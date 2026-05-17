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
import type { ISendEventResponse, IRedactOpts } from "./@types/requests";
import type { RoomAccountDataEvents } from "./@types/event";
import type { ITurnServer } from "./client";
import type { IIdentityServerProvider } from "./@types/IIdentityServerProvider";
import type { IdServerUnbindResult } from "./@types/partials";
import type { IMediaConfig, IWhoamiResponse } from "./client-internal-types";
import type { CryptoBackend } from "./common-crypto/CryptoBackend";
import type { CryptoApi } from "./crypto-api";
import type { IStoredClientOpts } from "./client-config-types";
import type { SyncApiOptions } from "./sync";

// ============ 类型定义 ============

export interface MatrixClientExtensionMethods {
    // ============ Account & Profile ============
    getAccountManager(): import("./account/index").AccountManager;
    getAccountDataManager(): import("./account-data/index").AccountDataManager;
    getProfileManager(): import("./profile/index").ProfileManager;
    getAuthManager(): import("./auth/index").AuthManager;
    getCredentialsManager(): import("./credentials/index").CredentialsManager;
    getDeviceManager(): import("./device/index").DeviceManager;
    getThreePidsManager(): import("./threepids/index").ThreePidsManager;
    getIdentityServerManager(): import("./identity-server/index").IdentityServerManager;
    getPasswordResetManager(): import("./password-reset/index").PasswordResetManager;
    getGlobalLogoutManager(): import("./auth/global-logout").GlobalLogoutManager;
    getUserManager(): import("./user/index").UserManager;

    // ============ Room Management ============
    getRoomManager(): import("./room/index").RoomManager;
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
    getMessageManager(): import("./message/index").MessageManager;
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
    getCryptoKeysManager(): import("./crypto-keys/index").CryptoKeysManager;
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
    getSecurityManager(): import("./security/index").SecurityManager;
    getSecureBackupManager(): import("./secure-backup/index").SecureBackupManager;
    getDeviceTrustManager(): import("./device-trust/index").DeviceTrustManager;

    // ============ Sessions & Tokens ============
    getSessionsManager(): import("./sessions/index").SessionsManager;
    getTokenManager(): import("./token-management/index").TokenManager;
    getOtrManager(): import("./otr/index").OtrManager;

    // ============ Server & Network ============
    getCapabilitiesManager(): import("./capabilities/index").CapabilitiesManager;
    getDiscoveryManager(): import("./discovery/index").DiscoveryManager;
    getDirectoryManager(): import("./directory/index").DirectoryManager;
    getFederationManager(): import("./federation/index").FederationManager;
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
    getModuleManager(): import("./module/index").ModuleManager;
    getBackgroundUpdateManager(): import("./background-update/index").BackgroundUpdateManager;
    getWorkerAdminManager(): import("./worker-admin/index").WorkerAdminManager;
    getReportingManager(): import("./reporting/index").ReportingManager;
    getInviteBlocklistManager(): import("./invite-blocklist/index").InviteBlocklistManager;

    // ============ Content & Media ============
    getMediaManager(): import("./media/index").MediaManager;
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
    getGuestManager(): import("./guest/index").GuestManager;
    getCaptchaManager(): import("./captcha/index").CaptchaManager;
    getRetentionManager(): import("./retention/index").RetentionManager;
    getBeaconManager(): import("./beacon/index").BeaconManager;
    getLoggerManager(): import("./logger/index").LoggerManager;
    getLifecycleManager(): import("./lifecycle/index").LifecycleManager;
    getPowerLevelsManager(): import("./power-levels/index").PowerLevelsManager;
    getMembershipManager(): import("./membership/index").MembershipManager;
    getSettledManager(): import("./settled/index").SettledManager;
    getEditionsManager(): import("./editions/index").EditionsManager;
    getPendingActionsManager(): import("./pending-actions/index").PendingActionsManager;
    getReadReceiptsManager(): import("./read-receipts/index").ReadReceiptsManager;
    getKeyBackupManager(): import("./key-backup/index").KeyBackupManager;
    getKeyRotationManager(): import("./key-rotation/index").KeyRotationManager;
    getBurnAfterReadManager(): import("./burn-after-read/index").BurnAfterReadManager;
    getRenderingManager(): import("./rendering/index").RenderingManager;
    getStickyEventManager(): import("./sticky-event/index").StickyEventManager;
    getQrLoginManager(): import("./qr-login/index").QrLoginManager;
    getOidcManager(): import("./oidc/manager").OidcManager;
    getTelemetryManager(
        config?: Partial<import("./telemetry/index").TelemetryConfig>,
    ): import("./telemetry/index").TelemetryManager;
    getRendezvousManager(): import("./rendezvous/RendezvousManager").RendezvousManager;
    getStateSendManager(): import("./state-send/index").StateSendManager;
    getUserReportManager(): import("./user-report/index").UserReportManager;
    getSessionManager(): import("./session/index").SessionManager;
    getToDeviceManager(): import("./to-device/index").ToDeviceManager;
    getEventReportManager(): import("./event-report/index").EventReportManager;
    getFeatureFlagManager(): import("./feature-flags/index").FeatureFlagManager;
    getModerationManager(): import("./moderation/index").ModerationManager;
    getVerificationManager(): import("./verification/index").VerificationManager;
    getE2EEManager(): import("./e2ee/index").E2EEManager;
    getWorkerBodyManager(): import("./worker-body/index").WorkerBodyManager;
}

/**
 * MatrixClient 内部属性和方法声明
 *
 * 这些是 MatrixClient 类中已实现但未在主接口中声明的属性和方法。
 * 管理器通过 (this.client as any) 访问这些成员，
 * 通过在扩展接口中声明它们，可以消除大部分 as any 用法。
 */
export interface MatrixClientInternalMethods {
    // ============ Credentials & Identity ============
    readonly credentials: { userId: string | null };
    readonly deviceId: string | null;
    readonly baseUrl: string;
    readonly idBaseUrl?: string;
    readonly syncing?: boolean;
    readonly syncToken?: string | null;
    readonly serverClockDiff?: number;
    readonly rooms: Room[];
    readonly identityServer?: IIdentityServerProvider;

    getAccessToken(): string | null;
    getIdentityServerUrl(stripProto?: boolean): string | undefined;
    getSessionId(): string;
    getRoomByAlias(alias: string): Room | null;
    getCrypto(): CryptoApi | undefined;
    getCryptoBackend(): CryptoBackend | undefined;
    getClientOpts(): IStoredClientOpts | undefined;
    getSyncApiOptions(): SyncApiOptions;
    isGuest(): boolean;

    // ============ Room Getters (implemented but not in interface) ============
    getRoomName(roomId: string): string;
    getRoomTopic(roomId: string): string;
    getRoomAvatarUrl(roomId: string): string;
    getRoomHistoryVisibility(roomId: string): string;
    getRoomGuestAccess(roomId: string): string;
    getRoomJoinRule(roomId: string): string;
    getNotificationCount(roomId: string): number;
    getHighlightCount(roomId: string): number;
    hasUnreadNotifications(roomId: string): boolean;
    hasUnreadHighlights(roomId: string): boolean;
    getTotalNotificationCount(): number;
    getTotalHighlightCount(): number;
    getRoomWithHighestUnread(): Room | null;
    getRoomsWithUnreadNotifications(): Room[];
    sortRoomsByLastMessage(): void;

    // ============ Room Setters (implemented but not in interface) ============
    setRoomName(roomId: string, name: string): Promise<ISendEventResponse>;
    setRoomTopic(roomId: string, topic?: string, htmlTopic?: string): Promise<ISendEventResponse>;
    setRoomAccountData<K extends keyof RoomAccountDataEvents>(
        roomId: string,
        eventType: K,
        content: RoomAccountDataEvents[K] | Record<string, never>,
    ): Promise<EmptyObject>;

    // ============ Message Sending (implemented but not in interface) ============
    sendTextMessage(roomId: string, body: string, txnId?: string): Promise<ISendEventResponse>;
    sendTextMessage(roomId: string, threadId: string | null, body: string, txnId?: string): Promise<ISendEventResponse>;
    sendNotice(roomId: string, body: string, txnId?: string): Promise<ISendEventResponse>;
    sendNotice(roomId: string, threadId: string | null, body: string, txnId?: string): Promise<ISendEventResponse>;
    sendEmoteMessage(roomId: string, body: string, txnId?: string): Promise<ISendEventResponse>;
    sendEmoteMessage(
        roomId: string,
        threadId: string | null,
        body: string,
        txnId?: string,
    ): Promise<ISendEventResponse>;
    sendHtmlMessage(roomId: string, body: string, htmlBody: string): Promise<ISendEventResponse>;
    sendHtmlMessage(
        roomId: string,
        threadId: string | null,
        body: string,
        htmlBody: string,
    ): Promise<ISendEventResponse>;
    sendHtmlNotice(roomId: string, body: string, htmlBody: string): Promise<ISendEventResponse>;
    sendHtmlNotice(
        roomId: string,
        threadId: string | null,
        body: string,
        htmlBody: string,
    ): Promise<ISendEventResponse>;
    sendHtmlEmote(roomId: string, body: string, htmlBody: string): Promise<ISendEventResponse>;
    sendHtmlEmote(roomId: string, threadId: string | null, body: string, htmlBody: string): Promise<ISendEventResponse>;
    sendImageMessage(roomId: string, url: string, info?: unknown, text?: string): Promise<ISendEventResponse>;
    sendImageMessage(
        roomId: string,
        threadId: string | null,
        url: string,
        info?: unknown,
        text?: string,
    ): Promise<ISendEventResponse>;

    // ============ Event Management (implemented but not in interface) ============
    resendEvent(event: MatrixEvent, room: Room): Promise<ISendEventResponse>;
    cancelPendingEvent(event: MatrixEvent): void;
    redactEvent(roomId: string, eventId: string, txnId?: string, opts?: IRedactOpts): Promise<ISendEventResponse>;
    redactEvent(
        roomId: string,
        threadId: string | null,
        eventId: string,
        txnId?: string,
        opts?: IRedactOpts,
    ): Promise<ISendEventResponse>;

    // ============ Room Settings (phantom methods used by RoomSettingsManager) ============
    setRoomAvatar(roomId: string, avatarUrl: string): Promise<void>;
    setRoomHistoryVisibility(roomId: string, visibility: string): Promise<void>;
    setRoomGuestAccess(roomId: string, allow: boolean): Promise<void>;
    setRoomJoinRule(roomId: string, joinRule: string): Promise<void>;
    getRoomHistoryVisibility(roomId: string): string;
    getRoomGuestAccess(roomId: string): string;
    getRoomJoinRule(roomId: string): string;

    // ============ Event Management (phantom methods used by EventManager) ============
    getEvent(roomId: string, eventId: string): Promise<MatrixEvent>;
    getRoomEvents(roomId: string, start: string, limit: number): Promise<MatrixEvent[]>;
    getStateEvents(roomId: string, eventType: string, stateKey?: string): Promise<MatrixEvent[]>;
    fetchEvent(roomId: string, eventId: string): Promise<MatrixEvent>;

    // ============ Server Time & Turn Servers ============
    getTurnServers(): ITurnServer[];
    getTurnServersExpiry(): number;
    getTurnServerURIs(): Promise<string[]>;
    getLocalTimestampForServerTime(serverTime: number): number;
    getServerTimestamp(): number;
    updateServerTimeInfo(serverTime: number, serverDate: string): void;
    getMediaConfig(useAuthenticatedMedia?: boolean): Promise<IMediaConfig>;

    // ============ Server Capabilities ============
    getServerCapabilities(): Promise<Record<string, unknown>>;
    hasServerSupport(feature: string): boolean;
    getServerVersion(): Promise<string>;
    supportsThreads(): boolean;
    supportsLocation(): boolean;

    // ============ Room Key Sharing ============
    shareRoomKey(roomId: string, users: string[]): Promise<unknown>;
    getSharedWithUsers(roomId: string): Promise<Record<string, unknown>>;
    hasSharedKeyWithUser(userId: string): Promise<boolean>;
    exportRoomKeys(): Promise<unknown>;
    importRoomKeys(keys: unknown[], options?: unknown): Promise<unknown>;

    // ============ Key Claiming ============
    claimKeys(users: Record<string, string[]>): Promise<unknown>;
    claimedKeys: Record<string, Record<string, string>>;

    // ============ Pending Events ============
    getPendingEvents(roomId: string): MatrixEvent[];
    hasPendingEvents(roomId: string): boolean;
    cancelUpload(upload: Promise<unknown>): boolean;
    getUnsentEvents(roomId: string): MatrixEvent[];

    // ============ Room Retention ============
    getRoomRetention(roomId: string): Promise<unknown>;
    setRoomRetention(roomId: string, policy: Record<string, unknown>): Promise<void>;
    getServerRetention(): Promise<unknown>;

    // ============ Encryption Rotation ============
    rotateEncryptionKeys(): Promise<void>;
    isRotationNeeded(): boolean;
    getRotationPeriod(): number;
    setRotationPeriod(period: number): void;
    getLastRotationTime(): number;

    // ============ Reactions ============
    reactToMessage(roomId: string, eventId: string, key: string): Promise<void>;
    redactReaction(roomId: string, eventId: string): Promise<void>;
    getReactionUsers(roomId: string, eventId: string): Promise<Array<{ userId: string }>>;
    hasReaction(roomId: string, eventId: string, userId: string, key: string): Promise<boolean>;

    // ============ Crypto & Cross-Signing ============
    cryptoStore: unknown;
    getCryptoAlgorithm(): unknown;
    setCryptoAlgorithm(algorithm: unknown): void;
    hasCrypto(): boolean;
    initCrypto(): Promise<void>;
    stopCrypto(): void;
    checkCrossSigningStatus(): unknown;
    getCrossSigningKeys(): Promise<unknown>;
    isCrossSigningReady(): boolean;
    getUserCrossSigningKeys(userId: string): Promise<unknown>;
    checkAndTrustCrossSigning(): Promise<void>;
    isCryptoBackupEnabled(): boolean;
    enableCryptoBackup(passphrase: string): Promise<void>;
    disableCryptoBackup(): Promise<void>;
    getCryptoBackup(): Promise<unknown>;
    restoreCryptoBackup(backup: string | object, passphrase?: string): Promise<void>;
    deleteCryptoStore(): Promise<void>;
    isCryptoStoreReady(): boolean;
    isSecretStorageReady(): boolean;

    // ============ User Directory & Profile ============
    searchUserDirectory(opts: { term: string; limit?: number }): Promise<{
        results: Array<{ user_id: string; display_name?: string; avatar_url?: string }>;
        limited: boolean;
    }>;
    getProfile(userId: string): Promise<{ displayname?: string; avatar_url?: string }>;
    getSecretStorageKey(keyId: string): Promise<[string, string] | null>;
    storeSecret(name: string, secret: string, keys: string[]): Promise<void>;
    getSecret(name: string): Promise<string | null>;
    hasSecret(name: string): boolean;
    getSecretStorageKeys(): Promise<Record<string, string>>;

    // ============ Widgets ============
    getUserWidgets(): Promise<Record<string, unknown>>;
    getRoomWidgets(roomId: string): Promise<Record<string, unknown>>;
    setUserWidgets(widgets: Record<string, unknown>): Promise<void>;
    setRoomWidgets(roomId: string, widgets: Record<string, unknown>): Promise<void>;
    getAllWidgetEvents(roomId: string): Promise<MatrixEvent[]>;

    // ============ Beacons ============

    // ============ Session ============
    logout(stopClient?: boolean): Promise<EmptyObject>;
    deactivateAccount(auth?: unknown, erase?: boolean): Promise<{ id_server_unbind_result: IdServerUnbindResult }>;
    whoami(): Promise<IWhoamiResponse>;
    // Note: sessionId is protected on MatrixClient, not public

    // ============ Settled / Sync State ============
    waitForPendingRequests(timeoutMs: number): Promise<void>;
    isInitialSyncComplete(): boolean;
    hasStartedSync(): boolean;
    isSyncing(): boolean;
    waitForSync(): Promise<void>;

    // ============ Crypto Store ============
    deleteCryptoStore(): Promise<void>;
    isCryptoStoreReady(): boolean;

    // ============ Media Storage ============
    getUserStorageUsage(userId: string): Promise<{ size: number; ntFiles: number } | null>;

    // ============ Credentials (for credentials/index.ts) ============
    getIdentityServerUrl(stripProto?: boolean): string | undefined;

    // ============ Notification Callback ============
    notificationCallback: unknown;
}

declare global {
    interface EmptyObject {
        // Marker interface for empty object returns
    }
}

// ============ 模块扩展声明 ============

// 扩展 MatrixClient 接口
declare module "./client" {
    interface MatrixClient extends MatrixClientExtensionMethods, MatrixClientInternalMethods {}
}

// 扩展 matrix 入口
declare module "./matrix" {
    interface MatrixClient extends MatrixClientExtensionMethods, MatrixClientInternalMethods {}
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
 *     MatrixClient.prototype.exampleManagerGetter = function(): ExampleManager {
 *         return new ExampleManager(this);
 *     };
 * }
 * export default extendMatrixClient;
 * ```
 *
 * 3. 在本文件中添加类型声明：
 * ```typescript
 * exampleManagerGetter(): import("./<module>/index").ExampleManager;
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
