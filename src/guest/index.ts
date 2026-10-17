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
 * Guest Manager - 访客管理
 *
 * 提供访客账户注册和登录功能
 *
 * 对应后端 API:
 * - POST /_matrix/client/v3/register/guest
 * - GET /_matrix/client/v3/account/guest
 * - POST /_matrix/client/v3/account/guest/upgrade
 */

import { logger } from "../logger";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { MatrixClient } from "../client";
import type { Room } from "../models/room";
import type { GuestPath } from "./__generated__/route-table";
import { registerManagerFactory, getOrCreateManager } from "../client-infra/manager-registry";
import { ValidationError } from "../errors";
import type { PathAssert, StripV3 } from "../http-api/strip-prefix";

function gp<const P extends string>(path: P & PathAssert<P, StripV3<GuestPath>>): P {
    return path;
}

export enum GuestEvent {
    GuestRegistered = "GuestRegistered",
    GuestLoggedIn = "GuestLoggedIn",
    GuestUpgraded = "GuestUpgraded",
    GuestInfoReceived = "GuestInfoReceived",
    GuestError = "GuestError",
}

export interface IGuestRegisterResponse {
    user_id: string;
    device_id: string;
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
}

export interface IGuestLoginResponse {
    user_id: string;
    device_id: string;
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    well_known?: {
        [key: string]: unknown;
    };
}

export interface IGuestInfo {
    userId: string;
    deviceId: string;
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
}

export interface IServerGuestInfo {
    user_id: string;
    device_id: string;
    is_guest: boolean;
    created_at?: number;
}

export type IServerGuestInfoResponse = IServerGuestInfo | { guest: IServerGuestInfo };

export interface IAuthDict {
    type?: string;
    session?: string;
    [key: string]: unknown;
}

export interface IUpgradeGuestRequest {
    username: string;
    password: string;
    auth?: IAuthDict;
}

export interface IUpgradeGuestResponse {
    success: boolean;
    user_id: string;
    access_token: string;
    device_id?: string;
}

/** Guest 注册请求体 */
interface GuestRegisterBody {
    kind: "guest";
    device_id?: string;
    initial_device_display_name?: string;
}

/** Guest 登录请求体 */
interface GuestLoginBody {
    type: "m.login.guest";
    device_id?: string;
    initial_device_display_name?: string;
}

/** Guest 账户升级请求体（旧接口） */
interface GuestUpgradeBody {
    password: string;
    auth?: IAuthDict;
}

/** Guest 服务器端升级请求体 */
interface GuestServerUpgradeBody {
    username: string;
    password: string;
    auth?: IAuthDict;
}

/** Guest 服务器端注册请求体 */
interface GuestServerRegisterBody {
    device_id?: string;
    initial_device_display_name?: string;
}

interface GuestManagerEventMap {
    [GuestEvent.GuestRegistered]: (guestInfo: IGuestInfo) => void;
    [GuestEvent.GuestLoggedIn]: (guestInfo: IGuestInfo) => void;
    [GuestEvent.GuestUpgraded]: (userId: string) => void;
    [GuestEvent.GuestInfoReceived]: (guestInfo: IServerGuestInfo) => void;
    [GuestEvent.GuestError]: (error: Error) => void;
}

export class GuestManager extends BaseManager<GuestEvent, GuestManagerEventMap> {
    private guestInfo: IGuestInfo | null = null;
    private baseUrl: string;

    constructor(client: MatrixClient, baseUrl: string, opts?: ManagerOpts) {
        super(client, opts);
        this.baseUrl = baseUrl;
    }

    /**
     * 以游客（guest）身份向服务端注册新账号，成功后缓存游客信息并发出 {@link GuestEvent.GuestRegistered}。
     *
     * @param deviceId - 可选设备 ID
     * @param initialDeviceDisplayName - 可选初始设备显示名
     * @returns 注册响应（含 `user_id` / `access_token` 等）
     * @throws 当服务端注册失败时原样抛出
     * @example
     * const res = await client.getGuestManager().registerGuest("DEVICE", "Web");
     */
    async registerGuest(deviceId?: string, initialDeviceDisplayName?: string): Promise<IGuestRegisterResponse> {
        try {
            const body: GuestRegisterBody = {
                kind: "guest",
            };

            if (deviceId) {
                body.device_id = deviceId;
            }

            if (initialDeviceDisplayName) {
                body.initial_device_display_name = initialDeviceDisplayName;
            }

            const response = await this.withRetry(async () => {
                return await this.request<IGuestRegisterResponse>({
                    method: Method.Post,
                    path: "/register",
                    body: body,
                    prefix: ClientPrefix.V3,
                    authenticated: false,
                });
            }, "registerGuest");

            const guestInfo: IGuestInfo = {
                userId: response.user_id,
                deviceId: response.device_id,
                accessToken: response.access_token,
                refreshToken: response.refresh_token,
                expiresAt: response.expires_in ? Date.now() + response.expires_in * 1000 : undefined,
            };

            this.guestInfo = guestInfo;
            this.emit(GuestEvent.GuestRegistered, guestInfo);

            return response;
        } catch (error) {
            this.emit(GuestEvent.GuestError, this.normalizeError(error, "registerGuestOnServer"));
            throw error;
        }
    }

    /**
     * 以游客身份登录，成功后缓存游客信息并发出 {@link GuestEvent.GuestLoggedIn}。
     *
     * @param deviceId - 可选设备 ID
     * @param initialDeviceDisplayName - 可选初始设备显示名
     * @returns 登录响应（含 `user_id` / `access_token` 等）
     * @throws 当登录失败时原样抛出
     * @example
     * const res = await client.getGuestManager().loginGuest("DEVICE", "Web");
     */
    async loginGuest(deviceId?: string, initialDeviceDisplayName?: string): Promise<IGuestLoginResponse> {
        try {
            const body: GuestLoginBody = {
                type: "m.login.guest",
            };

            if (deviceId) {
                body.device_id = deviceId;
            }

            if (initialDeviceDisplayName) {
                body.initial_device_display_name = initialDeviceDisplayName;
            }

            const response = await this.withRetry(async () => {
                return await this.request<IGuestLoginResponse>({
                    method: Method.Post,
                    path: "/login",
                    body: body,
                    prefix: ClientPrefix.V3,
                    authenticated: false,
                });
            }, "loginGuest");

            const guestInfo: IGuestInfo = {
                userId: response.user_id,
                deviceId: response.device_id,
                accessToken: response.access_token,
                refreshToken: response.refresh_token,
                expiresAt: response.expires_in ? Date.now() + response.expires_in * 1000 : undefined,
            };

            this.guestInfo = guestInfo;
            this.emit(GuestEvent.GuestLoggedIn, guestInfo);

            return response;
        } catch (error) {
            this.emit(GuestEvent.GuestError, error as Error);
            throw error;
        }
    }

    /**
     * 判断指定用户（缺省为当前用户）是否为游客。
     *
     * @param userId - 可选用户 ID，缺省使用当前登录用户
     * @returns 是否为游客；查询失败时按「非游客」处理并返回 false
     * @example
     * const guest = await client.getGuestManager().isGuest();
     */
    async isGuest(userId?: string): Promise<boolean> {
        try {
            const targetUserId = userId || this.client.getUserId();
            if (!targetUserId) {
                return false;
            }

            if (targetUserId === this.client.getUserId()) {
                try {
                    const guestInfo = await this.getGuestInfoFromServer();
                    return guestInfo?.is_guest === true;
                } catch (e) {
                    logger.warn("GuestManager.isGuest failed:", e);
                }
                return false;
            }

            return false;
        } catch (e) {
            // SECURITY: Returning false on error means a guest user may be treated as non-guest.
            // This is the safer default for most callers (e.g., sync, room access), but callers
            // that need definitive guest status should check separately.
            logger.error("GuestManager.isGuest failed - treating user as non-guest:", e);
        }
        return false;
    }

    /**
     * 获取当前游客账号的访问令牌。
     *
     * @returns 访问令牌；无游客信息或已过期时返回 null
     * @example
     * const token = await client.getGuestManager().getGuestAccessToken();
     */
    async getGuestAccessToken(): Promise<string | null> {
        if (!this.guestInfo) {
            return null;
        }

        if (this.guestInfo.expiresAt && this.guestInfo.expiresAt < Date.now()) {
            this.guestInfo = null;
            return null;
        }

        return this.guestInfo.accessToken;
    }

    /**
     * 通过设置密码将当前游客账号升级为普通账号。
     *
     * @param password - 新账号密码
     * @param authDict - 可选交互式认证参数
     * @throws 当不存在可升级的游客账号，或升级请求失败时
     * @example
     * await client.getGuestManager().upgradeGuestAccount("s3cret");
     */
    async upgradeGuestAccount(password: string, authDict?: IAuthDict): Promise<void> {
        if (!this.guestInfo) {
            throw new Error("No guest account to upgrade");
        }

        try {
            const body: GuestUpgradeBody = {
                password,
            };

            if (authDict) {
                body.auth = authDict;
            }

            await this.withRetry(async () => {
                await this.request({
                    method: Method.Post,
                    path: "/account/password",
                    body: body,
                    prefix: ClientPrefix.V3,
                });
            }, "upgradeGuestAccount");

            this.guestInfo = null;
        } catch (error) {
            this.emit(GuestEvent.GuestError, error as Error);
            throw error;
        }
    }

    /**
     * 获取缓存的游客信息副本。
     *
     * @returns 游客信息；无游客信息或已过期时返回 null
     * @example
     * const info = client.getGuestManager().getGuestInfo();
     */
    getGuestInfo(): IGuestInfo | null {
        if (!this.guestInfo) {
            return null;
        }

        if (this.guestInfo.expiresAt && this.guestInfo.expiresAt < Date.now()) {
            this.guestInfo = null;
            return null;
        }

        return { ...this.guestInfo };
    }

    /**
     * 列出当前游客账号可访问的房间。
     *
     * @returns 房间 ID 列表；非游客或查询失败时返回空数组
     * @example
     * const rooms = await client.getGuestManager().getGuestRooms();
     */
    async getGuestRooms(): Promise<string[]> {
        if (!this.guestInfo) {
            return [];
        }

        try {
            const rooms = this.client.getRooms?.() || [];
            return rooms.map((r: Room) => r.roomId);
        } catch (e) {
            logger.warn("GuestManager.getGuestRooms failed:", e);
        }
        return [];
    }

    /**
     * 以游客身份加入指定房间。
     *
     * @param roomIdOrAlias - 房间 ID 或别名
     * @returns 加入后的房间 ID
     * @throws 当不存在游客账号，或加入失败时
     * @example
     * const { roomId } = await client.getGuestManager().joinRoomAsGuest("!abc:example.org");
     */
    async joinRoomAsGuest(roomIdOrAlias: string): Promise<{ roomId: string }> {
        if (!this.guestInfo) {
            throw new Error("No guest account available");
        }

        try {
            const room = await this.client.joinRoom(roomIdOrAlias);

            return { roomId: room.roomId };
        } catch (error) {
            this.emit(GuestEvent.GuestError, error as Error);
            throw error;
        }
    }

    /**
     * 判断当前游客是否可加入指定房间：别名走目录服务查询，房间 ID 走本地已知房间判断。
     *
     * @param roomIdOrAlias - 房间 ID 或别名
     * @returns 是否可加入；查询失败时返回 false
     * @example
     * const ok = await client.getGuestManager().canJoinRoom("#room:example.org");
     */
    async canJoinRoom(roomIdOrAlias: string): Promise<boolean> {
        try {
            if (!roomIdOrAlias) {
                return false;
            }

            if (roomIdOrAlias.startsWith("#")) {
                const response = await this.withRetry(async () => {
                    return await this.request<{ room_id?: string }>({
                        method: Method.Get,
                        path: `/directory/room/${encodeURIComponent(roomIdOrAlias)}`,
                        prefix: ClientPrefix.V3,
                    });
                }, "canJoinRoom");
                return !!response?.room_id;
            }

            // For room IDs, avoid probing join semantics with a non-standard GET request.
            return !!this.client.getRoom?.(roomIdOrAlias);
        } catch (e) {
            logger.warn("GuestManager.canJoinRoom failed:", e);
        }
        return false;
    }

    /**
     * 清空缓存的游客信息。
     *
     * @example
     * client.getGuestManager().clearGuestInfo();
     */
    clearGuestInfo(): void {
        this.guestInfo = null;
    }

    /**
     * 判断当前缓存的游客令牌是否仍然有效（存在且未过期）。
     *
     * @returns 令牌是否有效
     * @example
     * const valid = client.getGuestManager().isGuestTokenValid();
     */
    isGuestTokenValid(): boolean {
        if (!this.guestInfo) {
            return false;
        }

        if (this.guestInfo.expiresAt && this.guestInfo.expiresAt < Date.now()) {
            this.guestInfo = null;
            return false;
        }

        return true;
    }

    /**
     * 从服务端拉取当前用户的游客信息，并发出 {@link GuestEvent.GuestInfoReceived}。
     *
     * @returns 服务端返回的游客信息
     * @throws 当请求失败时原样抛出
     * @example
     * const info = await client.getGuestManager().getGuestInfoFromServer();
     */
    public async getGuestInfoFromServer(): Promise<IServerGuestInfo> {
        try {
            const response = (await this.withRetry(async () => {
                return await this.request({
                    method: Method.Get,
                    path: gp("/account/guest"),
                    prefix: ClientPrefix.V3,
                });
            }, "getGuestInfoFromServer")) as IServerGuestInfoResponse;

            const guestInfo = "guest" in response ? response.guest : response;
            this.emit(GuestEvent.GuestInfoReceived, guestInfo);

            return guestInfo;
        } catch (error) {
            logger.warn("GuestManager.getGuestInfoFromServer failed:", error);
            throw error;
        }
    }

    /**
     * 通过服务端接口将游客账号升级为普通账号。
     *
     * @param request - 升级请求（`username` 必填）
     * @returns 升级响应
     * @throws {ValidationError} 当 `username` 缺失时；以及不存在可升级账号或请求失败时
     * @example
     * const res = await client
     *     .getGuestManager()
     *     .upgradeGuestAccountOnServer({ username: "alice", password: "s3cret" });
     */
    public async upgradeGuestAccountOnServer(request: IUpgradeGuestRequest): Promise<IUpgradeGuestResponse> {
        if (!this.guestInfo && !this.client.getUserId()) {
            throw new Error("No guest account to upgrade");
        }
        if (!request.username) {
            throw new ValidationError("username is required");
        }

        try {
            const body: GuestServerUpgradeBody = {
                username: request.username,
                password: request.password,
            };

            if (request.auth) {
                body.auth = request.auth;
            }

            const response = (await this.withRetry(async () => {
                return await this.request({
                    method: Method.Post,
                    path: gp("/account/guest/upgrade"),
                    body: body,
                    prefix: ClientPrefix.V3,
                });
            }, "upgradeGuestAccountOnServer")) as IUpgradeGuestResponse;

            this.guestInfo = null;
            this.emit(GuestEvent.GuestUpgraded, response.user_id);

            return response;
        } catch (error) {
            this.emit(GuestEvent.GuestError, error as Error);
            throw error;
        }
    }

    /**
     * 通过服务端专用接口注册游客账号，成功后缓存游客信息并发出 {@link GuestEvent.GuestRegistered}。
     *
     * @param deviceId - 可选设备 ID
     * @param initialDeviceDisplayName - 可选初始设备显示名
     * @returns 注册响应
     * @throws 当注册请求失败时原样抛出
     * @example
     * const res = await client.getGuestManager().registerGuestOnServer();
     */
    public async registerGuestOnServer(
        deviceId?: string,
        initialDeviceDisplayName?: string,
    ): Promise<IGuestRegisterResponse> {
        try {
            const body: GuestServerRegisterBody = {};

            if (deviceId) {
                body.device_id = deviceId;
            }

            if (initialDeviceDisplayName) {
                body.initial_device_display_name = initialDeviceDisplayName;
            }

            const response = (await this.withRetry(async () => {
                return await this.request({
                    method: Method.Post,
                    path: gp("/register/guest"),
                    body: body,
                    prefix: ClientPrefix.V3,
                    authenticated: false,
                });
            }, "registerGuestOnServer")) as IGuestRegisterResponse;

            const guestInfo: IGuestInfo = {
                userId: response.user_id,
                deviceId: response.device_id,
                accessToken: response.access_token,
                refreshToken: response.refresh_token,
                expiresAt: response.expires_in ? Date.now() + response.expires_in * 1000 : undefined,
            };

            this.guestInfo = guestInfo;
            this.emit(GuestEvent.GuestRegistered, guestInfo);

            return response;
        } catch (error) {
            this.emit(GuestEvent.GuestError, error as Error);
            throw error;
        }
    }

    /**
     * 停止管理器并清空缓存的游客信息。
     *
     * @example
     * client.getGuestManager().stop();
     */
    stop(): void {
        this.guestInfo = null;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getGuestManager = function (): GuestManager {
        registerManagerFactory("guest", (client) => new GuestManager(client, client.getHomeserverUrl()));
        return getOrCreateManager(this, "guest", () => new GuestManager(this, this.getHomeserverUrl()));
    };
}
