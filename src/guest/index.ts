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
import type { GuestPathPattern } from "./__generated__/route-table";
import { registerManagerFactory, getOrCreateManager } from "../client-infra/manager-registry";
import { ValidationError } from "../errors";

type StripV3<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;

function gp<P extends StripV3<GuestPathPattern>>(path: P): P {
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
                } catch {
                    return false;
                }
            }

            return false;
        } catch (e) {
            // SECURITY: Returning false on error means a guest user may be treated as non-guest.
            // This is the safer default for most callers (e.g., sync, room access), but callers
            // that need definitive guest status should check separately.
            logger.error("GuestManager.isGuest failed - treating user as non-guest:", e);
            return false;
        }
    }

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
            // @swallow-error { owner: "guest", expires: "2026-12-31" }
        } catch (error) {
            this.emit(GuestEvent.GuestError, error as Error);
            throw error;
        }
    }

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

    async getGuestRooms(): Promise<string[]> {
        if (!this.guestInfo) {
            return [];
        }

        try {
            const rooms = this.client.getRooms?.() || [];
            return rooms.map((r: Room) => r.roomId);
            // @swallow-error { owner: "guest", expires: "2026-12-31" }
        } catch (e) {
            logger.warn("GuestManager.getGuestRooms failed:", e);
            return [];
        }
    }

    async joinRoomAsGuest(roomIdOrAlias: string): Promise<{ roomId: string }> {
        if (!this.guestInfo) {
            throw new Error("No guest account available");
        }

        try {
            const room = await this.client.joinRoom(roomIdOrAlias);

            return { roomId: room.roomId };
            // @swallow-error { owner: "guest", expires: "2026-12-31" }
        } catch (error) {
            this.emit(GuestEvent.GuestError, error as Error);
            throw error;
        }
    }

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
        } catch {
            return false;
        }
    }

    clearGuestInfo(): void {
        this.guestInfo = null;
    }

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
