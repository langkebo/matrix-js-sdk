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
 * Admin Manager - 管理员 API 统一入口
 *
 * 采用组合模式，将 100+ 个方法按领域拆分为 6 个子 Manager：
 * - users: 用户管理（CRUD、设备、令牌、会话、速率限制、影子封禁）
 * - rooms: 房间管理（CRUD、成员、消息、状态、Space）
 * - server: 服务器管理（统计、健康、通知、配置、清理、备份）
 * - federation: 联邦管理（黑名单、目的地、缓存、准入）
 * - media: 媒体管理（CRUD、隔离、清理）
 * - config: 配置管理（保留策略、功能标志、模块、报告、审计、令牌）
 *
 * 所有原有方法保持向后兼容（委托到子 Manager）。
 * 推荐使用子 Manager 直接访问：`adminManager.users.createUser(...)`
 *
 * ⚠️ URL 组装规则：
 * - HTTP 层执行 baseUrl + prefix + path 三段拼接
 * - 使用 prefix 时，path 只传相对路径（不带前缀）
 * - 例如：baseUrl=https://server.com + prefix=/_synapse/admin + path=/v1/users
 *   结果: https://server.com/_synapse/admin/v1/users
 */

import { MatrixClient } from "../client";
import { getOrCreateManager } from "../client-infra/manager-registry";
import { AdminBaseManager, type AdminErrorCallback } from "./admin-base-manager";
import {
    AdminEvent,
    type DeviceInfo,
    type MediaInfo,
    type RoomStateEvent,
    type RoomMessage,
    type RoomInfo,
    type ServerStats,
    type ServerStatus,
    type ServerHealth,
    type ServerInfo,
    type AdminCleanupResponse,
    type AccountStatus,
    type ServerNotice,
    type FederationBlacklistEntry,
    type RegistrationToken,
    type FederationDestination,
    type AdminFederationDestinationDetail,
    type FederationAdmissionResult,
    type PendingFederationList,
    type RoomStats,
    type WhoisResponse,
    type RetentionPolicy,
    type RoomRetentionPolicy,
    type RetentionRunResult,
    type RetentionStatus,
    type FeatureFlagTarget,
    type FeatureFlag,
    type FeatureFlagPage,
    type SystemNotificationInfo,
    type SystemNotificationPage,
    type UserPusher,
    type SpacePage,
    type SpaceUser,
    type SpaceRoom,
    type SpaceInfo,
    type AuditEvent,
    type AuditEventPage,
    type PaginatedResponse,
    type AdminRoomVersionResponse,
    type AdminRoomBlockStatus,
    type AdminEventContext,
    type AdminForwardExtremity,
    type AdminTokenSync,
    type AdminRoomSearchResult,
    type AdminRoomListings,
    type AdminFederationCache,
    type AdminFederationDestinationRooms,
    type AdminAccountDetails,
    type AdminRegisterResult,
    type AdminReport,
    type AdminReportPage,
    type AdminModuleInfo,
    type AdminModulePage,
    type AdminModuleLogPage,
    type AdminAccountValidityInfo,
    type AdminPasswordAuthProvider,
    type AdminPasswordAuthProviderPage,
    type AdminPresenceRoute,
    type AdminPresenceRoutePage,
    type AdminMediaCallback,
    type AdminMediaCallbackPage,
    type AdminRateLimitCallback,
    type AdminRateLimitCallbackPage,
    type AdminAccountDataCallback,
    type AdminAccountDataCallbackPage,
    type AdminInviteList,
    type AdminJitsiConfig,
    type AdminPurgeHistoryResult,
    type AdminShutdownRoomResult,
    type AdminBackupPage,
    type AdminExperimentalFeatures,
    type ShadowBanStatus,
    type RateLimitConfig,
    type AdminLoginAsUserRequest,
    type AdminLoginAsUserResponse,
    type AdminServerConfig,
    type AdminInfoResponse,
    type BatchCreateUsersRequest,
    type BatchCreateUsersResponse,
    type BatchDeactivateUsersRequest,
    type BatchDeactivateUsersResponse,
    type UpdateAccountDetailsRequest,
    type UpdateAccountDetailsResponse,
    type AdminLogoutResponse,
    type AdminEvictResponse,
    type UserSession,
    type DynamicConfig,
    type RoomSearchPayload,
    type RoomDeletePayload,
    type PurgeHistoryPayload,
    type AdminReasonPayload,
    type AdminBanKickPayload,
    type AdminMakeRoomAdminPayload,
    type RoomEventSearchPayload,
    type SpaceStats,
    type AdminToken,
    type AdminRefreshToken,
    type AdminLogoutRequest,
    type AdminEvictRequest,
    type AdminRegisterRequest,
    type PurgeHistoryRequest,
    type ShutdownRoomRequest,
    type CleanupRoomsRequest,
    type FeatureFlagUpdatePayload,
    type AuditEventCreateRequest,
    type AccountValidityRequest,
    type AccountValidityRenewRequest,
    type UserStatsResponse,
    type UserStatsListResponse,
    type UserRoomsResponse,
    type UserNotificationResponse,
    type UserNotificationPayload,
    type RestartServerPayload,
    type RestartServerResponse,
    type PurgeRoomResponse,
    type FederationResolveResponse,
    type FederationRewriteResponse,
    type MediaQuotaResponse,
    type ThirdPartyRuleCheckPayload,
    type SpamCheckResult,
    type ThirdPartyRuleCheckResult,
    type ThirdPartyRuleResult,
    type MediaQuarantineChange,
    type MediaQuarantineChangesResponse,
} from "./types";
import type { ISynapseAdminWhoisResponse, ISynapseAdminDeactivateResponse } from "../@types/synapse";

// 子 Manager 导入
import { AdminUserManager, AdminUserEvent } from "./sub-managers/admin-user-manager";
import { AdminRoomManager, AdminRoomEvent } from "./sub-managers/admin-room-manager";
import { AdminServerManager, AdminServerEvent } from "./sub-managers/admin-server-manager";
import { AdminFederationManager } from "./sub-managers/admin-federation-manager";
import { AdminMediaManager } from "./sub-managers/admin-media-manager";
import { AdminConfigManager } from "./sub-managers/admin-config-manager";

export * from "./types";
export type { AdminAccountDetails as UserInfo } from "./types";
// 重新导出子 Manager 类型，供直接使用
export { AdminUserManager, AdminUserEvent } from "./sub-managers/admin-user-manager";
export { AdminRoomManager, AdminRoomEvent } from "./sub-managers/admin-room-manager";
export { AdminServerManager, AdminServerEvent } from "./sub-managers/admin-server-manager";
export { AdminFederationManager } from "./sub-managers/admin-federation-manager";
export { AdminMediaManager } from "./sub-managers/admin-media-manager";
export { AdminConfigManager } from "./sub-managers/admin-config-manager";

interface AdminManagerEventMap {
    [AdminEvent.UserCreated]: (userId: string, user: AdminAccountDetails) => void;
    [AdminEvent.UserDeactivated]: (userId: string) => void;
    [AdminEvent.UserShadowBanned]: (userId: string) => void;
    [AdminEvent.UserUnshadowBanned]: (userId: string) => void;
    [AdminEvent.RoomDeleted]: (roomId: string) => void;
    [AdminEvent.RoomBlocked]: (roomId: string, blocked: boolean) => void;
    [AdminEvent.ServerStatsUpdated]: (stats: ServerStats) => void;
    [AdminEvent.AdminError]: (error: Error) => void;
}

/**
 * Admin Manager - 管理员 API 统一入口
 *
 * 通过组合模式将功能委托到子 Manager，同时保持完全向后兼容。
 *
 * @example
 * ```typescript
 * // 向后兼容：直接在 AdminManager 上调用方法
 * const user = await adminManager.getUser("@alice:example.com");
 *
 * // 推荐新方式：通过子 Manager 访问
 * const user = await adminManager.users.getUser("@alice:example.com");
 * const room = await adminManager.rooms.getRoom("!room:example.com");
 * const stats = await adminManager.server.getServerStats();
 * ```
 */
export class AdminManager extends AdminBaseManager<AdminEvent, AdminManagerEventMap> {
    // ===== 子 Manager（组合模式） =====
    public readonly users: AdminUserManager;
    public readonly rooms: AdminRoomManager;
    public readonly server: AdminServerManager;
    public readonly federation: AdminFederationManager;
    public readonly media: AdminMediaManager;
    public readonly config: AdminConfigManager;

    constructor(client: MatrixClient) {
        // 错误回调：发射 AdminError 事件
        const onError: AdminErrorCallback = (error) => {
            this.emit(AdminEvent.AdminError, error);
        };

        super(client, onError);

        // 创建子 Manager，共享错误回调
        this.users = new AdminUserManager(client, onError);
        this.rooms = new AdminRoomManager(client, onError);
        this.server = new AdminServerManager(client, onError);
        this.federation = new AdminFederationManager(client, onError);
        this.media = new AdminMediaManager(client, onError);
        this.config = new AdminConfigManager(client, onError);

        // 转发子 Manager 事件到 AdminManager（向后兼容）
        this.forwardSubManagerEvents();
    }

    /**
     * 将子 Manager 的事件转发到 AdminManager
     * 保持 `adminManager.on(AdminEvent.UserCreated, ...)` 的向后兼容性
     */
    private forwardSubManagerEvents(): void {
        // 用户事件
        this.users.on(AdminUserEvent.UserCreated, (userId, user) =>
            this.emit(AdminEvent.UserCreated, userId, user),
        );
        this.users.on(AdminUserEvent.UserDeactivated, (userId) =>
            this.emit(AdminEvent.UserDeactivated, userId),
        );
        this.users.on(AdminUserEvent.UserShadowBanned, (userId) =>
            this.emit(AdminEvent.UserShadowBanned, userId),
        );
        this.users.on(AdminUserEvent.UserUnshadowBanned, (userId) =>
            this.emit(AdminEvent.UserUnshadowBanned, userId),
        );

        // 房间事件
        this.rooms.on(AdminRoomEvent.RoomDeleted, (roomId) =>
            this.emit(AdminEvent.RoomDeleted, roomId),
        );
        this.rooms.on(AdminRoomEvent.RoomBlocked, (roomId, blocked) =>
            this.emit(AdminEvent.RoomBlocked, roomId, blocked),
        );

        // 服务器事件
        this.server.on(AdminServerEvent.ServerStatsUpdated, (stats) =>
            this.emit(AdminEvent.ServerStatsUpdated, stats),
        );
    }

    // ===== 向后兼容委托方法 =====
    // 所有原有方法委托到对应的子 Manager，保持 API 完全兼容

    // ----- 用户管理（委托 → users） -----

    async getUsersPaginated(options?: { from?: string; limit?: number }): Promise<PaginatedResponse<AdminAccountDetails>> {
        return this.users.getUsersPaginated(options);
    }

    async getUser(userId: string, throwOnError = true): Promise<AdminAccountDetails | null> {
        return this.users.getUser(userId, throwOnError);
    }

    async createUser(
        userId: string,
        options?: { password?: string; displayname?: string; admin?: boolean; deactivated?: boolean },
    ): Promise<AdminAccountDetails> {
        return this.users.createUser(userId, options);
    }

    async deactivateUser(userId: string): Promise<void> {
        return this.users.deactivateUser(userId);
    }

    async deleteUser(userId: string): Promise<void> {
        return this.users.deleteUser(userId);
    }

    async batchCreateUsers(payload: BatchCreateUsersRequest): Promise<BatchCreateUsersResponse> {
        return this.users.batchCreateUsers(payload);
    }

    async batchDeactivateUsers(payload: BatchDeactivateUsersRequest): Promise<BatchDeactivateUsersResponse> {
        return this.users.batchDeactivateUsers(payload);
    }

    async resetPassword(userId: string, newPassword: string): Promise<void> {
        return this.users.resetPassword(userId, newPassword);
    }

    async setAdmin(userId: string, admin: boolean): Promise<void> {
        return this.users.setAdmin(userId, admin);
    }

    async getUserDevices(userId: string): Promise<DeviceInfo[]> {
        return this.users.getUserDevices(userId);
    }

    async deleteUserDevices(userId: string, deviceIds: string[]): Promise<void> {
        return this.users.deleteUserDevices(userId, deviceIds);
    }

    async deleteUserDevice(userId: string, deviceId: string): Promise<void> {
        return this.users.deleteUserDevice(userId, deviceId);
    }

    async getUserTokens(userId: string): Promise<{ tokens: AdminToken[] }> {
        return this.users.getUserTokens(userId);
    }

    async deleteUserToken(userId: string, tokenId: string): Promise<void> {
        return this.users.deleteUserToken(userId, tokenId);
    }

    async getUserRefreshTokens(userId: string): Promise<{ refresh_tokens: AdminRefreshToken[] }> {
        return this.users.getUserRefreshTokens(userId);
    }

    async deleteUserRefreshToken(userId: string, tokenId: string): Promise<void> {
        return this.users.deleteUserRefreshToken(userId, tokenId);
    }

    async getUserSession(userId: string): Promise<UserSession> {
        return this.users.getUserSession(userId);
    }

    async getUserRooms(userId: string, from?: string, limit?: number): Promise<UserRoomsResponse> {
        return this.users.getUserRooms(userId, from, limit);
    }

    async getUserStats(userId: string): Promise<UserStatsResponse> {
        return this.users.getUserStats(userId);
    }

    async listUserStats(from?: string, limit?: number): Promise<UserStatsListResponse> {
        return this.users.listUserStats(from, limit);
    }

    async invalidateUserSession(userId: string): Promise<void> {
        return this.users.invalidateUserSession(userId);
    }

    async loginAsUser(userId: string, payload?: AdminLoginAsUserRequest): Promise<AdminLoginAsUserResponse> {
        return this.users.loginAsUser(userId, payload);
    }

    async logoutUser(userId: string, payload?: AdminLogoutRequest): Promise<AdminLogoutResponse> {
        return this.users.logoutUser(userId, payload);
    }

    async evictUser(userId: string, payload?: AdminEvictRequest): Promise<AdminEvictResponse> {
        return this.users.evictUser(userId, payload);
    }

    async getAccountStatus(userId: string, throwOnError = true): Promise<AccountStatus | null> {
        return this.users.getAccountStatus(userId, throwOnError);
    }

    async isAdmin(userId: string, throwOnError = true): Promise<boolean> {
        return this.users.isAdmin(userId, throwOnError);
    }

    async overrideRateLimit(userId: string): Promise<void> {
        return this.users.overrideRateLimit(userId);
    }

    async getRateLimitOverride(userId: string, throwOnError = true): Promise<RateLimitConfig | null> {
        return this.users.getRateLimitOverride(userId, throwOnError);
    }

    async deleteRateLimitOverride(userId: string): Promise<void> {
        return this.users.deleteRateLimitOverride(userId);
    }

    async shadowBanUser(userId: string): Promise<void> {
        return this.users.shadowBanUser(userId);
    }

    async unshadowBanUser(userId: string): Promise<void> {
        return this.users.unshadowBanUser(userId);
    }

    async getShadowBanStatus(userId: string, throwOnError = true): Promise<ShadowBanStatus | null> {
        return this.users.getShadowBanStatus(userId, throwOnError);
    }

    async getRateLimit(userId: string, throwOnError = true): Promise<RateLimitConfig | null> {
        return this.users.getRateLimit(userId, throwOnError);
    }

    async setRateLimit(userId: string, config: { messages_per_second?: number; burst_count?: number }): Promise<void> {
        return this.users.setRateLimit(userId, config);
    }

    async deleteRateLimit(userId: string): Promise<void> {
        return this.users.deleteRateLimit(userId);
    }

    async getAccountDetails(userId: string): Promise<AdminAccountDetails> {
        return this.users.getAccountDetails(userId);
    }

    async updateAccountDetails(userId: string, payload: UpdateAccountDetailsRequest): Promise<UpdateAccountDetailsResponse> {
        return this.users.updateAccountDetails(userId, payload);
    }

    async getUserWhois(userId: string): Promise<WhoisResponse> {
        return this.users.getUserWhois(userId);
    }

    async whois(userId: string): Promise<WhoisResponse> {
        return this.users.whois(userId);
    }

    async whoisByDevice(userId: string, deviceId: string): Promise<WhoisResponse> {
        return this.users.whoisByDevice(userId, deviceId);
    }

    async getUserMedia(userId: string, from?: string, limit?: number): Promise<{ media: MediaInfo[]; next_token?: string }> {
        return this.users.getUserMedia(userId, from, limit);
    }

    async deleteUserMedia(userId: string): Promise<void> {
        return this.users.deleteUserMedia(userId);
    }

    async getUserNotification(userId: string): Promise<UserNotificationResponse> {
        return this.users.getUserNotification(userId);
    }

    async setUserNotification(userId: string, payload: UserNotificationPayload): Promise<UserNotificationResponse> {
        return this.users.setUserNotification(userId, payload);
    }

    async getUserPushers(userId: string): Promise<{ pushers: UserPusher[] }> {
        return this.users.getUserPushers(userId);
    }

    async deleteUserPusher(userId: string, pushkey: string): Promise<void> {
        return this.users.deleteUserPusher(userId, pushkey);
    }

    async blockEventReportUser(userId: string, payload: { blocked_until?: number; reason?: string }): Promise<void> {
        return this.users.blockEventReportUser(userId, payload);
    }

    async unblockEventReportUser(userId: string): Promise<void> {
        return this.users.unblockEventReportUser(userId);
    }

    // ----- Synapse-specific admin methods（委托 → users） -----

    async isSynapseAdministrator(userId: string): Promise<boolean> {
        return this.users.isSynapseAdministrator(userId);
    }

    async whoisSynapseUser(userId: string): Promise<ISynapseAdminWhoisResponse> {
        return this.users.whoisSynapseUser(userId);
    }

    async deactivateSynapseUser(userId: string): Promise<ISynapseAdminDeactivateResponse> {
        return this.users.deactivateSynapseUser(userId);
    }

    // ----- 房间管理（委托 → rooms） -----

    async getRoomsPaginated(options?: {
        from?: string;
        limit?: number;
        search?: string;
        order_by?: string;
        sort_order?: "asc" | "desc";
    }): Promise<PaginatedResponse<RoomInfo>> {
        return this.rooms.getRoomsPaginated(options);
    }

    async searchRooms(options?: Record<string, string | number | boolean | undefined>): Promise<AdminRoomSearchResult> {
        return this.rooms.searchRooms(options);
    }

    async searchRoomsPost(payload: RoomSearchPayload): Promise<AdminRoomSearchResult> {
        return this.rooms.searchRoomsPost(payload);
    }

    async getRoom(roomId: string, throwOnError = true): Promise<RoomInfo | null> {
        return this.rooms.getRoom(roomId, throwOnError);
    }

    async deleteRoom(
        roomId: string,
        blockOrOptions: boolean | { block?: boolean; purge?: boolean; force_purge?: boolean; reason?: string } = false,
        purge = false,
        reason?: string,
    ): Promise<void> {
        return this.rooms.deleteRoom(roomId, blockOrOptions, purge, reason);
    }

    async deleteRoomAdmin(roomId: string, payload?: RoomDeletePayload): Promise<void> {
        return this.rooms.deleteRoomAdmin(roomId, payload);
    }

    async purgeRoomHistory(roomId: string, payload?: PurgeHistoryPayload): Promise<AdminPurgeHistoryResult> {
        return this.rooms.purgeRoomHistory(roomId, payload);
    }

    async blockRoom(roomId: string, block: boolean, reason?: string): Promise<void> {
        return this.rooms.blockRoom(roomId, block, reason);
    }

    async unblockRoom(roomId: string, payload?: AdminReasonPayload): Promise<void> {
        return this.rooms.unblockRoom(roomId, payload);
    }

    async getRoomMembers(roomId: string): Promise<AdminAccountDetails[]> {
        return this.rooms.getRoomMembers(roomId);
    }

    async addRoomMember(roomId: string, userId: string, payload?: AdminReasonPayload): Promise<void> {
        return this.rooms.addRoomMember(roomId, userId, payload);
    }

    async removeRoomMember(roomId: string, userId: string): Promise<void> {
        return this.rooms.removeRoomMember(roomId, userId);
    }

    async banRoomMember(roomId: string, userId: string, payload?: AdminReasonPayload): Promise<void> {
        return this.rooms.banRoomMember(roomId, userId, payload);
    }

    async kickRoomMember(roomId: string, userId: string, payload?: AdminReasonPayload): Promise<void> {
        return this.rooms.kickRoomMember(roomId, userId, payload);
    }

    async unbanRoomMember(roomId: string, userId: string, payload?: AdminReasonPayload): Promise<void> {
        return this.rooms.unbanRoomMember(roomId, userId, payload);
    }

    async banRoom(roomId: string, payload: AdminBanKickPayload): Promise<void> {
        return this.rooms.banRoom(roomId, payload);
    }

    async kickRoom(roomId: string, payload: AdminBanKickPayload): Promise<void> {
        return this.rooms.kickRoom(roomId, payload);
    }

    async makeRoomAdmin(roomId: string, payload: AdminMakeRoomAdminPayload): Promise<void> {
        return this.rooms.makeRoomAdmin(roomId, payload);
    }

    async getRoomState(roomId: string): Promise<{ state: RoomStateEvent[] }> {
        return this.rooms.getRoomState(roomId);
    }

    async getRoomMessages(
        roomId: string,
        optionsOrFrom?: string | { from?: string; limit?: number; dir?: "b" | "f" | string },
        limit?: number,
    ): Promise<{ chunk: RoomMessage[]; start?: string; end?: string }> {
        return this.rooms.getRoomMessages(roomId, optionsOrFrom, limit);
    }

    async deleteRoomMessage(roomId: string, eventId: string, reason?: string): Promise<void> {
        return this.rooms.deleteRoomMessage(roomId, eventId, reason);
    }

    async getRoomAliases(roomId: string): Promise<{ aliases: string[] }> {
        return this.rooms.getRoomAliases(roomId);
    }

    async getRoomVersion(roomId: string): Promise<AdminRoomVersionResponse> {
        return this.rooms.getRoomVersion(roomId);
    }

    async getRoomBlockStatus(roomId: string): Promise<AdminRoomBlockStatus> {
        return this.rooms.getRoomBlockStatus(roomId);
    }

    async getRoomEventContext(roomId: string, eventId: string): Promise<AdminEventContext> {
        return this.rooms.getRoomEventContext(roomId, eventId);
    }

    async getRoomForwardExtremities(roomId: string): Promise<AdminForwardExtremity[]> {
        return this.rooms.getRoomForwardExtremities(roomId);
    }

    async getRoomTokenSync(roomId: string): Promise<AdminTokenSync> {
        return this.rooms.getRoomTokenSync(roomId);
    }

    async searchRoomEvents(roomId: string, payload: RoomEventSearchPayload): Promise<AdminRoomSearchResult> {
        return this.rooms.searchRoomEvents(roomId, payload);
    }

    async getRoomListings(roomId: string): Promise<AdminRoomListings> {
        return this.rooms.getRoomListings(roomId);
    }

    async setRoomPublicListing(roomId: string): Promise<void> {
        return this.rooms.setRoomPublicListing(roomId);
    }

    async deleteRoomPublicListing(roomId: string): Promise<void> {
        return this.rooms.deleteRoomPublicListing(roomId);
    }

    async getRoomStats(from?: string, limit?: number): Promise<RoomStats[]> {
        return this.rooms.getRoomStats(from, limit);
    }

    async getRoomStatsByRoom(roomId: string): Promise<RoomStats> {
        return this.rooms.getRoomStatsByRoom(roomId);
    }

    async joinRoom(roomId: string, userId: string): Promise<void> {
        return this.rooms.joinRoom(roomId, userId);
    }

    async listReports(options?: { from?: string; limit?: number }): Promise<AdminReportPage> {
        return this.rooms.listReports(options);
    }

    async getReport(reportId: string): Promise<AdminReport> {
        return this.rooms.getReport(reportId);
    }

    async deleteReport(reportId: string): Promise<void> {
        return this.rooms.deleteReport(reportId);
    }

    async listRoomReports(roomId: string, options?: { from?: string; limit?: number }): Promise<AdminReportPage> {
        return this.rooms.listRoomReports(roomId, options);
    }

    async getRoomReport(roomId: string, reportId: string): Promise<AdminReport> {
        return this.rooms.getRoomReport(roomId, reportId);
    }

    async getSpace(spaceId: string): Promise<SpaceInfo> {
        return this.rooms.getSpace(spaceId);
    }

    async listSpaces(from?: string, limit?: number): Promise<SpacePage> {
        return this.rooms.listSpaces(from, limit);
    }

    async deleteSpace(spaceId: string): Promise<void> {
        return this.rooms.deleteSpace(spaceId);
    }

    async getSpaceRooms(spaceId: string, from?: string, limit?: number): Promise<{ rooms: SpaceRoom[]; next_batch?: string }> {
        return this.rooms.getSpaceRooms(spaceId, from, limit);
    }

    async getSpaceStats(spaceId: string): Promise<SpaceStats> {
        return this.rooms.getSpaceStats(spaceId);
    }

    async getSpaceUsers(spaceId: string, from?: string, limit?: number): Promise<{ users: SpaceUser[]; next_batch?: string }> {
        return this.rooms.getSpaceUsers(spaceId, from, limit);
    }

    // ----- 服务器管理（委托 → server） -----

    async getServerStats(): Promise<ServerStats> {
        return this.server.getServerStats();
    }

    getServerStatsCached(): ServerStats | null {
        return this.server.getServerStatsCached();
    }

    async getServerStatus(): Promise<ServerStatus> {
        return this.server.getServerStatus();
    }

    async getServerHealth(): Promise<ServerHealth> {
        return this.server.getServerHealth();
    }

    async getServerInfo(): Promise<ServerInfo> {
        return this.server.getServerInfo();
    }

    async cleanupDatabase(options?: {
        room_id?: string;
        min_depth?: number;
        max_depth?: number;
        min_ts?: number;
        max_ts?: number;
        limit?: number;
        delete_local_media?: boolean;
        delete_remote_media?: boolean;
        delete_old_events?: boolean;
        delete_old_rooms?: boolean;
        delete_old_users?: boolean;
    }): Promise<AdminCleanupResponse> {
        return this.server.cleanupDatabase(options);
    }

    async getServerNotices(
        fromOrLimit?: string | number,
        limit?: number,
    ): Promise<{ notices: ServerNotice[]; next_token?: string }> {
        return this.server.getServerNotices(fromOrLimit, limit);
    }

    async sendServerNotice(
        arg1: string,
        arg2?: string | { msgtype: string; body: string; [k: string]: unknown },
        arg3?: string[],
    ): Promise<{ event_id?: string }> {
        return this.server.sendServerNotice(arg1, arg2, arg3);
    }

    async deleteServerNotice(notificationId: string): Promise<void> {
        return this.server.deleteServerNotice(notificationId);
    }

    async getServerNotice(noticeId: string): Promise<ServerNotice> {
        return this.server.getServerNotice(noticeId);
    }

    async listNotifications(from?: string, limit?: number): Promise<SystemNotificationPage> {
        return this.server.listNotifications(from, limit);
    }

    async createNotification(payload: DynamicConfig): Promise<SystemNotificationInfo> {
        return this.server.createNotification(payload);
    }

    async listActiveNotifications(): Promise<SystemNotificationInfo[]> {
        return this.server.listActiveNotifications();
    }

    async getNotification(notificationId: string): Promise<SystemNotificationInfo> {
        return this.server.getNotification(notificationId);
    }

    async updateNotification(notificationId: string, payload: DynamicConfig): Promise<SystemNotificationInfo> {
        return this.server.updateNotification(notificationId, payload);
    }

    async deactivateNotification(notificationId: string): Promise<void> {
        return this.server.deactivateNotification(notificationId);
    }

    async deleteNotification(notificationId: string): Promise<void> {
        return this.server.deleteNotification(notificationId);
    }

    async getServerConfig(throwOnError = true): Promise<AdminServerConfig> {
        return this.server.getServerConfig(throwOnError);
    }

    async getAdminInfo(): Promise<AdminInfoResponse> {
        return this.server.getAdminInfo();
    }

    async getServerVersion(throwOnError = true): Promise<{ server_version: string; python_version: string }> {
        return this.server.getServerVersion(throwOnError);
    }

    async getRegisterNonce(): Promise<{ nonce: string }> {
        return this.server.getRegisterNonce();
    }

    async registerAdmin(payload: AdminRegisterRequest): Promise<AdminRegisterResult> {
        return this.server.registerAdmin(payload);
    }

    async restartServer(payload?: RestartServerPayload): Promise<RestartServerResponse> {
        return this.server.restartServer(payload);
    }

    async listBackups(options?: { limit?: number; offset?: number }): Promise<AdminBackupPage> {
        return this.server.listBackups(options);
    }

    async getExperimentalFeatures(): Promise<AdminExperimentalFeatures> {
        return this.server.getExperimentalFeatures();
    }

    async purgeRoom(payload: { room_id: string }): Promise<PurgeRoomResponse> {
        return this.server.purgeRoom(payload);
    }

    async purgeHistory(payload: PurgeHistoryRequest): Promise<AdminPurgeHistoryResult> {
        return this.server.purgeHistory(payload);
    }

    async shutdownRoom(payload: ShutdownRoomRequest): Promise<AdminShutdownRoomResult> {
        return this.server.shutdownRoom(payload);
    }

    async cleanupAll(): Promise<AdminCleanupResponse> {
        return this.server.cleanupAll();
    }

    async cleanupRooms(payload?: CleanupRoomsRequest): Promise<AdminCleanupResponse> {
        return this.server.cleanupRooms(payload);
    }

    async cleanupTokens(): Promise<AdminCleanupResponse> {
        return this.server.cleanupTokens();
    }

    // ----- 联邦管理（委托 → federation） -----

    async getFederationBlacklist(): Promise<FederationBlacklistEntry[]> {
        return this.federation.getFederationBlacklist();
    }

    async addFederationBlacklistEntry(serverName: string, reason?: string): Promise<void> {
        return this.federation.addFederationBlacklistEntry(serverName, reason);
    }

    async removeFederationBlacklistEntry(serverName: string): Promise<void> {
        return this.federation.removeFederationBlacklistEntry(serverName);
    }

    async addToFederationBlacklist(serverName: string, reason?: string): Promise<void> {
        return this.federation.addToFederationBlacklist(serverName, reason);
    }

    async removeFromFederationBlacklist(serverName: string): Promise<void> {
        return this.federation.removeFromFederationBlacklist(serverName);
    }

    async getFederationDestinations(): Promise<FederationDestination[]> {
        return this.federation.getFederationDestinations();
    }

    async getFederationDestination(serverName: string, throwOnError = true): Promise<AdminFederationDestinationDetail | null> {
        return this.federation.getFederationDestination(serverName, throwOnError);
    }

    async disconnectFederation(serverName: string): Promise<void> {
        return this.federation.disconnectFederation(serverName);
    }

    async resetFederationConnection(serverName: string): Promise<void> {
        return this.federation.resetFederationConnection(serverName);
    }

    async resetFederationDestination(serverName: string): Promise<void> {
        return this.federation.resetFederationDestination(serverName);
    }

    async getFederationDestinationRooms(
        serverName: string,
        options?: { from?: number; limit?: number },
    ): Promise<AdminFederationDestinationRooms> {
        return this.federation.getFederationDestinationRooms(serverName, options);
    }

    async deleteFederationDestination(serverName: string): Promise<void> {
        return this.federation.deleteFederationDestination(serverName);
    }

    async getFederationCache(): Promise<AdminFederationCache> {
        return this.federation.getFederationCache();
    }

    async clearFederationCache(): Promise<void> {
        return this.federation.clearFederationCache();
    }

    async deleteFederationCacheEntry(key: string): Promise<void> {
        return this.federation.deleteFederationCacheEntry(key);
    }

    async getFederationAdmissionList(): Promise<FederationAdmissionResult[]> {
        return this.federation.getFederationAdmissionList();
    }

    async getPendingFederationServers(from?: string, limit?: number): Promise<PendingFederationList> {
        return this.federation.getPendingFederationServers(from, limit);
    }

    async resolveFederation(serverName: string): Promise<FederationResolveResponse> {
        return this.federation.resolveFederation(serverName);
    }

    async rewriteFederation(from: string, to: string): Promise<FederationRewriteResponse> {
        return this.federation.rewriteFederation(from, to);
    }

    async confirmFederation(payload: { server_name?: string; action?: string; reason?: string }): Promise<FederationAdmissionResult> {
        return this.federation.confirmFederation(payload);
    }

    // ----- 媒体管理（委托 → media） -----

    async getMedia(
        fromOrLimit?: string | number,
        limitOrFrom?: number | string,
    ): Promise<{ media: MediaInfo[]; next_token?: string }> {
        return this.media.getMedia(fromOrLimit, limitOrFrom);
    }

    async getMediaInfo(mediaId: string): Promise<MediaInfo> {
        return this.media.getMediaInfo(mediaId);
    }

    async deleteMedia(mediaId: string): Promise<void> {
        return this.media.deleteMedia(mediaId);
    }

    async getMediaQuota(): Promise<MediaQuotaResponse> {
        return this.media.getMediaQuota();
    }

    async quarantineMedia(mediaId: string): Promise<void> {
        return this.media.quarantineMedia(mediaId);
    }

    async unquarantineMedia(mediaId: string): Promise<void> {
        return this.media.unquarantineMedia(mediaId);
    }

    async purgeMediaCache(beforeTs?: number): Promise<{ deleted: number }> {
        return this.media.purgeMediaCache(beforeTs);
    }

    /**
     * 获取媒体隔离变更历史
     *
     * 调用 `GET /_synapse/admin/v1/quarantine_media/{media_id}/changes` 端点，
     * 返回指定媒体的隔离（quarantine / unquarantine）变更记录列表。
     *
     * @param mediaId - 媒体 ID
     * @param options - 可选分页参数
     * @param options.from - 分页起点 token
     * @param options.limit - 返回条数上限
     * @returns 媒体隔离变更历史
     *
     * @example
     * ```typescript
     * const history = await adminManager.getMediaQuarantineChanges("abc123", {
     *     limit: 50,
     * });
     * for (const change of history.changes) {
     *     console.log(change.action, change.changed_by, change.changed_ts);
     * }
     * ```
     *
     * @throws {ValidationError} 如果 mediaId 为空
     */
    async getMediaQuarantineChanges(
        mediaId: string,
        options?: { from?: string; limit?: number },
    ): Promise<MediaQuarantineChangesResponse> {
        return this.media.getMediaQuarantineChanges(mediaId, options);
    }

    // ----- 配置管理（委托 → config） -----

    async getRetentionPolicy(): Promise<RetentionPolicy> {
        return this.config.getRetentionPolicy();
    }

    async setRetentionPolicy(policy: {
        max_lifetime?: number | null;
        min_lifetime?: number | null;
        expire_on_clients?: boolean;
    }): Promise<RetentionPolicy> {
        return this.config.setRetentionPolicy(policy);
    }

    async getRoomRetentionPolicy(roomId: string): Promise<RoomRetentionPolicy> {
        return this.config.getRoomRetentionPolicy(roomId);
    }

    async setRoomRetentionPolicy(
        roomId: string,
        policy: {
            max_lifetime?: number | null;
            min_lifetime?: number | null;
            expire_on_clients?: boolean;
        },
    ): Promise<RoomRetentionPolicy> {
        return this.config.setRoomRetentionPolicy(roomId, policy);
    }

    async runRetention(options?: {
        room_id?: string;
        scope?: "all" | "room";
    }): Promise<RetentionRunResult> {
        return this.config.runRetention(options);
    }

    async getRetentionStatus(): Promise<RetentionStatus> {
        return this.config.getRetentionStatus();
    }

    async getFeatureFlags(): Promise<FeatureFlagPage> {
        return this.config.getFeatureFlags();
    }

    async getFeatureFlag(flagKey: string): Promise<FeatureFlag> {
        return this.config.getFeatureFlag(flagKey);
    }

    async setFeatureFlag(
        flagKey: string,
        targetScope: string,
        rolloutPercent: number,
        expiresAt: number | null,
        reason: string,
        targets: FeatureFlagTarget[],
    ): Promise<FeatureFlag> {
        return this.config.setFeatureFlag(flagKey, targetScope, rolloutPercent, expiresAt, reason, targets);
    }

    async deleteFeatureFlag(flagKey: string): Promise<void> {
        return this.config.deleteFeatureFlag(flagKey);
    }

    async listFeatureFlags(options?: Record<string, string | number | undefined>): Promise<FeatureFlagPage> {
        return this.config.listFeatureFlags(options);
    }

    async updateFeatureFlag(flagId: string, payload: FeatureFlagUpdatePayload): Promise<FeatureFlag> {
        return this.config.updateFeatureFlag(flagId, payload);
    }

    async listModules(options?: { limit?: number; from?: string }): Promise<AdminModulePage> {
        return this.config.listModules(options);
    }

    async listModulesByType(moduleType: string): Promise<AdminModulePage> {
        return this.config.listModulesByType(moduleType);
    }

    async updateModuleConfig(moduleId: string, config: DynamicConfig): Promise<AdminModuleInfo> {
        return this.config.updateModuleConfig(moduleId, config);
    }

    async setModuleEnabled(moduleId: string, isEnabled: boolean): Promise<AdminModuleInfo> {
        return this.config.setModuleEnabled(moduleId, isEnabled);
    }

    async getModuleLogs(moduleId: string, options?: { limit?: number; from?: number }): Promise<AdminModuleLogPage> {
        return this.config.getModuleLogs(moduleId, options);
    }

    async checkModuleThirdPartyRule(payload: ThirdPartyRuleCheckPayload): Promise<ThirdPartyRuleCheckResult> {
        return this.config.checkModuleThirdPartyRule(payload);
    }

    async getModuleSpamCheckResult(eventId: string): Promise<SpamCheckResult> {
        return this.config.getModuleSpamCheckResult(eventId);
    }

    async listModuleSpamChecksBySender(sender: string, options?: { limit?: number }): Promise<SpamCheckResult[]> {
        return this.config.listModuleSpamChecksBySender(sender, options);
    }

    async getModuleThirdPartyRuleResults(eventId: string): Promise<ThirdPartyRuleResult[]> {
        return this.config.getModuleThirdPartyRuleResults(eventId);
    }

    async getRegistrationTokens(): Promise<RegistrationToken[]> {
        return this.config.getRegistrationTokens();
    }

    async createRegistrationToken(
        tokenOrPayload: string | { token: string; uses_allowed?: number; expiry_ts?: number },
        usesAllowed?: number,
        expiryTs?: number,
    ): Promise<RegistrationToken> {
        return this.config.createRegistrationToken(tokenOrPayload, usesAllowed, expiryTs);
    }

    async deleteRegistrationToken(token: string): Promise<void> {
        return this.config.deleteRegistrationToken(token);
    }

    async updateRegistrationToken(token: string, payload: { uses_allowed?: number; expiry_ts?: number }): Promise<void> {
        return this.config.updateRegistrationToken(token, payload);
    }

    async getRegistrationToken(token: string): Promise<RegistrationToken> {
        return this.config.getRegistrationToken(token);
    }

    async createAccountValidity(payload: AccountValidityRequest): Promise<AdminAccountValidityInfo> {
        return this.config.createAccountValidity(payload);
    }

    async getAccountValidity(userId: string): Promise<AdminAccountValidityInfo> {
        return this.config.getAccountValidity(userId);
    }

    async renewAccountValidity(userId: string, payload: AccountValidityRenewRequest): Promise<AdminAccountValidityInfo> {
        return this.config.renewAccountValidity(userId, payload);
    }

    async listPasswordAuthProviders(): Promise<AdminPasswordAuthProviderPage> {
        return this.config.listPasswordAuthProviders();
    }

    async createPasswordAuthProvider(payload: DynamicConfig): Promise<AdminPasswordAuthProvider> {
        return this.config.createPasswordAuthProvider(payload);
    }

    async listPresenceRoutes(): Promise<AdminPresenceRoutePage> {
        return this.config.listPresenceRoutes();
    }

    async createPresenceRoute(payload: DynamicConfig): Promise<AdminPresenceRoute> {
        return this.config.createPresenceRoute(payload);
    }

    async listMediaCallbacks(): Promise<AdminMediaCallbackPage> {
        return this.config.listMediaCallbacks();
    }

    async listMediaCallbacksByType(callbackType: string): Promise<AdminMediaCallbackPage> {
        return this.config.listMediaCallbacksByType(callbackType);
    }

    async createMediaCallback(payload: DynamicConfig): Promise<AdminMediaCallback> {
        return this.config.createMediaCallback(payload);
    }

    async listRateLimitCallbacks(): Promise<AdminRateLimitCallbackPage> {
        return this.config.listRateLimitCallbacks();
    }

    async createRateLimitCallback(payload: DynamicConfig): Promise<AdminRateLimitCallback> {
        return this.config.createRateLimitCallback(payload);
    }

    async listAccountDataCallbacks(): Promise<AdminAccountDataCallbackPage> {
        return this.config.listAccountDataCallbacks();
    }

    async createAccountDataCallback(payload: DynamicConfig): Promise<AdminAccountDataCallback> {
        return this.config.createAccountDataCallback(payload);
    }

    async getInviteAllowlist(): Promise<AdminInviteList> {
        return this.config.getInviteAllowlist();
    }

    async getInviteBlocklist(): Promise<AdminInviteList> {
        return this.config.getInviteBlocklist();
    }

    async getJitsiConfig(): Promise<AdminJitsiConfig> {
        return this.config.getJitsiConfig();
    }

    async listAuditEvents(options?: Record<string, string | number | undefined>): Promise<AuditEventPage> {
        return this.config.listAuditEvents(options);
    }

    async getAuditEvent(eventId: string): Promise<AuditEvent> {
        return this.config.getAuditEvent(eventId);
    }

    async createAuditEvent(payload: AuditEventCreateRequest): Promise<AuditEvent> {
        return this.config.createAuditEvent(payload);
    }

    async acknowledgeTelemetryAlert(alertId: string): Promise<void> {
        return this.config.acknowledgeTelemetryAlert(alertId);
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getAdminManager = function (): AdminManager {
        return getOrCreateManager(this, "admin", () => new AdminManager(this));
    };

    // 子 Manager 便捷访问方法（通过 AdminManager 的组合属性获取）
    MatrixClient.prototype.getAdminUserManager = function (): AdminUserManager {
        return this.getAdminManager().users;
    };
    MatrixClient.prototype.getAdminRoomManager = function (): AdminRoomManager {
        return this.getAdminManager().rooms;
    };
    MatrixClient.prototype.getAdminServerManager = function (): AdminServerManager {
        return this.getAdminManager().server;
    };
    MatrixClient.prototype.getAdminFederationManager = function (): AdminFederationManager {
        return this.getAdminManager().federation;
    };
    MatrixClient.prototype.getAdminMediaManager = function (): AdminMediaManager {
        return this.getAdminManager().media;
    };
    MatrixClient.prototype.getAdminConfigManager = function (): AdminConfigManager {
        return this.getAdminManager().config;
    };
}

export default extendMatrixClient;
