import { MatrixClient } from "../client";
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
 * Admin Manager - 管理员 API 封装
 * 
 * 提供服务器管理功能，包括用户管理、房间管理、服务器配置等
 * 对接后端: synapse-rust/src/web/routes/admin/
 */

import { TypedEventEmitter } from "../models/typed-event-emitter";
import { Method } from "../http-api/method";
import { logger } from "../logger";

export enum AdminEvent {
    UserCreated = "UserCreated",
    UserDeactivated = "UserDeactivated",
    UserShadowBanned = "UserShadowBanned",
    UserUnshadowBanned = "UserUnshadowBanned",
    RoomDeleted = "RoomDeleted",
    RoomBlocked = "RoomBlocked",
    ServerStatsUpdated = "ServerStatsUpdated",
    AdminError = "AdminError",
}

export interface UserInfo {
    user_id: string;
    name?: string;
    displayname?: string;
    avatar_url?: string;
    admin?: boolean;
    deactivated?: boolean;
    suspended?: boolean;
    creation_ts?: number;
    last_seen_ts?: number;
    last_seen_ip?: string;
    user_type?: string;
    is_guest?: boolean;
}

export interface RoomInfo {
    room_id: string;
    name?: string;
    topic?: string;
    avatar_url?: string;
    creator?: string;
    joined_members?: number;
    joined_local_members?: number;
    invited_members?: number;
    version?: string;
    creation_ts?: number;
    join_rules?: string;
    public?: boolean;
    guest_access?: string;
    history_visibility?: string;
    state_events?: number;
}

export interface ServerStats {
    total_users?: number;
    total_rooms?: number;
    daily_active_users?: number;
    monthly_active_users?: number;
    total_nonlocal_users?: number;
    total_room_events?: number;
    r30_users?: number;
    r30v2_users?: number;
}

export interface ShadowBanStatus {
    user_id: string;
    banned: boolean;
    banned_at?: number;
}

export interface RateLimitConfig {
    messages_per_second?: number;
    burst_count?: number;
}

export interface RegistrationToken {
    token: string;
    uses_allowed?: number;
    pending?: number;
    completed?: number;
    expiry_time?: number;
    created_ts?: number;
}

export interface FederationDestination {
    destination: string;
    retry_last_ts?: number;
    retry_interval?: number;
    failure_ts?: number;
    last_successful_stream_ordering?: number;
}

interface AdminManagerEventMap {
    [AdminEvent.UserCreated]: (userId: string, user: UserInfo) => void;
    [AdminEvent.UserDeactivated]: (userId: string) => void;
    [AdminEvent.UserShadowBanned]: (userId: string) => void;
    [AdminEvent.UserUnshadowBanned]: (userId: string) => void;
    [AdminEvent.RoomDeleted]: (roomId: string) => void;
    [AdminEvent.RoomBlocked]: (roomId: string, blocked: boolean) => void;
    [AdminEvent.ServerStatsUpdated]: (stats: ServerStats) => void;
    [AdminEvent.AdminError]: (error: Error) => void;
}

const ADMIN_PREFIX = { prefix: "/_synapse/admin/v1" };

export class AdminManager extends TypedEventEmitter<AdminEvent, AdminManagerEventMap> {
    private client: any;
    private serverStats: ServerStats | null = null;

    constructor(client: any) {
        super();
        this.client = client;
    }

    // ===== 用户管理 =====

    async getUsers(from?: string, limit?: number): Promise<{ users: UserInfo[]; next_token?: string }> {
        try {
            const params = new URLSearchParams();
            if (from) params.set('from', from);
            if (limit) params.set('limit', String(limit));
            
            const query = params.toString() ? `?${params.toString()}` : '';
            
            const response = await this.client.http.authedRequest(
                Method.Get,
                `/_synapse/admin/v2/users${query}`,
                undefined,
                undefined,
                ADMIN_PREFIX
            );

            return {
                users: response.users || [],
                next_token: response.next_token,
            };
        } catch (e) {
            logger.warn('AdminManager.getUsers failed:', e);
            return { users: [] };
        }
    }

    async getUser(userId: string): Promise<UserInfo | null> {
        try {
            const response = await this.client.http.authedRequest(
                Method.Get,
                `/_synapse/admin/v2/users/${encodeURIComponent(userId)}`,
                undefined,
                undefined,
                ADMIN_PREFIX
            );
            return response as UserInfo;
        } catch (e) {
            logger.warn('AdminManager.getUser failed:', e);
            return null;
        }
    }

    async createUser(userId: string, options?: {
        password?: string;
        displayname?: string;
        admin?: boolean;
        deactivated?: boolean;
    }): Promise<UserInfo | null> {
        try {
            const response = await this.client.http.authedRequest(
                Method.Put,
                `/_synapse/admin/v2/users/${encodeURIComponent(userId)}`,
                undefined,
                options || {},
                ADMIN_PREFIX
            );

            const user = response as UserInfo;
            this.emit(AdminEvent.UserCreated, userId, user);
            return user;
        } catch (error) {
            this.emit(AdminEvent.AdminError, error as Error);
            throw error;
        }
    }

    async deactivateUser(userId: string, erase?: boolean): Promise<void> {
        try {
            await this.client.http.authedRequest(
                Method.Post,
                `/_synapse/admin/v1/deactivate/${encodeURIComponent(userId)}`,
                undefined,
                { erase: erase ?? false },
                ADMIN_PREFIX
            );
            this.emit(AdminEvent.UserDeactivated, userId);
        } catch (error) {
            this.emit(AdminEvent.AdminError, error as Error);
            throw error;
        }
    }

    async resetPassword(userId: string, newPassword: string, logout?: boolean): Promise<void> {
        try {
            await this.client.http.authedRequest(
                Method.Post,
                `/_synapse/admin/v1/reset_password/${encodeURIComponent(userId)}`,
                undefined,
                { new_password: newPassword, logout_devices: logout ?? true },
                ADMIN_PREFIX
            );
        } catch (error) {
            this.emit(AdminEvent.AdminError, error as Error);
            throw error;
        }
    }

    async setAdmin(userId: string, admin: boolean): Promise<void> {
        try {
            await this.client.http.authedRequest(
                Method.Put,
                `/_synapse/admin/v2/users/${encodeURIComponent(userId)}`,
                undefined,
                { admin },
                ADMIN_PREFIX
            );
        } catch (error) {
            this.emit(AdminEvent.AdminError, error as Error);
            throw error;
        }
    }

    async getUserDevices(userId: string): Promise<any[]> {
        try {
            const response = await this.client.http.authedRequest(
                Method.Get,
                `/_synapse/admin/v2/users/${encodeURIComponent(userId)}/devices`,
                undefined,
                undefined,
                ADMIN_PREFIX
            );
            return response.devices || [];
        } catch (e) {
            logger.warn('AdminManager.getUserDevices failed:', e);
            return [];
        }
    }

    async deleteUserDevices(userId: string, deviceIds: string[]): Promise<void> {
        try {
            await this.client.http.authedRequest(
                Method.Post,
                `/_synapse/admin/v2/users/${encodeURIComponent(userId)}/delete_devices`,
                undefined,
                { devices: deviceIds },
                ADMIN_PREFIX
            );
        } catch (error) {
            this.emit(AdminEvent.AdminError, error as Error);
            throw error;
        }
    }

    // ===== Shadow Ban =====

    async shadowBanUser(userId: string): Promise<void> {
        try {
            await this.client.http.authedRequest(
                Method.Post,
                `/_synapse/admin/v1/users/${encodeURIComponent(userId)}/shadow_ban`,
                undefined,
                undefined,
                ADMIN_PREFIX
            );
            this.emit(AdminEvent.UserShadowBanned, userId);
        } catch (error) {
            this.emit(AdminEvent.AdminError, error as Error);
            throw error;
        }
    }

    async unshadowBanUser(userId: string): Promise<void> {
        try {
            await this.client.http.authedRequest(
                Method.Delete,
                `/_synapse/admin/v1/users/${encodeURIComponent(userId)}/shadow_ban`,
                undefined,
                undefined,
                ADMIN_PREFIX
            );
            this.emit(AdminEvent.UserUnshadowBanned, userId);
        } catch (error) {
            this.emit(AdminEvent.AdminError, error as Error);
            throw error;
        }
    }

    async getShadowBanStatus(userId: string): Promise<ShadowBanStatus | null> {
        try {
            const response = await this.client.http.authedRequest(
                Method.Get,
                `/_synapse/admin/v1/users/${encodeURIComponent(userId)}/shadow_ban`,
                undefined,
                undefined,
                ADMIN_PREFIX
            );
            return response as ShadowBanStatus;
        } catch (e) {
            logger.warn('AdminManager.getShadowBanStatus failed:', e);
            return null;
        }
    }

    // ===== Rate Limit =====

    async getRateLimit(userId: string): Promise<RateLimitConfig | null> {
        try {
            const response = await this.client.http.authedRequest(
                Method.Get,
                `/_synapse/admin/v1/users/${encodeURIComponent(userId)}/rate_limit`,
                undefined,
                undefined,
                ADMIN_PREFIX
            );
            return response as RateLimitConfig;
        } catch (e) {
            logger.warn('AdminManager.getRateLimit failed:', e);
            return null;
        }
    }

    async setRateLimit(userId: string, config: RateLimitConfig): Promise<void> {
        try {
            await this.client.http.authedRequest(
                Method.Put,
                `/_synapse/admin/v1/users/${encodeURIComponent(userId)}/rate_limit`,
                undefined,
                config,
                ADMIN_PREFIX
            );
        } catch (error) {
            this.emit(AdminEvent.AdminError, error as Error);
            throw error;
        }
    }

    async deleteRateLimit(userId: string): Promise<void> {
        try {
            await this.client.http.authedRequest(
                Method.Delete,
                `/_synapse/admin/v1/users/${encodeURIComponent(userId)}/rate_limit`,
                undefined,
                undefined,
                ADMIN_PREFIX
            );
        } catch (error) {
            this.emit(AdminEvent.AdminError, error as Error);
            throw error;
        }
    }

    // ===== 房间管理 =====

    async getRooms(from?: string, limit?: number, searchTerm?: string): Promise<{ rooms: RoomInfo[]; next_token?: string }> {
        try {
            const params = new URLSearchParams();
            if (from) params.set('from', from);
            if (limit) params.set('limit', String(limit));
            if (searchTerm) params.set('search_term', searchTerm);
            
            const query = params.toString() ? `?${params.toString()}` : '';
            
            const response = await this.client.http.authedRequest(
                Method.Get,
                `/_synapse/admin/v1/rooms${query}`,
                undefined,
                undefined,
                ADMIN_PREFIX
            );

            return {
                rooms: response.rooms || [],
                next_token: response.next_token,
            };
        } catch (e) {
            logger.warn('AdminManager.getRooms failed:', e);
            return { rooms: [] };
        }
    }

    async getRoom(roomId: string): Promise<RoomInfo | null> {
        try {
            const response = await this.client.http.authedRequest(
                Method.Get,
                `/_synapse/admin/v1/rooms/${encodeURIComponent(roomId)}`,
                undefined,
                undefined,
                ADMIN_PREFIX
            );
            return response as RoomInfo;
        } catch (e) {
            logger.warn('AdminManager.getRoom failed:', e);
            return null;
        }
    }

    async deleteRoom(roomId: string, options?: {
        purge?: boolean;
        force_purge?: boolean;
    }): Promise<void> {
        try {
            await this.client.http.authedRequest(
                Method.Delete,
                `/_synapse/admin/v1/rooms/${encodeURIComponent(roomId)}`,
                undefined,
                options || {},
                ADMIN_PREFIX
            );
            this.emit(AdminEvent.RoomDeleted, roomId);
        } catch (error) {
            this.emit(AdminEvent.AdminError, error as Error);
            throw error;
        }
    }

    async blockRoom(roomId: string, block: boolean): Promise<void> {
        try {
            await this.client.http.authedRequest(
                Method.Post,
                `/_synapse/admin/v1/rooms/${encodeURIComponent(roomId)}/block`,
                undefined,
                { block },
                ADMIN_PREFIX
            );
            this.emit(AdminEvent.RoomBlocked, roomId, block);
        } catch (error) {
            this.emit(AdminEvent.AdminError, error as Error);
            throw error;
        }
    }

    async getRoomMembers(roomId: string): Promise<string[]> {
        try {
            const response = await this.client.http.authedRequest(
                Method.Get,
                `/_synapse/admin/v1/rooms/${encodeURIComponent(roomId)}/members`,
                undefined,
                undefined,
                ADMIN_PREFIX
            );
            return response.members || [];
        } catch (e) {
            logger.warn('AdminManager.getRoomMembers failed:', e);
            return [];
        }
    }

    async joinRoom(roomId: string, userId: string): Promise<void> {
        try {
            await this.client.http.authedRequest(
                Method.Post,
                `/_synapse/admin/v1/join/${encodeURIComponent(roomId)}`,
                undefined,
                { user_id: userId },
                ADMIN_PREFIX
            );
        } catch (error) {
            this.emit(AdminEvent.AdminError, error as Error);
            throw error;
        }
    }

    // ===== 服务器管理 =====

    async getServerVersion(): Promise<{ server_version: string; python_version: string }> {
        try {
            const response = await this.client.http.authedRequest(
                Method.Get,
                '/_synapse/admin/v1/server_version',
                undefined,
                undefined,
                ADMIN_PREFIX
            );
            return response as { server_version: string; python_version: string };
        } catch (e) {
            logger.warn('AdminManager.getServerVersion failed:', e);
            return { server_version: 'unknown', python_version: 'unknown' };
        }
    }

    async getServerStats(): Promise<ServerStats> {
        try {
            const response = await this.client.http.authedRequest(
                Method.Get,
                '/_synapse/admin/v1/statistics',
                undefined,
                undefined,
                ADMIN_PREFIX
            );
            this.serverStats = response as ServerStats;
            this.emit(AdminEvent.ServerStatsUpdated, this.serverStats);
            return this.serverStats;
        } catch (e) {
            logger.warn('AdminManager.getServerStats failed:', e);
            return {};
        }
    }

    async getServerConfig(): Promise<Record<string, any>> {
        try {
            const response = await this.client.http.authedRequest(
                Method.Get,
                '/_synapse/admin/v1/config',
                undefined,
                undefined,
                ADMIN_PREFIX
            );
            return response as Record<string, any>;
        } catch (e) {
            logger.warn('AdminManager.getServerConfig failed:', e);
            return {};
        }
    }

    // ===== 注册令牌 =====

    async getRegistrationTokens(): Promise<RegistrationToken[]> {
        try {
            const response = await this.client.http.authedRequest(
                Method.Get,
                '/_synapse/admin/v1/registration_tokens',
                undefined,
                undefined,
                ADMIN_PREFIX
            );
            return response.registration_tokens || [];
        } catch (e) {
            logger.warn('AdminManager.getRegistrationTokens failed:', e);
            return [];
        }
    }

    async createRegistrationToken(options?: {
        token?: string;
        uses_allowed?: number;
        expiry_time?: number;
    }): Promise<RegistrationToken | null> {
        try {
            const response = await this.client.http.authedRequest(
                Method.Post,
                '/_synapse/admin/v1/registration_tokens',
                undefined,
                options || {},
                ADMIN_PREFIX
            );
            return response as RegistrationToken;
        } catch (error) {
            this.emit(AdminEvent.AdminError, error as Error);
            throw error;
        }
    }

    async updateRegistrationToken(token: string, options: {
        uses_allowed?: number;
        expiry_time?: number;
    }): Promise<void> {
        try {
            await this.client.http.authedRequest(
                Method.Post,
                `/_synapse/admin/v1/registration_tokens/${encodeURIComponent(token)}`,
                undefined,
                options,
                ADMIN_PREFIX
            );
        } catch (error) {
            this.emit(AdminEvent.AdminError, error as Error);
            throw error;
        }
    }

    async deleteRegistrationToken(token: string): Promise<void> {
        try {
            await this.client.http.authedRequest(
                Method.Delete,
                `/_synapse/admin/v1/registration_tokens/${encodeURIComponent(token)}`,
                undefined,
                undefined,
                ADMIN_PREFIX
            );
        } catch (error) {
            this.emit(AdminEvent.AdminError, error as Error);
            throw error;
        }
    }

    // ===== 联邦管理 =====

    async getFederationDestinations(): Promise<FederationDestination[]> {
        try {
            const response = await this.client.http.authedRequest(
                Method.Get,
                '/_synapse/admin/v1/federation/destinations',
                undefined,
                undefined,
                ADMIN_PREFIX
            );
            return response.destinations || [];
        } catch (e) {
            logger.warn('AdminManager.getFederationDestinations failed:', e);
            return [];
        }
    }

    async getFederationDestination(destination: string): Promise<FederationDestination | null> {
        try {
            const response = await this.client.http.authedRequest(
                Method.Get,
                `/_synapse/admin/v1/federation/destinations/${encodeURIComponent(destination)}`,
                undefined,
                undefined,
                ADMIN_PREFIX
            );
            return response as FederationDestination;
        } catch (e) {
            logger.warn('AdminManager.getFederationDestination failed:', e);
            return null;
        }
    }

    async resetFederationConnection(destination: string): Promise<void> {
        try {
            await this.client.http.authedRequest(
                Method.Post,
                `/_synapse/admin/v1/federation/destinations/${encodeURIComponent(destination)}/reset_connection`,
                undefined,
                undefined,
                ADMIN_PREFIX
            );
        } catch (error) {
            this.emit(AdminEvent.AdminError, error as Error);
            throw error;
        }
    }

    // ===== 媒体管理 =====

    async getMedia(limit?: number, from?: string): Promise<{ media: any[]; next_token?: string }> {
        try {
            const params = new URLSearchParams();
            if (limit) params.set('limit', String(limit));
            if (from) params.set('from', from);
            
            const query = params.toString() ? `?${params.toString()}` : '';
            
            const response = await this.client.http.authedRequest(
                Method.Get,
                `/_synapse/admin/v1/media${query}`,
                undefined,
                undefined,
                ADMIN_PREFIX
            );

            return {
                media: response.media || [],
                next_token: response.next_token,
            };
        } catch (e) {
            logger.warn('AdminManager.getMedia failed:', e);
            return { media: [] };
        }
    }

    async deleteMedia(mediaId: string): Promise<void> {
        try {
            await this.client.http.authedRequest(
                Method.Delete,
                `/_synapse/admin/v1/media/${encodeURIComponent(mediaId)}`,
                undefined,
                undefined,
                ADMIN_PREFIX
            );
        } catch (error) {
            this.emit(AdminEvent.AdminError, error as Error);
            throw error;
        }
    }

    async quarantineMedia(mediaId: string): Promise<void> {
        try {
            await this.client.http.authedRequest(
                Method.Post,
                `/_synapse/admin/v1/media/quarantine/${encodeURIComponent(mediaId)}`,
                undefined,
                undefined,
                ADMIN_PREFIX
            );
        } catch (error) {
            this.emit(AdminEvent.AdminError, error as Error);
            throw error;
        }
    }

    async purgeMediaCache(beforeTs?: number): Promise<{ deleted: number }> {
        try {
            const response = await this.client.http.authedRequest(
                Method.Post,
                '/_synapse/admin/v1/purge_media_cache',
                undefined,
                beforeTs ? { before_ts: beforeTs } : {},
                ADMIN_PREFIX
            );
            return { deleted: response.deleted || 0 };
        } catch (e) {
            logger.warn('AdminManager.purgeMediaCache failed:', e);
            return { deleted: 0 };
        }
    }

    // ===== 便捷方法 =====

    getCachedServerStats(): ServerStats | null {
        return this.serverStats;
    }

    async whois(userId: string): Promise<any> {
        try {
            const response = await this.client.http.authedRequest(
                Method.Get,
                `/_synapse/admin/v1/whois/${encodeURIComponent(userId)}`,
                undefined,
                undefined,
                ADMIN_PREFIX
            );
            return response;
        } catch (e) {
            logger.warn('AdminManager.whois failed:', e);
            return null;
        }
    }

    async makeRoomAdmin(roomId: string, userId?: string): Promise<void> {
        try {
            await this.client.http.authedRequest(
                Method.Post,
                `/_synapse/admin/v1/rooms/${encodeURIComponent(roomId)}/make_room_admin`,
                undefined,
                userId ? { user_id: userId } : {},
                ADMIN_PREFIX
            );
        } catch (error) {
            this.emit(AdminEvent.AdminError, error as Error);
            throw error;
        }
    }

    start(): void {
        // Initialization if needed
    }

    stop(): void {
        this.serverStats = null;
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getAdminManager(): AdminManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getAdminManager = function (): AdminManager {
        return new AdminManager(this);
    };
}

export default extendMatrixClient;
