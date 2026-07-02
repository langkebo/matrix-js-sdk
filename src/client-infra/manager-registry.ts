import { MatrixClient } from "../client";

const MANAGER_REGISTRY = Symbol.for("matrix-js-sdk.manager-registry");

type ManagerRegistryCarrier = MatrixClient & {
    [MANAGER_REGISTRY]?: Map<string, unknown>;
};

function getRegistry(client: MatrixClient): Map<string, unknown> {
    const carrier = client as ManagerRegistryCarrier;
    if (!carrier[MANAGER_REGISTRY]) {
        carrier[MANAGER_REGISTRY] = new Map<string, unknown>();
    }
    return carrier[MANAGER_REGISTRY];
}

export function getOrCreateManager<T>(client: MatrixClient, key: string, factory: () => T): T {
    const registry = getRegistry(client);
    const cached = registry.get(key);
    if (cached !== undefined) {
        return cached as T;
    }

    const manager = factory();
    registry.set(key, manager as unknown);
    return manager;
}

export function clearManagerRegistry(client: MatrixClient): void {
    getRegistry(client).clear();
}

// ── Class / factory registry (for manager() accessor) ──────────

type ManagerClass = new (client: MatrixClient) => unknown;
type ManagerFactory = (client: MatrixClient) => unknown;

const managerClassRegistry = new Map<string, ManagerClass>();
const managerFactoryRegistry = new Map<string, ManagerFactory>();

export function registerManagerClass(name: string, ctor: ManagerClass): void {
    managerClassRegistry.set(name, ctor);
}

export function registerManagerFactory(name: string, factory: ManagerFactory): void {
    managerFactoryRegistry.set(name, factory);
}

export function getManagerClass(name: string): ManagerClass | undefined {
    return managerClassRegistry.get(name);
}

export function getManagerFactory(name: string): ManagerFactory | undefined {
    return managerFactoryRegistry.get(name);
}

export function clearManagerClassRegistry(): void {
    managerClassRegistry.clear();
    managerFactoryRegistry.clear();
}

// ── Type-level manager registry ────────────────────────────────

/**
 * Union of all valid manager name keys.
 * Each key corresponds to the first argument passed to `getOrCreateManager`
 * and can be used with `client.manager(key)`.
 */
export type ManagerName =
    | "account"
    | "accountData"
    | "admin"
    | "aggregations"
    | "aiConnection"
    | "auth"
    | "authGlobalLogout"
    | "backgroundUpdate"
    | "beacon"
    | "BurnAfterReadManager"
    | "capabilities"
    | "captcha"
    | "cas"
    | "credentials"
    | "crossSigning"
    | "cryptoBackup"
    | "cryptoEncryption"
    | "cryptoKeys"
    | "cryptoStore"
    | "dehydratedDevice"
    | "device"
    | "deviceKeys"
    | "deviceTrust"
    | "directory"
    | "discovery"
    | "dm"
    | "e2ee"
    | "ephemeral"
    | "event"
    | "eventProcessing"
    | "eventReport"
    | "eventStatus"
    | "external-service"
    | "featureFlags"
    | "federation"
    | "filter"
    | "friend"
    | "guest"
    | "http"
    | "identity"
    | "identityServer"
    | "inviteBlocklist"
    | "invites"
    | "keyBackup"
    | "keyClaim"
    | "keyForwarding"
    | "keyRotation"
    | "keyVerification"
    | "lifecycle"
    | "logger"
    | "media"
    | "mediaQuota"
    | "membership"
    | "moderation"
    | "module"
    | "notifications"
    | "oidc"
    | "openclaw"
    | "passwordReset"
    | "pinnedMessages"
    | "presence"
    | "profile"
    | "push"
    | "pushNotifications"
    | "pushRules"
    | "qrLogin"
    | "reactions"
    | "readReceipts"
    | "relations"
    | "rendezvous"
    | "reporting"
    | "retention"
    | "room"
    | "roomAccountData"
    | "roomCreation"
    | "roomEvents"
    | "roomJoining"
    | "roomKeySharing"
    | "roomKeys"
    | "roomList"
    | "roomMember"
    | "roomSettings"
    | "roomState"
    | "roomStateManagement"
    | "roomSummary"
    | "roomUpgrades"
    | "saml-auth"
    | "scheduledEvents"
    | "search"
    | "secretStorage"
    | "secureBackup"
    | "security"
    | "sending"
    | "sendingQueue"
    | "serverCapabilities"
    | "serverTime"
    | "session"
    | "sessions"
    | "space"
    | "stateSend"
    | "stickyEvent"
    | "stores"
    | "syncAccumulator"
    | "syncManagement"
    | "tagsManagement"
    | "telemetry"
    | "thirdparty"
    | "thread"
    | "threading"
    | "threepids"
    | "timeline"
    | "toDevice"
    | "tokenManagement"
    | "turnServer"
    | "typing"
    | "uploads"
    | "urlPreview"
    | "user"
    | "userDirectory"
    | "userPresence"
    | "userReport"
    | "verification"
    | "voice"
    | "voipCalls"
    | "widget"
    | "widgets"
    | "workerAdmin"
    | "workerBody";

/**
 * Maps each manager name to its return type.
 * Used by the `manager()` accessor for type-safe lookups.
 */
export interface ManagerTypeMap {
    account: import("../account/index").AccountManager;
    accountData: import("../account-data/index").AccountDataManager;
    admin: import("../admin/index").AdminManager;
    aggregations: import("../aggregations/index").AggregationsManager;
    aiConnection: import("../ai-connection/index").AIConnectionManager;
    auth: import("../auth/index").AuthManager;
    authGlobalLogout: import("../auth/global-logout").GlobalLogoutManager;
    backgroundUpdate: import("../background-update/index").BackgroundUpdateManager;
    beacon: import("../beacon/index").BeaconManager;
    BurnAfterReadManager: import("../burn-after-read/index").BurnAfterReadManager;
    capabilities: import("../capabilities/index").CapabilitiesManager;
    captcha: import("../captcha/index").CaptchaManager;
    cas: import("../cas/index").CasManager;
    credentials: import("../credentials/index").CredentialsManager;
    crossSigning: import("../cross-signing/index").CrossSigningManager;
    cryptoBackup: import("../crypto-backup/index").CryptoBackupManager;
    cryptoEncryption: import("../crypto-encryption/index").CryptoEncryptionManager;
    cryptoKeys: import("../crypto-keys/index").CryptoKeysManager;
    cryptoStore: import("../crypto-store/index").CryptoStoreManager;
    dehydratedDevice: import("../dehydrated-device/index").DehydratedDeviceManager;
    device: import("../device/index").DeviceManager;
    deviceKeys: import("../device-keys/index").DeviceKeysManager;
    deviceTrust: import("../device-trust/index").DeviceTrustManager;
    directory: import("../directory/index").DirectoryManager;
    discovery: import("../discovery/index").DiscoveryManager;
    dm: import("../dm/index").DirectMessageManager;
    e2ee: import("../e2ee/index").E2EEManager;
    ephemeral: import("../ephemeral/index").EphemeralManager;
    event: import("../event/index").EventManager;
    eventProcessing: import("../event-processing/index").EventProcessingManager;
    eventReport: import("../event-report/index").EventReportManager;
    eventStatus: import("../event-status/index").EventStatusManager;
    "external-service": import("../external-service/index").ExternalServiceManager;
    featureFlags: import("../feature-flags/index").FeatureFlagManager;
    federation: import("../federation/index").FederationManager;
    filter: import("../filter/index").FilterManager;
    friend: import("../friend/index").FriendManager;
    guest: import("../guest/index").GuestManager;
    http: import("../http/index").HttpManager;
    identity: import("../identity/index").IdentityManager;
    identityServer: import("../identity-server/index").IdentityServerManager;
    inviteBlocklist: import("../invite-blocklist/index").InviteBlocklistManager;
    invites: import("../invites/index").InvitesManager;
    keyBackup: import("../key-backup/index").KeyBackupManager;
    keyClaim: import("../key-claim/index").KeyClaimManager;
    keyForwarding: import("../key-forwarding/index").KeyForwardingManager;
    keyRotation: import("../key-rotation/index").KeyRotationManager;
    keyVerification: import("../key-verification/index").KeyVerificationManager;
    lifecycle: import("../lifecycle/index").LifecycleManager;
    logger: import("../logger/index").LoggerManager;
    media: import("../media/index").MediaManager;
    mediaQuota: import("../media-quota/index").MediaQuotaManager;
    membership: import("../membership/index").MembershipManager;
    moderation: import("../moderation/index").ModerationManager;
    module: import("../module/index").ModuleManager;
    notifications: import("../notifications/index").NotificationsManager;
    oidc: import("../oidc/manager").OidcManager;
    openclaw: import("../open-claw/index").OpenClawManager;
    passwordReset: import("../password-reset/index").PasswordResetManager;
    pinnedMessages: import("../pinned-messages/index").PinnedMessagesManager;
    presence: import("../presence/index").PresenceManager;
    profile: import("../profile/index").ProfileManager;
    push: import("../push/index").PushManager;
    pushNotifications: import("../push-notifications/index").PushNotificationsManager;
    pushRules: import("../push-rules/index").PushRulesManager;
    qrLogin: import("../qr-login/index").QrLoginManager;
    reactions: import("../reactions/index").ReactionsManager;
    readReceipts: import("../read-receipts/index").ReadReceiptsManager;
    relations: import("../relations/index").RelationsManager;
    rendezvous: import("../rendezvous/RendezvousManager").RendezvousManager;
    reporting: import("../reporting/index").ReportingManager;
    retention: import("../retention/index").RetentionManager;
    room: import("../room/index").RoomManager;
    roomAccountData: import("../room-account-data/index").RoomAccountDataManager;
    roomCreation: import("../room-creation/index").RoomCreationManager;
    roomEvents: import("../room-events/index").RoomEventsManager;
    roomJoining: import("../room-joining/index").RoomJoiningManager;
    roomKeySharing: import("../room-key-sharing/index").RoomKeySharingManager;
    roomKeys: import("../room-keys/index").RoomKeysManager;
    roomList: import("../room-list/index").RoomListManager;
    roomMember: import("../room-member/index").RoomMemberManager;
    roomSettings: import("../room-settings/index").RoomSettingsManager;
    roomState: import("../room-state/index").RoomStateManager;
    roomStateManagement: import("../room-state-management/index").RoomStateManagementManager;
    roomSummary: import("../room-summary/index").RoomSummaryManager;
    roomUpgrades: import("../room-upgrades/index").RoomUpgradesManager;
    "saml-auth": import("../saml/index").SamlAuthManager;
    scheduledEvents: import("../scheduled-events/index").ScheduledEventsManager;
    search: import("../search/index").SearchManager;
    secretStorage: import("../secret-storage/index").SecretStorageManager;
    secureBackup: import("../secure-backup/index").SecureBackupManager;
    security: import("../security/index").SecurityManager;
    sending: import("../sending/index").SendingManager;
    sendingQueue: import("../sending-queue/index").SendingQueueManager;
    serverCapabilities: import("../server-capabilities/index").ServerCapabilitiesManager;
    serverTime: import("../server-time/index").ServerTimeManager;
    session: import("../session/index").SessionManager;
    sessions: import("../sessions/index").SessionsManager;
    space: import("../space/index").SpaceManager;
    stateSend: import("../state-send/index").StateSendManager;
    stickyEvent: import("../sticky-event/index").StickyEventManager;
    stores: import("../stores/index").StoresManager;
    syncAccumulator: import("../sync-accumulator/index").SyncAccumulatorManager;
    syncManagement: import("../sync-management/index").SyncManager;
    tagsManagement: import("../tags-management/index").TagsManager;
    telemetry: import("../telemetry/index").TelemetryManager;
    thirdparty: import("../third-party/index").ThirdPartyManager;
    thread: import("../thread/index").ThreadManager;
    threading: import("../threading/index").ThreadingManager;
    threepids: import("../three-pids/index").ThreePidsManager;
    timeline: import("../timeline/index").TimelineManager;
    toDevice: import("../to-device/index").ToDeviceManager;
    tokenManagement: import("../token-management/index").TokenManager;
    turnServer: import("../turn-server/index").TurnServerManager;
    typing: import("../typing/index").TypingManager;
    uploads: import("../uploads/index").UploadsManager;
    urlPreview: import("../url-preview/index").UrlPreviewManager;
    user: import("../user/index").UserManager;
    userDirectory: import("../user-directory/index").UserDirectoryManager;
    userPresence: import("../user-presence/index").UserPresenceManager;
    userReport: import("../user-report/index").UserReportManager;
    verification: import("../verification/index").VerificationManager;
    voice: import("../voice/index").VoiceManager;
    voipCalls: import("../voip-calls/index").VoIPCallsManager;
    widget: import("../widget/index").WidgetManager;
    widgets: import("../widgets/index").WidgetsManager;
    workerAdmin: import("../worker-admin/index").WorkerAdminManager;
    workerBody: import("../worker-body/index").WorkerBodyManager;
}
