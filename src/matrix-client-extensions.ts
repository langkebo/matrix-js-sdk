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
    getDisplayName(userId: string): Promise<string | null>;
    setDisplayName(name: string): Promise<void>;
    setAvatarUrl(url: string): Promise<void>;
    getProfileManager(): import("./profile/index").ProfileManager;
    mxcUrlToHttp(
        mxcUrl: string,
        width?: number,
        height?: number,
        method?: string,
        allowDirectLinks?: boolean,
        allowRedirects?: boolean,
        ignoreCertificateErrors?: boolean,
    ): string | null;
    getAuthManager(): import("./auth/index").AuthManager;

    getDeviceManager(): import("./device/index").DeviceManager;
    getDevices(): Promise<import("./device/index").IDevice[]>;
    getDevice(deviceId: string): Promise<import("./device/index").IDevice>;
    setDeviceName(deviceId: string, name: string): Promise<void>;
    deleteDevice(deviceId: string, auth?: UiaAuthData): Promise<void>;
    deleteMultipleDevices(deviceIds: string[], auth?: UiaAuthData): Promise<void>;
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
    getRoomEvent(roomId: string, eventId: string): Promise<import("./room/index").IRoomEvent>;
    getRoomStateEvent(roomId: string, eventType: string, stateKey?: string): Promise<import("./models/event").IContent>;
    redact(roomId: string, eventId: string, txnId?: string, opts?: IRedactOpts): Promise<ISendEventResponse>;

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
    getPushRules(): Promise<import("./push/index").IPushRules>;
    // Overloads for PushRulesManager (2-arg/3-arg signatures) - must come before PushManager signatures
    setPushRule(kind: string, ruleId: string, body: import("./push-rules/index").ISetPushRuleBody): Promise<void>;
    // PushManager signature (4-6 args)
    setPushRule(
        scope: string,
        kind: import("./@types/PushRules").PushRuleKind,
        ruleId: string,
        actions: import("./@types/PushRules").PushRuleAction[],
        conditions?: import("./@types/PushRules").PushRuleCondition[],
        pattern?: string,
    ): Promise<void>;
    addPushRule(
        scope: string,
        kind: import("./@types/PushRules").PushRuleKind,
        ruleId: string,
        body: import("./push/index").IUpdatePushRuleRequest,
    ): Promise<void>;
    // Overload for PushRulesManager (2-arg signature) - must come before PushManager signature
    deletePushRule(kind: string, ruleId: string): Promise<void>;
    // PushManager signature (3 args)
    deletePushRule(scope: string, kind: import("./@types/PushRules").PushRuleKind, ruleId: string): Promise<void>;
    setPusher(pusher: import("./push/index").IPusherRequest): Promise<void>;
    getPushRulesManager(): import("./push-rules/index").PushRulesManager;
    getPushNotificationsManager(): import("./push-notifications/index").PushNotificationsManager;
    getNotificationsManager(): import("./notifications/index").NotificationsManager;

    // ============ Crypto & Security ============
    getCryptoKeysManager(): import("./crypto-keys/index").CryptoKeysManager;
    getCryptoStoreManager(): import("./crypto-store/index").CryptoStoreManager;
    getCrossSigningManager(): import("./cross-signing/index").CrossSigningManager;
    getDeviceKeysManager(): import("./device-keys/index").DeviceKeysManager;
    getKeyVerificationManager(): import("./key-verification/index").KeyVerificationManager;

    getSecretStorageManager(): import("./secret-storage/index").SecretStorageManager;
    getSecurityManager(): import("./security/index").SecurityManager;
    getSecureBackupManager(): import("./secure-backup/index").SecureBackupManager;
    getDeviceTrustManager(): import("./device-trust/index").DeviceTrustManager;
    getDehydratedDeviceManager(): import("./dehydrated-device/index").DehydratedDeviceManager;
    getDelayedEventsManager(): import("./delayed-events/index").DelayedEventsManager;
    getVerificationRequestsToDevice(userId: string): import("./crypto-api/verification").VerificationRequest[];
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

    // ============ Sessions & Tokens ============
    getSessionsManager(): import("./sessions/index").SessionsManager;

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
    getAdminUserManager(): import("./admin/sub-managers/admin-user-manager").AdminUserManager;
    getAdminRoomManager(): import("./admin/sub-managers/admin-room-manager").AdminRoomManager;
    getAdminServerManager(): import("./admin/sub-managers/admin-server-manager").AdminServerManager;
    getAdminFederationManager(): import("./admin/sub-managers/admin-federation-manager").AdminFederationManager;
    getAdminMediaManager(): import("./admin/sub-managers/admin-media-manager").AdminMediaManager;
    getAdminConfigManager(): import("./admin/sub-managers/admin-config-manager").AdminConfigManager;
    getBackgroundUpdateManager(): import("./background-update/index").BackgroundUpdateManager;
    getWorkerAdminManager(): import("./worker-admin/index").WorkerAdminManager;
    getWorkerBodyManager(): import("./worker-body/index").WorkerBodyManager;
    getReportingManager(): import("./reporting/index").ReportingManager;
    getInviteBlocklistManager(): import("./invite-blocklist/index").InviteBlocklistManager;

    // ============ Content & Media ============
    getMediaManager(): import("./media/index").MediaManager;
    getMediaApiUrl(path: string): string;
    sendEmote(roomId: string, text: string, txnId?: string): Promise<ISendEventResponse>;

    // ============ Tags & Labels ============
    getTagsManager(): import("./tags-management/index").TagsManager;
    removeRoomTag(roomId: string, tag: string): Promise<import("./@types/common").EmptyObject>;

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
    setUserPowerLevel(roomId: string, userId: string, powerLevel: number): Promise<void>;
    getMembershipManager(): import("./membership/index").MembershipManager;
    getReadReceiptsManager(): import("./read-receipts/index").ReadReceiptsManager;
    getKeyBackupManager(): import("./key-backup/index").KeyBackupManager;
    getKeyRotationManager(): import("./key-rotation/index").KeyRotationManager;
    getBurnAfterReadManager(): import("./burn-after-read/index").BurnAfterReadManager;
    getOidcManager(): import("./oidc/manager").OidcManager;
    oidcUserInfo(): Promise<OidcUserInfo>;
    getTelemetryManager(
        config?: Partial<import("./telemetry/index").TelemetryConfig>,
    ): import("./telemetry/index").TelemetryManager;
    getRendezvousManager(): import("./rendezvous/RendezvousManager").RendezvousManager;
    getStateSendManager(): import("./state-send/index").StateSendManager;
    getSessionManager(): import("./session/index").SessionManager;
    getToDeviceManager(): import("./to-device/index").ToDeviceManager;
    getAIConnectionManager(): import("./ai-connection/index").AIConnectionManager;
    getOpenClawManager(): import("./open-claw/index").OpenClawManager;
    getSamlAuthManager(): import("./saml/index").SamlAuthManager;
    getE2EEManager(): import("./e2ee/index").E2EEManager;
    getEventReportManager(): import("./event-report/index").EventReportManager;
    getExternalServiceManager(): import("./external-service/index").ExternalServiceManager;
    getFeatureFlagManager(): import("./feature-flags/index").FeatureFlagManager;
    getFilterManager(): import("./filter/index").FilterManager;
    getModerationManager(): import("./moderation/index").ModerationManager;
    getModuleManager(): import("./module/index").ModuleManager;
    getVerificationManager(): import("./verification/index").VerificationManager;
    getVoiceManager(): import("./voice/index").VoiceManager;
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
    serverClockDiff: number;
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
    fetchEvent(roomId: string, eventId: string): Promise<MatrixEvent>;

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
    isCrossSigningReady(): Promise<boolean>;
    getUserCrossSigningKeys(userId: string): Promise<unknown>;
    checkAndTrustCrossSigning(): Promise<void>;
    isCryptoBackupEnabled(): Promise<boolean>;
    enableCryptoBackup(passphrase: string): Promise<void>;
    disableCryptoBackup(): Promise<void>;
    getCryptoBackup(): Promise<unknown>;
    restoreCryptoBackup(backup: string | object, passphrase?: string): Promise<void>;
    deleteCryptoStore(): Promise<void>;
    isCryptoStoreReady(): boolean;
    isSecretStorageReady(): Promise<boolean>;

    // ============ User Directory & Profile ============
    searchUserDirectory(opts: { term: string; limit?: number }): Promise<{
        results: Array<{ user_id: string; display_name?: string; avatar_url?: string }>;
        limited: boolean;
    }>;
    getProfile(userId: string): Promise<{ displayname?: string; avatar_url?: string }>;
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
    getIdentityServerUrl(stripProto?: boolean): string | undefined;

    // ============ Notification Callback ============
    notificationCallback: unknown;

    // ============ Logger (logger/index.ts) ============
    // Note: logger is private on MatrixClient, access via (client as any).logger
    // logger?: import("./logger/index").ILogger;

    // ============ Crypto internals (used by device-keys, crypto-api, etc.) ============
    isCryptoReady(): boolean;
    deviceList?: unknown;
    getUserDevices(userId: string): Promise<UserDeviceMap>;
    setDeviceVerified(userId: string, deviceId: string): Promise<void>;
    markDeviceAsVerified(userId: string, deviceId: string): Promise<void>;
    markAllDevicesAsVerified(userId: string): Promise<void>;

    // ============ Sessions (sessions/index.ts) ============
    getActiveSessions(): import("./sessions/index").ISessionInfo[];
    getSessionInfo(): import("./sessions/index").ISessionInfo | null;
    refreshSession(): Promise<import("./sessions/index").ISessionInfo>;
    revokeSession(deviceId: string): Promise<void>;
    getLastActiveSession(): import("./sessions/index").ISessionDetail | null;
    setLastActiveSession(sessionId: string): void;

    // ============ Room Events (room-events/index.ts) ============
    getRoomEvents(roomId: string, limit?: number): Promise<MatrixEvent[]>;
    getStateEventsForRoom(roomId: string): Promise<MatrixEvent[]>;
    getTimelineEvents(roomId: string): MatrixEvent[];
    getEphemeralEvents(roomId: string): EphemeralEventData[];
    hasTimelineEvent(roomId: string, eventId: string): boolean;
    findEventById(roomId: string, eventId: string): MatrixEvent | null;

    // ============ Room State Management internals ============
    getRoomStateEvents(roomId: string, eventType: string, stateKey?: string): Promise<MatrixEvent[]>;
    getStateEvents(eventType: string, stateKey: string): MatrixEvent[];
    getRoomAccountData(roomId: string, eventType: string): IContent | null;
    getRoomAccountDataSync(roomId: string, eventType: string): import("./models/event").IContent | null;

    // ============ Sync Accumulator (sync-accumulator/index.ts) ============
    syncAccumulator?: import("./sync-accumulator").SyncAccumulator;
    accumulateSyncData(data: import("./sync-accumulator").ISyncResponse): Promise<void>;
    getAccumulatedData(): import("./sync-accumulator/index").ISyncAccumulatedData | null;
    resetAccumulator(): void;

    // ============ Stores (stores/index.ts) ============
    store?: import("./store/index").IStore;
    storeValue(key: string, value: unknown): Promise<void>;
    getStoredValue(key: string): Promise<unknown>;

    // ============ Push Rules (push-rules/index.ts) ============
    getPushRule(kind: string, ruleId: string): Promise<import("./push-rules/index").IPushRule | null>;
    enablePushRule(kind: string, ruleId: string, enabled: boolean): Promise<void>;
    pushRules?: import("./@types/PushRules").IPushRules;

    // ============ Push Notifications (push-notifications/index.ts) ============
    getPushers(): Promise<import("./push-notifications/index").IPushersResponse>;
    setPushers(pushers: import("./push-notifications/index").IPusher[]): Promise<void>;
    removePusher(pusherData: import("./push-notifications/index").IPusher): Promise<void>;
    getPusherData(roomId: string, userId: string): import("./push-notifications/index").IPusherData | null;

    // ============ Lifecycle (lifecycle/index.ts) ============
    clientRunning?: boolean;
    exit(code?: number): Promise<void>;
    terminate(): void;
    reset(): Promise<void>;
    prepare(clientOptions?: import("./lifecycle/index").IClientOptions): Promise<void>;

    // ============ Invites (invites/index.ts) ============
    // Note: inviteByThreePid has incompatible signature with MatrixClient's actual method
    // Real: inviteByThreePid(roomId, medium, address): Promise<EmptyObject>
    // Manager expects: inviteByThreePid(medium, address, roomId): Promise<IInviteResponse>
    // Access via type assertion in InvitesManager
    // inviteByThreePid(medium: string, address: string, roomId: string): Promise<import("./invites/index").IInviteResponse>;
    inviteUserToRoom(userId: string, roomId: string): Promise<import("./invites/index").IInviteResponse>;
    getInviteEvents(): import("./invites/index").IInviteEvent[];
    hasInvite(roomId: string): boolean;
    acceptInvite(roomId: string): Promise<import("./invites/index").IInviteResponse>;
    declineInvite(roomId: string): Promise<import("./invites/index").IInviteResponse>;

    // ============ Capabilities (capabilities/index.ts) ============
    // Note: serverCapabilitiesService is private on MatrixClient
    // serverCapabilitiesService?: {
    //     getCachedCapabilities(): import("./capabilities/index").IServerCapabilities | undefined;
    //     fetchCapabilities(): Promise<import("./capabilities/index").IServerCapabilities>;
    // };

    // ============ Room Creation (room-creation/index.ts) ============
    createDirectRoom(
        userId: string,
        options?: import("./room-creation/index").ICreateRoomOptions,
    ): Promise<import("./room-creation/index").ICreateRoomResponse>;
    findOrCreateDirectRoom(userId: string): Promise<import("./room-creation/index").ICreateRoomResponse>;
    getCreateRoomOptions(): import("./room-creation/index").ICreateRoomOptionsConfig;
    setCreateRoomOptions(options: import("./room-creation/index").ICreateRoomOptionsConfig): void;

    // ============ Device Keys (device-keys/index.ts) ============
    getDeviceKeys(userId: string): Promise<Record<string, import("./device-keys/index").DeviceKeys>>;
    uploadDeviceKeys(
        keys: import("./device-keys/index").DeviceKeys,
    ): Promise<import("./device-keys/index").UploadKeysResponse>;
    hasDevice(deviceId: string): boolean;

    // ============ Uploads (uploads/index.ts) ============
    uploadFile(
        file: File | Blob,
        opts?: import("./uploads/index").IUploadOptions,
    ): Promise<import("./uploads/index").IUploadResponse>;
    getUploadProgress(uploadId: string): import("./uploads/index").IUploadProgress | null;
    abortAllUploads(): void;

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
