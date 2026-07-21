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
    | "backgroundUpdate"
    | "beacon"
    | "BurnAfterReadManager"
    | "capabilities"
    | "captcha"
    | "cas"
    | "crossSigning"
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
    | "eventReport"
    | "external-service"
    | "featureFlags"
    | "federation"
    | "filter"
    | "friend"
    | "guest"
    | "identity"
    | "identityServer"
    | "inviteBlocklist"
    | "invites"
    | "keyBackup"
    | "keyRotation"
    | "keyVerification"
    | "lifecycle"
    | "media"
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
    | "reactions"
    | "readReceipts"
    | "relations"
    | "rendezvous"
    | "reporting"
    | "retention"
    | "room"
    | "roomCreation"
    | "roomEvents"
    | "roomKeys"
    | "roomList"
    | "roomMember"
    | "roomSettings"
    | "roomState"
    | "roomSummary"
    | "saml-auth"
    | "search"
    | "secretStorage"
    | "secureBackup"
    | "security"
    | "sending"
    | "serverCapabilities"
    | "serverTime"
    | "session"
    | "sessions"
    | "space"
    | "stateSend"
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
    | "turnServer"
    | "typing"
    | "uploads"
    | "user"
    | "userDirectory"
    | "verification"
    | "voice"
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
    backgroundUpdate: import("../background-update/index").BackgroundUpdateManager;
    beacon: import("../beacon/index").BeaconManager;
    BurnAfterReadManager: import("../burn-after-read/index").BurnAfterReadManager;
    capabilities: import("../capabilities/index").CapabilitiesManager;
    captcha: import("../captcha/index").CaptchaManager;
    cas: import("../cas/index").CasManager;
    crossSigning: import("../cross-signing/index").CrossSigningManager;
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
    eventReport: import("../event-report/index").EventReportManager;
    "external-service": import("../external-service/index").ExternalServiceManager;
    featureFlags: import("../feature-flags/index").FeatureFlagManager;
    federation: import("../federation/index").FederationManager;
    filter: import("../filter/index").FilterManager;
    friend: import("../friend/index").FriendManager;
    guest: import("../guest/index").GuestManager;
    identity: import("../identity/index").IdentityManager;
    identityServer: import("../identity-server/index").IdentityServerManager;
    inviteBlocklist: import("../invite-blocklist/index").InviteBlocklistManager;
    invites: import("../invites/index").InvitesManager;
    keyBackup: import("../key-backup/index").KeyBackupManager;
    keyRotation: import("../key-rotation/index").KeyRotationManager;
    keyVerification: import("../key-verification/index").KeyVerificationManager;
    lifecycle: import("../lifecycle/index").LifecycleManager;
    media: import("../media/index").MediaManager;
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
    reactions: import("../reactions/index").ReactionsManager;
    readReceipts: import("../read-receipts/index").ReadReceiptsManager;
    relations: import("../relations/index").RelationsManager;
    rendezvous: import("../rendezvous/RendezvousManager").RendezvousManager;
    reporting: import("../reporting/index").ReportingManager;
    retention: import("../retention/index").RetentionManager;
    room: import("../room/index").RoomManager;
    roomCreation: import("../room-creation/index").RoomCreationManager;
    roomEvents: import("../room-events/index").RoomEventsManager;
    roomKeys: import("../room-keys/index").RoomKeysManager;
    roomList: import("../room-list/index").RoomListManager;
    roomMember: import("../room-member/index").RoomMemberManager;
    roomSettings: import("../room-settings/index").RoomSettingsManager;
    roomState: import("../room-state/index").RoomStateManager;
    roomSummary: import("../room-summary/index").RoomSummaryManager;
    "saml-auth": import("../saml/index").SamlAuthManager;
    search: import("../search/index").SearchManager;
    secretStorage: import("../secret-storage/index").SecretStorageManager;
    secureBackup: import("../secure-backup/index").SecureBackupManager;
    security: import("../security/index").SecurityManager;
    sending: import("../sending/index").SendingManager;
    serverCapabilities: import("../server-capabilities/index").ServerCapabilitiesManager;
    serverTime: import("../server-time/index").ServerTimeManager;
    session: import("../session/index").SessionManager;
    sessions: import("../sessions/index").SessionsManager;
    space: import("../space/index").SpaceManager;
    stateSend: import("../state-send/index").StateSendManager;
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
    turnServer: import("../turn-server/index").TurnServerManager;
    typing: import("../typing/index").TypingManager;
    uploads: import("../uploads/index").UploadsManager;
    user: import("../user/index").UserManager;
    userDirectory: import("../user-directory/index").UserDirectoryManager;
    verification: import("../verification/index").VerificationManager;
    voice: import("../voice/index").VoiceManager;
    widget: import("../widget/index").WidgetManager;
    widgets: import("../widgets/index").WidgetsManager;
    workerAdmin: import("../worker-admin/index").WorkerAdminManager;
    workerBody: import("../worker-body/index").WorkerBodyManager;
}
