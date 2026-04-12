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
import * as utils from "../utils";
import { ClientPrefix } from "../http-api/prefix";
import { logger } from "../logger";
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";
import { LRUCache } from "../utils/lru-cache.ts";

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
interface ProfileManagerEventMap {
    [ProfileEvent.ProfileUpdated]: (userId: string, profile: IProfile) => void;
    [ProfileEvent.ProfileError]: (error: Error) => void;
}

export class ProfileManager extends BaseManager<ProfileEvent, ProfileManagerEventMap> {
    private profileCache: LRUCache<IProfile>;

    constructor(client: MatrixClient) {
        super(client);
        this.profileCache = new LRUCache<IProfile>({ maxSize: 200, ttl: 10 * 60 * 1000, name: "index.ts-iprofile" });
    }

    /**
     * Set profile information
     */
    public setProfileInfo(info: "avatar_url", data: { avatar_url: string }): Promise<EmptyObject>;
    public setProfileInfo(info: "displayname", data: { displayname: string }): Promise<EmptyObject>;
    public async setProfileInfo(info: "avatar_url" | "displayname", data: object): Promise<EmptyObject> {
        const path = utils.encodeUri("/profile/$userId/$info", {
            $userId: this.client.credentials.userId!,
            $info: info,
        });

        try {
            const result = await this.withRetry(async () => {
                return await this.client.http.authedRequest<EmptyObject>(Method.Put, path, undefined, data);
            });

            const userId = this.client.getUserId();
            if (userId) {
                this.profileCache.delete(userId);
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
     */
    public async setDisplayName(name: string): Promise<EmptyObject> {
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
     */
    public async setAvatarUrl(url: string): Promise<EmptyObject> {
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
     */
    public async getProfileInfo(userId: string): Promise<IProfile> {
        if (this.profileCache.has(userId)) {
            return this.profileCache.get(userId)!;
        }

        const path = utils.encodeUri("/profile/$userId", {
            $userId: userId,
        });

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<IProfile>(Method.Get, path);
            });

            this.profileCache.set(userId, response);
            this.emit(ProfileEvent.ProfileUpdated, userId, response);
            return response;
        } catch (e) {
            const error = this.normalizeError(e, "getProfileInfo");
            this.emit(ProfileEvent.ProfileError, error);
            throw error;
        }
    }

    /**
     * Get display name
     */
    public async getDisplayName(userId: string, forceRefresh = false, throwOnError = false): Promise<string | null> {
        try {
            if (!forceRefresh && this.profileCache.has(userId)) {
                return this.profileCache.get(userId)?.displayname ?? null;
            }
            const info = await this.getProfileInfo(userId);
            return info.displayname ?? null;
            // @swallow-error { owner: "profile", expires: "2026-12-31" }
        } catch (error) {
            if (throwOnError) {
                throw this.normalizeError(error, "getDisplayName");
            }
            logger.warn(`ProfileManager.getDisplayName failed for ${userId}:`, error);
            return null;
        }
    }

    /**
     * Get avatar URL
     */
    public async getAvatarUrl(userId: string, forceRefresh = false, throwOnError = false): Promise<string | null> {
        try {
            if (!forceRefresh && this.profileCache.has(userId)) {
                return this.profileCache.get(userId)?.avatar_url ?? null;
            }
            const info = await this.getProfileInfo(userId);
            return info.avatar_url ?? null;
            // @swallow-error { owner: "profile", expires: "2026-12-31" }
        } catch (error) {
            if (throwOnError) {
                throw this.normalizeError(error, "getAvatarUrl");
            }
            logger.warn(`ProfileManager.getAvatarUrl failed for ${userId}:`, error);
            return null;
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
        return this.getDisplayName(userId, forceRefresh);
    }

    /**
     * @deprecated Use {@link getAvatarUrl}
     */
    public async getStateAvatarUrl(userId: string, forceRefresh = false): Promise<string | null> {
        return this.getAvatarUrl(userId, forceRefresh);
    }

    /**
     * Extended profiles (MSC4133)
     */
    public async getExtendedProfile(userId: string): Promise<IExtendedProfile> {
        const path = utils.encodeUri("/profile/$userId", {
            $userId: userId,
        });

        try {
            return await this.withRetry(async () => {
                return await this.client.http.authedRequest<IExtendedProfile>(Method.Get, path, undefined, undefined, {
                    prefix: ClientPrefix.Unstable,
                });
            });
        } catch (e) {
            throw this.normalizeError(e, "getExtendedProfile");
        }
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
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getProfileManager = function (): ProfileManager {
        return getOrCreateManager(this, "profile", () => new ProfileManager(this));
    };
}

export default extendMatrixClient;
