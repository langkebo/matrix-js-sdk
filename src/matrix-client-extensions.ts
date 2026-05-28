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
import type { RoomAccountDataEvents } from "./@types/event";
import type { IdServerUnbindResult } from "./@types/partials";
import type { IIdentityServerProvider } from "./@types/IIdentityServerProvider";
import type { ITurnServer } from "./client-api-types";
import type { IMediaConfig, IWhoamiResponse } from "./client-internal-types";
import type { CryptoBackend } from "./common-crypto/CryptoBackend";
import type { CryptoApi } from "./crypto-api";
import type { IStoredClientOpts } from "./client-config-types";
import type { SyncApiOptions } from "./sync";

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
    address?: { formatted?: string; street_address?: string; locality?: string; region?: string; postal_code?: string; country?: string };
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

/** Forwarded room key data */
export interface ForwardedRoomKey {
    /** The algorithm used for the key */
    algorithm?: string;
    /** The room ID the key is for */
    room_id?: string;
    /** The sender's curve25519 key */
    sender_key?: string;
    /** The session ID */
    session_id?: string;
    /** The session key */
    session_key?: string;
    /** Additional key properties */
    [key: string]: unknown;
}

export interface MatrixClientExtensionMethods {
    // ============ Account & Profile ============
    getAccountManager(): import("./account/index").AccountManager;
    getAccountDataManager(): import("./account-data/index").AccountDataManager;
    getRoom(roomId: string): Room | null;
    getRooms(): Room[];
    getUsers(): unknown[];
    getUser(userId: string): unknown | null;
    sendEvent(
        roomId: string,
        eventType: string,
        content: IContent,
        txnId?: string,
    ): Promise<{ event_id: string }>;
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
    getCredentialsManager(): import("./credentials/index").CredentialsManager;
    getDeviceManager(): import("./device/index").DeviceManager;
    getDevices(): Promise<import("./device/index").IDevice[]>;
    getDevice(deviceId: string): Promise<import("./device/index").IDevice>;
    setDeviceName(deviceId: string, name: string): Promise<void>;
    deleteDevice(deviceId: string, auth?: UiaAuthData): Promise<void>;
    deleteMultipleDevices(deviceIds: string[], auth?: UiaAuthData): Promise<void>;
    getThreePidsManager(): import("./three-pids/index").ThreePidsManager;
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
    getSendingManager(): import("./sending/index").SendingManager;
    getSendingQueueManager(): import("./sending-queue/index").SendingQueueManager;
    getEventManager(): import("./event/index").EventManager;
    getEventProcessingManager(): import("./event-processing/index").EventProcessingManager;
    getEventStatusManager(): import("./event-status/index").EventStatusManager;
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
    getPushRules(): Promise<import("./push/index").IPushRules>;
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
    deletePushRule(scope: string, kind: import("./@types/PushRules").PushRuleKind, ruleId: string): Promise<void>;
    setPusher(pusher: import("./push/index").IPusherRequest): Promise<void>;
    getPushRulesManager(): import("./push-rules/index").PushRulesManager;
    getPushNotificationsManager(): import("./push-notifications/index").PushNotificationsManager;
    getNotificationsManager(): import("./notifications/index").NotificationsManager;

    // ============ Crypto & Security ============
    getCryptoKeysManager(): import("./crypto-keys/index").CryptoKeysManager;
    getCryptoEncryptionManager(): import("./crypto-encryption/index").CryptoEncryptionManager;
    getCryptoBackupManager(): import("./crypto-backup/index").CryptoBackupManager;
    getCryptoStoreManager(): import("./crypto-store/index").CryptoStoreManager;
    getCrossSigningManager(): import("./cross-signing/index").CrossSigningManager;
    getDeviceKeysManager(): import("./device-keys/index").DeviceKeysManager;
    getKeyVerificationManager(): import("./key-verification/index").KeyVerificationManager;
    getKeyForwardingManager(): import("./key-forwarding/index").KeyForwardingManager;
    getKeyClaimManager(): import("./key-claim/index").KeyClaimManager;
    getSecretStorageManager(): import("./secret-storage/index").SecretStorageManager;
    getSecurityManager(): import("./security/index").SecurityManager;
    getSecureBackupManager(): import("./secure-backup/index").SecureBackupManager;
    getDeviceTrustManager(): import("./device-trust/index").DeviceTrustManager;
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
    getTokenManager(): import("./token-management/index").TokenManager;

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

    // ============ Storage & Persistence ============
    getStoresManager(): import("./stores/index").StoresManager;
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
    getMediaQuotaManager(): import("./media-quota/index").MediaQuotaManager;
    sendEmote(roomId: string, text: string, txnId?: string): Promise<ISendEventResponse>;

    // ============ Tags & Labels ============
    getTagsManager(): import("./tags-management/index").TagsManager;
    removeRoomTag(roomId: string, tag: string): Promise<import("./@types/common").EmptyObject>;

    // ============ Widgets & Integrations ============
    getWidgetsManager(): import("./widgets/index").WidgetsManager;

    // ============ Scheduled Events ============
    getScheduledEventsManager(): import("./scheduled-events/index").ScheduledEventsManager;

    // ============ Other Features ============
    getThirdPartyManager(): import("./third-party/index").ThirdPartyManager;
    getUrlPreviewManager(): import("./url-preview/index").UrlPreviewManager;
    getGuestManager(): import("./guest/index").GuestManager;
    getCaptchaManager(): import("./captcha/index").CaptchaManager;
    getRetentionManager(): import("./retention/index").RetentionManager;
    getBeaconManager(): import("./beacon/index").BeaconManager;
    getLoggerManager(): import("./logger/index").LoggerManager;
    getLifecycleManager(): import("./lifecycle/index").LifecycleManager;
    setUserPowerLevel(roomId: string, userId: string, powerLevel: number): Promise<void>;
    getMembershipManager(): import("./membership/index").MembershipManager;
    getReadReceiptsManager(): import("./read-receipts/index").ReadReceiptsManager;
    getKeyBackupManager(): import("./key-backup/index").KeyBackupManager;
    getKeyRotationManager(): import("./key-rotation/index").KeyRotationManager;
    getBurnAfterReadManager(): import("./burn-after-read/index").BurnAfterReadManager;
    getStickyEventManager(): import("./sticky-event/index").StickyEventManager;
    getQrLoginManager(): import("./qr-login/index").QrLoginManager;
    getOidcManager(): import("./oidc/manager").OidcManager;
    oidcUserInfo(): Promise<OidcUserInfo>;
    getTelemetryManager(
        config?: Partial<import("./telemetry/index").TelemetryConfig>,
    ): import("./telemetry/index").TelemetryManager;
    getRendezvousManager(): import("./rendezvous/RendezvousManager").RendezvousManager;
    getStateSendManager(): import("./state-send/index").StateSendManager;
    getUserReportManager(): import("./user-report/index").UserReportManager;
    getSessionManager(): import("./session/index").SessionManager;
    getToDeviceManager(): import("./to-device/index").ToDeviceManager;
    getAIConnectionManager(): import("./ai-connection/index").AIConnectionManager;
    getOpenClawManager(): import("./open-claw/index").OpenClawManager;
    getSamlAuthManager(): import("./saml/index").SamlAuthManager;
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
    getServerCapabilities(): Promise<ServerCapabilities>;
    hasServerSupport(feature: string): boolean;
    getServerVersion(): Promise<string>;
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

    // ============ Crypto Encryption (crypto-encryption/index.ts) ============
    isCryptoReady(): boolean;
    deviceList?: unknown;
    encryptEvent(event: MatrixEvent, room: Room): Promise<import("./crypto-encryption/index").IEncryptionResult>;
    decryptEvent(event: MatrixEvent): Promise<import("./crypto-encryption/index").IDecryptionResult>;
    getUserDevices(userId: string): Promise<UserDeviceMap>;
    setDeviceVerified(userId: string, deviceId: string): Promise<void>;
    markDeviceAsVerified(userId: string, deviceId: string): Promise<void>;
    markAllDevicesAsVerified(userId: string): Promise<void>;
    getEncryptionInfoForRoom(roomId: string): Promise<import("./crypto-encryption/index").IEncryptionInfo>;

    // ============ Scheduled Events (scheduled-events/index.ts) ============
    // Note: _unstable_* methods have incompatible signatures with MatrixClient's actual methods
    // Access via (client as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)["_unstable_*"]
    // _unstable_sendDelayedEvent(...): Promise<IDelayedEventResponse>;
    // _unstable_sendStickyDelayedEvent(...): Promise<IDelayedEventResponse>;
    // _unstable_sendDelayedStateEvent(...): Promise<IDelayedEventResponse>;
    // _unstable_getDelayedEvents(): Promise<IDelayedEvent[]>;
    // _unstable_updateDelayedEvent(...): Promise<IDelayedEventResponse>;
    // _unstable_restartScheduledDelayedEvent(...): Promise<IDelayedEventResponse>;
    // _unstable_sendScheduledDelayedEvent(...): Promise<IDelayedEventResponse>;

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

    // ============ Room State Management (room-state-management/index.ts) ============
    getRoomState(roomId: string): Promise<import("./room-state-management/index").IRoomStateEvent[]>;
    getRoomAccountDataSync(roomId: string, eventType: string): import("./models/event").IContent | null;

    // ============ Sending Queue (sending-queue/index.ts) ============
    sendingQueue?: import("./sending-queue/index").IQueuedEvent[];

    // ============ Sync Accumulator (sync-accumulator/index.ts) ============
    syncAccumulator?: import("./sync-accumulator").SyncAccumulator;
    accumulateSyncData(data: IContent /* raw sync response */): Promise<void>;
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

    // ============ Key Forwarding (key-forwarding/index.ts) ============
    requestKeyForwarding(
        roomId: string,
        eventId: string,
        userId: string,
    ): Promise<import("./key-forwarding/index").IKeyForwardingResponse>;
    forwardKey(
        roomId: string,
        eventId: string,
        userId: string,
        key: ForwardedRoomKey,
    ): Promise<import("./key-forwarding/index").IKeyForwardingResponse>;
    hasForwardedKey(roomId: string, eventId: string): boolean;
    getForwardedKeys(roomId: string): import("./key-forwarding/index").IForwardedKey[];

    // ============ Invites (invites/index.ts) ============
    // Note: invite methods have different signatures than MatrixClient's actual implementations
    // inviteByThreePid on MatrixClient: (roomId, medium, address) => Promise<EmptyObject>
    // inviteUserToRoom, acceptInvite, declineInvite are phantom methods
    // getInviteEvents, hasInvite are phantom methods
    // inviteByThreePid(medium: string, address: string, roomId: string): Promise<import("./invites/index").IInviteResponse>;
    // inviteUserToRoom(userId: string, roomId: string): Promise<import("./invites/index").IInviteResponse>;
    // getInviteEvents(): import("./invites/index").IInviteEvent[];
    // hasInvite(roomId: string): boolean;
    // acceptInvite(roomId: string): Promise<import("./invites/index").IInviteResponse>;
    // declineInvite(roomId: string): Promise<import("./invites/index").IInviteResponse>;

    // ============ HTTP (http/index.ts) ============
    createRequest(options: import("./http/index").IRequestOptions): Promise<unknown>;
    pickAnyDestinationCertificate(roomId: string, eventId: string): unknown;
    getPendingRequests(): import("./http/index").IPendingRequest[];
    cancelPendingRequests(reason: string): void;

    // ============ Event Processing (event-processing/index.ts) ============
    processEvent(event: MatrixEvent): Promise<void>;
    handleEvent(event: MatrixEvent): Promise<void>;

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
    uploadDeviceKeys(keys: import("./device-keys/index").DeviceKeys): Promise<import("./device-keys/index").UploadKeysResponse>;
    hasDevice(deviceId: string): boolean;

    // ============ Uploads (uploads/index.ts) ============
    uploadFile(file: File | Blob, opts?: import("./uploads/index").IUploadOptions): Promise<import("./uploads/index").IUploadResponse>;
    getUploadProgress(uploadId: string): import("./uploads/index").IUploadProgress | null;
    abortAllUploads(): void;

    // ============ Room Upgrades (room-upgrades/index.ts) ============
    getRoomUpgradeHistory(roomId: string): import("./room-upgrades/index").IRoomUpgradeHistory[];
    upgradeRoom(roomId: string, newVersion: string): Promise<import("./room-upgrades/index").IUpgradeRoomResponse>;
    canUpgradeRoom(roomId: string): boolean;
    getRecommendedRoomVersion(): Promise<string>;

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
