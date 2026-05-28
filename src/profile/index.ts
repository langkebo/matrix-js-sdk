/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/**
 * Profile Manager - 用户资料管理
 *
 * 提供用户资料相关的功能：获取、设置显示名、头像等
 *
 * 优化特性:
 * - LRU 缓存: 用户资料缓存 (200 条, TTL 10 分钟)
 * - 重试机制: 指数退避重试 (继承自 BaseManager)
 * - 监控指标: 请求统计和性能监控 (继承自 BaseManager)
 */

import { MatrixClient } from "../client";
import { UserEvent } from "../models/user";
import { Method } from "../http-api/index";
import { type EmptyObject } from "../@types/common";
import { getHttpUriForMxc } from "../content-repo";
import { BaseManager } from "../managers/base-manager";
import type { AuthPathPattern } from "../auth/__generated__/route-table";
import { getOrCreateManager } from "../client-infra/manager-registry";
import { LRUCache } from "../utils/lru-cache";
import { AdminValidators } from "../admin/validators";
import { ValidationError } from "../errors";
import { handleManagerError, type ErrorHandlingOptions } from "../error/index.js";
import {
    getExtendedProfileRequest,
    getExtendedProfilePropertyRequest,
    setExtendedProfilePropertyRequest,
    deleteExtendedProfilePropertyRequest,
    patchExtendedProfileRequest,
    setExtendedProfileRequest,
    selectExtendedProfileRequestPrefix,
} from "../client-profile-requests";
import { assertExtendedProfileSupported } from "../client-profile-core";

type StripAuthPrefix<P extends string> =
    P extends `/_matrix/client/v3${infer Rest}` ? Rest :
    P extends `/_matrix/client/r0${infer Rest}` ? Rest :
    P extends `/_matrix/client/v1${infer Rest}` ? Rest :
    P;

function ap<P extends StripAuthPrefix<AuthPathPattern>>(path: P): P {
    return path;
}

export enum ProfileEvent {
    ProfileUpdated = "ProfileUpdated",
    ProfileError = "ProfileError",
}

export interface IProfile {
    displayname?: string;
    avatar_url?: string;
}

export interface IExtendedProfile extends IProfile {
    [key: string]: unknown;
}

type ProfileField = keyof IProfile;
const ALL_PROFILE_FIELDS: readonly ProfileField[] = ["displayname", "avatar_url"];

interface CachedProfileEntry {
    profile: IProfile;
    isComplete: boolean;
    fields: Set<ProfileField>;
}

interface SetProfileFieldCacheOptions {
    mergeWithExisting?: boolean;
}

interface ProfileManagerEventMap {
    [ProfileEvent.ProfileUpdated]: (userId: string, profile: IProfile) => void;
    [ProfileEvent.ProfileError]: (error: Error) => void;
}

export class ProfileManager extends BaseManager<ProfileEvent, ProfileManagerEventMap> {
    private profileCache: LRUCache<CachedProfileEntry>;

    constructor(client: MatrixClient) {
        super(client);
        this.profileCache = new LRUCache<CachedProfileEntry>({
            maxSize: 200,
            ttl: 10 * 60 * 1000,
            name: "index.ts-iprofile",
        });
    }

    private getCachedProfileEntry(userId: string): CachedProfileEntry | undefined {
        return this.profileCache.get(userId);
    }

    private setCompleteProfileCache(userId: string, profile: IProfile): IProfile {
        const cachedProfile = { ...profile };
        this.profileCache.set(userId, {
            profile: cachedProfile,
            isComplete: true,
            fields: new Set<ProfileField>(ALL_PROFILE_FIELDS),
        });
        return cachedProfile;
    }

    private setProfileFieldCache<K extends ProfileField>(
        userId: string,
        field: K,
        value: IProfile[K],
        options: SetProfileFieldCacheOptions = {},
    ): IProfile {
        const cachedEntry = options.mergeWithExisting === false ? undefined : this.getCachedProfileEntry(userId);
        const profile = {
            ...(cachedEntry?.profile ?? {}),
            [field]: value,
        };
        const fields = new Set<ProfileField>(cachedEntry?.fields ?? []);
        fields.add(field);
        const isComplete =
            cachedEntry?.isComplete === true || ALL_PROFILE_FIELDS.every((profileField) => fields.has(profileField));
        this.profileCache.set(userId, {
            profile,
            isComplete,
            fields,
        });
        return profile;
    }

    private async getProfileField<K extends ProfileField>(
        userId: string,
        field: K,
        options: SetProfileFieldCacheOptions = {},
    ): Promise<IProfile[K]> {
        const path = ap(`/profile/${encodeURIComponent(userId)}/${encodeURIComponent(field)}` as StripAuthPrefix<AuthPathPattern>);

        const response = await this.withRetry(async () => {
            return await this.client.http.request<Pick<IProfile, K>>(Method.Get, path);
        });

        const profile = this.setProfileFieldCache(userId, field, response[field], options);
        this.emit(ProfileEvent.ProfileUpdated, userId, profile);
        return response[field];
    }

    /**
     * Set profile information
     */
    public setProfileInfo(info: "avatar_url", data: { avatar_url: string }): Promise<EmptyObject>;
    public setProfileInfo(info: "displayname", data: { displayname: string }): Promise<EmptyObject>;
    public async setProfileInfo<K extends ProfileField>(info: K, data: Pick<IProfile, K>): Promise<EmptyObject> {
        const path = ap(
            `/profile/${encodeURIComponent(this.client.credentials.userId!)}/${encodeURIComponent(
                info,
            )}` as StripAuthPrefix<AuthPathPattern>,
        );

        try {
            const result = await this.withRetry(async () => {
                return await this.client.http.authedRequest<EmptyObject>(Method.Put, path, undefined, data);
            });

            const userId = this.client.getUserId();
            if (userId) {
                const profile = this.setProfileFieldCache(userId, info, data[info]);
                this.emit(ProfileEvent.ProfileUpdated, userId, profile);
            }

            return result;
        } catch (e) {
            const error = this.normalizeError(e, "setProfileInfo");
            this.emit(ProfileEvent.ProfileError, error);
            throw error;
        }
    }

    /**
     * Set display name
     *
     * @param name - 显示名称
     * @returns Promise that resolves when the display name is set
     *
     * @example
     * ```typescript
     * // 设置显示名称
     * await profileManager.setDisplayName("Alice");
     *
     * // 监听资料更新事件
     * profileManager.on(ProfileEvent.ProfileUpdated, (userId, profile) => {
     *     console.log(`Profile updated for ${userId}:`, profile);
     * });
     * ```
     *
     * @throws {ValidationError} 如果显示名称为空或过长
     * @throws {ApiError} 如果 API 调用失败
     */
    public async setDisplayName(name: string): Promise<EmptyObject> {
        if (!name || name.trim().length === 0) {
            throw new ValidationError("Display name cannot be empty");
        }
        if (name.length > 255) {
            throw new ValidationError("Display name too long (max 255 characters)");
        }

        try {
            const prom = await this.setProfileInfo("displayname", { displayname: name });
            const user = this.client.getUser(this.client.getUserId()!);
            if (user) {
                user.displayName = name;
                user.emit(UserEvent.DisplayName, user.events.presence, user);
            }
            return prom;
        } catch (e) {
            throw this.normalizeError(e, "setDisplayName");
        }
    }

    /**
     * Set avatar URL
     *
     * @param url - MXC URL of the avatar (e.g., mxc://example.com/abc123)
     * @returns Promise that resolves when the avatar is set
     *
     * @example
     * ```typescript
     * // 上传头像并设置
     * const uploadResponse = await client.uploadContent(file);
     * await profileManager.setAvatarUrl(uploadResponse.content_uri);
     *
     * // 清除头像
     * await profileManager.setAvatarUrl("");
     * ```
     *
     * @throws {ValidationError} 如果 URL 格式无效
     * @throws {ApiError} 如果 API 调用失败
     */
    public async setAvatarUrl(url: string): Promise<EmptyObject> {
        if (url && !url.startsWith("mxc://") && url !== "") {
            throw new ValidationError("Avatar URL must be a valid MXC URL (mxc://...) or empty string");
        }

        try {
            const prom = await this.setProfileInfo("avatar_url", { avatar_url: url });
            const user = this.client.getUser(this.client.getUserId()!);
            if (user) {
                user.setAvatarUrl(url);
                user.emit(UserEvent.AvatarUrl, user.events.presence, user);
            }
            return prom;
        } catch (e) {
            throw this.normalizeError(e, "setAvatarUrl");
        }
    }

    /**
     * Get profile information
     *
     * @param userId - 用户 ID（格式：@localpart:homeserver）
     * @returns 用户资料信息
     *
     * @example
     * ```typescript
     * // 获取用户资料
     * const profile = await profileManager.getProfileInfo("@alice:example.com");
     * console.log("Display name:", profile.displayname);
     * console.log("Avatar URL:", profile.avatar_url);
     *
     * // 使用缓存
     * const cachedProfile = await profileManager.getProfileInfo("@alice:example.com");
     * // 第二次调用会使用缓存（10 分钟 TTL）
     * ```
     *
     * @throws {ValidationError} 如果用户 ID 格式无效
     * @throws {NotFoundError} 如果用户不存在
     * @throws {ApiError} 如果 API 调用失败
     */
    public async getProfileInfo(userId: string): Promise<IProfile> {
        AdminValidators.validateUserId(userId);

        const cachedEntry = this.getCachedProfileEntry(userId);
        if (cachedEntry?.isComplete) {
            return cachedEntry.profile;
        }

        const path = ap(`/profile/${encodeURIComponent(userId)}` as StripAuthPrefix<AuthPathPattern>);

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.request<IProfile>(Method.Get, path);
            });

            const profile = this.setCompleteProfileCache(userId, response);
            this.emit(ProfileEvent.ProfileUpdated, userId, profile);
            return profile;
        } catch (e) {
            const error = this.normalizeError(e, "getProfileInfo");
            this.emit(ProfileEvent.ProfileError, error);
            throw error;
        }
    }

    /**
     * Get display name
     *
     * @param userId - 用户 ID（格式：@localpart:homeserver）
     * @param forceRefresh - 是否强制刷新缓存（默认 false）
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 显示名称，如果不存在或出错则返回 null
     *
     * @example
     * ```typescript
     * // 获取显示名称
     * const displayName = await profileManager.getDisplayName("@alice:example.com");
     * console.log("Display name:", displayName);
     *
     * // 强制刷新缓存
     * const freshName = await profileManager.getDisplayName("@alice:example.com", true);
     *
     * // 不抛出错误
     * const name = await profileManager.getDisplayName("@invalid:example.com", false, false);
     * if (!name) {
     *     console.log("User not found or error occurred");
     * }
     * ```
     *
     * @throws {ValidationError} 如果用户 ID 格式无效
     * @throws {ApiError} 如果 API 调用失败且 throwOnError 为 true
     */
    public async getDisplayName(userId: string, forceRefresh = false, options: ErrorHandlingOptions | boolean = {}): Promise<string | null> {
        AdminValidators.validateUserId(userId);

        try {
            const cachedEntry = !forceRefresh ? this.getCachedProfileEntry(userId) : undefined;
            if (cachedEntry && (cachedEntry.isComplete || cachedEntry.fields.has("displayname"))) {
                return cachedEntry.profile.displayname ?? null;
            }
            const displayName = await this.getProfileField(userId, "displayname", {
                mergeWithExisting: !forceRefresh,
            });
            return displayName ?? null;
            // @swallow-error { owner: "profile", expires: "2026-12-31" }
        } catch (error) {
            const normalizedError = this.normalizeError(error, "getDisplayName");
            this.emit(ProfileEvent.ProfileError, normalizedError);
            return handleManagerError<string>(normalizedError, options, "getDisplayName");
        }
    }

    /**
     * Get avatar URL
     *
     * @param userId - 用户 ID（格式：@localpart:homeserver）
     * @param forceRefresh - 是否强制刷新缓存（默认 false）
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns MXC URL，如果不存在或出错则返回 null
     *
     * @example
     * ```typescript
     * // 获取头像 URL
     * const avatarUrl = await profileManager.getAvatarUrl("@alice:example.com");
     * if (avatarUrl) {
     *     // 转换为 HTTP URL
     *     const httpUrl = profileManager.getHttpUriForMxc(avatarUrl, 96, 96);
     *     console.log("Avatar HTTP URL:", httpUrl);
     * }
     *
     * // 强制刷新缓存
     * const freshUrl = await profileManager.getAvatarUrl("@alice:example.com", true);
     * ```
     *
     * @throws {ValidationError} 如果用户 ID 格式无效
     * @throws {ApiError} 如果 API 调用失败且 throwOnError 为 true
     */
    public async getAvatarUrl(userId: string, forceRefresh = false, options: ErrorHandlingOptions | boolean = {}): Promise<string | null> {
        AdminValidators.validateUserId(userId);

        try {
            const cachedEntry = !forceRefresh ? this.getCachedProfileEntry(userId) : undefined;
            if (cachedEntry && (cachedEntry.isComplete || cachedEntry.fields.has("avatar_url"))) {
                return cachedEntry.profile.avatar_url ?? null;
            }
            const avatarUrl = await this.getProfileField(userId, "avatar_url", {
                mergeWithExisting: !forceRefresh,
            });
            return avatarUrl ?? null;
            // @swallow-error { owner: "profile", expires: "2026-12-31" }
        } catch (error) {
            const normalizedError = this.normalizeError(error, "getAvatarUrl");
            this.emit(ProfileEvent.ProfileError, normalizedError);
            return handleManagerError<string>(normalizedError, options, "getAvatarUrl");
        }
    }

    /**
     * Helper to get an HTTP URL for a MXC URL
     */
    public getHttpUriForMxc(
        mxcUrl: string,
        width?: number,
        height?: number,
        method?: string,
        allowDirectLinks?: boolean,
    ): string | null {
        return getHttpUriForMxc(this.client.getHomeserverUrl(), mxcUrl, width, height, method, allowDirectLinks);
    }

    public mxcUrlToHttp(
        mxcUrl: string,
        width?: number,
        height?: number,
        method?: string,
        allowDirectLinks?: boolean,
        _allowRedirects?: boolean,
        _ignoreCertificateErrors?: boolean,
    ): string | null {
        return this.getHttpUriForMxc(mxcUrl, width, height, method, allowDirectLinks);
    }

    /**
     * @deprecated Use {@link getDisplayName}
     */
    public async getStateDisplayName(userId: string, forceRefresh = false): Promise<string | null> {
        return this.getDisplayName(userId, forceRefresh, false);
    }

    /**
     * @deprecated Use {@link getAvatarUrl}
     */
    public async getStateAvatarUrl(userId: string, forceRefresh = false): Promise<string | null> {
        return this.getAvatarUrl(userId, forceRefresh, false);
    }

    /**
     * Determine if the server supports extended profiles, as described by MSC4133.
     *
     * @returns `true` if supported, otherwise `false`
     */
    public async doesServerSupportExtendedProfiles(): Promise<boolean> {
        return (
            (await this.client.isVersionSupported("v1.16")) ||
            (await this.client.doesServerSupportUnstableFeature("uk.tcpip.msc4133")) ||
            (await this.client.doesServerSupportUnstableFeature("uk.tcpip.msc4133.stable"))
        );
    }

    /**
     * Get the prefix used for extended profile requests.
     */
    private async getExtendedProfileRequestPrefix(): Promise<string> {
        return selectExtendedProfileRequestPrefix(
            await this.client.isVersionSupported("v1.16"),
            await this.client.doesServerSupportUnstableFeature("uk.tcpip.msc4133.stable"),
        );
    }

    private async assertExtendedProfileSupport(): Promise<void> {
        assertExtendedProfileSupported(await this.doesServerSupportExtendedProfiles());
    }

    /**
     * Fetch a user's *extended* profile, which may include additional keys.
     *
     * @see https://github.com/tcpipuk/matrix-spec-proposals/blob/main/proposals/4133-extended-profiles.md
     * @param userId The user ID to fetch the profile of.
     * @returns A set of keys to property values.
     *
     * @throws An error if the server does not support MSC4133.
     * @throws A M_NOT_FOUND error if the profile could not be found.
     */
    public async getExtendedProfile(userId: string): Promise<IExtendedProfile> {
        await this.assertExtendedProfileSupport();
        return getExtendedProfileRequest(
            userId,
            await this.getExtendedProfileRequestPrefix(),
            this.client.http.authedRequest.bind(this.client.http),
        );
    }

    /**
     * Fetch a specific key from the user's *extended* profile.
     *
     * @see https://github.com/tcpipuk/matrix-spec-proposals/blob/main/proposals/4133-extended-profiles.md
     * @param userId The user ID to fetch the profile of.
     * @param key The key of the property to fetch.
     * @returns The property value.
     *
     * @throws An error if the server does not support MSC4133.
     * @throws A M_NOT_FOUND error if the key was not set OR the profile could not be found.
     */
    public async getExtendedProfileProperty(userId: string, key: string): Promise<unknown> {
        await this.assertExtendedProfileSupport();
        return getExtendedProfilePropertyRequest(
            userId,
            key,
            await this.getExtendedProfileRequestPrefix(),
            this.client.http.authedRequest.bind(this.client.http),
        );
    }

    /**
     * Set a property on your *extended* profile.
     *
     * @see https://github.com/tcpipuk/matrix-spec-proposals/blob/main/proposals/4133-extended-profiles.md
     * @param key The key of the property to set.
     * @param value The value to set on the property.
     *
     * @throws An error if the server does not support MSC4133 OR the server disallows editing the user profile.
     */
    public async setExtendedProfileProperty(key: string, value: unknown): Promise<void> {
        await this.assertExtendedProfileSupport();
        return setExtendedProfilePropertyRequest(
            this.client.getUserId(),
            key,
            value,
            await this.getExtendedProfileRequestPrefix(),
            this.client.http.authedRequest.bind(this.client.http),
        );
    }

    /**
     * Delete a property on your *extended* profile.
     *
     * @see https://github.com/tcpipuk/matrix-spec-proposals/blob/main/proposals/4133-extended-profiles.md
     * @param key The key of the property to delete.
     *
     * @throws An error if the server does not support MSC4133 OR the server disallows editing the user profile.
     */
    public async deleteExtendedProfileProperty(key: string): Promise<void> {
        await this.assertExtendedProfileSupport();
        return deleteExtendedProfilePropertyRequest(
            this.client.getUserId(),
            key,
            await this.getExtendedProfileRequestPrefix(),
            this.client.http.authedRequest.bind(this.client.http),
        );
    }

    /**
     * Update multiple properties on your *extended* profile. This will
     * merge with any existing keys.
     *
     * @see https://github.com/tcpipuk/matrix-spec-proposals/blob/main/proposals/4133-extended-profiles.md
     * @param profile The profile object to merge with the existing profile.
     * @returns The newly merged profile.
     *
     * @throws An error if the server does not support MSC4133 OR the server disallows editing the user profile.
     */
    public async patchExtendedProfile(profile: IExtendedProfile): Promise<IExtendedProfile> {
        await this.assertExtendedProfileSupport();
        return patchExtendedProfileRequest(
            this.client.getUserId(),
            profile,
            await this.getExtendedProfileRequestPrefix(),
            this.client.http.authedRequest.bind(this.client.http),
        );
    }

    /**
     * Set multiple properties on your *extended* profile. This will completely
     * replace the existing profile, removing any unspecified keys.
     *
     * @see https://github.com/tcpipuk/matrix-spec-proposals/blob/main/proposals/4133-extended-profiles.md
     * @param profile The profile object to set.
     *
     * @throws An error if the server does not support MSC4133 OR the server disallows editing the user profile.
     */
    public async setExtendedProfile(profile: IExtendedProfile): Promise<void> {
        await this.assertExtendedProfileSupport();
        await setExtendedProfileRequest(
            this.client.getUserId(),
            profile,
            await this.getExtendedProfileRequestPrefix(),
            this.client.http.authedRequest.bind(this.client.http),
        );
    }

    public getCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
        return this.profileCache.getStats();
    }

    public clearCache(): void {
        this.profileCache.clear();
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getProfileManager(): ProfileManager;
        setDisplayName(name: string): Promise<void>;
        setAvatarUrl(url: string): Promise<void>;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getProfileManager = function (): ProfileManager {
        return getOrCreateManager(this, "profile", () => new ProfileManager(this));
    };
    MatrixClient.prototype.getProfileInfo = function (userId: string): Promise<IProfile> {
        return this.getProfileManager().getProfileInfo(userId);
    };
    MatrixClient.prototype.getUserProfile = function (userId: string): Promise<IProfile> {
        return this.getProfileManager().getProfileInfo(userId);
    };
    MatrixClient.prototype.setDisplayName = async function (name: string): Promise<void> {
        await this.getProfileManager().setDisplayName(name);
    };
    MatrixClient.prototype.setAvatarUrl = async function (url: string): Promise<void> {
        await this.getProfileManager().setAvatarUrl(url);
    };
}

export default extendMatrixClient;
