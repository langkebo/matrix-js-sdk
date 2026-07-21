export { AdminManager, type UserInfo, type RoomInfo, type ServerStats } from "./admin";
export { WorkerAdminManager } from "./worker-admin";
export { AccountManager } from "./account";
export { AccountDataManager } from "./account-data";
export { AuthManager, type RegisterFlow, type RegisterFlowsResponse } from "./auth";
export { CapabilitiesManager } from "./capabilities";
export { CryptoKeysManager } from "./crypto-keys";
export { DeviceTrustManager } from "./device-trust";
export { DirectMessageManager } from "./dm";
export {
    DiscoveryManager,
    type UserDirectorySearchResponse,
    type UserDirectoryListResponse,
    type PublicRoomsResponse,
} from "./discovery";
export { PushManager } from "./push";
export { RoomManager } from "./room";
export { RoomListManager } from "./room-list";
export { SendingManager } from "./sending";
export {
    SpaceManager,
    type Space,
    type SpaceChild,
    type SpaceMember,
    type SpaceHierarchy,
    type SpaceListResponse,
    type SpaceHierarchyPage,
    type SpaceStatistics,
    type SpaceQueryOptions,
    type CreateSpaceOptions,
    type UpdateSpaceOptions,
    type AddChildOptions,
} from "./space";
export { FriendManager } from "./friend";
export { GuestManager } from "./guest";
export { InviteBlocklistManager } from "./invite-blocklist";
export { KeyVerificationManager } from "./key-verification";
export type { IVerificationStatusResponse } from "./key-verification";
export {
    CasManager,
    type CasApiPrefix,
    type CasService,
    type CasServiceListResponse,
    type CasServiceCreateRequest,
    type CasServiceCreateResponse,
    type CasServiceDeleteResponse,
    type CasUserAttributes,
    type CasUserAttributesResponse,
    type CasServiceValidateResponse,
    type CasProxyResponse,
} from "./cas";
export {
    ExternalServiceManager,
    type ExternalServiceApiPrefix,
    type ExternalServiceItem,
    type ExternalServiceListResponse,
    type ExternalServiceCreateRequest,
    type ExternalServiceCreateResponse,
    type ExternalServiceUpdateRequest,
    type ExternalServiceUpdateResponse,
    type ExternalServiceDeleteResponse,
    type ExternalServiceHealthResponse,
    type ExternalServiceSingleHealthResponse,
    type ExternalServiceHealthCheckResponse,
    type ExternalServiceWebhookResponse,
} from "./external-service";
export { MediaManager } from "./media";
export { ModuleManager } from "./module";
export {
    RoomSummaryManager,
    RoomSummaryMemberManager,
    RoomSummaryMemberEvent,
    RoomSummaryStateManager,
    RoomSummaryStatsManager,
    RoomSummaryStatsEvent,
    RoomSummaryThreadManager,
    RoomSummarySearchManager,
    RoomSummaryKeyManager,
    RoomSummaryInvitePolicyManager,
    RoomSummaryEventOperationManager,
} from "./room-summary";
export { ThirdPartyManager } from "./third-party";
export { UserManager } from "./user";
export { BeaconManager } from "./beacon";
export { Beacon, BeaconEvent, getBeaconInfoIdentifier } from "./models/beacon";
export type { BeaconIdentifier, BeaconEventHandlerMap } from "./models/beacon";
export type {
    RoomSummaryMember,
    RoomStats,
    IRoomSummaryState,
    RoomSummaryStateContent,
    RoomSummaryHero,
    RoomSummaryOptions,
    RoomSummaryListResponse,
} from "./room-summary";
export { PresenceManager } from "./presence";
export { FederationManager } from "./federation";
export { DeviceManager } from "./device";
export type {
    IDevice,
    IDeviceUpdateRequest,
    IDeviceDeleteRequest,
    IAuthDict,
    IDeviceListUpdatesResponse,
} from "./device";
export { ProfileManager } from "./profile";
export { SecurityManager } from "./security";
export { TypingManager } from "./typing";
export { TagManager, TagEvent } from "./tags";
export type { IRoomTags, IRoomTag } from "./tags";
export { AggregationsManager } from "./aggregations";
export { ApplicationServiceManager } from "./app-service";
export {
    SamlAuthManager,
    type SamlLoginResponse,
    type SamlAuthResult,
    type SamlLogoutResponse,
    type SamlMetadata,
    type SamlSpMetadata,
    type SamlAdminConfig,
    type SamlUserMapping,
    type SamlUserMappingPage,
    type SamlRefreshResult,
} from "./saml";
export {
    BurnAfterReadManager,
    BurnAfterReadEvent,
    type IBurnAfterReadMessage,
    type IBurnAfterReadConfig,
    type IBurnSettings,
    type IBurnStats,
    type IBurnPendingEvent,
    type ISendBurnAfterReadMessageRequest,
    type IBurnAfterReadMessageResponse,
    type IMarkBurnReadResponse,
    type ICancelBurnResponse,
    type ISetBurnConfigResponse,
} from "./burn-after-read";
export { CaptchaManager } from "./captcha";
export { CrossSigningManager } from "./cross-signing";
export { CryptoStoreManager } from "./crypto-store";
export { DeviceKeysManager } from "./device-keys";
export { DirectoryManager } from "./directory";
export { EphemeralManager } from "./ephemeral";
export { EventManager } from "./event";
export { FilterManager, FilterManager as CanonicalFilterManager } from "./filter/index";
export { IdentityManager } from "./identity";
export { InviteListManager } from "./invite-list";
export { InvitesManager } from "./invites";
export { KeyBackupManager } from "./key-backup";
export { KeyRotationManager } from "./key-rotation";
export {
    DehydratedDeviceManager,
    type DehydratedDeviceData,
    type CreateDehydratedDeviceRequest,
    type CreateDehydratedDeviceResponse,
    type DeviceInfo,
    type GetDevicesResponse,
    type RehydrateData,
    type ClaimDehydratedDeviceRequest,
    type ClaimDehydratedDeviceResponse,
    type UpdateDehydratedDeviceRequest,
    type UpdateDehydratedDeviceResponse,
} from "./dehydrated-device";
export { LifecycleManager } from "./lifecycle";
export { MembershipManager } from "./membership";
export { NotificationsManager } from "./notifications";
export { PinnedMessagesManager } from "./pinned-messages";
export { PushNotificationsManager } from "./push-notifications";
export { PushRulesManager } from "./push-rules";
export { ReactionsManager } from "./reactions";
export { ReadReceiptsManager } from "./read-receipts";
export { RelationsManager } from "./relations";
export { ReportingManager } from "./reporting";
export { RetentionManager } from "./retention";
export { RoomAliasManager } from "./room-alias";
export { RoomCreationManager } from "./room-creation";
export { RoomEventsManager } from "./room-events";
export { RoomKeysManager } from "./room-keys";
export { RoomMemberManager } from "./room-member";
export { RoomSettingsManager } from "./room-settings";
export { RoomStateManager } from "./room-state";
export { SearchManager } from "./search";
export { SecretStorageManager } from "./secret-storage/index";
export { SecureBackupManager } from "./secure-backup";
export {
    doesClientAdvertiseSynapseRustFeature,
    isCapabilityEnabled,
    isUnstableFeatureEnabled,
    resolveSynapseRustFeatureSupport,
    ServerCapabilitiesManager,
    SynapseRustFeature,
    type SynapseRustFeatureDiscoveryClient,
    type SynapseRustFeatureName,
    type SynapseRustFeatureSupport,
} from "./server-capabilities";
export { ServerTimeManager } from "./server-time";
export { SessionManager } from "./session";
export { SessionsManager } from "./sessions";
export { SyncAccumulatorManager } from "./sync-accumulator/index";
export { SyncManager } from "./sync-management";
export { TagsManager } from "./tags-management";
export { TelemetryManager } from "./telemetry";
export { ThreadingManager } from "./threading";
export { TimelineManager } from "./timeline";
export { ToDeviceManager } from "./to-device";
export { TurnServerManager } from "./turn-server";
export { UploadsManager } from "./uploads";
export { UserDirectoryManager } from "./user-directory";
export { VoiceManager, VoiceEvent } from "./voice";
export type {
    IVoiceStats,
    IVoiceRoomStats,
    IVoiceUserStats,
    IVoiceConfig,
    IVoiceUploadRequest,
    IVoiceUploadResponse,
    IVoiceTranscriptionResponse,
    IVoiceMessage,
    IVoiceDeleteResponse,
} from "./voice";
export { WidgetsManager } from "./widgets";
export { AIConnectionManager, AIConnectionEvent } from "./ai-connection";
export type {
    AIConnection,
    CreateConnectionOptions,
    McpToolCallRequest,
    AiApiVersion,
    McpTool,
    McpToolListResponse,
    McpToolCallResponse,
    ConnectionListResponse,
} from "./ai-connection";
export { OpenClawManager, OpenClawEvent } from "./open-claw";
export type {
    OpenClawConnection,
    OpenClawConversation,
    OpenClawMessage,
    OpenClawGeneration,
    OpenClawChatRole,
    CreateOpenClawConnectionRequest,
    UpdateOpenClawConnectionRequest,
    CreateOpenClawConversationRequest,
    UpdateOpenClawConversationRequest,
    SendMessageRequest,
    CreateGenerationRequest,
    CreateChatRoleRequest,
    UpdateChatRoleRequest,
    PaginatedResponse,
    PaginationParams,
    ConnectionTestResult,
} from "./open-claw";
