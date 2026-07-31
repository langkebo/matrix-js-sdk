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
 * 通过 ES Proxy 自动将旧方法调用转发到对应子 Manager，保持完全向后兼容。
 * 推荐使用子 Manager 直接访问：`adminManager.users.createUser(...)`
 *
 * ⚠️ URL 组装规则：
 * - HTTP 层执行 baseUrl + prefix + path 三段拼接
 * - 使用 prefix 时，path 只传相对路径（不带前缀）
 * - 例如：baseUrl=https://server.com + prefix=/_synapse/admin + path=/v1/users
 *   结果: https://server.com/_synapse/admin/v1/users
 */

import { MatrixClient } from "../client";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import { AdminBaseManager, type AdminErrorCallback, type ManagerOpts } from "./admin-base-manager";
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

/** 6 个子 Manager 的联合类型（用于 Proxy 路由） */
type AdminSubManager =
    | AdminUserManager
    | AdminRoomManager
    | AdminServerManager
    | AdminFederationManager
    | AdminMediaManager
    | AdminConfigManager;

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
 * AdminManager 向后兼容门面方法签名（由 Proxy 在运行时自动转发到对应子 Manager）。
 *
 * 此接口与 `AdminManager` class 声明合并，保证现有调用方的 TypeScript 类型不变；
 * 实现由构造器返回的 ES Proxy 按方法名路由到对应子 Manager。
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- Proxy 在运行时提供实现，与 client.ts 同模式
export interface AdminManager {
    // ----- 用户管理（→ users） -----
    getUsersPaginated(options?: { from?: string; limit?: number }): Promise<PaginatedResponse<AdminAccountDetails>>;
    getUser(userId: string, throwOnError?: boolean): Promise<AdminAccountDetails | null>;
    createUser(
        userId: string,
        options?: { password?: string; displayname?: string; admin?: boolean; deactivated?: boolean },
    ): Promise<AdminAccountDetails>;
    deactivateUser(userId: string): Promise<void>;
    deleteUser(userId: string): Promise<void>;
    batchCreateUsers(payload: BatchCreateUsersRequest): Promise<BatchCreateUsersResponse>;
    batchDeactivateUsers(payload: BatchDeactivateUsersRequest): Promise<BatchDeactivateUsersResponse>;
    resetPassword(userId: string, newPassword: string): Promise<void>;
    setAdmin(userId: string, admin: boolean): Promise<void>;
    getUserDevices(userId: string): Promise<DeviceInfo[]>;
    deleteUserDevices(userId: string, deviceIds: string[]): Promise<void>;
    deleteUserDevice(userId: string, deviceId: string): Promise<void>;
    getUserTokens(userId: string): Promise<{ tokens: AdminToken[] }>;
    deleteUserToken(userId: string, tokenId: string): Promise<void>;
    getUserRefreshTokens(userId: string): Promise<{ refresh_tokens: AdminRefreshToken[] }>;
    deleteUserRefreshToken(userId: string, tokenId: string): Promise<void>;
    getUserSession(userId: string): Promise<UserSession>;
    getUserRooms(userId: string, from?: string, limit?: number): Promise<UserRoomsResponse>;
    getUserStats(userId: string): Promise<UserStatsResponse>;
    listUserStats(from?: string, limit?: number): Promise<UserStatsListResponse>;
    invalidateUserSession(userId: string): Promise<void>;
    loginAsUser(userId: string, payload?: AdminLoginAsUserRequest): Promise<AdminLoginAsUserResponse>;
    logoutUser(userId: string, payload?: AdminLogoutRequest): Promise<AdminLogoutResponse>;
    evictUser(userId: string, payload?: AdminEvictRequest): Promise<AdminEvictResponse>;
    getAccountStatus(userId: string, throwOnError?: boolean): Promise<AccountStatus | null>;
    isAdmin(userId: string, throwOnError?: boolean): Promise<boolean>;
    overrideRateLimit(userId: string): Promise<void>;
    getRateLimitOverride(userId: string, throwOnError?: boolean): Promise<RateLimitConfig | null>;
    deleteRateLimitOverride(userId: string): Promise<void>;
    shadowBanUser(userId: string): Promise<void>;
    unshadowBanUser(userId: string): Promise<void>;
    getShadowBanStatus(userId: string, throwOnError?: boolean): Promise<ShadowBanStatus | null>;
    getRateLimit(userId: string, throwOnError?: boolean): Promise<RateLimitConfig | null>;
    setRateLimit(userId: string, config: { messages_per_second?: number; burst_count?: number }): Promise<void>;
    deleteRateLimit(userId: string): Promise<void>;
    getAccountDetails(userId: string): Promise<AdminAccountDetails>;
    updateAccountDetails(userId: string, payload: UpdateAccountDetailsRequest): Promise<UpdateAccountDetailsResponse>;
    getUserWhois(userId: string): Promise<WhoisResponse>;
    whois(userId: string): Promise<WhoisResponse>;
    whoisByDevice(userId: string, deviceId: string): Promise<WhoisResponse>;
    getUserMedia(userId: string, from?: string, limit?: number): Promise<{ media: MediaInfo[]; next_token?: string }>;
    deleteUserMedia(userId: string): Promise<void>;
    getUserNotification(userId: string): Promise<UserNotificationResponse>;
    setUserNotification(userId: string, payload: UserNotificationPayload): Promise<UserNotificationResponse>;
    getUserPushers(userId: string): Promise<{ pushers: UserPusher[] }>;
    deleteUserPusher(userId: string, pushkey: string): Promise<void>;
    blockEventReportUser(userId: string, payload: { blocked_until?: number; reason?: string }): Promise<void>;
    unblockEventReportUser(userId: string): Promise<void>;

    // ----- Synapse-specific admin methods（→ users） -----
    isSynapseAdministrator(userId: string): Promise<boolean>;
    whoisSynapseUser(userId: string): Promise<ISynapseAdminWhoisResponse>;
    deactivateSynapseUser(userId: string): Promise<ISynapseAdminDeactivateResponse>;

    // ----- 房间管理（→ rooms） -----
    getRoomsPaginated(options?: {
        from?: string;
        limit?: number;
        search?: string;
        order_by?: string;
        sort_order?: "asc" | "desc";
    }): Promise<PaginatedResponse<RoomInfo>>;
    searchRooms(options?: Record<string, string | number | boolean | undefined>): Promise<AdminRoomSearchResult>;
    searchRoomsPost(payload: RoomSearchPayload): Promise<AdminRoomSearchResult>;
    getRoom(roomId: string, throwOnError?: boolean): Promise<RoomInfo | null>;
    deleteRoom(
        roomId: string,
        blockOrOptions?: boolean | { block?: boolean; purge?: boolean; force_purge?: boolean; reason?: string },
        purge?: boolean,
        reason?: string,
    ): Promise<void>;
    deleteRoomAdmin(roomId: string, payload?: RoomDeletePayload): Promise<void>;
    purgeRoomHistory(roomId: string, payload?: PurgeHistoryPayload): Promise<AdminPurgeHistoryResult>;
    blockRoom(roomId: string, block: boolean, reason?: string): Promise<void>;
    unblockRoom(roomId: string, payload?: AdminReasonPayload): Promise<void>;
    getRoomMembers(roomId: string): Promise<AdminAccountDetails[]>;
    addRoomMember(roomId: string, userId: string, payload?: AdminReasonPayload): Promise<void>;
    removeRoomMember(roomId: string, userId: string): Promise<void>;
    banRoomMember(roomId: string, userId: string, payload?: AdminReasonPayload): Promise<void>;
    kickRoomMember(roomId: string, userId: string, payload?: AdminReasonPayload): Promise<void>;
    unbanRoomMember(roomId: string, userId: string, payload?: AdminReasonPayload): Promise<void>;
    banRoom(roomId: string, payload: AdminBanKickPayload): Promise<void>;
    kickRoom(roomId: string, payload: AdminBanKickPayload): Promise<void>;
    makeRoomAdmin(roomId: string, payload: AdminMakeRoomAdminPayload): Promise<void>;
    getRoomState(roomId: string): Promise<{ state: RoomStateEvent[] }>;
    getRoomMessages(
        roomId: string,
        optionsOrFrom?: string | { from?: string; limit?: number; dir?: "b" | "f" | string },
        limit?: number,
    ): Promise<{ chunk: RoomMessage[]; start?: string; end?: string }>;
    deleteRoomMessage(roomId: string, eventId: string, reason?: string): Promise<void>;
    getRoomAliases(roomId: string): Promise<{ aliases: string[] }>;
    getRoomVersion(roomId: string): Promise<AdminRoomVersionResponse>;
    getRoomBlockStatus(roomId: string): Promise<AdminRoomBlockStatus>;
    getRoomEventContext(roomId: string, eventId: string): Promise<AdminEventContext>;
    getRoomForwardExtremities(roomId: string): Promise<AdminForwardExtremity[]>;
    getRoomTokenSync(roomId: string): Promise<AdminTokenSync>;
    searchRoomEvents(roomId: string, payload: RoomEventSearchPayload): Promise<AdminRoomSearchResult>;
    getRoomListings(roomId: string): Promise<AdminRoomListings>;
    setRoomPublicListing(roomId: string): Promise<void>;
    deleteRoomPublicListing(roomId: string): Promise<void>;
    getRoomStats(from?: string, limit?: number): Promise<RoomStats[]>;
    getRoomStatsByRoom(roomId: string): Promise<RoomStats>;
    joinRoom(roomId: string, userId: string): Promise<void>;
    listReports(options?: { from?: string; limit?: number }): Promise<AdminReportPage>;
    getReport(reportId: string): Promise<AdminReport>;
    deleteReport(reportId: string): Promise<void>;
    listRoomReports(roomId: string, options?: { from?: string; limit?: number }): Promise<AdminReportPage>;
    getRoomReport(roomId: string, reportId: string): Promise<AdminReport>;
    getSpace(spaceId: string): Promise<SpaceInfo>;
    listSpaces(from?: string, limit?: number): Promise<SpacePage>;
    deleteSpace(spaceId: string): Promise<void>;
    getSpaceRooms(spaceId: string, from?: string, limit?: number): Promise<{ rooms: SpaceRoom[]; next_batch?: string }>;
    getSpaceStats(spaceId: string): Promise<SpaceStats>;
    getSpaceUsers(spaceId: string, from?: string, limit?: number): Promise<{ users: SpaceUser[]; next_batch?: string }>;

    // ----- 服务器管理（→ server） -----
    getServerStats(): Promise<ServerStats>;
    getServerStatsCached(): ServerStats | null;
    getServerStatus(): Promise<ServerStatus>;
    getServerHealth(): Promise<ServerHealth>;
    getServerInfo(): Promise<ServerInfo>;
    cleanupDatabase(options?: {
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
    }): Promise<AdminCleanupResponse>;
    getServerNotices(
        fromOrLimit?: string | number,
        limit?: number,
    ): Promise<{ notices: ServerNotice[]; next_token?: string }>;
    sendServerNotice(
        arg1: string,
        arg2?: string | { msgtype: string; body: string; [k: string]: unknown },
        arg3?: string[],
    ): Promise<{ event_id?: string }>;
    deleteServerNotice(notificationId: string): Promise<void>;
    getServerNotice(noticeId: string): Promise<ServerNotice>;
    listNotifications(from?: string, limit?: number): Promise<SystemNotificationPage>;
    createNotification(payload: DynamicConfig): Promise<SystemNotificationInfo>;
    listActiveNotifications(): Promise<SystemNotificationInfo[]>;
    getNotification(notificationId: string): Promise<SystemNotificationInfo>;
    updateNotification(notificationId: string, payload: DynamicConfig): Promise<SystemNotificationInfo>;
    deactivateNotification(notificationId: string): Promise<void>;
    deleteNotification(notificationId: string): Promise<void>;
    getServerConfig(throwOnError?: boolean): Promise<AdminServerConfig>;
    getAdminInfo(): Promise<AdminInfoResponse>;
    getServerVersion(throwOnError?: boolean): Promise<{ server_version: string; python_version: string }>;
    getRegisterNonce(): Promise<{ nonce: string }>;
    registerAdmin(payload: AdminRegisterRequest): Promise<AdminRegisterResult>;
    restartServer(payload?: RestartServerPayload): Promise<RestartServerResponse>;
    listBackups(options?: { limit?: number; offset?: number }): Promise<AdminBackupPage>;
    getExperimentalFeatures(): Promise<AdminExperimentalFeatures>;
    purgeRoom(payload: { room_id: string }): Promise<PurgeRoomResponse>;
    purgeHistory(payload: PurgeHistoryRequest): Promise<AdminPurgeHistoryResult>;
    shutdownRoom(payload: ShutdownRoomRequest): Promise<AdminShutdownRoomResult>;
    cleanupAll(): Promise<AdminCleanupResponse>;
    cleanupRooms(payload?: CleanupRoomsRequest): Promise<AdminCleanupResponse>;
    cleanupTokens(): Promise<AdminCleanupResponse>;

    // ----- 联邦管理（→ federation） -----
    getFederationBlacklist(): Promise<FederationBlacklistEntry[]>;
    addFederationBlacklistEntry(serverName: string, reason?: string): Promise<void>;
    removeFederationBlacklistEntry(serverName: string): Promise<void>;
    addToFederationBlacklist(serverName: string, reason?: string): Promise<void>;
    removeFromFederationBlacklist(serverName: string): Promise<void>;
    getFederationDestinations(): Promise<FederationDestination[]>;
    getFederationDestination(
        serverName: string,
        throwOnError?: boolean,
    ): Promise<AdminFederationDestinationDetail | null>;
    disconnectFederation(serverName: string): Promise<void>;
    resetFederationConnection(serverName: string): Promise<void>;
    resetFederationDestination(serverName: string): Promise<void>;
    getFederationDestinationRooms(
        serverName: string,
        options?: { from?: number; limit?: number },
    ): Promise<AdminFederationDestinationRooms>;
    deleteFederationDestination(serverName: string): Promise<void>;
    getFederationCache(): Promise<AdminFederationCache>;
    clearFederationCache(): Promise<void>;
    deleteFederationCacheEntry(key: string): Promise<void>;
    getFederationAdmissionList(): Promise<FederationAdmissionResult[]>;
    getPendingFederationServers(from?: string, limit?: number): Promise<PendingFederationList>;
    resolveFederation(serverName: string): Promise<FederationResolveResponse>;
    rewriteFederation(from: string, to: string): Promise<FederationRewriteResponse>;
    confirmFederation(payload: {
        server_name?: string;
        action?: string;
        reason?: string;
    }): Promise<FederationAdmissionResult>;

    // ----- 媒体管理（→ media） -----
    getMedia(
        fromOrLimit?: string | number,
        limitOrFrom?: number | string,
    ): Promise<{ media: MediaInfo[]; next_token?: string }>;
    getMediaInfo(mediaId: string): Promise<MediaInfo>;
    deleteMedia(mediaId: string): Promise<void>;
    getMediaQuota(): Promise<MediaQuotaResponse>;
    quarantineMedia(mediaId: string): Promise<void>;
    unquarantineMedia(mediaId: string): Promise<void>;
    purgeMediaCache(beforeTs?: number): Promise<{ deleted: number }>;
    /** 获取媒体隔离变更历史（详见 AdminMediaManager.getMediaQuarantineChanges） */
    getMediaQuarantineChanges(
        mediaId: string,
        options?: { from?: string; limit?: number },
    ): Promise<MediaQuarantineChangesResponse>;

    // ----- 配置管理（→ config） -----
    getRetentionPolicy(): Promise<RetentionPolicy>;
    setRetentionPolicy(policy: {
        max_lifetime?: number | null;
        min_lifetime?: number | null;
        expire_on_clients?: boolean;
    }): Promise<RetentionPolicy>;
    getRoomRetentionPolicy(roomId: string): Promise<RoomRetentionPolicy>;
    setRoomRetentionPolicy(
        roomId: string,
        policy: {
            max_lifetime?: number | null;
            min_lifetime?: number | null;
            expire_on_clients?: boolean;
        },
    ): Promise<RoomRetentionPolicy>;
    runRetention(options?: { room_id?: string; scope?: "all" | "room" }): Promise<RetentionRunResult>;
    getRetentionStatus(): Promise<RetentionStatus>;
    getFeatureFlags(): Promise<FeatureFlagPage>;
    getFeatureFlag(flagKey: string): Promise<FeatureFlag>;
    setFeatureFlag(
        flagKey: string,
        targetScope: string,
        rolloutPercent: number,
        expiresAt: number | null,
        reason: string,
        targets: FeatureFlagTarget[],
    ): Promise<FeatureFlag>;
    deleteFeatureFlag(flagKey: string): Promise<void>;
    listFeatureFlags(options?: Record<string, string | number | undefined>): Promise<FeatureFlagPage>;
    updateFeatureFlag(flagId: string, payload: FeatureFlagUpdatePayload): Promise<FeatureFlag>;
    listModules(options?: { limit?: number; from?: string }): Promise<AdminModulePage>;
    listModulesByType(moduleType: string): Promise<AdminModulePage>;
    updateModuleConfig(moduleId: string, config: DynamicConfig): Promise<AdminModuleInfo>;
    setModuleEnabled(moduleId: string, isEnabled: boolean): Promise<AdminModuleInfo>;
    getModuleLogs(moduleId: string, options?: { limit?: number; from?: number }): Promise<AdminModuleLogPage>;
    checkModuleThirdPartyRule(payload: ThirdPartyRuleCheckPayload): Promise<ThirdPartyRuleCheckResult>;
    getModuleSpamCheckResult(eventId: string): Promise<SpamCheckResult>;
    listModuleSpamChecksBySender(sender: string, options?: { limit?: number }): Promise<SpamCheckResult[]>;
    getModuleThirdPartyRuleResults(eventId: string): Promise<ThirdPartyRuleResult[]>;
    getRegistrationTokens(): Promise<RegistrationToken[]>;
    createRegistrationToken(
        tokenOrPayload: string | { token: string; uses_allowed?: number; expiry_ts?: number },
        usesAllowed?: number,
        expiryTs?: number,
    ): Promise<RegistrationToken>;
    deleteRegistrationToken(token: string): Promise<void>;
    updateRegistrationToken(token: string, payload: { uses_allowed?: number; expiry_ts?: number }): Promise<void>;
    getRegistrationToken(token: string): Promise<RegistrationToken>;
    createAccountValidity(payload: AccountValidityRequest): Promise<AdminAccountValidityInfo>;
    getAccountValidity(userId: string): Promise<AdminAccountValidityInfo>;
    renewAccountValidity(userId: string, payload: AccountValidityRenewRequest): Promise<AdminAccountValidityInfo>;
    listPasswordAuthProviders(): Promise<AdminPasswordAuthProviderPage>;
    createPasswordAuthProvider(payload: DynamicConfig): Promise<AdminPasswordAuthProvider>;
    listPresenceRoutes(): Promise<AdminPresenceRoutePage>;
    createPresenceRoute(payload: DynamicConfig): Promise<AdminPresenceRoute>;
    listMediaCallbacks(): Promise<AdminMediaCallbackPage>;
    listMediaCallbacksByType(callbackType: string): Promise<AdminMediaCallbackPage>;
    createMediaCallback(payload: DynamicConfig): Promise<AdminMediaCallback>;
    listRateLimitCallbacks(): Promise<AdminRateLimitCallbackPage>;
    createRateLimitCallback(payload: DynamicConfig): Promise<AdminRateLimitCallback>;
    listAccountDataCallbacks(): Promise<AdminAccountDataCallbackPage>;
    createAccountDataCallback(payload: DynamicConfig): Promise<AdminAccountDataCallback>;
    getInviteAllowlist(): Promise<AdminInviteList>;
    getInviteBlocklist(): Promise<AdminInviteList>;
    addToInviteBlocklist(userId: string, reason?: string): Promise<void>;
    removeFromInviteBlocklist(userId: string): Promise<void>;
    addToInviteAllowlist(userId: string): Promise<void>;
    removeFromInviteAllowlist(userId: string): Promise<void>;
    getJitsiConfig(): Promise<AdminJitsiConfig>;
    listAuditEvents(options?: Record<string, string | number | undefined>): Promise<AuditEventPage>;
    getAuditEvent(eventId: string): Promise<AuditEvent>;
    createAuditEvent(payload: AuditEventCreateRequest): Promise<AuditEvent>;
    acknowledgeTelemetryAlert(alertId: string): Promise<void>;
}

/**
 * Admin Manager - 管理员 API 统一入口
 *
 * 通过组合模式将功能委托到子 Manager，同时通过 ES Proxy 保持完全向后兼容。
 *
 * @example
 * ```typescript
 * // 向后兼容：直接在 AdminManager 上调用方法（Proxy 自动转发到对应子 Manager）
 * const user = await adminManager.getUser("@alice:example.com");
 *
 * // 推荐新方式：通过子 Manager 访问
 * const user = await adminManager.users.getUser("@alice:example.com");
 * const room = await adminManager.rooms.getRoom("!room:example.com");
 * const stats = await adminManager.server.getServerStats();
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- 门面方法签名由 interface 提供，Proxy 转发实现
export class AdminManager extends AdminBaseManager<AdminEvent, AdminManagerEventMap> {
    // ===== 子 Manager（组合模式） =====
    public readonly users: AdminUserManager;
    public readonly rooms: AdminRoomManager;
    public readonly server: AdminServerManager;
    public readonly federation: AdminFederationManager;
    public readonly media: AdminMediaManager;
    public readonly config: AdminConfigManager;

    /** 方法名 → 子 Manager 路由表（构造时一次性构建，覆盖 6 个子 Manager 的全部自有方法） */
    private readonly subManagerRoutes: ReadonlyMap<string, AdminSubManager>;

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        // 错误回调：发射 AdminError 事件
        const onError: AdminErrorCallback = (error) => {
            this.emit(AdminEvent.AdminError, error);
        };

        super(client, onError, opts);

        // 创建子 Manager，共享错误回调和 ManagerOpts
        this.users = new AdminUserManager(client, onError, opts);
        this.rooms = new AdminRoomManager(client, onError, opts);
        this.server = new AdminServerManager(client, onError, opts);
        this.federation = new AdminFederationManager(client, onError, opts);
        this.media = new AdminMediaManager(client, onError, opts);
        this.config = new AdminConfigManager(client, onError, opts);

        // 构建方法名 → 子 Manager 路由表。
        // 遍历每个子 Manager 的自有原型方法，first-match-wins 决定冲突优先级：
        // rooms 优先于 config（listReports/getReport/deleteReport 同时存在于两者，index.ts 历史委托给 rooms）。
        const routes = new Map<string, AdminSubManager>();
        for (const subManager of [this.users, this.rooms, this.server, this.federation, this.media, this.config]) {
            const proto = Object.getPrototypeOf(subManager);
            for (const name of Object.getOwnPropertyNames(proto)) {
                if (name === "constructor") continue;
                if (typeof proto[name] === "function" && !routes.has(name)) {
                    routes.set(name, subManager);
                }
            }
        }
        this.subManagerRoutes = routes;

        // 转发子 Manager 事件到 AdminManager（向后兼容）
        this.forwardSubManagerEvents();

        // ES Proxy：自动将未在 AdminManager 上定义的方法调用转发到对应子 Manager。
        // get trap 先检查 target 自身及原型链（Reflect.has），确保 instanceof、Symbol 属性、
        // EventEmitter 方法（on/emit/off 等）、子 Manager 字段（users/rooms/...）等正常工作；
        // 仅当 target 无此属性时才按方法名路由到子 Manager 并返回绑定方法。
        return new Proxy(this, {
            get(target, prop, receiver) {
                if (Reflect.has(target, prop)) {
                    return Reflect.get(target, prop, receiver);
                }
                if (typeof prop === "string") {
                    const subManager = target.routeToSubManager(prop);
                    if (subManager) {
                        const fn = (subManager as unknown as Record<string, unknown>)[prop];
                        if (typeof fn === "function") {
                            return fn.bind(subManager);
                        }
                    }
                }
                return undefined;
            },
        });
    }

    /**
     * 将方法名路由到对应的子 Manager。
     * 基于构造时构建的路由表（覆盖 6 个子 Manager 的全部自有方法）。
     */
    private routeToSubManager(methodName: string): AdminSubManager | null {
        return this.subManagerRoutes.get(methodName) ?? null;
    }

    /**
     * 将子 Manager 的事件转发到 AdminManager
     * 保持 `adminManager.on(AdminEvent.UserCreated, ...)` 的向后兼容性
     */
    private forwardSubManagerEvents(): void {
        // 用户事件
        this.users.on(AdminUserEvent.UserCreated, (userId, user) => this.emit(AdminEvent.UserCreated, userId, user));
        this.users.on(AdminUserEvent.UserDeactivated, (userId) => this.emit(AdminEvent.UserDeactivated, userId));
        this.users.on(AdminUserEvent.UserShadowBanned, (userId) => this.emit(AdminEvent.UserShadowBanned, userId));
        this.users.on(AdminUserEvent.UserUnshadowBanned, (userId) => this.emit(AdminEvent.UserUnshadowBanned, userId));

        // 房间事件
        this.rooms.on(AdminRoomEvent.RoomDeleted, (roomId) => this.emit(AdminEvent.RoomDeleted, roomId));
        this.rooms.on(AdminRoomEvent.RoomBlocked, (roomId, blocked) =>
            this.emit(AdminEvent.RoomBlocked, roomId, blocked),
        );

        // 服务器事件
        this.server.on(AdminServerEvent.ServerStatsUpdated, (stats) => this.emit(AdminEvent.ServerStatsUpdated, stats));
    }

    /** 停止 AdminManager，清理所有 sub-manager 的转发监听器 */
    stop(): void {
        // 清理 forwardSubManagerEvents 注册的转发监听器，防止 stop() 后事件泄漏
        this.users.removeAllListeners();
        this.rooms.removeAllListeners();
        this.server.removeAllListeners();
        this.federation.removeAllListeners();
        this.media.removeAllListeners();
        this.config.removeAllListeners();
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getAdminManager = function (): AdminManager {
        registerManagerClass("admin", AdminManager);
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
