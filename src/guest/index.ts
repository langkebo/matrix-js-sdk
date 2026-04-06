import { logger } from "../logger"
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

import { TypedEventEmitter } from "../models/typed-event-emitter.ts";
import { Method } from "../http-api/method.ts";
import { ClientPrefix } from "../http-api/prefix.ts";
import { MatrixClient } from "../client";

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
        [key: string]: any;
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

export interface IServerGuestInfoResponse {
    guest: IServerGuestInfo;
}

export interface IUpgradeGuestRequest {
    username?: string;
    password: string;
    auth?: any;
}

export interface IUpgradeGuestResponse {
    user_id: string;
    access_token?: string;
    device_id?: string;
}

interface GuestManagerEventMap {
    [GuestEvent.GuestRegistered]: (guestInfo: IGuestInfo) => void;
    [GuestEvent.GuestLoggedIn]: (guestInfo: IGuestInfo) => void;
    [GuestEvent.GuestUpgraded]: (userId: string) => void;
    [GuestEvent.GuestInfoReceived]: (guestInfo: IServerGuestInfo) => void;
    [GuestEvent.GuestError]: (error: Error) => void;
}

export class GuestManager extends TypedEventEmitter<GuestEvent, GuestManagerEventMap> {
    private client: any;
    private guestInfo: IGuestInfo | null = null;
    private baseUrl: string;

    constructor(client: any, baseUrl: string) {
        super();
        this.client = client;
        this.baseUrl = baseUrl;
    }

    async registerGuest(deviceId?: string, initialDeviceDisplayName?: string): Promise<IGuestRegisterResponse> {
        try {
            const body: Record<string, any> = {
                kind: 'guest',
            };

            if (deviceId) {
                body.device_id = deviceId;
            }

            if (initialDeviceDisplayName) {
                body.initial_device_display_name = initialDeviceDisplayName;
            }

            const response = await this.client.http.request(
                Method.Post,
                "/register",
                undefined,
                body,
                { prefix: ClientPrefix.V3 }
            );

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

    async loginGuest(deviceId?: string, initialDeviceDisplayName?: string): Promise<IGuestLoginResponse> {
        try {
            const body: Record<string, any> = {
                type: 'm.login.guest',
            };

            if (deviceId) {
                body.device_id = deviceId;
            }

            if (initialDeviceDisplayName) {
                body.initial_device_display_name = initialDeviceDisplayName;
            }

            const response = await this.client.http.request(
                Method.Post,
                "/login",
                undefined,
                body,
                { prefix: ClientPrefix.V3 }
            );

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

            const profile = await this.client.getProfileInfo(targetUserId);
            
            return profile?.is_guest === true;
        } catch (e) {
            logger.warn('GuestManager.isGuest failed:', e);
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

    async upgradeGuestAccount(password: string, authDict?: any): Promise<void> {
        if (!this.guestInfo) {
            throw new Error("No guest account to upgrade");
        }

        try {
            const body: Record<string, any> = {
                password,
            };

            if (authDict) {
                body.auth = authDict;
            }

            await this.client.http.authedRequest(
                Method.Post,
                "/account/password",
                undefined,
                body,
                { prefix: ClientPrefix.V3 }
            );

            this.guestInfo = null;
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
            return rooms.map((r: any) => r.roomId);
        } catch (e) {
            logger.warn('GuestManager.getGuestRooms failed:', e);
            return [];
        }
    }

    async joinRoomAsGuest(roomIdOrAlias: string): Promise<{ roomId: string }> {
        if (!this.guestInfo) {
            throw new Error("No guest account available");
        }

        try {
            const response = await this.client.joinRoom(roomIdOrAlias, {
                syncRoom: true,
            });

            return { roomId: response.roomId };
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
                const response = await this.client.http.authedRequest(
                    Method.Get,
                    `/directory/room/${encodeURIComponent(roomIdOrAlias)}`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 }
                );
                return !!response?.room_id;
            }

            // For room IDs, avoid probing join semantics with a non-standard GET request.
            return !!this.client.getRoom?.(roomIdOrAlias);
        } catch (e) {
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
            const response = await this.client.http.authedRequest(
                Method.Get,
                "/account/guest",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            ) as IServerGuestInfoResponse;

            const guestInfo = response.guest;
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

        try {
            const body: Record<string, any> = {
                password: request.password,
            };

            if (request.username) {
                body.username = request.username;
            }

            if (request.auth) {
                body.auth = request.auth;
            }

            const response = await this.client.http.authedRequest(
                Method.Post,
                "/account/guest/upgrade",
                undefined,
                body,
                { prefix: ClientPrefix.V3 }
            ) as IUpgradeGuestResponse;

            this.guestInfo = null;
            this.emit(GuestEvent.GuestUpgraded, response.user_id);

            return response;
        } catch (error) {
            this.emit(GuestEvent.GuestError, error as Error);
            throw error;
        }
    }

    public async registerGuestOnServer(deviceId?: string, initialDeviceDisplayName?: string): Promise<IGuestRegisterResponse> {
        try {
            const body: Record<string, any> = {};

            if (deviceId) {
                body.device_id = deviceId;
            }

            if (initialDeviceDisplayName) {
                body.initial_device_display_name = initialDeviceDisplayName;
            }

            const response = await this.client.http.request(
                Method.Post,
                "/register/guest",
                undefined,
                body,
                { prefix: ClientPrefix.V3 }
            ) as IGuestRegisterResponse;

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

declare module "../client.ts" {
    interface MatrixClient {
        getGuestManager(): GuestManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getGuestManager = function (): GuestManager {
        return new GuestManager(this, this.getHomeserverUrl());
    };
}

export default extendMatrixClient;
