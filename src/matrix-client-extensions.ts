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
import type { IContent } from "./models/event";
import type { RoomMember } from "./models/room-member";
import type { ISendEventResponse, IRedactOpts } from "./@types/requests";
import type { IdServerUnbindResult } from "./@types/partials";
import type { IIdentityServerProvider } from "./@types/IIdentityServerProvider";
import type { ITurnServer } from "./client-api-types";
import type { IMediaConfig, IWhoamiResponse } from "./client-internal-types";
import type { CryptoBackend } from "./common-crypto/CryptoBackend";
import type { CryptoApi } from "./crypto-api";
import type { IStoredClientOpts } from "./client-config-types";
import type { SyncApiOptions } from "./sync";
import { UNSTABLE_MSC3089_LEAF } from "./@types/event";

// ============ 类型定义 ============

/** User-Interactive Authentication data — structure varies by auth stage // Dynamic: shape depends on auth type (password, token, etc.) */
export type UiaAuthData = IContent;

/** OIDC UserInfo response — standard claims from OpenID Connect */
export interface OidcUserInfo {
    /** Subject identifier */
    sub?: string;
    /** Full name */
    name?: string;
    /** Given name(s) */
    given_name?: string;
    /** Family name(s) */
    family_name?: string;
    /** Middle name(s) */
    middle_name?: string;
    /** Nickname */
    nickname?: string;
    /** Preferred username */
    preferred_username?: string;
    /** Profile page URL */
    profile?: string;
    /** Profile picture URL */
    picture?: string;
    /** Website URL */
    website?: string;
    /** Email address */
    email?: string;
    /** Email address verified */
    email_verified?: boolean;
    /** Gender */
    gender?: string;
    /** Birthdate */
    birthdate?: string;
    /** Zoneinfo (timezone) */
    zoneinfo?: string;
    /** Locale */
    locale?: string;
    /** Phone number */
    phone_number?: string;
    /** Phone number verified */
    phone_number_verified?: boolean;
    /** Address */
    address?: {
        formatted?: string;
        street_address?: string;
        locality?: string;
        region?: string;
        postal_code?: string;
        country?: string;
    };
    /** Updated at (timestamp) */
    updated_at?: number;
    /** Additional claims */
    [key: string]: unknown;
}

/** Server capabilities response */
export interface ServerCapabilities {
    /** Room versions supported by the server */
    "m.room_versions"?: { default: string; available: Record<string, string> };
    /** Change password capability */
    "m.change_password"?: { enabled: boolean };
    /** Room directory search capability */
    "m.room_directory_search"?: { enabled: boolean };
    /** 3PID changes capability */
    "m.3pid_changes"?: { enabled: boolean };
    /** Get media config capability */
    "m.get_media_config"?: { enabled: boolean };
    /** Additional capabilities */
    [key: string]: unknown;
}

/** Map of user_id → device_id → session_id indicating key sharing status // Dynamic: structure varies by crypto backend */
export type SharedWithUsersMap = IContent;

/** Widget data — structure varies by widget type // Dynamic: shape depends on widget */
export type WidgetData = IContent;

/** Map of device_id → device info for a user // Dynamic: device info structure varies */
export type UserDeviceMap = Record<string, IContent>;

/** Ephemeral event data (typing receipts, read receipts, etc.) */
export type EphemeralEventData = import("./ephemeral/index").IEphemeralEventData;

export interface MatrixClientExtensionMethods {
    // ============ Account & Profile ============
    getAccountManager(): import("./account/index").AccountManager;
    getAccountDataManager(): import("./account-data/index").AccountDataManager;
    getRoom(roomId: string): Room | null;
    getRooms(): Room[];
    getUsers(): unknown[];
    getUser(userId: string): unknown | null;
    sendEvent(roomId: string, eventType: string, content: IContent, txnId?: string): Promise<{ event_id: string }>;
    sendEvent(
        roomId: string,
        threadId: string | null,
        eventType: string,
        content: IContent,
        txnId?: string,
    ): Promise<{ event_id: string }>;
    sendStateEvent(
        roomId: string,
        eventType: string,
        content: IContent,
        stateKey?: string,
        opts?: import("./http-api/index").IRequestOpts,
    ): Promise<import("./@types/requests").ISendEventResponse>;
    sendTyping(roomId: string, isTyping: boolean, timeoutMs?: number): Promise<import("./@types/common").EmptyObject>;
    getProfileInfo(userId: string): Promise<import("./profile/index").IProfile>;
    getUserProfile(userId: string): Promise<import("./profile/index").IProfile>;
    setDisplayName(name: string): Promise<void>;
    setAvatarUrl(url: string): Promise<void>;
    getProfileManager(): import("./profile/index").ProfileManager;
    getAuthManager(): import("./auth/index").AuthManager;

    getDeviceManager(): import("./device/index").DeviceManager;
    getThreePidsManager(): import("./three-pids/index").ThreePidsManager;
    getIdentityServerManager(): import("./identity-server/index").IdentityServerManager;
    getPasswordResetManager(): import("./password-reset/index").PasswordResetManager;
    getUserManager(): import("./user/index").UserManager;

    // ============ Room Management ============
    getRoomManager(): import("./room/index").RoomManager;
    getRoomCreationManager(): import("./room-creation/index").RoomCreationManager;
    getRoomSettingsManager(): import("./room-settings/index").RoomSettingsManager;
    getRoomStateManager(): import("./room-state/index").RoomStateManager;
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
    getPinnedMessagesManager(): import("./pinned-messages/index").PinnedMessagesManager;

    // ============ Messaging & Events ============
    getSendingManager(): import("./sending/index").SendingManager;
    getEventManager(): import("./event/index").EventManager;
    getReactionsManager(): import("./reactions/index").ReactionsManager;
    getRelationsManager(): import("./relations/index").RelationsManager;
    getAggregationsManager(): import("./aggregations/index").AggregationsManager;
    getTimelineManager(): import("./timeline/index").TimelineManager;
    getThreadingManager(): import("./threading/index").ThreadingManager;

    // ============ Presence & Typing ============
    getPresenceManager(): import("./presence/index").PresenceManager;
    setPresence(presence: import("./presence/index").PresenceState, opts?: { status_msg?: string }): Promise<void>;
    setPresence(opts: { presence: import("./presence/index").PresenceState; status_msg?: string }): Promise<void>;
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

    // ============ Push Notifications ============
    // ⚠️ Push Manager - 提供完整的推送规则和 pusher 管理
    getPushManager(): import("./push/index").PushManager;
    // 以下 client-level 的 push 方法（getPushRules / setPushRule / addPushRule / deletePushRule /
    // setPusher / getPushRule / enablePushRule）**从未在 MatrixClient 上实现** —— 能力全在
    // `client.getPushManager()` 里。它们此前只以"类型声明 + 注释里的 overload 顺序要求"存在，
    // 使 `client.getPushRules()` 这类调用通过类型检查、运行时 TypeError。2026-10-07 删除。
    getPushRulesManager(): import("./push-rules/index").PushRulesManager;
    getPushNotificationsManager(): import("./push-notifications/index").PushNotificationsManager;
    getNotificationsManager(): import("./notifications/index").NotificationsManager;

    // ============ Crypto & Security ============
    getCryptoKeysManager(): import("./crypto-keys/index").CryptoKeysManager;
    getCryptoStoreManager(): import("./crypto-store/index").CryptoStoreManager;
    getCrossSigningManager(): import("./cross-signing/index").CrossSigningManager;
    getDeviceKeysManager(): import("./device-keys/index").DeviceKeysManager;

    getSecretStorageManager(): import("./secret-storage/index").SecretStorageManager;
    getSecurityManager(): import("./security/index").SecurityManager;
    getSecureBackupManager(): import("./secure-backup/index").SecureBackupManager;
    getDehydratedDeviceManager(): import("./dehydrated-device/index").DehydratedDeviceManager;
    getDelayedEventsManager(): import("./delayed-events/index").DelayedEventsManager;
    getAccountStatusManager(): import("./account-status/index").AccountStatusManager;
    requestAdd3pidEmailToken(
        email: string,
        clientSecret: string,
        sendAttempt: number,
        nextLink?: string,
    ): Promise<import("./client-api-types").IRequestTokenResponse>;
    requestAdd3pidEmailToken(
        clientSecret: string,
        email: string,
        sendAttempt: number,
        nextLink?: string,
    ): Promise<import("./client-api-types").IRequestTokenResponse>;
    requestAdd3pidMsisdnToken(
        phoneCountry: string,
        phoneNumber: string,
        clientSecret: string,
        sendAttempt: number,
        nextLink?: string,
    ): Promise<import("./client-api-types").IRequestMsisdnTokenResponse>;
    requestAdd3pidMsisdnToken(
        clientSecret: string,
        phoneCountry: string,
        phoneNumber: string,
        sendAttempt: number,
        nextLink?: string,
    ): Promise<import("./client-api-types").IRequestMsisdnTokenResponse>;

    // ============ Server & Network ============
    getCapabilitiesManager(): import("./capabilities/index").CapabilitiesManager;
    getCasManager(): import("./cas/index").CasManager;
    getDiscoveryManager(): import("./discovery/index").DiscoveryManager;
    getDirectoryManager(): import("./directory/index").DirectoryManager;
    getFederationManager(): import("./federation/index").FederationManager;
    getServerCapabilitiesManager(): import("./server-capabilities/index").ServerCapabilitiesManager;
    getTurnServerManager(): import("./turn-server/index").TurnServerManager;
    getServerTimeManager(): import("./server-time/index").ServerTimeManager;
    getIdentityManager(): import("./identity/index").IdentityManager;

    // ============ Sync & State ============
    getSyncManager(): import("./sync-management/index").SyncManager;
    getSyncAccumulatorManager(): import("./sync-accumulator/index").SyncAccumulatorManager;

    // ============ Storage & Persistence ============

    getUploadsManager(): import("./uploads/index").UploadsManager;

    // ============ Admin & Moderation ============
    // ⚠️ Admin Manager - URL 组装规则：prefix + path（相对路径）
    getAdminManager(): import("./admin/index").AdminManager;
    getAppServiceManager(): import("./app-service/index").ApplicationServiceManager;
    getAdminUserManager(): import("./admin/sub-managers/admin-user-manager").AdminUserManager;
    getAdminRoomManager(): import("./admin/sub-managers/admin-room-manager").AdminRoomManager;
    getAdminServerManager(): import("./admin/sub-managers/admin-server-manager").AdminServerManager;
    getAdminFederationManager(): import("./admin/sub-managers/admin-federation-manager").AdminFederationManager;
    getAdminMediaManager(): import("./admin/sub-managers/admin-media-manager").AdminMediaManager;
    getAdminConfigManager(): import("./admin/sub-managers/admin-config-manager").AdminConfigManager;
    getAdminExternalServiceManager(): import("./admin/sub-managers/admin-external-service-manager").AdminExternalServiceManager;
    // 新的 Admin Sub-Managers
    getAdminCleanupManager(): import("./admin/sub-managers/admin-cleanup-manager").AdminCleanupManager;
    getAdminNotificationManager(): import("./admin/sub-managers/admin-notification-manager").AdminNotificationManager;
    getAdminReportManager(): import("./admin/sub-managers/admin-report-manager").AdminReportManager;
    getAdminPolicyManager(): import("./admin/sub-managers/admin-policy-manager").AdminPolicyManager;
    // 顶级 admin 模块便捷访问（AdminManager 集成的子入口）
    getAdminBackgroundUpdates(): import("./background-update/index").BackgroundUpdateManager;
    getAdminEventReports(): import("./event-report/index").EventReportManager;
    getAdminModules(): import("./module/index").ModuleManager;
    getAdminSaml(): import("./saml/index").SamlAuthManager;
    getAdminCas(): import("./cas/index").CasManager;
    getAdminFeatureFlags(): import("./feature-flags/index").FeatureFlagManager;
    getAdminRetention(): import("./retention/index").RetentionManager;
    getAdminTelemetry(): import("./telemetry/index").TelemetryManager;
    getBackgroundUpdateManager(): import("./background-update/index").BackgroundUpdateManager;
    getWorkerAdminManager(): import("./worker-admin/index").WorkerAdminManager;
    getWorkerBodyManager(): import("./worker-body/index").WorkerBodyManager;
    getWorkerManager(): import("./client/worker/worker").WorkerManager;
    getReportingManager(): import("./reporting/index").ReportingManager;
    getInviteBlocklistManager(): import("./invite-blocklist/index").InviteBlocklistManager;

    // ============ Content & Media ============
    getMediaManager(): import("./media/index").MediaManager;

    // ============ Tags & Labels ============
    getTagsManager(): import("./tags-management/index").TagsManager;

    // ============ Thread ============
    getThreadManager(): import("./thread/index").ThreadManager;

    // ============ Widgets & Integrations ============
    getWidgetsManager(): import("./widgets/index").WidgetsManager;
    getWidgetManager(): import("./widget/index").WidgetManager;

    // ============ Other Features ============
    getThirdPartyManager(): import("./third-party/index").ThirdPartyManager;

    getGuestManager(): import("./guest/index").GuestManager;
    getCaptchaManager(): import("./captcha/index").CaptchaManager;
    getRetentionManager(): import("./retention/index").RetentionManager;
    getBeaconManager(): import("./beacon/index").BeaconManager;
    getRoomAliasManager(): import("./room-alias/index").RoomAliasManager;

    getLifecycleManager(): import("./lifecycle/index").LifecycleManager;
    getMembershipManager(): import("./membership/index").MembershipManager;
    getReadReceiptsManager(): import("./read-receipts/index").ReadReceiptsManager;
    getKeyBackupManager(): import("./key-backup/index").KeyBackupManager;
    getKeyRotationManager(): import("./key-rotation/index").KeyRotationManager;
    getBurnAfterReadManager(): import("./burn-after-read/index").BurnAfterReadManager;
    getOidcManager(): import("./oidc/manager").OidcManager;
    getTelemetryManager(
        config?: Partial<import("./telemetry/index").TelemetryConfig>,
    ): import("./telemetry/index").TelemetryManager;
    getRendezvousManager(): import("./rendezvous/RendezvousManager").RendezvousManager;
    getStateSendManager(): import("./state-send/index").StateSendManager;
    getSessionManager(): import("./session/index").SessionManager;
    getToDeviceManager(): import("./to-device/index").ToDeviceManager;
    getSamlAuthManager(): import("./saml/index").SamlAuthManager;
    getE2EEManager(): import("./e2ee/index").E2EEManager;
    getEventReportManager(): import("./event-report/index").EventReportManager;
    getExternalServiceManager(): import("./external-service/index").ExternalServiceManager;
    getFeatureFlagManager(): import("./feature-flags/index").FeatureFlagManager;
    getFilterManager(): import("./filter/index").FilterManager;
    getModerationManager(): import("./moderation/index").ModerationManager;
    getModuleManager(): import("./module/index").ModuleManager;
    getVoiceManager(): import("./voice/index").VoiceManager;
}

/**
 * MatrixClient 内部属性和方法声明
 *
 * 这些是 MatrixClient 类中已实现但未在主接口中声明的属性和方法。
 * 管理器通过 `BaseManager.internalClient`（`MatrixClient & MatrixClientInternalMethods`）
 * 类型安全地访问它们，从而消除散落的 `as any` 断言。
 *
 * ⚠️ 本接口**会直接合并进 `MatrixClient`**（见文件末尾的 `declare module "./client"`），
 * 因此这里的每一条声明都让「类型检查通过」成为**既定事实** —— 声明一个 MatrixClient
 * 并不存在的方法，症状是调用即 TypeError、编译期毫无提示。
 *
 * 2026-10-07 清掉 53 条这样的残留声明（`getRoomName` / `getStateEvents` / `createDirectRoom` /
 * `uploadFile` / `checkCrossSigningStatus` …）：MatrixClient 从未实现过它们，能力都在对应
 * Manager 上。判据与守卫见 `spec/unit/manager-accessor-wiring.spec.ts`（缺失集合必须为空）。
 */
export interface MatrixClientInternalMethods {
    // ============ Credentials & Identity ============
    readonly credentials: { userId: string | null };
    readonly deviceId: string | null;
    readonly baseUrl: string;
    readonly idBaseUrl?: string;
    readonly syncing?: boolean;
    readonly syncToken?: string | null;
    serverClockDiff: number;
    readonly rooms: Room[];
    readonly identityServer?: IIdentityServerProvider;

    getAccessToken(): string | null;
    getSessionId(): string;
    getRoomByAlias(alias: string): Room | null;
    getCrypto(): CryptoApi | undefined;
    getCryptoBackend(): CryptoBackend | undefined;
    getClientOpts(): IStoredClientOpts | undefined;
    getSyncApiOptions(): SyncApiOptions;
    isGuest(): boolean;

    // ============ Room Getters (implemented but not in interface) ============
    // 注意：`getRoomName` / `getRoomTopic` / `getRoomAvatarUrl` / `getRoomHistoryVisibility` /
    // `getRoomGuestAccess` / `getRoomJoinRule` 不在本段 —— 它们是 RoomSettingsManager 自己的
    // 方法（底层读 `Room.currentState`），MatrixClient 从未实现过，2026-10-07 从类型表删除：
    // 留着只会让 `client.getRoomName(roomId)` 类型检查通过、运行时 TypeError。
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

    // ============ Room Settings / Event Management（原先的「phantom 方法」声明）============
    // 这里曾声明 RoomSettingsManager / EventManager 借道调用的 10 个方法：
    //   setRoomAvatar / setRoomHistoryVisibility / setRoomGuestAccess / setRoomJoinRule /
    //   getRoomHistoryVisibility / getRoomGuestAccess / getRoomJoinRule（RoomSettingsManager）
    //   getEvent / getRoomEvents / fetchEvent（EventManager）
    // MatrixClient **从未实现过其中任何一个** —— 调用即 TypeError，而类型检查照样通过。
    // 两个 Manager 现已各自落地（RoomSettingsManager 直接读写 `Room.currentState`，
    // EventManager 走 `client.getRoomEventsManager()`），故 2026-10-07 从类型表删除。

    // ============ Server Time & Turn Servers ============
    getTurnServers(): ITurnServer[];
    getTurnServersExpiry(): number;
    getTurnServerURIs(): Promise<string[]>;
    getLocalTimestampForServerTime(serverTime: number): number;
    getServerTimestamp(): number;
    updateServerTimeInfo(serverTime: number, serverDate: string): void;
    getMediaConfig(useAuthenticatedMedia?: boolean): Promise<IMediaConfig>;
    supportsVoip(): boolean;
    checkTurnServersIntervalID?: ReturnType<typeof setInterval>;

    // ============ Internal Properties (property-form, accessed by managers) ============
    // These are public/protected fields on MatrixClient that managers access directly
    // (rather than via getter methods). Declared here so managers can use typed access
    // via `this.internalClient.xxx` instead of scattered `as unknown as` casts.
    turnServers: ITurnServer[];
    turnServersExpiry: number;
    cryptoBackend?: import("./common-crypto/CryptoBackend").CryptoBackend;
    clientOpts?: IStoredClientOpts;
    syncApi?: import("./sync").SyncApi | import("./sliding-sync-sdk").SlidingSyncSdk;
    toDeviceMessageQueue: import("./ToDeviceMessageQueue").ToDeviceMessageQueue;
    clientWellKnown?: import("./client-api-types").IClientWellKnown;
    buildSyncApiOptions(): import("./sync").SyncApiOptions;
    logger: import("./logger").Logger;

    // ============ Server Capabilities ============
    getServerCapabilities(): Promise<ServerCapabilities>;
    hasServerSupport(feature: string): boolean;
    getServerVersion(): Promise<string>;
    doesServerAdvertiseSynapseRustFeature(
        feature: import("./server-capabilities/index").SynapseRustFeatureName,
    ): Promise<boolean>;
    getSynapseRustFeatureSupport(): Promise<import("./server-capabilities/index").SynapseRustFeatureSupport>;
    isSlidingSyncSupported(): Promise<boolean>;
    supportsThreads(): boolean;
    supportsLocation(): boolean;

    // ============ Room Key Sharing ============
    shareRoomKey(roomId: string, users: string[]): Promise<unknown>;
    getSharedWithUsers(roomId: string): Promise<SharedWithUsersMap>;
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
    setRoomRetention(roomId: string, policy: import("./room-summary/types").RetentionPolicy): Promise<void>;
    getServerRetention(): Promise<unknown>;

    // ============ Reactions ============
    reactToMessage(roomId: string, eventId: string, key: string): Promise<string | undefined>;
    redactReaction(roomId: string, eventId: string, reason?: string): Promise<{ event_id: string }>;
    getReactionUsers(roomId: string, eventId: string): Promise<Array<{ userId: string }>>;
    hasReaction(roomId: string, eventId: string, userId: string, key: string): Promise<boolean>;

    // ============ Crypto & Cross-Signing ============
    cryptoStore: unknown;
    getCryptoAlgorithm(): unknown;
    setCryptoAlgorithm(algorithm: unknown): void;
    hasCrypto(): boolean;
    initCrypto(): Promise<void>;
    stopCrypto(): void;
    deleteCryptoStore(): Promise<void>;
    isCryptoStoreReady(): boolean;
    isSecretStorageReady(): Promise<boolean>;

    // ============ User Directory & Profile ============
    searchUserDirectory(opts: { term: string; limit?: number }): Promise<{
        results: Array<{ user_id: string; display_name?: string; avatar_url?: string }>;
        limited: boolean;
    }>;
    getSecretStorageKey(keyId: string): Promise<[string, string] | null>;
    storeSecret(name: string, secret: string, keys: string[]): Promise<void>;
    getSecret(name: string): Promise<string | null>;
    hasSecret(name: string): Promise<boolean>;
    getSecretStorageKeys(): Promise<Record<string, string>>;

    // ============ Widgets ============
    getUserWidgets(): Promise<WidgetData>;
    getRoomWidgets(roomId: string): Promise<WidgetData>;
    setUserWidgets(widgets: WidgetData): Promise<void>;
    setRoomWidgets(roomId: string, widgets: WidgetData): Promise<void>;
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
    // 本段曾重复声明 `getIdentityServerUrl()`（与上面「Credentials & Identity」段同名同签名）：
    // MatrixClient 上并不存在，真实能力在
    // `client.getIdentityServerManager().getIdentityServerUrl(stripProto?)`。2026-10-07 删除。

    // ============ Notification Callback ============
    notificationCallback: unknown;

    // ============ Logger (logger/index.ts) ============
    // Note: logger is private on MatrixClient, access via (client as any).logger
    // logger?: import("./logger/index").ILogger;

    // ============ Crypto internals (used by device-keys, crypto-api, etc.) ============
    deviceList?: unknown;
    getUserDevices(userId: string): Promise<UserDeviceMap>;

    // ============ Room Events (room-events/index.ts) ============
    // 本段曾声明 getRoomEvents / getStateEventsForRoom / getTimelineEvents / getEphemeralEvents /
    // hasTimelineEvent / findEventById —— 它们**全部**是 RoomEventsManager 自己的方法，
    // MatrixClient 从未实现（`client.getRoomEvents(roomId)` 调用即 TypeError）。2026-10-07 删除。

    // ============ Room State Management internals ============
    // 本段曾声明 getRoomStateEvents / getStateEvents / getRoomAccountData / getRoomAccountDataSync。
    // 前两者现由 `client.getRoomStateManager().getStateEvents(roomId, eventType?, stateKey?)` 提供；
    // `getRoomAccountData(roomId, eventType)` 由 `client.getRoomSummaryManager().getRoomAccountData()`
    // 提供 —— 语义已变（走服务端 `GET /rooms/$roomId/account_data/$type` 返回 RoomAccountDataResult，
    // 而非旧的同步读本地 `IContent | null`）；`getRoomAccountDataSync` 无等价能力。2026-10-07 删除。

    // ============ Sync Accumulator (sync-accumulator/index.ts) ============
    syncAccumulator?: import("./sync-accumulator").SyncAccumulator;

    // ============ Stores (stores/index.ts) ============
    store?: import("./store/index").IStore;

    // ============ Push Rules ============
    // `pushRules` 是 MatrixClient 上的**真实属性**（src/client.ts:733）。
    // 注意 `getPushRule` / `enablePushRule` 等不在 MatrixClient 上（能力在 `client.getPushManager()`），
    // 此前这里声明过它们，2026-10-07 删除。
    pushRules?: import("./@types/PushRules").IPushRules;

    // ============ Push Notifications (push-notifications/index.ts) ============
    // 该模块的便捷方法**不在** MatrixClient 上，而在 `client.getPushNotificationsManager()` 的成员上。
    // 此前这里声明过 getPushers / setPushers / removePusher / getPusherData，但 MatrixClient
    // **从未实现**它们（模块自己的实现也只是转发给这些不存在的方法）⇒ 调用即 TypeError。
    // 2026-10-07：模块已改为委托 `PushManager`，这里的假声明一并删除。

    // ============ Lifecycle (lifecycle/index.ts) ============
    // `clientRunning` 是**真实属性**（src/client.ts:668）。其余四个
    // （exit / terminate / reset / prepare）MatrixClient 从未实现过，2026-10-07 删除。
    clientRunning?: boolean;

    // ============ Invites (invites/index.ts) ============
    // 便捷方法在 `client.getInvitesManager()` 上，**不在** MatrixClient 上。此前这里声明过
    // inviteUserToRoom / getInviteEvents / hasInvite / acceptInvite / declineInvite，但 MatrixClient
    // 从未实现它们 ⇒ 调用即 TypeError。
    // 注意 `inviteByThreePid`：它在 MatrixClient 上**有**实现，但签名是
    // `(roomId, medium, address)`（src/client.ts:2908），而 InvitesManager 曾用 `as unknown as`
    // 双重断言按 `(medium, address, roomId)` 反向传参 —— 2026-10-07 已改为按真实签名调用。

    // ============ Capabilities (capabilities/index.ts) ============
    // Note: serverCapabilitiesService is private on MatrixClient
    // serverCapabilitiesService?: {
    //     getCachedCapabilities(): import("./capabilities/index").IServerCapabilities | undefined;
    //     fetchCapabilities(): Promise<import("./capabilities/index").IServerCapabilities>;
    // };

    // ============ Room Creation (room-creation/index.ts) ============
    // 本段曾声明 createDirectRoom / findOrCreateDirectRoom / getCreateRoomOptions /
    // setCreateRoomOptions —— 四者都是 RoomCreationManager 自己的方法，MatrixClient 从未实现。
    // 2026-10-07 删除。

    // ============ Device Keys (device-keys/index.ts) ============
    // 本段曾声明 getDeviceKeys / uploadDeviceKeys / hasDevice —— 都是 DeviceKeysManager 自己的方法
    // （`src/device-keys/index.ts` 的实现注释里早就写着「不要写成 this.client.getDeviceKeys(...)」）。
    // 2026-10-07 删除。

    // ============ Uploads (uploads/index.ts) ============
    // 本段曾声明 uploadFile / getUploadProgress / abortAllUploads —— 三者都是 UploadsManager
    // 自己的方法，MatrixClient 从未实现。2026-10-07 删除。

    // ============ State Send / Sync Management / Timeline / Threading internals ============
    // Note: clientOpts, buildSyncApiOptions, syncApi are protected on MatrixClient
    // clientOpts: unknown;
    // buildSyncApiOptions(): unknown;
    // syncApi?: { getSyncState(): unknown; getSyncStateData(): unknown };
    stopPeeking(): void;
    timelineSupport?: unknown;
    // Note: getThreadTimeline, getEventContext, getEventMapper have complex signatures
    // that differ from MatrixClient's actual implementation. Use local ClientInternals type instead.
    // getThreadTimeline(timelineSet: unknown, eventId: string): Promise<unknown>;
    // getEventContext(roomId: string, eventId: string, opts?: unknown): Promise<unknown>;
    // getEventMapper(): (event: unknown) => unknown;
    // getStateEvent(roomId: string, eventType: string, stateKey: string): Promise<import("./models/event").IContent>;
    usingExternalCrypto: boolean;
    enableEncryptedStateEvents?: boolean;

    // ============ Discovery (discovery/index.ts) ============
    // Note: clientWellKnown is protected on MatrixClient
    // clientWellKnown?: Record<string, unknown>;

    // ============ Telemetry (telemetry/index.ts) ============
    version?: string;
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

// 扩展媒体类型（MSC3089 文件树支持）
declare module "./@types/media" {
    interface FileContent {
        [UNSTABLE_MSC3089_LEAF.name]?: EmptyObject;
    }
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
