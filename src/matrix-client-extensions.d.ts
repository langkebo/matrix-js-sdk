/**
 * MatrixClient 类型扩展声明
 * 解决 extendMatrixClient 模式导致的类型丢失问题
 *
 * 每个通过 extendMatrixClient 添加的方法都需要在这里声明
 * 
 * ⚠️ 重要：所有 Manager 必须实现 extendMatrixClient() 函数才能正常工作
 * 新添加的 Manager 需要同时：
 * 1. 在对应的模块中实现 extendMatrixClient()
 * 2. 在本文件中声明接口
 */

import type { MatrixClient } from "./client";
import type { Room } from "./models/room";
import type { MatrixEvent } from "./models/event";
import type { RoomMember } from "./models/room-member";

// ============ 类型定义 ============

interface MatrixClientExtensionMethods {
    // ============ Account & Profile ============
    getProfileManager(): import("./profile/index").ProfileManager;
    getAuthManager(): import("./auth/index").AuthManager;
    getCredentialsManager(): import("./credentials/index").CredentialsManager;
    getDeviceManager(): import("./device-management/index").DeviceManager;

    // ============ Room Management ============
    getRoomCreationManager(): import("./room-creation/index").RoomCreationManager;
    getRoomJoiningManager(): import("./room-joining/index").RoomJoiningManager;
    getRoomSettingsManager(): import("./room-settings/index").RoomSettingsManager;
    getRoomStateManager(): import("./room-state/index").RoomStateManager;
    getRoomStateManagementManager(): import("./room-state-management/index").RoomStateManagementManager;
    getRoomListManager(): import("./room-list/index").RoomListManager;
    
    // ============ Room Summary ============
    // 推荐使用 RoomSummaryManager（完整封装，包含缓存和事件）
    getRoomSummaryManager(): import("./room-summary/index").RoomSummaryManager;

    // ============ Space ============
    // SpaceManager - Space 空间管理
    getSpaceManager(): import("./space/index").SpaceManager;

    getRoomEventsManager(): import("./room-events/index").RoomEventsManager;
    getRoomMemberManager(): import("./room-member/index").RoomMemberManager;
    getInvitesManager(): import("./invites/index").InvitesManager;
    getRoomKeysManager(): import("./room-keys/index").RoomKeysManager;
    getRoomKeySharingManager(): import("./room-key-sharing/index").RoomKeySharingManager;
    getRoomUpgradesManager(): import("./room-upgrades/index").RoomUpgradesManager;
    getPinnedMessagesManager(): import("./pinned-messages/index").PinnedMessagesManager;
    getRoomAccountDataManager(): import("./room-account-data/index").RoomAccountDataManager;

    // ============ Messaging & Events ============
    getSendingManager(): import("./sending/index").SendingManager;
    getSendingQueueManager(): import("./sending-queue/index").SendingQueueManager;
    getEventManager(): import("./event/index").EventManager;
    getEventProcessingManager(): import("./event-processing/index").EventProcessingManager;
    getEventStatusManager(): import("./event-status/index").EventStatusManager;
    getReactionsManager(): import("./reactions/index").ReactionsManager;
    getRelationsManager(): import("./relations/index").RelationsManager;
    getAggregationsManager(): import("./aggregations/index").AggregationsManager;
    getTimelineManager(): import("./timeline/index").TimelineManager;
    getPaginationManager(): import("./pagination/index").PaginationManager;
    getThreadingManager(): import("./threading/index").ThreadingManager;

    // ============ Presence & Typing ============
    getPresenceManager(): import("./presence/index").PresenceManager;
    getUserPresenceManager(): import("./user-presence/index").UserPresenceManager;
    getTypingManager(): import("./typing/index").TypingManager;
    getEphemeralManager(): import("./ephemeral/index").EphemeralManager;

    // ============ User Directory & Search ============
    getUserDirectoryManager(): import("./user-directory/index").UserDirectoryManager;
    getSearchManager(): import("./search/index").SearchManager;

    // ============ Direct Messages ============
    // ⚠️ DM Manager - m.direct 是用户级别的 account data
    getDirectMessageManager(): import("./dm/index").DirectMessageManager;

    // ============ Friends ============
    getFriendManager(): import("./friend/index").FriendManager;

    // ============ VoIP & Calls ============
    getVoIPCallsManager(): import("./voip-calls/index").VoIPCallsManager;

    // ============ Push Notifications ============
    // ⚠️ Push Manager - 提供完整的推送规则和 pusher 管理
    getPushManager(): import("./push/index").PushManager;
    getPushRulesManager(): import("./push-rules/index").PushRulesManager;
    getPushNotificationsManager(): import("./push-notifications/index").PushNotificationsManager;
    getNotificationsManager(): import("./notifications/index").NotificationsManager;
    getNotificationsLegacyManager(): import("./notifications-legacy/index").NotificationsLegacyManager;

    // ============ Crypto & Security ============
    getCryptoEncryptionManager(): import("./crypto-encryption/index").CryptoEncryptionManager;
    getCryptoAlgorithmsManager(): import("./crypto-algorithms/index").CryptoAlgorithmsManager;
    getCryptoBackupManager(): import("./crypto-backup/index").CryptoBackupManager;
    getCryptoStoreManager(): import("./crypto-store/index").CryptoStoreManager;
    getCrossSigningManager(): import("./cross-signing/index").CrossSigningManager;
    getDeviceKeysManager(): import("./device-keys/index").DeviceKeysManager;
    getKeyVerificationManager(): import("./key-verification/index").KeyVerificationManager;
    getKeyForwardingManager(): import("./key-forwarding/index").KeyForwardingManager;
    getKeyClaimManager(): import("./key-claim/index").KeyClaimManager;
    getSecretStorageManager(): import("./secret-storage/index").SecretStorageManager;
    getEncryptionRotationManager(): import("./encryption-rotation/index").EncryptionRotationManager;

    // ============ Sessions & Tokens ============
    getSessionsManager(): import("./sessions/index").SessionsManager;
    getTokenManager(): import("./token-management/index").TokenManager;
    getOtrManager(): import("./otr/index").OtrManager;

    // ============ Server & Network ============
    getDiscoveryManager(): import("./discovery/index").DiscoveryManager;
    getDirectoryManager(): import("./directory/index").DirectoryManager;
    getServerCapabilitiesManager(): import("./server-capabilities/index").ServerCapabilitiesManager;
    getHttpManager(): import("./http/index").HttpManager;
    getTurnServerManager(): import("./turn-server/index").TurnServerManager;
    getServerTimeManager(): import("./server-time/index").ServerTimeManager;
    getIdentityManager(): import("./identity/index").IdentityManager;

    // ============ Sync & State ============
    getSyncManager(): import("./sync-management/index").SyncManager;
    getSyncAccumulatorManager(): import("./sync-accumulator/index").SyncAccumulatorManager;
    getFilteringManager(): import("./filtering/index").FilteringManager;

    // ============ Storage & Persistence ============
    getStoresManager(): import("./stores/index").StoresManager;
    getUploadsManager(): import("./uploads/index").UploadsManager;

    // ============ Admin & Moderation ============
    // ⚠️ Admin Manager - URL 组装规则：prefix + path（相对路径）
    getAdminManager(): import("./admin/index").AdminManager;
    getReportingManager(): import("./reporting/index").ReportingManager;
    getBannedUsersManager(): import("./banned-users/index").BannedUsersManager;

    // ============ Content & Media ============
    getMediaQuotaManager(): import("./media-quota/index").MediaQuotaManager;
    getContentScanManager(): import("./content-scan/index").ContentScanManager;

    // ============ Tags & Labels ============
    getTagsManager(): import("./tags-management/index").TagsManager;

    // ============ Widgets & Integrations ============
    getWidgetsManager(): import("./widgets/index").WidgetsManager;
    getGroupCallManager(): import("./group-management/index").GroupCallManager;

    // ============ Scheduled Events ============
    getScheduledCallManager(): import("./scheduled-call/index").ScheduledCallManager;
    getScheduledEventsManager(): import("./scheduled-events/index").ScheduledEventsManager;

    // ============ Other Features ============
    getThirdPartyManager(): import("./thirdparty/index").ThirdPartyManager;
    getUrlPreviewManager(): import("./url-preview/index").UrlPreviewManager;
    getIgnoredUsersManager(): import("./ignored-users/index").IgnoredUsersManager;
    getGuestManager(): import("./guest/index").GuestManager;
    getCaptchaManager(): import("./captcha/index").CaptchaManager;
    getRetentionManager(): import("./retention/index").RetentionManager;
    getBeaconManager(): import("./beacon/index").BeaconManager;
    getSamlAuthManager(): import("./saml/index").SamlAuthManager;
    getLoggerManager(): import("./logger/index").LoggerManager;
    getLifecycleManager(): import("./lifecycle/index").LifecycleManager;
    getPowerLevelsManager(): import("./power-levels/index").PowerLevelsManager;
    getMembershipManager(): import("./membership/index").MembershipManager;
    getNotificationsLegacyManager(): import("./notifications-legacy/index").NotificationsLegacyManager;
    getSettledManager(): import("./settled/index").SettledManager;
    getEditionsManager(): import("./editions/index").EditionsManager;
    getPendingActionsManager(): import("./pending-actions/index").PendingActionsManager;
    getReadReceiptsManager(): import("./read-receipts/index").ReadReceiptsManager;
    getKeyBackupManager(): import("./key-backup-management/index").KeyBackupManager;
    getBurnAfterReadManager(): import("./burn-after-read/index").BurnAfterReadManager;
    getStickyEventManager(): import("./sticky-event/index").StickyEventManager;
    getVoiceManager(): import("./voice/index").VoiceMessageManager;
    getSessionManager(): import("./session/index").SessionManager;
    getToDeviceManager(): import("./to-device/index").ToDeviceManager;
    getWaitingRoomManager(): import("./waiting-room/index").WaitingRoomManager;
}

// ============ 模块扩展声明 ============

// 扩展 MatrixClient 接口
declare module "./client" {
    interface MatrixClient extends MatrixClientExtensionMethods {}
}

// 扩展 matrix 入口
declare module "./matrix" {
    interface MatrixClient extends MatrixClientExtensionMethods {}
}

// ============ 导出类型 ============

export type { MatrixClient, Room, MatrixEvent, RoomMember };
export type MatrixClientExtensions = MatrixClient;

// ============ Manager 初始化指南 ============

/**
 * 如何添加新的 Manager：
 * 
 * 1. 在对应的 src/<module>/index.ts 中实现 Manager 类
 * 
 * 2. 实现 extendMatrixClient() 函数：
 * ```typescript
 * export function extendMatrixClient(): void {
 *     MatrixClient.prototype.getYourManager = function(): YourManager {
 *         return new YourManager(this);
 *     };
 * }
 * export default extendMatrixClient;
 * ```
 * 
 * 3. 在本文件中添加类型声明：
 * ```typescript
 * getYourManager(): import("./<module>/index").YourManager;
 * ```
 * 
 * 4. ⚠️ 重要：在实际使用前必须调用 extendMatrixClient()
 * 
 * 示例：
 * ```typescript
 * import { extendMatrixClient } from "./admin";
 * extendMatrixClient(); // 必须调用
 * 
 * const client = createClient({ ... });
 * const admin = client.getAdminManager(); // 现在可以用了
 * ```
 */