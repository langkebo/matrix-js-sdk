/*
Copyright 2015-2023 The Matrix.org Foundation C.I.C.

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
 * This is an internal module. See {@link MatrixClient} for the public class.
 */

import { type ISyncStateData, type SetPresence, SyncApi, type SyncApiOptions, SyncState } from "./sync";
import type {
    MatrixClientExtensionMethods,
    MatrixClientInternalMethods,
    SharedWithUsersMap,
    WidgetData,
} from "./matrix-client-extensions";
import {
    EventStatus,
    type IContent,
    type IDecryptOptions,
    type IEvent,
    MatrixEvent,
    MatrixEventEvent,
    type MatrixEventHandlerMap,
    type PushDetails,
} from "./models/event";
import { StubStore } from "./store/stub";
import {
    type CallEvent,
    type CallEventHandlerMap,
    createNewMatrixCall,
    type MatrixCall,
    supportsMatrixCall,
} from "./web-rtc/call";
import { Filter, type IFilterDefinition, type IRoomEventFilter } from "./filter";
import {
    CallEventHandler,
    type CallEventHandlerEvent,
    type CallEventHandlerEventHandlerMap,
} from "./web-rtc/callEventHandler";
import {
    GroupCallEventHandler,
    type GroupCallEventHandlerEvent,
    type GroupCallEventHandlerEventHandlerMap,
} from "./web-rtc/groupCallEventHandler";
import * as utils from "./utils";
import { type QueryDict } from "./utils";
import { Direction, EventTimeline } from "./models/event-timeline";
import { type IActionsObject, PushProcessor } from "./pushprocessor";
import { AutoDiscovery } from "./autodiscovery";
import { TypedReEmitter } from "./ReEmitter";
import { logger, type Logger } from "./logger";
import {
    type Body,
    ClientPrefix,
    type FileType,
    type HttpApiEvent,
    type HttpApiEventHandlerMap,
    type IHttpOpts,
    type IRequestOpts,
    MatrixError,
    MatrixHttpApi,
    Method,
    type Upload,
    type UploadOpts,
    type UploadResponse,
} from "./http-api/index";
import { User, UserEvent, type UserEventHandlerMap } from "./models/user";
import { ProfileManager, type IExtendedProfile } from "./profile/index";

import { type IIdentityServerProvider } from "./@types/IIdentityServerProvider";
import { type MatrixScheduler } from "./scheduler";
import { type BeaconEvent, type BeaconEventHandlerMap } from "./models/beacon";
import { type AuthDict } from "./interactive-auth";
import { type ReceivedToDeviceMessage } from "./sync-accumulator";
import type { EventTimelineSet } from "./models/event-timeline-set";
import { InflightRequestCache, stableSerialize } from "./utils/inflight-request-cache";
import { LRUCache } from "./utils/lru-cache";
import { NotificationCountType, type Room, type RoomEvent, type RoomEventHandlerMap } from "./models/room";
import { RoomMemberEvent, type RoomMemberEventHandlerMap } from "./models/room-member";
import { type RoomStateEvent, type RoomStateEventHandlerMap } from "./models/room-state";
import {
    isSendDelayedEventRequestOpts,
    UpdateDelayedEventAction,
    type DelayedEventInfo,
    type ICreateRoomOpts,
    type IEventSearchOpts,
    type IGuestAccessOpts,
    type IJoinRoomOpts,
    type INotificationsResponse,
    type InviteOpts,
    type IPaginateOpts,
    type IRedactOpts,
    type IRelationsRequestOpts,
    type IRelationsResponse,
    type IRoomDirectoryOptions,
    type ISearchOpts,
    type ISendEventResponse,
    type ITagsResponse,
    type KnockRoomOpts,
    type SendDelayedEventRequestOpts,
    type SendDelayedEventResponse,
} from "./@types/requests";
import {
    type AccountDataEvents,
    EventType,
    MsgType,
    RelationType,
    type RoomAccountDataEvents,
    type StateEvents,
    type TimelineEvents,
    type WritableAccountDataEvents,
} from "./@types/event";
import { type IdServerUnbindResult, Preset, type Visibility } from "./@types/partials";
import { type EventMapper, eventMapperFor, type MapperOpts } from "./event-mapper";
import { secureRandomString } from "./randomstring";
import { MSC3089TreeSpace } from "./models/MSC3089TreeSpace";
import { type IStore } from "./store/index";
import {
    type ISearchRequestBody,
    type ISearchResponse,
    type ISearchResults,
    type IStateEventWithRoomId,
} from "./@types/search";
import { type ISynapseAdminDeactivateResponse, type ISynapseAdminWhoisResponse } from "./@types/synapse";
import type {
    IKeyBackupPath,
    IMediaConfig,
    IMessagesResponse,
    IMyRoomInfo,
    IRoomHierarchy,
    ITagMetadata,
    IThirdPartyLocation,
    IThirdPartyUser,
    IUserDirectoryResponse,
    IWhoamiResponse,
} from "./client-internal-types";
import { type IPushRule, type IPushRules } from "./@types/PushRules";
import { type CryptoStore } from "./crypto/store/base";
import {
    GroupCall,
    type GroupCallIntent,
    type GroupCallType,
    type IGroupCallDataChannelOptions,
} from "./web-rtc/groupCall";
import { MediaHandler } from "./web-rtc/mediaHandler";
import {
    type ILoginFlowsResponse,
    type IRefreshTokenResponse,
    type LoginRequest,
    type LoginResponse,
    type LoginTokenPostResponse,
    type SSOAction,
} from "./@types/auth";
import { TypedEventEmitter } from "./models/typed-event-emitter";
import { type MSC3575SlidingSyncRequest, type MSC3575SlidingSyncResponse } from "./sliding-sync";
import { SlidingSyncSdk } from "./sliding-sync-sdk";
import { FeatureSupport, Thread, THREAD_RELATION_TYPE, ThreadFilterType } from "./models/thread";
import { NamespacedValue, UnstableValue } from "./NamespacedValue";
import { ToDeviceMessageQueue } from "./ToDeviceMessageQueue";
import { IgnoredInvites } from "./models/invites-ignorer";
import { type LocalNotificationSettings } from "./@types/local_notifications";
import { Feature, ServerSupport } from "./feature";
import { M_BEACON_INFO, type MBeaconInfoEventContent } from "./@types/beacon";
import { type CryptoBackend } from "./common-crypto/CryptoBackend";
import { RUST_SDK_STORE_PREFIX } from "./rust-crypto/constants";
import { type CryptoApi, type CryptoCallbacks, CryptoEvent, type CryptoEventHandlerMap } from "./crypto-api/index";
import {
    type SecretStorageKeyDescription,
    type ServerSideSecretStorage,
    ServerSideSecretStorageImpl,
} from "./secret-storage";
import { type RegisterRequest, type RegisterResponse } from "./@types/registration";
import { MatrixRTCSessionManager } from "./matrix-rtc/MatrixRTCSessionManager";
import { type RoomMessageEventContent } from "./@types/events";
import { type ImageInfo } from "./@types/media";
import { type Capabilities, ServerCapabilities } from "./serverCapabilities";
import { type SynapseRustFeatureName, type SynapseRustFeatureSupport } from "./server-capabilities";
import { type OidcClientConfig } from "./oidc/index";
import { type EmptyObject } from "./@types/common";
import { UnsupportedDelayedEventsEndpointError, UnsupportedStickyEventsEndpointError } from "./errors";
import { type Transport } from "./matrix-rtc/index";
import { buildDelayedEventsQuery, buildUnstableFeaturePrefix } from "./client-delayed-events";
import {
    updateScheduledDelayedEventWithFallback,
} from "./client-delayed-events-updater";
import { prepareSendCompleteEventLifecycle } from "./client-send-lifecycle";
import { encryptAndSendEventWorkflow } from "./client-encrypt-send";
import { dispatchSendEventHttpRequest } from "./client-send-http";
import { dispatchDelayedStateEventRequest, dispatchStateEventRequest } from "./client-send-state";
import { prepareSendEventParams, type PreparedSendEventParams } from "./client-send-event";
import { normalizeRedactEventArgs, normalizeThreadHtmlArgs } from "./client-send-args";
import { buildRedactEventContent } from "./client-send-redaction";
import { fetchAuthMetadataWithFallback } from "./client-auth";
import { fixNotificationCountOnDecryption, inMainTimelineForReceipt, threadIdForReceipt } from "./client-receipts";
import { leaveRoomChainRequest } from "./client-membership";
import { buildRoomUpgradeHistory, selectVisibleRoomsForClient } from "./client-room-upgrade";
import { paginateEventTimelineRequest } from "./client-timeline-pagination";
import { createEncryptionUtils } from "./client-encryption-utils";
import {
    type CrossSigningKeys,
    type IClientWellKnown,
    type ICreateRoomKeyRequest,
    type IClaimOTKsResult,
    type IDownloadKeyResult,
    type IGetRoomKeyRequestsQuery,
    type IJoinedMembersResponse,
    type IJoinedRoomsResponse,
    type IOpenIDToken,
    type IPublicRoomsResponse,
    type IProtocol,
    type IPreviewUrlResponse,
    type IRoomKeyRequestCreateResponse,
    type IRoomKeyRequestsResponse,
    type IRequestMsisdnTokenResponse,
    type IRequestTokenResponse,
    type IRoomInitialSyncResponse,
    type ISecureBackupInfo,
    type ISecureBackupRestoreResponse,
    type ISecureBackupSessionKey,
    type ISecureBackupStoreKeysResponse,
    type ISecureBackupVerifyResponse,
    type IServerVersions,
    type ITurnServer,
    type ITurnServerResponse,
    type IUploadKeySignaturesResponse,
    type TimestampToEventResponse,
    type IUploadKeysRequest,
    type KeySignatures,
} from "./client-api-types";
import {
    type ICreateClientOpts,
    type IKeysUploadResponse,
    type IMatrixClientCreateOpts,
    type IStartClientOpts,
    type IStoredClientOpts,
} from "./client-config-types";
import {
    createSecureBackupRequest,
    deleteRoomKeyRequestHttpRequest,
    deleteSecureBackupRequest,
    getJoinedRoomMembersRequest,
    getJoinedRoomsRequest,
    getSSOUserInfoRequest,
    getClientConfigRequest,
    getOpenIdTokenRequest,
    getRoomKeyRequestsHttpRequest,
    getSecureBackupRequest,
    membersRequest,
    publicRoomsRequest,
    requestRoomKeyHttpRequest,
    restoreSecureBackupRequest,
    storeSecureBackupKeysRequest,
    timestampToEventRequest,
    verifySecureBackupPassphraseRequest,
} from "./client-request-delegates";
import { uploadDeviceSigningKeysHttpRequest } from "./client-crypto-requests";
import { createFileTreeSpaceRequest, getFileTreeSpaceReference } from "./client-room-access";
import { EventManager } from "./event/EventManager";

export type {
    IClientWellKnown,
    ICreateRoomKeyRequest,
    IDeviceSigningVerificationAcceptRequest,
    IDeviceSigningVerificationAcceptResponse,
    IDeviceSigningVerificationCancelRequest,
    IDeviceSigningVerificationCancelResponse,
    IDeviceSigningVerificationDoneRequest,
    IDeviceSigningVerificationDoneResponse,
    IDeviceSigningVerificationKeyAgreementRequest,
    IDeviceSigningVerificationKeyAgreementResponse,
    IDeviceSigningVerificationMacRequest,
    IDeviceSigningVerificationMacResponse,
    IDeviceSigningVerificationStartRequest,
    IDeviceSigningVerificationStartResponse,
    IClaimKeysRequest,
    IClaimOTKsResult,
    IDownloadKeyResult,
    IFieldType,
    IGetRoomKeyRequestsQuery,
    IInstance,
    IJoinedMembersResponse,
    IJoinedRoomsResponse,
    IMyDevice,
    IOpenIDToken,
    IPublicRoomsChunkRoom,
    IPublicRoomsResponse,
    IPreviewUrlResponse,
    IProtocol,
    IQueryKeysRequest,
    IRequestMsisdnTokenResponse,
    IRequestTokenResponse,
    IRoomKeyRequestCreateResponse,
    IRoomKeyRequestsResponse,
    IRoomInitialSyncResponse,
    IScanQrCodeRequest,
    IScanQrCodeResponse,
    ISecureBackupInfo,
    ISecureBackupRestoreResponse,
    ISecureBackupSessionKey,
    ISecureBackupStoreKeysResponse,
    ISecureBackupVerifyResponse,
    IShowQrCodeResponse,
    IServerVersions,
    ITurnServer,
    ITurnServerResponse,
    IUploadKeySignaturesResponse,
    RoomSummary,
    IVerificationRequestsResponse,
    IWellKnownConfig,
    KeySignatures,
    CrossSigningKeys,
    SendToDeviceContentMap,
    TimestampToEventResponse,
    RoomKeyRequestStatus,
    IUploadKeysRequest,
    Keys,
    SigningKeys,
} from "./client-api-types";
export { PendingEventOrdering } from "./client-config-types";
export type {
    ICreateClientOpts,
    IKeysUploadResponse,
    IMatrixClientCreateOpts,
    IStartClientOpts,
    IStoredClientOpts,
} from "./client-config-types";

export type Store = IStore;

export type ResetTimelineCallback = (roomId: string) => boolean;

const TURN_CHECK_INTERVAL = 10 * 60 * 1000; // poll for turn credentials every 10 minutes

export const UNSTABLE_MSC3852_LAST_SEEN_UA = new UnstableValue(
    "last_seen_user_agent",
    "org.matrix.msc3852.last_seen_user_agent",
);

export const GET_LOGIN_TOKEN_CAPABILITY = new NamespacedValue(
    "m.get_login_token",
    "org.matrix.msc3882.get_login_token",
);

export const UNSTABLE_MSC2666_SHARED_ROOMS = "uk.half-shot.msc2666";
export const UNSTABLE_MSC2666_MUTUAL_ROOMS = "uk.half-shot.msc2666.mutual_rooms";
export const UNSTABLE_MSC2666_QUERY_MUTUAL_ROOMS = "uk.half-shot.msc2666.query_mutual_rooms";

export const UNSTABLE_MSC4140_DELAYED_EVENTS = "org.matrix.msc4140";
export const UNSTABLE_MSC4354_STICKY_EVENTS = "org.matrix.msc4354";

export const UNSTABLE_MSC4133_EXTENDED_PROFILES = "uk.tcpip.msc4133";
export const STABLE_MSC4133_EXTENDED_PROFILES = "uk.tcpip.msc4133.stable";

// Re-export for backwards compatibility
export type IRegisterRequestParams = RegisterRequest;

// We're using this constant for methods overloading and inspect whether a variable
// contains an eventId or not. This was required to ensure backwards compatibility
// of methods for threads
// Probably not the most graceful solution but does a good enough job for now
const EVENT_ID_PREFIX = "$";

export enum ClientEvent {
    /**
     * Fires whenever the SDK's syncing state is updated. The state can be one of:
     * <ul>
     *
     * <li>PREPARED: The client has synced with the server at least once and is
     * ready for methods to be called on it. This will be immediately followed by
     * a state of SYNCING. <i>This is the equivalent of "syncComplete" in the
     * previous API.</i></li>
     *
     * <li>CATCHUP: The client has detected the connection to the server might be
     * available again and will now try to do a sync again. As this sync might take
     * a long time (depending how long ago was last synced, and general server
     * performance) the client is put in this mode so the UI can reflect trying
     * to catch up with the server after losing connection.</li>
     *
     * <li>SYNCING : The client is currently polling for new events from the server.
     * This will be called <i>after</i> processing latest events from a sync.</li>
     *
     * <li>ERROR : The client has had a problem syncing with the server. If this is
     * called <i>before</i> PREPARED then there was a problem performing the initial
     * sync. If this is called <i>after</i> PREPARED then there was a problem polling
     * the server for updates. This may be called multiple times even if the state is
     * already ERROR. <i>This is the equivalent of "syncError" in the previous
     * API.</i></li>
     *
     * <li>RECONNECTING: The sync connection has dropped, but not (yet) in a way that
     * should be considered erroneous.
     * </li>
     *
     * <li>STOPPED: The client has stopped syncing with server due to stopClient
     * being called.
     * </li>
     * </ul>
     * State transition diagram:
     * ```
     *                                          +---->STOPPED
     *                                          |
     *              +----->PREPARED -------> SYNCING <--+
     *              |                        ^  |  ^    |
     *              |      CATCHUP ----------+  |  |    |
     *              |        ^                  V  |    |
     *   null ------+        |  +------- RECONNECTING   |
     *              |        V  V                       |
     *              +------->ERROR ---------------------+
     *
     * NB: 'null' will never be emitted by this event.
     *
     * ```
     * Transitions:
     * <ul>
     *
     * <li>`null -> PREPARED` : Occurs when the initial sync is completed
     * first time. This involves setting up filters and obtaining push rules.
     *
     * <li>`null -> ERROR` : Occurs when the initial sync failed first time.
     *
     * <li>`ERROR -> PREPARED` : Occurs when the initial sync succeeds
     * after previously failing.
     *
     * <li>`PREPARED -> SYNCING` : Occurs immediately after transitioning
     * to PREPARED. Starts listening for live updates rather than catching up.
     *
     * <li>`SYNCING -> RECONNECTING` : Occurs when the live update fails.
     *
     * <li>`RECONNECTING -> RECONNECTING` : Can occur if the update calls
     * continue to fail, but the keepalive calls (to /versions) succeed.
     *
     * <li>`RECONNECTING -> ERROR` : Occurs when the keepalive call also fails
     *
     * <li>`ERROR -> SYNCING` : Occurs when the client has performed a
     * live update after having previously failed.
     *
     * <li>`ERROR -> ERROR` : Occurs when the client has failed to keepalive
     * for a second time or more.</li>
     *
     * <li>`SYNCING -> SYNCING` : Occurs when the client has performed a live
     * update. This is called <i>after</i> processing.</li>
     *
     * <li>`* -> STOPPED` : Occurs once the client has stopped syncing or
     * trying to sync after stopClient has been called.</li>
     * </ul>
     *
     * The payloads consits of the following 3 parameters:
     *
     * - state - An enum representing the syncing state. One of "PREPARED",
     * "SYNCING", "ERROR", "STOPPED".
     *
     * - prevState - An enum representing the previous syncing state.
     * One of "PREPARED", "SYNCING", "ERROR", "STOPPED" <b>or null</b>.
     *
     * - data - Data about this transition.
     *
     * @example
     * ```
     * matrixClient.on("sync", function(state, prevState, data) {
     *   switch (state) {
     *     case "ERROR":
     *       // update UI to say "Connection Lost"
     *       break;
     *     case "SYNCING":
     *       // update UI to remove any "Connection Lost" message
     *       break;
     *     case "PREPARED":
     *       // the client instance is ready to be queried.
     *       var rooms = matrixClient.getRooms();
     *       break;
     *   }
     * });
     * ```
     */
    Sync = "sync",
    /**
     * Fires whenever the SDK receives a new event.
     * <p>
     * This is only fired for live events received via /sync - it is not fired for
     * events received over context, search, or pagination APIs.
     *
     * The payload is the matrix event which caused this event to fire.
     * @example
     * ```
     * matrixClient.on("event", function(event){
     *   var sender = event.getSender();
     * });
     * ```
     */
    Event = "event",
    /** @deprecated Use {@link ReceivedToDeviceMessage}. */
    ToDeviceEvent = "toDeviceEvent",
    /**
     * Fires whenever the SDK receives a new (potentially decrypted) to-device message.
     * The payload is the to-device message and the encryption info for that message ({@link ReceivedToDeviceMessage}).
     * @example
     * ```
     * matrixClient.on("receivedToDeviceMessage", function(payload){
     *   const { message, encryptionInfo } = payload;
     *   var claimed_sender = encryptionInfo ? encryptionInfo.sender : message.sender;
     *   var isVerified = encryptionInfo ? encryptionInfo.verified : false;
     *   var type = message.type;
     * });
     */
    ReceivedToDeviceMessage = "receivedToDeviceMessage",
    /**
     * Fires whenever new user-scoped account_data is added.
     * The payload is a pair of event ({@link MatrixEvent}) describing the account_data just added, and the previous event, if known:
     *  - event: The event describing the account_data just added
     *  - oldEvent: The previous account data, if known.
     * @example
     * ```
     * matrixClient.on("accountData", function(event, oldEvent){
     *   myAccountData[event.type] = event.content;
     * });
     * ```
     */
    AccountData = "accountData",
    /**
     * Fires whenever a new Room is added. This will fire when you are invited to a
     * room, as well as when you join a room. <strong>This event is experimental and
     * may change.</strong>
     *
     * The payload is the newly created room, fully populated.
     * @example
     * ```
     * matrixClient.on("Room", function(room){
     *   var roomId = room.roomId;
     * });
     * ```
     */
    Room = "Room",
    /**
     * Fires whenever a Room is removed. This will fire when you forget a room.
     * <strong>This event is experimental and may change.</strong>
     * The payload is the roomId of the deleted room.
     * @example
     * ```
     * matrixClient.on("deleteRoom", function(roomId){
     *   // update UI from getRooms()
     * });
     * ```
     */
    DeleteRoom = "deleteRoom",
    SyncUnexpectedError = "sync.unexpectedError",
    /**
     * Fires when the client .well-known info is fetched.
     * The payload is the JSON object (see {@link IClientWellKnown}) returned by the server
     */
    ClientWellKnown = "WellKnown.client",
    ReceivedVoipEvent = "received_voip_event",
    TurnServers = "turnServers",
    TurnServersError = "turnServers.error",
}

type RoomEvents =
    | RoomEvent.Name
    | RoomEvent.Redaction
    | RoomEvent.RedactionCancelled
    | RoomEvent.Receipt
    | RoomEvent.Tags
    | RoomEvent.LocalEchoUpdated
    | RoomEvent.HistoryImportedWithinTimeline
    | RoomEvent.AccountData
    | RoomEvent.MyMembership
    | RoomEvent.Timeline
    | RoomEvent.TimelineReset;

type RoomStateEvents =
    | RoomStateEvent.Events
    | RoomStateEvent.Members
    | RoomStateEvent.NewMember
    | RoomStateEvent.Update
    | RoomStateEvent.Marker;

type CryptoEvents = (typeof CryptoEvent)[keyof typeof CryptoEvent];

type MatrixEventEvents = MatrixEventEvent.Decrypted | MatrixEventEvent.Replaced | MatrixEventEvent.VisibilityChange;

type RoomMemberEvents =
    | RoomMemberEvent.Name
    | RoomMemberEvent.Typing
    | RoomMemberEvent.PowerLevel
    | RoomMemberEvent.Membership;

type UserEvents =
    | UserEvent.AvatarUrl
    | UserEvent.DisplayName
    | UserEvent.Presence
    | UserEvent.CurrentlyActive
    | UserEvent.LastPresenceTs;

export type EmittedEvents =
    | ClientEvent
    | RoomEvents
    | RoomStateEvents
    | CryptoEvents
    | MatrixEventEvents
    | RoomMemberEvents
    | UserEvents
    | CallEvent // re-emitted by call.ts using Object.values
    | CallEventHandlerEvent.Incoming
    | GroupCallEventHandlerEvent.Incoming
    | GroupCallEventHandlerEvent.Outgoing
    | GroupCallEventHandlerEvent.Ended
    | GroupCallEventHandlerEvent.Participants
    | HttpApiEvent.SessionLoggedOut
    | HttpApiEvent.NoConsent
    | BeaconEvent;

export type ClientEventHandlerMap = {
    [ClientEvent.Sync]: (state: SyncState, prevState: SyncState | null, data?: ISyncStateData) => void;
    [ClientEvent.Event]: (event: MatrixEvent) => void;
    [ClientEvent.ToDeviceEvent]: (event: MatrixEvent) => void;
    [ClientEvent.ReceivedToDeviceMessage]: (payload: ReceivedToDeviceMessage) => void;
    [ClientEvent.AccountData]: (event: MatrixEvent, lastEvent?: MatrixEvent) => void;
    [ClientEvent.Room]: (room: Room) => void;
    [ClientEvent.DeleteRoom]: (roomId: string) => void;
    [ClientEvent.SyncUnexpectedError]: (error: Error) => void;
    [ClientEvent.ClientWellKnown]: (data: IClientWellKnown) => void;
    [ClientEvent.ReceivedVoipEvent]: (event: MatrixEvent) => void;
    [ClientEvent.TurnServers]: (servers: ITurnServer[]) => void;
    [ClientEvent.TurnServersError]: (error: Error, fatal: boolean) => void;
} & RoomEventHandlerMap &
    RoomStateEventHandlerMap &
    CryptoEventHandlerMap &
    MatrixEventHandlerMap &
    RoomMemberEventHandlerMap &
    UserEventHandlerMap &
    CallEventHandlerEventHandlerMap &
    GroupCallEventHandlerEventHandlerMap &
    CallEventHandlerMap &
    HttpApiEventHandlerMap &
    BeaconEventHandlerMap;

/**
 * Represents a Matrix Client. Only directly construct this if you want to use
 * custom modules. Normally, {@link createClient} should be used
 * as it specifies 'sensible' defaults for these modules.
 */

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface MatrixClient extends MatrixClientExtensionMethods, MatrixClientInternalMethods {}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class MatrixClient extends TypedEventEmitter<EmittedEvents, ClientEventHandlerMap> {
    public static readonly RESTORE_BACKUP_ERROR_BAD_KEY = "RESTORE_BACKUP_ERROR_BAD_KEY";

    private readonly logger: Logger;

    public reEmitter = new TypedReEmitter<EmittedEvents, ClientEventHandlerMap>(this);
    public olmVersion: [number, number, number] | null = null; // populated after initLegacyCrypto
    public usingExternalCrypto = false;
    private _store!: Store;
    public deviceId: string | null;
    public credentials: { userId: string | null };

    /**
     * Encryption key used for encrypting sensitive data (such as e2ee keys) in storage.
     *
     * As supplied in the constructor via {@link IMatrixClientCreateOpts#pickleKey}.
     * Used for migration from the legacy crypto to the rust crypto
     */
    private readonly legacyPickleKey?: string;

    public scheduler?: MatrixScheduler;
    public clientRunning = false;
    public timelineSupport = false;
    public urlPreviewCache = new LRUCache<IPreviewUrlResponse>(100, 3600000);
    private readonly publicRoomsCache = new LRUCache<IPublicRoomsResponse>(50, 30_000);
    private readonly publicRoomsRequestCache = new InflightRequestCache<IPublicRoomsResponse>(this.publicRoomsCache);
    public identityServer?: IIdentityServerProvider;
    public http: MatrixHttpApi<IHttpOpts & { onlyData: true }>; // Intended private, used in code.
    private readonly authedRequestProxy = <T>(
        method: Method,
        path: string,
        queryParams?: QueryDict,
        body?: Body,
        requestOpts?: IRequestOpts,
    ): Promise<T> => this.http.authedRequest(method, path, queryParams, body, requestOpts);

    private cryptoBackend?: CryptoBackend; // one of crypto or rustCrypto

    /**
     * Support MSC4362: Simplified Encrypted State Events.
     *
     * The client must be recreated for changes to this setting to take effect
     * reliably.
     *
     * When this setting is true, if we find a state event that is encrypted
     * (within a room that supports encrypted state), we will attempt to decrypt
     * it as specified in MSC4362. If the user was in the room at the time an
     * encrypted state event was received (meaning we have the key), even if
     * this setting was set to false at the time it was received, recreating the
     * client with this setting set to true will allow decrypting that event.
     *
     * When this setting is false, any state event that is encrypted will not be
     * decrypted, meaning it will have no effect. This matched the behaviour of
     * a client that does not support MSC4362.
     */
    public enableEncryptedStateEvents: boolean;

    public cryptoCallbacks: CryptoCallbacks; // Intended private, used in code.
    public callEventHandler?: CallEventHandler; // Intended private, used in code.
    public groupCallEventHandler?: GroupCallEventHandler;
    public supportsCallTransfer = false; // Intended private, used in code.
    public forceTURN = false; // Intended private, used in code.
    public iceCandidatePoolSize = 0; // Intended private, used in code.
    public idBaseUrl?: string;
    public baseUrl: string;
    public readonly isVoipWithNoMediaAllowed;
    public disableVoip: boolean;

    public useLivekitForGroupCalls: boolean;

    // Note: these are all `protected` to let downstream consumers make mistakes if they want to.
    // We don't technically support this usage, but have reasons to do this.

    protected canSupportVoip = false;
    protected peekSync: SyncApi | null = null;
    protected isGuestAccount = false;

    /**
     * Legacy crypto store used for migration from the legacy crypto to the rust crypto
     * @private
     */
    private readonly legacyCryptoStore?: CryptoStore;
    protected verificationMethods?: string[];
    protected fallbackICEServerAllowed = false;
    protected syncApi?: SlidingSyncSdk | SyncApi;
    public roomNameGenerator?: ICreateClientOpts["roomNameGenerator"];
    public pushRules?: IPushRules;
    protected syncLeftRoomsPromise?: Promise<Room[]>;
    protected syncedLeftRooms = false;
    protected clientOpts?: IStoredClientOpts;
    protected clientWellKnownIntervalID?: ReturnType<typeof setInterval>;
    protected canResetTimelineCallback?: ResetTimelineCallback;

    public canSupport = new Map<Feature, ServerSupport>();

    // The pushprocessor caches useful things, so keep one and re-use it
    public readonly pushProcessor = new PushProcessor(this);

    // Promise to a response of the server's /versions response
    // Tracking issue: https://github.com/matrix-org/matrix-js-sdk/issues/1020
    protected serverVersionsPromise?: Promise<IServerVersions>;

    protected clientWellKnown?: IClientWellKnown;
    protected clientWellKnownPromise?: Promise<IClientWellKnown>;
    protected turnServers: ITurnServer[] = [];
    protected turnServersExpiry = 0;
    protected checkTurnServersIntervalID?: ReturnType<typeof setInterval>;
    protected txnCtr = 0;
    protected mediaHandler = new MediaHandler(this);
    protected sessionId: string;

    /** IDs of events which are currently being encrypted.
     *
     * This is part of the cancellation mechanism: if the event is no longer listed here when encryption completes,
     * that tells us that it has been cancelled, and we should not send it.
     */
    private eventsBeingEncrypted = new Set<string>();

    private useE2eForGroupCall = true;
    private toDeviceMessageQueue: ToDeviceMessageQueue;
    public livekitServiceURL?: string;

    private _secretStorage: ServerSideSecretStorageImpl;

    private _encryptionUtils: ReturnType<typeof createEncryptionUtils> | null = null;
    private eventManager: EventManager | null = null;

    private get encryptionUtils(): ReturnType<typeof createEncryptionUtils> {
        if (!this._encryptionUtils) {
            this._encryptionUtils = createEncryptionUtils(this);
        }
        return this._encryptionUtils;
    }

    // A manager for determining which invites should be ignored.
    public readonly ignoredInvites: IgnoredInvites;

    public readonly matrixRTC: MatrixRTCSessionManager;

    private serverCapabilitiesService: ServerCapabilities;

    public constructor(opts: IMatrixClientCreateOpts) {
        super();

        // If a custom logger is provided, use it. Otherwise, default to the global
        // one in logger.ts.
        this.logger = opts.logger ?? logger;

        opts.baseUrl = utils.ensureNoTrailingSlash(opts.baseUrl);
        opts.idBaseUrl = utils.ensureNoTrailingSlash(opts.idBaseUrl);

        this.baseUrl = opts.baseUrl;
        this.idBaseUrl = opts.idBaseUrl;
        this.identityServer = opts.identityServer;

        this.usingExternalCrypto = opts.usingExternalCrypto ?? false;
        this.store = opts.store || new StubStore();
        this.deviceId = opts.deviceId || null;
        this.sessionId = secureRandomString(10);

        const userId = opts.userId || null;
        this.credentials = { userId };

        this.http = new MatrixHttpApi(this as ConstructorParameters<typeof MatrixHttpApi>[0], {
            fetchFn: opts.fetchFn,
            baseUrl: opts.baseUrl,
            idBaseUrl: opts.idBaseUrl,
            allowInsecureHttp: opts.allowInsecureHttp,
            accessToken: opts.accessToken,
            refreshToken: opts.refreshToken,
            tokenRefreshFunction: opts.tokenRefreshFunction,
            prefix: ClientPrefix.V3,
            onlyData: true,
            extraParams: opts.queryParams,
            localTimeoutMs: opts.localTimeoutMs,
            useAuthorizationHeader: opts.useAuthorizationHeader,
            logger: this.logger,
        });

        if (opts.pickleKey) {
            this.legacyPickleKey = opts.pickleKey;
        }

        this.useLivekitForGroupCalls = Boolean(opts.useLivekitForGroupCalls);

        this.scheduler = opts.scheduler;
        if (this.scheduler) {
            this.scheduler.setProcessFunction(async (eventToSend: MatrixEvent) => {
                const room = this.getRoom(eventToSend.getRoomId());
                if (eventToSend.status !== EventStatus.SENDING) {
                    this.updatePendingEventStatus(room, eventToSend, EventStatus.SENDING);
                }
                const res = await this.sendEventHttpRequest(eventToSend);
                if (room) {
                    // ensure we update pending event before the next scheduler run so that any listeners to event id
                    // updates on the synchronous event emitter get a chance to run first.
                    room.updatePendingEvent(eventToSend, EventStatus.SENT, res.event_id);
                }
                return res;
            });
        }

        this.disableVoip = opts.disableVoip ?? false;

        if (!this.disableVoip && supportsMatrixCall()) {
            this.callEventHandler = new CallEventHandler(this);
            this.groupCallEventHandler = new GroupCallEventHandler(this);
            this.canSupportVoip = true;
            // Start listening for calls after the initial sync is done
            // We do not need to backfill the call event buffer
            // with encrypted events that might never get decrypted
            this.on(ClientEvent.Sync, this.startCallEventHandler);
        }

        // NB. We initialise MatrixRTC whether we have call support or not: this is just
        // the underlying session management and doesn't use any actual media capabilities
        this.matrixRTC = new MatrixRTCSessionManager(this.logger, this);

        this.serverCapabilitiesService = new ServerCapabilities(this.logger, this.http);

        this.on(ClientEvent.Sync, this.fixupRoomNotifications);

        this.timelineSupport = Boolean(opts.timelineSupport);

        this.legacyCryptoStore = opts.cryptoStore;
        this.verificationMethods = opts.verificationMethods;
        this.cryptoCallbacks = opts.cryptoCallbacks || {};
        this.enableEncryptedStateEvents = opts.enableEncryptedStateEvents ?? false;

        this.forceTURN = opts.forceTURN || false;
        this.iceCandidatePoolSize = opts.iceCandidatePoolSize === undefined ? 0 : opts.iceCandidatePoolSize;
        this.supportsCallTransfer = opts.supportsCallTransfer || false;
        this.fallbackICEServerAllowed = opts.fallbackICEServerAllowed || false;
        this.isVoipWithNoMediaAllowed = opts.isVoipWithNoMediaAllowed || false;

        if (opts.useE2eForGroupCall !== undefined) this.useE2eForGroupCall = opts.useE2eForGroupCall;

        this.livekitServiceURL = opts.livekitServiceURL;

        this.roomNameGenerator = opts.roomNameGenerator;

        this.toDeviceMessageQueue = new ToDeviceMessageQueue(this, this.logger);

        // The SDK doesn't really provide a clean way for events to recalculate the push
        // actions for themselves, so we have to kinda help them out when they are encrypted.
        // We do this so that push rules are correctly executed on events in their decrypted
        // state, such as highlights when the user's name is mentioned.
        this.on(MatrixEventEvent.Decrypted, (event) => {
            fixNotificationCountOnDecryption(this, event);
        });

        this.ignoredInvites = new IgnoredInvites(this);
        this._secretStorage = new ServerSideSecretStorageImpl(this, opts.cryptoCallbacks ?? {});

        // having lots of event listeners is not unusual. 0 means "unlimited".
        this.setMaxListeners(0);
    }

    public set store(newStore: Store) {
        this._store = newStore;
        this._store.setUserCreator((userId) => User.createUser(userId, this));
    }

    public getEventManager(): EventManager {
        if (!this.eventManager) {
            this.eventManager = new EventManager(this);
        }
        return this.eventManager;
    }

    public get store(): Store {
        return this._store;
    }

    /**
     * High level helper method to begin syncing and poll for new events. To listen for these
     * events, add a listener for {@link ClientEvent.Event}
     * via {@link MatrixClient#on}. Alternatively, listen for specific
     * state change events.
     * @param opts - Options to apply when syncing.
     */
    public async startClient(opts?: IStartClientOpts): Promise<void> {
        if (this.clientRunning) {
            // client is already running.
            return;
        }
        this.clientRunning = true;

        this.on(ClientEvent.Sync, this.startMatrixRTC);

        // Create our own user object artificially (instead of waiting for sync)
        // so it's always available, even if the user is not in any rooms etc.
        const userId = this.getUserId();
        if (userId) {
            this.store.storeUser(new User(userId));
        }

        // periodically poll for turn servers if we support voip
        if (this.supportsVoip()) {
            this.checkTurnServersIntervalID = setInterval(() => {
                this.checkTurnServers();
            }, TURN_CHECK_INTERVAL);
            // noinspection ES6MissingAwait
            this.checkTurnServers();
        }

        if (this.syncApi) {
            // This shouldn't happen since we thought the client was not running
            this.logger.error("Still have sync object whilst not running: stopping old one");
            this.syncApi.stop();
        }

        try {
            await this.getVersions();

            // This should be done with `canSupport`
            // Tracking issue: https://github.com/vector-im/element-web/issues/23643
            const { threads, list, fwdPagination } = await this.doesServerSupportThread();
            Thread.setServerSideSupport(threads);
            Thread.setServerSideListSupport(list);
            Thread.setServerSideFwdPaginationSupport(fwdPagination);
        } catch (e) {
            this.logger.error(
                "Can't fetch server versions, continuing to initialise sync, this will be retried later",
                e,
            );
        }

        this.clientOpts = opts ?? {};
        if (this.clientOpts.slidingSync) {
            this.syncApi = new SlidingSyncSdk(
                this.clientOpts.slidingSync,
                this,
                this.clientOpts,
                this.buildSyncApiOptions(),
            );
        } else {
            this.syncApi = new SyncApi(this, this.clientOpts, this.buildSyncApiOptions());
        }

        this.syncApi.sync().catch((e) => this.logger.info("Sync startup aborted with an error:", e));

        if (this.clientOpts.clientWellKnownPollPeriod !== undefined) {
            this.clientWellKnownIntervalID = setInterval(() => {
                this.fetchClientWellKnown();
            }, 1000 * this.clientOpts.clientWellKnownPollPeriod);
            this.fetchClientWellKnown();
        }

        this.toDeviceMessageQueue.start();
        this.serverCapabilitiesService.start();
    }

    /**
     * Construct a SyncApiOptions for this client, suitable for passing into the SyncApi constructor
     */
    protected buildSyncApiOptions(): SyncApiOptions {
        return {
            cryptoCallbacks: this.cryptoBackend,
            canResetEntireTimeline: (roomId: string): boolean => {
                if (!this.canResetTimelineCallback) {
                    return false;
                }
                return this.canResetTimelineCallback(roomId);
            },
            logger: this.logger.getChild("sync"),
        };
    }

    /**
     * High level helper method to stop the client from polling and allow a
     * clean shutdown.
     */
    public stopClient(): void {
        this.cryptoBackend?.stop(); // crypto might have been initialised even if the client wasn't fully started

        this.off(ClientEvent.Sync, this.startMatrixRTC);

        if (!this.clientRunning) return; // already stopped

        this.logger.debug("stopping MatrixClient");

        this.clientRunning = false;

        this.syncApi?.stop();
        this.syncApi = undefined;

        this.peekSync?.stopPeeking();

        this.callEventHandler?.stop();
        this.groupCallEventHandler?.stop();
        this.callEventHandler = undefined;
        this.groupCallEventHandler = undefined;

        globalThis.clearInterval(this.checkTurnServersIntervalID);
        this.checkTurnServersIntervalID = undefined;

        if (this.clientWellKnownIntervalID !== undefined) {
            globalThis.clearInterval(this.clientWellKnownIntervalID);
        }

        this.toDeviceMessageQueue.stop();

        this.matrixRTC.stop();

        this.serverCapabilitiesService.stop();
    }

    /**
     * Clear any data out of the persistent stores used by the client.
     *
     * @param args.cryptoDatabasePrefix - The database name to use for indexeddb, defaults to 'matrix-js-sdk'.
     * @returns Promise which resolves when the stores have been cleared.
     */
    public async clearStores(
        args: {
            cryptoDatabasePrefix?: string;
        } = {},
    ): Promise<void> {
        if (this.clientRunning) {
            throw new Error("Cannot clear stores while client is running");
        }

        const promises: Promise<void>[] = [];

        promises.push(this.store.deleteAllData());
        if (this.legacyCryptoStore) {
            promises.push(this.legacyCryptoStore.deleteAllData());
        }

        // delete the stores used by the rust matrix-sdk-crypto, in case they were used
        const deleteRustSdkStore = async (): Promise<void> => {
            let indexedDB: IDBFactory;
            try {
                indexedDB = globalThis.indexedDB;
                if (!indexedDB) return; // No indexedDB support
            } catch {
                // No indexedDB support
                return;
            }
            for (const dbname of [
                `${args.cryptoDatabasePrefix ?? RUST_SDK_STORE_PREFIX}::matrix-sdk-crypto`,
                `${args.cryptoDatabasePrefix ?? RUST_SDK_STORE_PREFIX}::matrix-sdk-crypto-meta`,
            ]) {
                const prom = new Promise((resolve) => {
                    this.logger.info(`Removing IndexedDB instance ${dbname}`);
                    const req = indexedDB.deleteDatabase(dbname);
                    req.onsuccess = (_): void => {
                        this.logger.info(`Removed IndexedDB instance ${dbname}`);
                        resolve(0);
                    };
                    req.onerror = (e): void => {
                        // In private browsing, Firefox has a globalThis.indexedDB, but attempts to delete an indexeddb
                        // (even a non-existent one) fail with "DOMException: A mutation operation was attempted on a
                        // database that did not allow mutations."
                        //
                        // it seems like the only thing we can really do is ignore the error.
                        this.logger.warn(`Failed to remove IndexedDB instance ${dbname}:`, e);
                        resolve(0);
                    };
                    req.onblocked = (): void => {
                        this.logger.info(`cannot yet remove IndexedDB instance ${dbname}`);
                    };
                });
                await prom;
            }
        };
        promises.push(deleteRustSdkStore());

        await Promise.all(promises);
    }

    /**
     * Get the user-id of the logged-in user
     *
     * @returns MXID for the logged-in user, or null if not logged in
     */
    public getUserId(): string | null {
        return this.getCredentialsManager().getUserId();
    }

    /**
     * Get the user-id of the logged-in user
     *
     * @returns MXID for the logged-in user
     * @throws Error if not logged in
     */
    public getSafeUserId(): string {
        const userId = this.getCredentialsManager().getUserId();
        if (!userId) {
            throw new Error("Expected logged in user but found none.");
        }
        return userId;
    }

    /**
     * Get the domain for this client's MXID
     * @returns Domain of this MXID
     */
    public getDomain(): string | null {
        const userId = this.getCredentialsManager().getUserId();
        if (userId) {
            return userId.split(":")[1] || null;
        }
        return null;
    }

    /**
     * Get the local part of the current user ID e.g. "foo" in "\@foo:bar".
     * @returns The user ID localpart or null.
     */
    public getUserIdLocalpart(): string | null {
        return this.credentials?.userId?.split(":")[0].substring(1) ?? null;
    }

    /**
     * Get the device ID of this client
     * @returns device ID
     */
    public getDeviceId(): string | null {
        return this.getCredentialsManager().getDeviceId() ?? null;
    }

    /**
     * Get the session ID of this client
     * @returns session ID
     */
    public getSessionId(): string {
        return this.sessionId;
    }

    /**
     * Check if the runtime environment supports VoIP calling.
     * @returns True if VoIP is supported.
     */
    public supportsVoip(): boolean {
        return !this.disableVoip && this.canSupportVoip;
    }

    /**
     * @returns
     */
    public getMediaHandler(): MediaHandler {
        return this.mediaHandler;
    }

    /**
     * Set whether VoIP calls are forced to use only TURN
     * candidates. This is the same as the forceTURN option
     * when creating the client.
     * @param force - True to force use of TURN servers
     */
    public setForceTURN(force: boolean): void {
        this.forceTURN = force;
    }

    /**
     * Set whether to advertise transfer support to other parties on Matrix calls.
     * @param support - True to advertise the 'm.call.transferee' capability
     */
    public setSupportsCallTransfer(support: boolean): void {
        this.supportsCallTransfer = support;
    }

    /**
     * Returns true if to-device signalling for group calls will be encrypted with Olm.
     * If false, it will be sent unencrypted.
     * @returns boolean Whether group call signalling will be encrypted
     */
    public getUseE2eForGroupCall(): boolean {
        return this.useE2eForGroupCall;
    }

    /**
     * Creates a new call.
     * The place*Call methods on the returned call can be used to actually place a call
     *
     * @param roomId - The room the call is to be placed in.
     * @returns the call or null if the browser doesn't support calling.
     */
    public createCall(roomId: string): MatrixCall | null {
        return createNewMatrixCall(this, roomId);
    }

    /**
     * Creates a new group call and sends the associated state event
     * to alert other members that the room now has a group call.
     *
     * @param roomId - The room the call is to be placed in.
     */
    public async createGroupCall(
        roomId: string,
        type: GroupCallType,
        isPtt: boolean,
        intent: GroupCallIntent,
        dataChannelsEnabled?: boolean,
        dataChannelOptions?: IGroupCallDataChannelOptions,
    ): Promise<GroupCall> {
        if (this.getGroupCallForRoom(roomId)) {
            throw new Error(`${roomId} already has an existing group call`);
        }

        const room = this.getRoom(roomId);

        if (!room) {
            throw new Error(`Cannot find room ${roomId}`);
        }

        // Because without Media section a WebRTC connection is not possible, so need a RTCDataChannel to set up a
        // no media WebRTC connection anyway.
        return new GroupCall(
            this,
            room,
            type,
            isPtt,
            intent,
            undefined,
            dataChannelsEnabled || this.isVoipWithNoMediaAllowed,
            dataChannelOptions,
            this.isVoipWithNoMediaAllowed,
            this.useLivekitForGroupCalls,
            this.livekitServiceURL,
        ).create();
    }

    public getLivekitServiceURL(): string | undefined {
        return this.livekitServiceURL;
    }

    // This shouldn't need to exist, but the widget API has startup ordering problems that
    // mean it doesn't know the livekit URL fast enough: remove this once this is fixed.
    public setLivekitServiceURL(newURL: string): void {
        this.livekitServiceURL = newURL;
    }

    /**
     * Wait until an initial state for the given room has been processed by the
     * client and the client is aware of any ongoing group calls. Awaiting on
     * the promise returned by this method before calling getGroupCallForRoom()
     * avoids races where getGroupCallForRoom is called before the state for that
     * room has been processed. It does not, however, fix other races, eg. two
     * clients both creating a group call at the same time.
     * @param roomId - The room ID to wait for
     * @returns A promise that resolves once existing group calls in the room
     *          have been processed.
     */
    public waitUntilRoomReadyForGroupCalls(roomId: string): Promise<void> {
        return this.groupCallEventHandler!.waitUntilRoomReadyForGroupCalls(roomId);
    }

    /**
     * Get an existing group call for the provided room.
     * @returns The group call or null if it doesn't already exist.
     */
    public getGroupCallForRoom(roomId: string): GroupCall | null {
        return this.groupCallEventHandler!.groupCalls.get(roomId) || null;
    }

    /**
     * Get the current sync state.
     * @returns the sync state, which may be null.
     * @see MatrixClient#event:"sync"
     */
    public getSyncState(): SyncState | null {
        return this.getSyncManager().getSyncState();
    }

    /**
     * Returns the additional data object associated with
     * the current sync state, or null if there is no
     * such data.
     * Sync errors, if available, are put in the 'error' key of
     * this object.
     */
    public getSyncStateData(): ISyncStateData | null {
        return this.getSyncManager().getSyncStateData();
    }

    /**
     * Whether the initial sync has completed.
     * @returns True if at least one sync has happened.
     */
    public isInitialSyncComplete(): boolean {
        const state = this.getSyncState();
        if (!state) {
            return false;
        }
        return state === SyncState.Prepared || state === SyncState.Syncing;
    }

    /**
     * Return whether the client is configured for a guest account.
     * @returns True if this is a guest access_token (or no token is supplied).
     */
    public isGuest(): boolean {
        return this.isGuestAccount;
    }

    /**
     * Set whether this client is a guest account. <b>This method is experimental
     * and may change without warning.</b>
     * @param guest - True if this is a guest account.
     * @experimental if the token is a macaroon, it should be encoded in it that it is a 'guest'
     * access token, which means that the SDK can determine this entirely without
     * the dev manually flipping this flag.
     */
    public setGuest(guest: boolean): void {
        this.isGuestAccount = guest;
    }

    /**
     * Return the provided scheduler, if any.
     * @returns The scheduler or undefined
     */
    public getScheduler(): MatrixScheduler | undefined {
        return this.scheduler;
    }

    /**
     * Retry a backed off syncing request immediately. This should only be used when
     * the user <b>explicitly</b> attempts to retry their lost connection.
     * Will also retry any outbound to-device messages currently in the queue to be sent
     * (retries of regular outgoing events are handled separately, per-event).
     * @returns True if this resulted in a request being retried.
     */
    public retryImmediately(): boolean {
        // don't await for this promise: we just want to kick it off
        this.toDeviceMessageQueue.sendQueue();
        return this.syncApi?.retryImmediately() ?? false;
    }

    /**
     * Return the global notification EventTimelineSet, if any
     *
     * @returns the globl notification EventTimelineSet
     */
    public getNotifTimelineSet(): EventTimelineSet | null {
        return this.getNotificationsManager().getNotifTimelineSet();
    }

    /**
     * Set the global notification EventTimelineSet
     *
     */
    public setNotifTimelineSet(set: EventTimelineSet): void {
        this.getNotificationsManager().setNotifTimelineSet(set);
    }

    /**
     * Gets the cached capabilities of the homeserver, returning cached ones if available.
     * If there are no cached capabilities and none can be fetched, throw an exception.
     *
     * @returns Promise resolving with The capabilities of the homeserver
     */
    public async getCapabilities(): Promise<Capabilities> {
        const caps = this.serverCapabilitiesService.getCachedCapabilities();
        if (caps) return caps;
        return this.serverCapabilitiesService.fetchCapabilities();
    }

    /**
     * Gets the cached capabilities of the homeserver. If none have been fetched yet,
     * return undefined.
     *
     * @returns The capabilities of the homeserver
     */
    public getCachedCapabilities(): Capabilities | undefined {
        return this.serverCapabilitiesService.getCachedCapabilities();
    }

    /**
     * Fetches the latest capabilities from the homeserver, ignoring any cached
     * versions. The newly returned version is cached.
     *
     * @returns A promise which resolves to the capabilities of the homeserver
     */
    public fetchCapabilities(): Promise<Capabilities> {
        return this.serverCapabilitiesService.fetchCapabilities();
    }

    /**
     * Initialise support for end-to-end encryption in this client, using the rust matrix-sdk-crypto.
     *
     * **WARNING**: the cryptography stack is not thread-safe. Having multiple `MatrixClient` instances connected to
     * the same Indexed DB will cause data corruption and decryption failures. The application layer is responsible for
     * ensuring that only one `MatrixClient` issue is instantiated at a time.
     *
     * @param args.useIndexedDB - True to use an indexeddb store, false to use an in-memory store. Defaults to 'true'.
     * @param args.cryptoDatabasePrefix - The database name to use for indexeddb, defaults to 'matrix-js-sdk'.
     *    Unused if useIndexedDB is 'false'.
     * @param args.storageKey - A key with which to encrypt the indexeddb store. If provided, it must be exactly
     *    32 bytes of data, and must be the same each time the client is initialised for a given device.
     *    If both this and `storagePassword` are unspecified, the store will be unencrypted.
     * @param args.storagePassword - An alternative to `storageKey`. A password which will be used to derive a key to
     *    encrypt the store with. Deriving a key from a password is (deliberately) a slow operation, so prefer
     *    to pass a `storageKey` directly where possible.
     *
     * @returns a Promise which will resolve when the crypto layer has been
     *    successfully initialised.
     */
    public async initRustCrypto(
        args: {
            useIndexedDB?: boolean;
            cryptoDatabasePrefix?: string;
            storageKey?: Uint8Array;
            storagePassword?: string;
        } = {},
    ): Promise<void> {
        if (this.cryptoBackend) {
            this.logger.warn("Attempt to re-initialise e2e encryption on MatrixClient");
            return;
        }

        const userId = this.getUserId();
        if (userId === null) {
            throw new Error(
                `Cannot enable encryption on MatrixClient with unknown userId: ` +
                    `ensure userId is passed in createClient().`,
            );
        }
        const deviceId = this.getDeviceId();
        if (deviceId === null) {
            throw new Error(
                `Cannot enable encryption on MatrixClient with unknown deviceId: ` +
                    `ensure deviceId is passed in createClient().`,
            );
        }

        // importing rust-crypto will download the webassembly, so we delay it until we know it will be
        // needed.
        this.logger.debug("Downloading Rust crypto library");
        const RustCrypto = await import("./rust-crypto/index");

        const rustCrypto = await RustCrypto.initRustCrypto({
            logger: this.logger,
            http: this.http,
            userId: userId,
            deviceId: deviceId,
            secretStorage: this.secretStorage,
            cryptoCallbacks: this.cryptoCallbacks,
            storePrefix: args.useIndexedDB === false ? null : (args.cryptoDatabasePrefix ?? RUST_SDK_STORE_PREFIX),
            storeKey: args.storageKey,
            storePassphrase: args.storagePassword,

            legacyCryptoStore: this.legacyCryptoStore,
            legacyPickleKey: this.legacyPickleKey ?? "DEFAULT_KEY",
            legacyMigrationProgressListener: (progress: number, total: number): void => {
                this.emit(CryptoEvent.LegacyCryptoStoreMigrationProgress, progress, total);
            },

            enableEncryptedStateEvents: this.enableEncryptedStateEvents,
        });

        rustCrypto.setSupportedVerificationMethods(this.verificationMethods);

        this.cryptoBackend = rustCrypto;

        // attach the event listeners needed by RustCrypto
        this.on(RoomMemberEvent.Membership, rustCrypto.onRoomMembership.bind(rustCrypto));
        this.on(ClientEvent.Event, (event) => {
            rustCrypto.onLiveEventFromSync(event);
        });

        // re-emit the events emitted by the crypto impl
        this.reEmitter.reEmit(rustCrypto, [
            CryptoEvent.VerificationRequestReceived,
            CryptoEvent.UserTrustStatusChanged,
            CryptoEvent.KeyBackupStatus,
            CryptoEvent.KeyBackupSessionsRemaining,
            CryptoEvent.KeyBackupFailed,
            CryptoEvent.KeyBackupDecryptionKeyCached,
            CryptoEvent.KeysChanged,
            CryptoEvent.DevicesUpdated,
            CryptoEvent.WillUpdateDevices,
            CryptoEvent.DehydratedDeviceCreated,
            CryptoEvent.DehydratedDeviceUploaded,
            CryptoEvent.RehydrationStarted,
            CryptoEvent.RehydrationProgress,
            CryptoEvent.RehydrationCompleted,
            CryptoEvent.RehydrationError,
            CryptoEvent.DehydrationKeyCached,
            CryptoEvent.DehydratedDeviceRotationError,
        ]);
    }

    /**
     * Access the server-side secret storage API for this client.
     */
    public get secretStorage(): ServerSideSecretStorage {
        return this._secretStorage;
    }

    /**
     * Access the crypto API for this client.
     *
     * If end-to-end encryption has been enabled for this client (via {@link initRustCrypto}),
     * returns an object giving access to the crypto API. Otherwise, returns `undefined`.
     */
    public getCrypto(): CryptoApi | undefined {
        return this.cryptoBackend;
    }

    /**
     * Get the crypto backend instance.
     * This is intended for internal use by managers that need direct access to crypto functionality.
     * @returns The crypto backend instance, or undefined if crypto is not enabled.
     * @internal
     */
    public getCryptoBackend(): CryptoBackend | undefined {
        return this.cryptoBackend;
    }

    /**
     * Get the stored client options.
     * This is intended for internal use by managers that need access to client configuration.
     * @returns The stored client options, or undefined if not set.
     * @internal
     */
    public getClientOpts(): IStoredClientOpts | undefined {
        return this.clientOpts;
    }

    /**
     * Build sync API options for this client.
     * This is intended for internal use by managers that need to create SyncApi instances.
     * @returns The sync API options.
     * @internal
     */
    public getSyncApiOptions(): SyncApiOptions {
        return this.buildSyncApiOptions();
    }

    /**
     * Check whether the key backup private key is stored in secret storage.
     * @returns map of key name to key info the secret is
     *     encrypted with, or null if it is not present or not encrypted with a
     *     trusted key
     */
    public isKeyBackupKeyStored(): Promise<Record<string, SecretStorageKeyDescription> | null> {
        return Promise.resolve(this.secretStorage.isStored("m.megolm_backup.v1"));
    }

    private makeKeyBackupPath(roomId?: string, sessionId?: string, version?: string): IKeyBackupPath {
        let path: string;
        if (sessionId !== undefined) {
            path = utils.encodeUri("/room_keys/keys/$roomId/$sessionId", {
                $roomId: roomId!,
                $sessionId: sessionId,
            });
        } else if (roomId !== undefined) {
            path = utils.encodeUri("/room_keys/keys/$roomId", {
                $roomId: roomId,
            });
        } else {
            path = "/room_keys/keys";
        }
        const queryData = version === undefined ? undefined : { version };
        return { path, queryData };
    }

    public deleteKeysFromBackup(roomId: undefined, sessionId: undefined, version?: string): Promise<void>;
    public deleteKeysFromBackup(roomId: string, sessionId: undefined, version?: string): Promise<void>;
    public deleteKeysFromBackup(roomId: string, sessionId: string, version?: string): Promise<void>;
    public async deleteKeysFromBackup(roomId?: string, sessionId?: string, version?: string): Promise<void> {
        const path = this.makeKeyBackupPath(roomId!, sessionId!, version);
        await this.http.authedRequest(Method.Delete, path.path, path.queryData, undefined, { prefix: ClientPrefix.V3 });
    }

    /**
     * Get the config for the media repository.
     *
     * @param useAuthenticatedMedia - If true, the caller supports authenticated
     * media and wants an authentication-required URL. Note that server support
     * for authenticated media will *not* be checked - it is the caller's responsibility
     * to do so before calling this function.
     *
     * @returns Promise which resolves with an object containing the config.
     */
    public getMediaConfig(useAuthenticatedMedia: boolean = false): Promise<IMediaConfig> {
        return this.getMediaManager().getMediaConfig(useAuthenticatedMedia);
    }

    /**
     * Get the room for the given room ID.
     * This function will return a valid room for any room for which a Room event
     * has been emitted. Note in particular that other events, eg. RoomState.members
     * will be emitted for a room before this function will return the given room.
     * @param roomId - The room ID
     * @returns The Room or null if it doesn't exist or there is no data store.
     */
    public getRoom(roomId: string | undefined): Room | null {
        if (!roomId) {
            return null;
        }
        return this.store.getRoom(roomId);
    }

    /**
     * Retrieve all known rooms.
     * @returns A list of rooms, or an empty list if there is no data store.
     */
    public getRooms(): Room[] {
        return this.getSyncManager().getRooms();
    }

    /**
     * Retrieve all rooms that should be displayed to the user
     * This is essentially getRooms() with some rooms filtered out, eg. old versions
     * of rooms that have been replaced or (in future) other rooms that have been
     * marked at the protocol level as not to be displayed to the user.
     *
     * @param msc3946ProcessDynamicPredecessor - if true, look for an
     *                                           m.room.predecessor state event and
     *                                           use it if found (MSC3946).
     * @returns A list of rooms, or an empty list if there is no data store.
     */
    public getVisibleRooms(msc3946ProcessDynamicPredecessor = false): Room[] {
        return selectVisibleRoomsForClient(
            this.store.getRooms(),
            this.getRoom.bind(this),
            msc3946ProcessDynamicPredecessor,
        );
    }

    /**
     * Retrieve a user.
     * @param userId - The user ID to retrieve.
     * @returns A user or null if there is no data store or the user does
     * not exist.
     */
    public getUser(userId: string): User | null {
        return this.store.getUser(userId);
    }

    /**
     * Retrieve all known users.
     * @returns A list of users, or an empty list if there is no data store.
     */
    public getUsers(): User[] {
        return this.store.getUsers();
    }

    /**
     * Set account data event for the current user, and wait for the result to be echoed over `/sync`.
     *
     * Waiting for the remote echo ensures that a subsequent call to {@link getAccountData} will return the updated
     * value.
     *
     * If called before the client is started with {@link startClient}, logs a warning and falls back to
     * {@link setAccountDataRaw}.
     *
     * Retries the request up to 5 times in the case of an {@link ConnectionError}.
     *
     * @param eventType - The event type
     * @param content - the contents object for the event
     */
    public async setAccountData<K extends keyof WritableAccountDataEvents>(
        eventType: K,
        content: AccountDataEvents[K] | Record<string, never>,
    ): Promise<EmptyObject> {
        return this.getAccountDataManager().setAccountData(eventType, content);
    }

    /**
     * Set account data event for the current user, without waiting for the remote echo.
     *
     * @param eventType - The event type
     * @param content - the contents object for the event
     */
    public setAccountDataRaw<K extends keyof WritableAccountDataEvents>(
        eventType: K,
        content: AccountDataEvents[K] | Record<string, never>,
    ): Promise<EmptyObject> {
        return this.getAccountDataManager().setAccountDataRaw(eventType, content);
    }

    /**
     * Get account data event of given type for the current user.
     * @param eventType - The event type
     * @returns The contents of the given account data event
     */
    public getAccountData<K extends keyof AccountDataEvents>(eventType: K): MatrixEvent | undefined {
        return this.getAccountDataManager().getAccountData(eventType);
    }

    /**
     * Get account data event of given type for the current user. This variant
     * gets account data directly from the homeserver if the local store is not
     * ready, which can be useful very early in startup before the initial sync.
     * @param eventType - The event type
     * @returns Promise which resolves: The contents of the given account data event.
     * @returns Rejects: with an error response.
     */
    public async getAccountDataFromServer<K extends keyof AccountDataEvents>(
        eventType: K,
    ): Promise<AccountDataEvents[K] | null> {
        return this.getAccountDataManager().getAccountDataFromServer(eventType);
    }

    public async deleteAccountData(eventType: keyof WritableAccountDataEvents): Promise<void> {
        return this.getAccountDataManager().deleteAccountData(eventType);
    }

    /**
     * Gets the users that are ignored by this client
     * @returns The array of users that are ignored (empty if none)
     */
    public getIgnoredUsers(): string[] {
        return this.getAccountDataManager().getIgnoredUsers();
    }

    /**
     * Sets the users that the current user should ignore.
     * @param userIds - the user IDs to ignore
     * @returns Promise which resolves: an empty object
     * @returns Rejects: with an error response.
     */
    public setIgnoredUsers(userIds: string[]): Promise<EmptyObject> {
        return this.getAccountDataManager().setIgnoredUsers(userIds);
    }

    /**
     * Gets whether or not a specific user is being ignored by this client.
     * @param userId - the user ID to check
     * @returns true if the user is ignored, false otherwise
     */
    public isUserIgnored(userId: string): boolean {
        return this.getAccountDataManager().isUserIgnored(userId);
    }

    /**
     * Join a room. If you have already joined the room, this will no-op.
     * @param roomIdOrAlias - The room ID or room alias to join.
     * @param opts - Options when joining the room.
     * @returns Promise which resolves: Room object.
     * @returns Rejects: with an error response.
     */
    /**
     * Join a room. If you are already in the room, this will no-op.
     * @param roomIdOrAlias - The room ID or room alias to join.
     * @param opts - Options when joining the room.
     * @returns Promise which resolves: the room joined.
     * @returns Rejects: with an error response.
     */
    public async joinRoom(roomIdOrAlias: string, opts: IJoinRoomOpts = {}): Promise<Room> {
        return this.getRoomManager().joinRoom(roomIdOrAlias, opts);
    }

    /**
     * Knock a room. If you have already knocked the room, this will no-op.
     * @param roomIdOrAlias - The room ID or room alias to knock.
     * @param opts - Options when knocking the room.
     * @returns Promise which resolves: `{room_id: {string}}`
     * @returns Rejects: with an error response.
     */
    public knockRoom(roomIdOrAlias: string, opts: KnockRoomOpts = {}): Promise<{ room_id: string }> {
        return this.getRoomManager().knockRoom(roomIdOrAlias, opts);
    }

    /**
     * Resend an event. Will also retry any to-device messages waiting to be sent.
     * @param event - The event to resend.
     * @param room - Optional. The room the event is in. Will update the
     * timeline entry if provided.
     * @throws May throw a `MatrixSafetyError` if content is deemed unsafe.
     * @see MatrixSafetyError
     */
    public resendEvent(event: MatrixEvent, room: Room): Promise<ISendEventResponse> {
        return this.getEventManager().resendEvent(event, room, {
            toDeviceMessageQueueSendQueue: () => this.toDeviceMessageQueue.sendQueue(),
            updatePendingEventStatus: (rm, ev, status) => this.updatePendingEventStatus(rm, ev, status),
            encryptAndSendEvent: (rm, ev) => this.encryptAndSendEvent(rm, ev),
        });
    }

    /**
     * Cancel a queued or unsent event.
     *
     * @param event -   Event to cancel
     * @throws Error if the event is not in QUEUED, NOT_SENT or ENCRYPTING state
     */
    public cancelPendingEvent(event: MatrixEvent): void {
        this.getEventManager().cancelPendingEvent(event, {
            eventsBeingEncrypted: this.eventsBeingEncrypted,
            scheduler: this.scheduler ?? undefined,
            getRoom: (id) => this.getRoom(id),
            updatePendingEventStatus: (rm, ev, status) => this.updatePendingEventStatus(rm, ev, status),
        });
    }

    /**
     * @returns Promise which resolves with the request result.
     * @returns Rejects: with an error response.
     * @throws May throw a `MatrixSafetyError` if content is deemed unsafe.
     * @see MatrixSafetyError
     */
    public setRoomName(roomId: string, name: string): Promise<ISendEventResponse> {
        return this.getRoomManager().setRoomName(roomId, name);
    }

    public setRoomTopic(roomId: string, topic?: string, htmlTopic?: string): Promise<ISendEventResponse> {
        return this.getRoomManager().setRoomTopic(roomId, topic, htmlTopic);
    }

    public getRoomTags(roomId: string): Promise<ITagsResponse> {
        return this.getRoomManager().getRoomTags(roomId);
    }

    public setRoomTag(roomId: string, tagName: string, metadata: ITagMetadata = {}): Promise<EmptyObject> {
        return this.getRoomManager().setRoomTag(roomId, tagName, metadata);
    }

    public deleteRoomTag(roomId: string, tagName: string): Promise<EmptyObject> {
        return this.getRoomManager().deleteRoomTag(roomId, tagName);
    }

    /**
     * @param roomId - the ID of the room this event should be stored within
     * @param eventType - event type to be set
     * @param content - event content
     * @returns Promise which resolves: to an empty object `{}`
     * @returns Rejects: with an error response.
     */
    public setRoomAccountData<K extends keyof RoomAccountDataEvents>(
        roomId: string,
        eventType: K,
        content: RoomAccountDataEvents[K] | Record<string, never>,
    ): Promise<EmptyObject> {
        return this.getRoomManager().setRoomAccountData(roomId, eventType, content);
    }

    /**
     * Set a power level to one or multiple users.
     * Will apply changes atop of current power level event from local state if running & synced, falling back
     * to fetching latest from the `/state/` API.
     * @param roomId - the room to update power levels in
     * @param userId - the ID of the user or users to update power levels of
     * @param powerLevel - the numeric power level to update given users to
     * @returns Promise which resolves: to an ISendEventResponse object
     * @returns Rejects: with an error response.
     * @throws May throw a `MatrixSafetyError` if content is deemed unsafe.
     * @see MatrixSafetyError
     */
    public async setPowerLevel(
        roomId: string,
        userId: string | string[],
        powerLevel: number | undefined,
    ): Promise<ISendEventResponse> {
        return this.getStateSendManager().setPowerLevel(roomId, userId, powerLevel);
    }

    /**
     * Create an m.beacon_info event
     * @returns
     * @throws May throw a `MatrixSafetyError` if content is deemed unsafe.
     * @see MatrixSafetyError
     */
    public async unstable_createLiveBeacon(
        roomId: Room["roomId"],
        beaconInfoContent: MBeaconInfoEventContent,
    ): Promise<ISendEventResponse> {
        return this.unstable_setLiveBeacon(roomId, beaconInfoContent);
    }

    /**
     * Upsert a live beacon event
     * using a specific m.beacon_info.* event variable type
     * @param roomId - string
     * @returns
     * @throws May throw a `MatrixSafetyError` if content is deemed unsafe.
     * @see MatrixSafetyError
     */
    public async unstable_setLiveBeacon(
        roomId: string,
        beaconInfoContent: MBeaconInfoEventContent,
    ): Promise<ISendEventResponse> {
        return this.sendStateEvent(roomId, M_BEACON_INFO.name, beaconInfoContent, this.getUserId()!);
    }

    /**
     * Send a Matrix timeline event.
     * @param roomId The room to send to.
     * @param eventType The event type.
     * @param content The event content.
     * @param txnId An optional ID to deduplicate requests in case of repeated attempts.
     * @throws May throw a `MatrixSafetyError` if content is deemed unsafe.
     * @see MatrixSafetyError
     */
    public sendEvent<K extends keyof TimelineEvents>(
        roomId: string,
        eventType: K,
        content: TimelineEvents[K],
        txnId?: string,
    ): Promise<ISendEventResponse>;
    public sendEvent<K extends keyof TimelineEvents>(
        roomId: string,
        threadId: string | null,
        eventType: K,
        content: TimelineEvents[K],
        txnId?: string,
    ): Promise<ISendEventResponse>;
    public sendEvent(
        roomId: string,
        threadIdOrEventType: string | null,
        eventTypeOrContent: string | IContent,
        contentOrTxnId?: IContent | string,
        txnIdOrVoid?: string,
    ): Promise<ISendEventResponse> {
        const prepared = this.prepareSendEventWithThreadRelation(
            roomId,
            threadIdOrEventType,
            eventTypeOrContent,
            contentOrTxnId,
            txnIdOrVoid,
        );
        return this.getEventManager().sendEvent(
            roomId,
            prepared.eventObject.type as string,
            prepared.eventObject.content as IContent,
            prepared.txnId,
            {
                threadId: prepared.threadId,
                userId: this.credentials.userId!,
                makeTxnId: () => this.makeTxnId(),
                getRoom: (id) => this.getRoom(id),
                reEmitter: this.reEmitter,
                scheduler: this.scheduler ?? undefined,
                eventsBeingEncrypted: this.eventsBeingEncrypted,
                encryptEventIfNeeded: (event, room) => this.encryptEventIfNeeded(event, room),
                sendEventHttpRequest: (event, queryOrDelayOpts, queryDict) =>
                    this.sendEventHttpRequest(event, queryOrDelayOpts as SendDelayedEventRequestOpts, queryDict),
                updatePendingEventStatus: (room, event, status) => this.updatePendingEventStatus(room, event, status),
                logger: this.logger,
            },
        );
    }

    public get clientOptions(): IStoredClientOpts | undefined {
        return this.clientOpts;
    }

    /**
     * @param eventObject - An object with the partial structure of an event, to which event_id, user_id, room_id and origin_server_ts will be added.
     * @param txnId - Optional.
     * @returns Promise which resolves: to an empty object `{}`
     * @returns Rejects: with an error response.
     */
    private sendCompleteEvent(params: {
        roomId: string;
        threadId: string | null;
        eventObject: Partial<IEvent>;
        queryDict?: QueryDict;
        txnId?: string;
    }): Promise<ISendEventResponse>;
    /**
     * Sends a delayed event (MSC4140).
     * @param eventObject - An object with the partial structure of an event, to which event_id, user_id, room_id and origin_server_ts will be added.
     * @param delayOpts - Properties of the delay for this event.
     * @param txnId - Optional.
     * @returns Promise which resolves: to an empty object `{}`
     * @returns Rejects: with an error response.
     */
    private sendCompleteEvent(params: {
        roomId: string;
        threadId: string | null;
        eventObject: Partial<IEvent>;
        delayOpts: SendDelayedEventRequestOpts;
        queryDict?: QueryDict;
        txnId?: string;
    }): Promise<SendDelayedEventResponse>;
    private sendCompleteEvent({
        roomId,
        threadId,
        eventObject,
        delayOpts,
        queryDict,
        txnId,
    }: {
        roomId: string;
        threadId: string | null;
        eventObject: Partial<IEvent>;
        delayOpts?: SendDelayedEventRequestOpts;
        queryDict?: QueryDict;
        txnId?: string;
    }): Promise<SendDelayedEventResponse | ISendEventResponse> {
        const { room, localEvent } = prepareSendCompleteEventLifecycle({
            roomId,
            threadId,
            eventObject,
            delayOpts,
            queryDict,
            txnId,
            userId: this.credentials.userId!,
            makeTxnId: () => this.makeTxnId(),
            getRoom: (id) => this.getRoom(id),
            logger: this.logger,
            reEmitter: this.reEmitter,
        });

        if (delayOpts) {
            return this.encryptAndSendEvent(room, localEvent, delayOpts, queryDict);
        }
        return this.encryptAndSendEvent(room, localEvent, queryDict);
    }

    /**
     * encrypts the event if necessary; adds the event to the queue, or sends it; marks the event as sent/unsent
     * @returns returns a promise which resolves with the result of the send request
     */
    protected async encryptAndSendEvent(
        room: Room | null,
        event: MatrixEvent,
        queryDict?: QueryDict,
    ): Promise<ISendEventResponse>;
    /**
     * Simply sends a delayed event without encrypting it.
     * Known limitation: delayed events are currently sent without encryption.
     * @param delayOpts - Properties of the delay for this event.
     * @returns returns a promise which resolves with the result of the delayed send request
     */
    protected async encryptAndSendEvent(
        room: Room | null,
        event: MatrixEvent,
        delayOpts: SendDelayedEventRequestOpts,
        queryDict?: QueryDict,
    ): Promise<ISendEventResponse>;
    protected async encryptAndSendEvent(
        room: Room | null,
        event: MatrixEvent,
        delayOptsOrQuery?: SendDelayedEventRequestOpts | QueryDict,
        queryDict?: QueryDict,
    ): Promise<ISendEventResponse | SendDelayedEventResponse> {
        return await encryptAndSendEventWorkflow({
            room,
            event,
            delayOptsOrQuery,
            queryDict,
            scheduler: this.scheduler ?? undefined,
            eventsBeingEncrypted: this.eventsBeingEncrypted,
            encryptEventIfNeeded: (ev, rm) => this.encryptEventIfNeeded(ev, rm),
            sendEventHttpRequest: (ev, options, query) => {
                if (options && isSendDelayedEventRequestOpts(options)) {
                    return this.sendEventHttpRequest(ev, options, query);
                }
                return this.sendEventHttpRequest(ev, (options as QueryDict | undefined) ?? query);
            },
            updatePendingEventStatus: (rm, ev, status) => this.updatePendingEventStatus(rm, ev, status),
            logger: this.logger,
        });
    }

    private async encryptEventIfNeeded(event: MatrixEvent, room?: Room): Promise<void> {
        return this.encryptionUtils.encryptEventIfNeeded(event, room);
    }

    /**
     * Returns the eventType that should be used taking encryption into account
     * for a given eventType.
     * @param roomId - the room for the events `eventType` relates to
     * @param eventType - the event type
     * @returns the event type taking encryption into account
     */
    private getEncryptedIfNeededEventType(
        roomId: string,
        eventType?: EventType | string | null,
    ): EventType | string | null | undefined {
        return this.encryptionUtils.getEncryptedIfNeededEventType(roomId, eventType);
    }

    protected updatePendingEventStatus(room: Room | null, event: MatrixEvent, newStatus: EventStatus): void {
        if (room) {
            room.updatePendingEvent(event, newStatus);
        } else {
            event.setStatus(newStatus);
        }
    }

    private sendEventHttpRequest(event: MatrixEvent, queryDict?: QueryDict): Promise<ISendEventResponse>;
    private sendEventHttpRequest(
        event: MatrixEvent,
        delayOpts: SendDelayedEventRequestOpts,
        queryDict?: QueryDict,
    ): Promise<SendDelayedEventResponse>;
    private sendEventHttpRequest(
        event: MatrixEvent,
        queryOrDelayOpts?: SendDelayedEventRequestOpts | QueryDict,
        queryDict?: QueryDict,
    ): Promise<ISendEventResponse | SendDelayedEventResponse> {
        return dispatchSendEventHttpRequest({
            event,
            queryOrDelayOpts,
            queryDict,
            makeTxnId: () => this.makeTxnId(),
            http: this.http,
            logger: this.logger,
            unstableDelayFeatureName: UNSTABLE_MSC4140_DELAYED_EVENTS,
        });
    }

    /**
     * @param txnId -  transaction id. One will be made up if not supplied.
     * @param opts - Redact options
     * @returns Promise which resolves with an empty object.
     * @returns Rejects: with an error response.
     * @throws Error if called with `with_rel_types` (MSC3912) but the server does not support it.
     *         Callers should check whether the server supports MSC3912 via `MatrixClient.canSupport`.
     * @throws May throw a `MatrixSafetyError` if content is deemed unsafe.
     * @see MatrixSafetyError
     */
    public redactEvent(
        roomId: string,
        eventId: string,
        txnId?: string | undefined,
        opts?: IRedactOpts,
    ): Promise<ISendEventResponse>;
    public redactEvent(
        roomId: string,
        threadId: string | null,
        eventId: string,
        txnId?: string | undefined,
        opts?: IRedactOpts,
    ): Promise<ISendEventResponse>;
    public redactEvent(
        roomId: string,
        threadId: string | null,
        eventId?: string,
        txnId?: string | IRedactOpts,
        opts?: IRedactOpts,
    ): Promise<ISendEventResponse> {
        const normalized = normalizeRedactEventArgs(threadId, eventId, txnId, opts, EVENT_ID_PREFIX);
        const content = buildRedactEventContent({
            opts: normalized.opts,
            relationBasedRedactionsSupport: this.canSupport.get(Feature.RelationBasedRedactions),
            relationPropertyNames: {
                stable: "with_rel_types",
                unstable: "org.matrix.msc3912.with_relations",
            },
            roomId,
            eventId: normalized.eventId!,
            txnId: normalized.txnId,
            threadId: normalized.threadId,
        });
        return this.getEventManager().redactEvent(roomId, normalized.eventId!, content, normalized.txnId);
    }

    public sendMessage(
        roomId: string,
        threadId: string | null | RoomMessageEventContent,
        content?: RoomMessageEventContent | string,
        txnId?: string,
    ): Promise<ISendEventResponse> {
        if (typeof threadId === "object" && threadId !== null) {
            return this.sendEvent(
                roomId,
                null,
                EventType.RoomMessage,
                threadId as RoomMessageEventContent,
                content as string,
            );
        }
        return this.sendEvent(
            roomId,
            threadId as string | null,
            EventType.RoomMessage,
            content as RoomMessageEventContent,
            txnId,
        );
    }

    public sendTextMessage(roomId: string, body: string, txnId?: string): Promise<ISendEventResponse>;
    public sendTextMessage(
        roomId: string,
        threadId: string | null,
        body: string,
        txnId?: string,
    ): Promise<ISendEventResponse>;
    public sendTextMessage(
        roomId: string,
        threadIdOrBody: string | null,
        bodyOrTxnId?: string,
        txnId?: string,
    ): Promise<ISendEventResponse> {
        let threadId: string | null;
        let body: string;
        let actualTxnId: string | undefined;

        if (threadIdOrBody !== null && !threadIdOrBody.startsWith("$")) {
            threadId = null;
            body = threadIdOrBody;
            actualTxnId = bodyOrTxnId;
        } else {
            threadId = threadIdOrBody;
            body = bodyOrTxnId!;
            actualTxnId = txnId;
        }

        return this.sendMessage(roomId, threadId, { msgtype: MsgType.Text, body }, actualTxnId);
    }

    public sendNotice(roomId: string, body: string, txnId?: string): Promise<ISendEventResponse>;
    public sendNotice(
        roomId: string,
        threadId: string | null,
        body: string,
        txnId?: string,
    ): Promise<ISendEventResponse>;
    public sendNotice(
        roomId: string,
        threadIdOrBody: string | null,
        bodyOrTxnId?: string,
        txnId?: string,
    ): Promise<ISendEventResponse> {
        let threadId: string | null;
        let body: string;
        let actualTxnId: string | undefined;

        if (threadIdOrBody !== null && !threadIdOrBody.startsWith("$")) {
            threadId = null;
            body = threadIdOrBody;
            actualTxnId = bodyOrTxnId;
        } else {
            threadId = threadIdOrBody;
            body = bodyOrTxnId!;
            actualTxnId = txnId;
        }

        return this.sendMessage(roomId, threadId, { msgtype: MsgType.Notice, body }, actualTxnId);
    }

    public sendEmoteMessage(roomId: string, body: string, txnId?: string): Promise<ISendEventResponse>;
    public sendEmoteMessage(
        roomId: string,
        threadId: string | null,
        body: string,
        txnId?: string,
    ): Promise<ISendEventResponse>;
    public sendEmoteMessage(
        roomId: string,
        threadIdOrBody: string | null,
        bodyOrTxnId?: string,
        txnId?: string,
    ): Promise<ISendEventResponse> {
        let threadId: string | null;
        let body: string;
        let actualTxnId: string | undefined;

        if (threadIdOrBody !== null && !threadIdOrBody.startsWith("$")) {
            threadId = null;
            body = threadIdOrBody;
            actualTxnId = bodyOrTxnId;
        } else {
            threadId = threadIdOrBody;
            body = bodyOrTxnId!;
            actualTxnId = txnId;
        }

        return this.sendMessage(roomId, threadId, { msgtype: MsgType.Emote, body }, actualTxnId);
    }

    public sendImageMessage(
        roomId: string,
        threadId: string | null,
        url?: string | ImageInfo,
        info?: ImageInfo | string,
        text = "Image",
    ): Promise<ISendEventResponse> {
        return this.sendMessage(roomId, threadId, {
            msgtype: MsgType.Image,
            url: url as string,
            info: info as ImageInfo | undefined,
            body: text,
        });
    }

    public sendStickerMessage(
        roomId: string,
        threadId: string | null,
        url?: string | ImageInfo,
        info?: ImageInfo | string,
        text = "Sticker",
    ): Promise<ISendEventResponse> {
        return this.sendMessage(roomId, threadId, {
            msgtype: MsgType.Text,
            url: url as string,
            info: info as ImageInfo | undefined,
            body: text,
        } as RoomMessageEventContent);
    }

    public sendHtmlMessage(
        roomId: string,
        threadIdOrBody: string | null,
        bodyOrHtml: string,
        htmlBody?: string,
    ): Promise<ISendEventResponse> {
        const {
            threadId,
            body,
            htmlBody: actualHtmlBody,
        } = normalizeThreadHtmlArgs(threadIdOrBody, bodyOrHtml, htmlBody);
        return this.sendMessage(roomId, threadId, {
            msgtype: MsgType.Text,
            body,
            format: "org.matrix.custom.html",
            formatted_body: actualHtmlBody,
        });
    }

    public sendHtmlNotice(
        roomId: string,
        threadIdOrBody: string | null,
        bodyOrHtml: string,
        htmlBody?: string,
    ): Promise<ISendEventResponse> {
        const {
            threadId,
            body,
            htmlBody: actualHtmlBody,
        } = normalizeThreadHtmlArgs(threadIdOrBody, bodyOrHtml, htmlBody);
        return this.sendMessage(roomId, threadId, {
            msgtype: MsgType.Notice,
            body,
            format: "org.matrix.custom.html",
            formatted_body: actualHtmlBody,
        });
    }

    public sendHtmlEmote(
        roomId: string,
        threadIdOrBody: string | null,
        bodyOrHtml: string,
        htmlBody?: string,
    ): Promise<ISendEventResponse> {
        const {
            threadId,
            body,
            htmlBody: actualHtmlBody,
        } = normalizeThreadHtmlArgs(threadIdOrBody, bodyOrHtml, htmlBody);
        return this.sendMessage(roomId, threadId, {
            msgtype: MsgType.Emote,
            body,
            format: "org.matrix.custom.html",
            formatted_body: actualHtmlBody,
        });
    }

    protected prepareSendEventWithThreadRelation(
        roomId: string,
        threadIdOrEventType: string | null,
        eventTypeOrContent: string | IContent,
        contentOrTxnId?: IContent | string,
        txnIdOrVoid?: string,
    ): PreparedSendEventParams {
        return prepareSendEventParams({
            roomId,
            threadIdOrEventType,
            eventTypeOrContent,
            contentOrTxnId,
            txnIdOrVoid,
            eventIdPrefix: EVENT_ID_PREFIX,
            threadRelationTypeName: THREAD_RELATION_TYPE.name,
            getThread: (targetRoomId, targetThreadId) =>
                this.getRoom(targetRoomId)?.getThread(targetThreadId) ?? undefined,
        });
    }

    private sendPreparedCompleteEvent(
        roomId: string,
        prepared: PreparedSendEventParams,
        params: { delayOpts: SendDelayedEventRequestOpts; queryDict?: QueryDict },
    ): Promise<SendDelayedEventResponse>;
    private sendPreparedCompleteEvent(
        roomId: string,
        prepared: PreparedSendEventParams,
        params?: { queryDict?: QueryDict },
    ): Promise<ISendEventResponse>;
    private sendPreparedCompleteEvent(
        roomId: string,
        prepared: PreparedSendEventParams,
        params?: { delayOpts?: SendDelayedEventRequestOpts; queryDict?: QueryDict },
    ): Promise<ISendEventResponse | SendDelayedEventResponse> {
        if (params?.delayOpts) {
            return this.sendCompleteEvent({
                roomId,
                threadId: prepared.threadId,
                eventObject: prepared.eventObject,
                delayOpts: params.delayOpts,
                queryDict: params.queryDict,
                txnId: prepared.txnId,
            });
        }
        return this.sendCompleteEvent({
            roomId,
            threadId: prepared.threadId,
            eventObject: prepared.eventObject,
            queryDict: params?.queryDict,
            txnId: prepared.txnId,
        });
    }

    private async assertDelayedEventsSupported(
        apiName:
            | "sendDelayedEvent"
            | "updateDelayedEvent"
            | "cancelScheduledDelayedEvent"
            | "restartScheduledDelayedEvent"
            | "sendScheduledDelayedEvent"
            | "sendDelayedStateEvent"
            | "getDelayedEvents",
    ): Promise<void> {
        if (!(await this.doesServerSupportUnstableFeature(UNSTABLE_MSC4140_DELAYED_EVENTS))) {
            throw new UnsupportedDelayedEventsEndpointError("Server does not support the delayed events API", apiName);
        }
    }

    private async assertStickyEventsSupported(apiName: "sendStickyEvent" | "sendStickyStateEvent"): Promise<void> {
        if (!(await this.doesServerSupportUnstableFeature(UNSTABLE_MSC4354_STICKY_EVENTS))) {
            throw new UnsupportedStickyEventsEndpointError("Server does not support the sticky events", apiName);
        }
    }

    /**
     * Send a delayed timeline event.
     *
     * Note: This endpoint is unstable, and can throw an `Error`.
     *   Check progress on [MSC4140](https://github.com/matrix-org/matrix-spec-proposals/pull/4140) for more details.
     * @throws May throw a `MatrixSafetyError` if content is deemed unsafe.
     * @see MatrixSafetyError
     */
    public async _unstable_sendDelayedEvent<K extends keyof TimelineEvents>(
        roomId: string,
        delayOpts: SendDelayedEventRequestOpts,
        threadId: string | null,
        eventType: K,
        content: TimelineEvents[K],
        txnId?: string,
    ): Promise<SendDelayedEventResponse> {
        await this.assertDelayedEventsSupported("sendDelayedEvent");

        const prepared = this.prepareSendEventWithThreadRelation(
            roomId,
            threadId,
            eventType as string,
            content as IContent,
            txnId,
        );
        return this.sendPreparedCompleteEvent(roomId, prepared, { delayOpts });
    }

    /**
     * Send a delayed sticky timeline event.
     *
     * Note: This endpoint is unstable, and can throw an `Error`.
     *   Check progress on [MSC4140](https://github.com/matrix-org/matrix-spec-proposals/pull/4140) and
     *   [MSC4354](https://github.com/matrix-org/matrix-spec-proposals/pull/4354) for more details.
     * @throws May throw a `MatrixSafetyError` if content is deemed unsafe.
     * @see MatrixSafetyError
     */
    public async _unstable_sendStickyDelayedEvent<K extends keyof TimelineEvents>(
        roomId: string,
        stickDuration: number,
        delayOpts: SendDelayedEventRequestOpts,
        threadId: string | null,
        eventType: K,
        content: TimelineEvents[K] & { msc4354_sticky_key?: string },
        txnId?: string,
    ): Promise<SendDelayedEventResponse> {
        await this.assertDelayedEventsSupported("getDelayedEvents");
        await this.assertStickyEventsSupported("sendStickyEvent");

        const prepared = this.prepareSendEventWithThreadRelation(
            roomId,
            threadId,
            eventType as string,
            content as IContent,
            txnId,
        );
        return this.sendPreparedCompleteEvent(roomId, prepared, {
            delayOpts,
            queryDict: { "org.matrix.msc4354.sticky_duration_ms": stickDuration },
        });
    }

    /**
     * Send a delayed state event.
     *
     * Note: This endpoint is unstable, and can throw an `Error`.
     *   Check progress on [MSC4140](https://github.com/matrix-org/matrix-spec-proposals/pull/4140) for more details.
     * @throws May throw a `MatrixSafetyError` if content is deemed unsafe.
     * @see MatrixSafetyError
     */
    public async _unstable_sendDelayedStateEvent<K extends keyof StateEvents>(
        roomId: string,
        delayOpts: SendDelayedEventRequestOpts,
        eventType: K,
        content: StateEvents[K],
        stateKey = "",
        opts: IRequestOpts = {},
    ): Promise<SendDelayedEventResponse> {
        await this.assertDelayedEventsSupported("sendDelayedStateEvent");

        return dispatchDelayedStateEventRequest({
            roomId,
            eventType: eventType as string,
            content: content as Body,
            stateKey,
            delayOpts,
            http: this.http,
            requestOpts: opts,
            unstableDelayFeatureName: UNSTABLE_MSC4140_DELAYED_EVENTS,
        });
    }

    /**
     * Send a sticky timeline event.
     *
     * Note: This endpoint is unstable, and can throw an `Error`.
     *   Check progress on [MSC4354](https://github.com/matrix-org/matrix-spec-proposals/pull/4354) for more details.
     * @throws May throw a `MatrixSafetyError` if content is deemed unsafe.
     * @see MatrixSafetyError
     */
    public async _unstable_sendStickyEvent<K extends keyof TimelineEvents>(
        roomId: string,
        stickDuration: number,
        threadId: string | null,
        eventType: K,
        content: TimelineEvents[K] & { msc4354_sticky_key?: string },
        txnId?: string,
    ): Promise<ISendEventResponse> {
        await this.assertStickyEventsSupported("sendStickyEvent");

        const prepared = this.prepareSendEventWithThreadRelation(
            roomId,
            threadId,
            eventType as string,
            content as IContent,
            txnId,
        );
        return this.sendPreparedCompleteEvent(roomId, prepared, {
            queryDict: { "org.matrix.msc4354.sticky_duration_ms": stickDuration },
        });
    }

    /**
     * Get information about delayed events owned by the requesting user.
     *
     * Note: This endpoint is unstable, and can throw an `Error`.
     *   Check progress on [MSC4140](https://github.com/matrix-org/matrix-spec-proposals/pull/4140) for more details.
     */
    public async _unstable_getDelayedEvents(
        status?: "scheduled" | "finalised",
        delayId?: string | string[],
        fromToken?: string,
    ): Promise<DelayedEventInfo> {
        await this.assertDelayedEventsSupported("getDelayedEvents");

        const queryDict: QueryDict = buildDelayedEventsQuery(status, delayId, fromToken);
        return await this.http.authedRequest(Method.Get, "/delayed_events", queryDict, undefined, {
            prefix: buildUnstableFeaturePrefix(UNSTABLE_MSC4140_DELAYED_EVENTS),
        });
    }

    /**
     * Cancel the scheduled delivery of the delayed event matching the provided delayId.
     *
     * Note: This endpoint is unstable, and can throw an `Error`.
     *   Check progress on [MSC4140](https://github.com/matrix-org/matrix-spec-proposals/pull/4140) for more details.
     *
     * @throws A M_NOT_FOUND error if no matching delayed event could be found.
     */
    public async _unstable_cancelScheduledDelayedEvent(
        delayId: string,
        requestOptions: IRequestOpts = {},
    ): Promise<EmptyObject> {
        return await this.updateScheduledDelayedEvent(delayId, UpdateDelayedEventAction.Cancel, requestOptions);
    }

    /**
     * Restart the scheduled delivery of the delayed event matching the given delayId.
     *
     * Note: This endpoint is unstable, and can throw an `Error`.
     *   Check progress on [MSC4140](https://github.com/matrix-org/matrix-spec-proposals/pull/4140) for more details.
     *
     * @throws A M_NOT_FOUND error if no matching delayed event could be found.
     */
    public async _unstable_restartScheduledDelayedEvent(
        delayId: string,
        requestOptions: IRequestOpts = {},
    ): Promise<EmptyObject> {
        return await this.updateScheduledDelayedEvent(delayId, UpdateDelayedEventAction.Restart, requestOptions);
    }

    /**
     * Immediately send the delayed event matching the given delayId,
     * instead of waiting for its scheduled delivery.
     *
     * Note: This endpoint is unstable, and can throw an `Error`.
     *   Check progress on [MSC4140](https://github.com/matrix-org/matrix-spec-proposals/pull/4140) for more details.
     *
     * @throws A M_NOT_FOUND error if no matching delayed event could be found.
     * @throws May throw a `MatrixSafetyError` if content is deemed unsafe.
     * @see MatrixSafetyError
     */
    public async _unstable_sendScheduledDelayedEvent(
        delayId: string,
        requestOptions: IRequestOpts = {},
    ): Promise<EmptyObject> {
        return await this.updateScheduledDelayedEvent(delayId, UpdateDelayedEventAction.Send, requestOptions);
    }

    private async updateScheduledDelayedEvent(
        delayId: string,
        action: UpdateDelayedEventAction,
        requestOptions: IRequestOpts = {},
    ): Promise<EmptyObject> {
        await this.assertDelayedEventsSupported(`${action}ScheduledDelayedEvent`);

        return await updateScheduledDelayedEventWithFallback(
            this.http,
            delayId,
            action,
            UNSTABLE_MSC4140_DELAYED_EVENTS,
            requestOptions,
        );
    }

    /**
     *
     * @param roomId
     * @param notificationEventId
     * @returns
     * @throws May throw a `MatrixSafetyError` if content is deemed unsafe.
     * @see MatrixSafetyError
     */
    public sendRtcDecline(roomId: string, notificationEventId: string): Promise<ISendEventResponse> {
        return this.sendEvent(roomId, EventType.RTCDecline, {
            "m.relates_to": { event_id: notificationEventId, rel_type: RelationType.Reference },
        });
    }

    /**
     * Get a preview of the given URL as of (roughly) the given point in time,
     * described as an object with OpenGraph keys and associated values.
     * Attributes may be synthesized where actual OG metadata is lacking.
     * Caches results to prevent hammering the server.
     * @param url - The URL to get preview data for
     * @param ts - The preferred point in time that the preview should
     * describe (ms since epoch).  The preview returned will either be the most
     * recent one preceding this timestamp if available, or failing that the next
     * most recent available preview.
     * @returns Promise which resolves: Object of OG metadata.
     * @returns Rejects: with an error response.
     * May return synthesized attributes if the URL lacked OG meta.
     */
    public getUrlPreview(url: string, ts: number): Promise<IPreviewUrlResponse> {
        return this.getRoomManager().getUrlPreview(url, ts);
    }

    /**
     * @returns Promise which resolves: to an empty object `{}`
     * @returns Rejects: with an error response.
     */
    public sendTyping(roomId: string, isTyping: boolean, timeoutMs: number): Promise<EmptyObject> {
        return this.getTypingManager().sendTyping(roomId, isTyping, timeoutMs);
    }

    /**
     * Get typing users in a room
     * @param roomId - The room ID
     * @returns Array of user IDs currently typing
     */
    public async getRoomTyping(roomId: string): Promise<string[]> {
        return this.getRoomManager().getRoomTyping(roomId);
    }

    /**
     * Get typing users in multiple rooms
     * @param roomIds - Array of room IDs
     * @returns Map of room ID to array of typing user IDs
     */
    public async getBatchTyping(roomIds: string[]): Promise<Record<string, string[]>> {
        return this.getRoomManager().getBatchTyping(roomIds);
    }

    /**
     * Determines the history of room upgrades for a given room, as far as the
     * client can see. Returns an array of Rooms where the first entry is the
     * oldest and the last entry is the newest (likely current) room. If the
     * provided room is not found, this returns an empty list. This works in
     * both directions, looking for older and newer rooms of the given room.
     * @param roomId - The room ID to search from
     * @param verifyLinks - If true, the function will only return rooms
     * which can be proven to be linked. For example, rooms which have a create
     * event pointing to an old room which the client is not aware of or doesn't
     * have a matching tombstone would not be returned.
     * @param msc3946ProcessDynamicPredecessor - if true, look for
     * m.room.predecessor state events as well as create events, and prefer
     * predecessor events where they exist (MSC3946).
     * @returns An array of rooms representing the upgrade
     * history.
     */
    public getRoomUpgradeHistory(
        roomId: string,
        verifyLinks = false,
        msc3946ProcessDynamicPredecessor = false,
    ): Room[] {
        return buildRoomUpgradeHistory(roomId, this.getRoom.bind(this), verifyLinks, msc3946ProcessDynamicPredecessor);
    }

    /**
     * Send an invite to the given user to join the given room.
     *
     * @param roomId - The ID of the room to which the user should be invited.
     * @param userId - The ID of the user that should be invited.
     * @param opts - Optional reason object. For backwards compatibility, a string is also accepted, and will be interpreted as a reason.
     *
     * @returns An empty object.
     * @throws May throw a `MatrixSafetyError` if content is deemed unsafe.
     * @see MatrixSafetyError
     */
    public async invite(roomId: string, userId: string, opts: InviteOpts | string = {}): Promise<EmptyObject> {
        return this.getRoomManager().invite(roomId, userId, opts);
    }

    /**
     * Invite a user to a room based on their email address.
     * @param roomId - The room to invite the user to.
     * @param email - The email address to invite.
     * @returns Promise which resolves: `{}` an empty object.
     * @returns Rejects: with an error response.
     * @throws May throw a `MatrixSafetyError` if content is deemed unsafe.
     * @see MatrixSafetyError
     */
    public inviteByEmail(roomId: string, email: string): Promise<EmptyObject> {
        return this.getRoomManager().inviteByEmail(roomId, email);
    }

    /**
     * Invite a user to a room based on a third-party identifier.
     * @param roomId - The room to invite the user to.
     * @param medium - The medium to invite the user e.g. "email".
     * @param address - The address for the specified medium.
     * @returns Promise which resolves: `{}` an empty object.
     * @returns Rejects: with an error response.
     * @throws May throw a `MatrixSafetyError` if content is deemed unsafe.
     * @see MatrixSafetyError
     */
    public async inviteByThreePid(roomId: string, medium: string, address: string): Promise<EmptyObject> {
        return this.getRoomManager().inviteByThreePid(roomId, medium, address);
    }

    /**
     * @returns Promise which resolves: `{}` an empty object.
     * @returns Rejects: with an error response.
     */
    public leave(roomId: string): Promise<EmptyObject> {
        return this.getRoomManager().leave(roomId);
    }

    /**
     * Leaves all rooms in the chain of room upgrades based on the given room. By
     * default, this will leave all the previous and upgraded rooms, including the
     * given room. To only leave the given room and any previous rooms, keeping the
     * upgraded (modern) rooms untouched supply `false` to `includeFuture`.
     * @param roomId - The room ID to start leaving at
     * @param includeFuture - If true, the whole chain (past and future) of
     * upgraded rooms will be left.
     * @returns Promise which resolves when completed with an object keyed
     * by room ID and value of the error encountered when leaving or null.
     */
    public leaveRoomChain(
        roomId: string,
        includeFuture = true,
    ): Promise<{ [roomId: string]: Error | MatrixError | null }> {
        return leaveRoomChainRequest(
            roomId,
            includeFuture,
            this.getRoomUpgradeHistory.bind(this),
            this.leave.bind(this),
        );
    }

    /**
     * @param reason - Optional.
     * @returns Promise which resolves with an empty object.
     * @returns Rejects: with an error response.
     */
    public ban(roomId: string, userId: string, reason?: string): Promise<EmptyObject> {
        return this.getRoomManager().ban(roomId, userId, reason);
    }

    /**
     * @param deleteRoom - True to delete the room from the store on success.
     * Default: true.
     * @returns Promise which resolves: `{}` an empty object.
     * @returns Rejects: with an error response.
     */
    public async forget(roomId: string, deleteRoom = true): Promise<EmptyObject> {
        return this.getRoomManager().forget(roomId, deleteRoom);
    }

    public unban(roomId: string, userId: string): Promise<EmptyObject> {
        return this.getRoomManager().unban(roomId, userId);
    }

    public kick(roomId: string, userId: string, reason?: string): Promise<EmptyObject> {
        return this.getRoomManager().kick(roomId, userId, reason);
    }

    public getPushActionsForEvent(event: MatrixEvent, forceRecalculate = false): IActionsObject | null {
        if (!event.getPushActions() || forceRecalculate) {
            const { actions, rule } = this.pushProcessor.actionsAndRuleForEvent(event);
            event.setPushDetails(actions, rule);
        }
        return event.getPushActions();
    }

    public getPushDetailsForEvent(event: MatrixEvent, forceRecalculate = false): PushDetails | null {
        if (!event.getPushDetails() || forceRecalculate) {
            const { actions, rule } = this.pushProcessor.actionsAndRuleForEvent(event);
            event.setPushDetails(actions, rule);
        }
        return event.getPushDetails();
    }

    public async setSyncPresence(presence?: SetPresence): Promise<void> {
        this.syncApi?.setPresence(presence);
    }

    public scrollback(room: Room, limit = 30): Promise<Room> {
        return this.getTimelineManager().scrollback(room, limit);
    }

    /**
     * Get the event context for a given event.
     * @param roomId - The room ID.
     * @param eventId - The event ID.
     * @param params - Optional parameters.
     * @returns The event context.
     */
    public async getEventContext(
        roomId: string,
        eventId: string,
        params?: { limit?: number; filter?: IRoomEventFilter },
    ): Promise<import("./@types/requests").IContextResponse> {
        return this.getRoomManager().getEventContext(roomId, eventId, params);
    }

    /**
     * Retrieve scrollback for this room from the store.
     * @param room - The room.
     * @param limit - The limit.
     * @returns The events.
     */
    public storeScrollback(room: Room, limit: number): MatrixEvent[] {
        return this.store.scrollback(room, limit);
    }

    /**
     * Store events for a room in the store.
     * @param room - The room.
     * @param events - The events.
     * @param token - The token.
     * @param backwards - Whether these are paginated results.
     */
    public storeEvents(room: Room, events: MatrixEvent[], token: string | null, backwards: boolean): void {
        this.store.storeEvents(room, events, token, backwards);
    }

    public getEventMapper(options?: MapperOpts): EventMapper {
        return eventMapperFor(this, options || {});
    }

    public async getEventTimeline(timelineSet: EventTimelineSet, eventId: string): Promise<EventTimeline | null> {
        return this.getTimelineManager().getEventTimeline(timelineSet, eventId);
    }

    public async getThreadTimeline(timelineSet: EventTimelineSet, eventId: string): Promise<EventTimeline | undefined> {
        return this.getThreadingManager().getThreadTimeline(timelineSet, eventId);
    }

    public async getLatestTimeline(timelineSet: EventTimelineSet): Promise<EventTimeline | null> {
        return this.getTimelineManager().getLatestTimeline(timelineSet);
    }

    public createMessagesRequest(
        roomId: string,
        fromToken: string | null,
        limit = 30,
        dir: Direction,
        timelineFilter?: Filter,
    ): Promise<IMessagesResponse> {
        return this.getEventManager().createMessagesRequest(
            roomId,
            fromToken,
            limit,
            dir,
            timelineFilter?.getRoomTimelineFilterComponent()?.toJSON(),
            !!this.clientOpts?.lazyLoadMembers,
        );
    }

    public async createThreadListMessagesRequest(
        roomId: string,
        fromToken: string | null,
        limit = 30,
        dir = Direction.Backward,
        threadListType: ThreadFilterType | null = ThreadFilterType.All,
        timelineFilter?: Filter,
    ): Promise<IMessagesResponse> {
        return this.getEventManager().createThreadListMessagesRequest(
            roomId,
            fromToken,
            limit,
            dir,
            threadListType,
            timelineFilter?.getRoomTimelineFilterComponent()?.toJSON(),
            !!this.clientOpts?.lazyLoadMembers,
        );
    }

    public paginateEventTimeline(eventTimeline: EventTimeline, opts: IPaginateOpts): Promise<boolean> {
        return paginateEventTimelineRequest(eventTimeline, opts || {}, {
            notifTimelineSet: this.getNotifTimelineSet(),
            getRoom: this.getRoom.bind(this),
            createMessagesRequest: this.createMessagesRequest.bind(this),
            createThreadListMessagesRequest: this.createThreadListMessagesRequest.bind(this),
            fetchRelations: this.fetchRelations.bind(this),
            fetchRoomEvent: this.fetchRoomEvent.bind(this),
            getEventMapper: this.getEventMapper.bind(this),
            getPushDetailsForEvent: this.getPushDetailsForEvent.bind(this),
            processPaginationEvents: this.processPaginationEvents.bind(this),
            requestNotifications: (params) =>
                this.http.authedRequest<INotificationsResponse>(Method.Get, "/notifications", params),
            canSupportRelationsRecursion: this.canSupport.get(Feature.RelationsRecursion) !== ServerSupport.Unsupported,
        });
    }

    public resetNotifTimelineSet(): void {
        this.getNotificationsManager().resetNotifTimelineSet();
    }

    public peekInRoom(roomId: string, limit: number = 20): Promise<Room> {
        return this.getRoomManager().peekInRoom(roomId, limit);
    }

    public stopPeeking(): void {
        this.getRoomManager().stopPeeking();
    }

    public setGuestAccess(roomId: string, opts: IGuestAccessOpts): Promise<void> {
        return this.getRoomManager().setGuestAccess(roomId, opts);
    }

    public requestRegisterEmailToken(
        email: string,
        clientSecret: string,
        sendAttempt: number,
        nextLink?: string,
    ): Promise<IRequestTokenResponse> {
        return this.getAuthManager().requestRegisterEmailToken(email, clientSecret, sendAttempt, nextLink);
    }

    public requestRegisterMsisdnToken(
        phoneCountry: string,
        phoneNumber: string,
        clientSecret: string,
        sendAttempt: number,
        nextLink?: string,
    ): Promise<IRequestMsisdnTokenResponse> {
        return this.getAuthManager().requestRegisterMsisdnToken(
            phoneCountry,
            phoneNumber,
            clientSecret,
            sendAttempt,
            nextLink,
        );
    }

    public requestAdd3pidEmailToken(
        email: string,
        clientSecret: string,
        sendAttempt: number,
        nextLink?: string,
    ): Promise<IRequestTokenResponse> {
        return this.getAuthManager().requestAdd3pidEmailToken(email, clientSecret, sendAttempt, nextLink);
    }

    public requestAdd3pidMsisdnToken(
        phoneCountry: string,
        phoneNumber: string,
        clientSecret: string,
        sendAttempt: number,
        nextLink?: string,
    ): Promise<IRequestMsisdnTokenResponse> {
        return this.getAuthManager().requestAdd3pidMsisdnToken(
            phoneCountry,
            phoneNumber,
            clientSecret,
            sendAttempt,
            nextLink,
        );
    }

    public requestPasswordEmailToken(
        email: string,
        clientSecret: string,
        sendAttempt: number,
        nextLink?: string,
    ): Promise<IRequestTokenResponse> {
        return this.getPasswordResetManager().requestPasswordEmailToken(email, clientSecret, sendAttempt, nextLink);
    }

    public requestPasswordMsisdnToken(
        phoneCountry: string,
        phoneNumber: string,
        clientSecret: string,
        sendAttempt: number,
        nextLink: string,
    ): Promise<IRequestMsisdnTokenResponse> {
        return this.getPasswordResetManager().requestPasswordMsisdnToken(
            phoneCountry,
            phoneNumber,
            clientSecret,
            sendAttempt,
            nextLink,
        );
    }

    public getRoomPushRule(scope: "global" | "device", roomId: string): IPushRule | undefined {
        return this.getPushManager().getRoomPushRule(scope, roomId);
    }

    public setRoomMutePushRule(scope: "global" | "device", roomId: string, mute: boolean): Promise<void> | undefined {
        return this.getPushManager().setRoomMutePushRule(scope, roomId, mute);
    }

    public searchMessageText(opts: ISearchOpts): Promise<ISearchResponse> {
        return this.getSearchManager().searchMessageText({ term: opts.query, keys: opts.keys });
    }

    public async searchRoomEvents(opts: IEventSearchOpts): Promise<ISearchResults> {
        return this.getSearchManager().searchRoomEventsProcessed(opts);
    }

    public backPaginateRoomEventsSearch<T extends ISearchResults>(searchResults: T): Promise<T> {
        return this.getSearchManager().backPaginateRoomEventsSearch(searchResults);
    }

    /** @internal */
    public processRoomEventsSearch<T extends ISearchResults>(searchResults: T, response: ISearchResponse): T {
        return this.getSearchManager().processRoomEventsSearch(searchResults, response);
    }

    public syncLeftRooms(): Promise<Room[]> {
        return this.getSyncManager().syncLeftRooms();
    }

    public async createFilter(content: IFilterDefinition): Promise<Filter> {
        const result = await this.getFilterManager().createFilter(content);
        return Filter.fromJson(this.credentials.userId, result.filterId, content);
    }

    public async getFilter(userId: string, filterId: string, allowCached: boolean): Promise<Filter> {
        return this.getFilterManager().getFilter(userId, filterId, allowCached);
    }

    public async getOrCreateFilter(filterName: string, filter: Filter): Promise<string> {
        return this.getFilterManager().getOrCreateFilter(filterName, filter);
    }

    public getOpenIdToken(): Promise<IOpenIDToken> {
        return getOpenIdTokenRequest(this.credentials.userId!, this.authedRequestProxy);
    }

    private startCallEventHandler = (): void => {
        if (this.isInitialSyncComplete()) {
            if (supportsMatrixCall()) {
                this.callEventHandler!.start();
                this.groupCallEventHandler!.start();
            }

            this.off(ClientEvent.Sync, this.startCallEventHandler);
        }
    };

    private startMatrixRTC = (): void => {
        if (this.isInitialSyncComplete()) {
            this.matrixRTC.start();

            this.off(ClientEvent.Sync, this.startMatrixRTC);
        }
    };

    /**
     * Once the client has been initialised, we want to clear notifications we
     * know for a fact should be here.
     * This issue should also be addressed on synapse's side and is tracked as part
     * of https://github.com/matrix-org/synapse/issues/14837
     *
     * We consider a room or a thread as fully read if the current user has sent
     * the last event in the live timeline of that context and if the read receipt
     * we have on record matches.
     */
    private fixupRoomNotifications = (): void => {
        if (this.isInitialSyncComplete()) {
            const unreadRooms = (this.getRooms() ?? []).filter((room) => {
                return room.getUnreadNotificationCount(NotificationCountType.Total) > 0;
            });

            for (const room of unreadRooms) {
                const currentUserId = this.getSafeUserId();
                room.fixupNotifications(currentUserId);
            }

            this.off(ClientEvent.Sync, this.fixupRoomNotifications);
        }
    };

    public turnServer(): Promise<ITurnServerResponse> {
        return this.http.authedRequest(Method.Get, "/voip/turnServer");
    }

    public getTurnServers(): ITurnServer[] {
        return this.getTurnServerManager().getTurnServers();
    }

    public getTurnServersExpiry(): number {
        return this.getTurnServerManager().getTurnServerExpiry();
    }

    public get pollingTurnServers(): boolean {
        return this.checkTurnServersIntervalID !== undefined;
    }

    public async checkTurnServers(): Promise<boolean | undefined> {
        return this.getTurnServerManager().checkTurnServers();
    }

    public setFallbackICEServerAllowed(allow: boolean): void {
        this.fallbackICEServerAllowed = allow;
    }

    public isFallbackICEServerAllowed(): boolean {
        return this.fallbackICEServerAllowed;
    }

    public async isSynapseAdministrator(): Promise<boolean> {
        return this.getAdminManager().isSynapseAdministrator(this.getUserId()!);
    }

    public whoisSynapseUser(userId: string): Promise<ISynapseAdminWhoisResponse> {
        return this.getAdminManager().whoisSynapseUser(userId);
    }

    public deactivateSynapseUser(userId: string): Promise<ISynapseAdminDeactivateResponse> {
        return this.getAdminManager().deactivateSynapseUser(userId);
    }

    protected async fetchClientWellKnown(): Promise<void> {
        // `getRawClientConfig` does not throw or reject on network errors, instead
        // it absorbs errors and returns `{}`.
        this.clientWellKnownPromise = AutoDiscovery.getRawClientConfig(this.getDomain() ?? undefined);
        this.clientWellKnown = await this.clientWellKnownPromise;
        this.emit(ClientEvent.ClientWellKnown, this.clientWellKnown);
    }

    public getClientWellKnown(): IClientWellKnown | undefined {
        return this.clientWellKnown;
    }

    public waitForClientWellKnown(): Promise<IClientWellKnown> {
        if (!this.clientRunning) {
            throw new Error("Client is not running");
        }
        return this.clientWellKnownPromise!;
    }

    /**
     * store client options with boolean/string/numeric values
     * to know in the next session what flags the sync data was
     * created with (e.g. lazy loading)
     * @returns for store operation
     */
    public storeClientOptions(): Promise<void> {
        // Intended private, used in code
        const primTypes = ["boolean", "string", "number"];
        const serializableOpts = Object.entries(this.clientOpts!)
            .filter(([, value]) => {
                return primTypes.includes(typeof value);
            })
            .reduce<Record<string, unknown>>((obj, [key, value]) => {
                // Dynamic: accumulates arbitrary client option key-value pairs
                obj[key] = value;
                return obj;
            }, {});
        return this.store.storeClientOptions(serializableOpts);
    }

    /**
     * Gets a set of room IDs in common with another user.
     *
     * Note: This endpoint is unstable, and can throw an `Error`.
     *   Check progress on [MSC2666](https://github.com/matrix-org/matrix-spec-proposals/pull/2666) for more details.
     *
     * @param userId - The userId to check.
     * @returns Promise which resolves to an array of rooms
     * @returns Rejects: with an error response.
     */
    // On spec release, rename this to getMutualRooms
    public async _unstable_getSharedRooms(userId: string): Promise<string[]> {
        return this.getServerCapabilitiesManager()._unstable_getSharedRooms(userId);
    }

    /**
     * Returns a set of configured RTC transports supported by the homeserver.
     * Requires homeserver support for MSC4143.
     * @throws A M_NOT_FOUND error if not supported by the homeserver.
     */
    public async _unstable_getRTCTransports(): Promise<Transport[]> {
        return this.getServerCapabilitiesManager()._unstable_getRTCTransports() as Promise<Transport[]>;
    }

    public async getVersions(): Promise<IServerVersions> {
        return this.getServerCapabilitiesManager().getVersions();
    }

    public async isVersionSupported(version: string): Promise<boolean> {
        return this.getServerCapabilitiesManager().isVersionSupported(version);
    }

    public async doesServerSupportUnstableFeature(feature: string): Promise<boolean> {
        return this.getServerCapabilitiesManager().doesServerSupportUnstableFeature(feature);
    }

    public async doesServerAdvertiseSynapseRustFeature(feature: SynapseRustFeatureName): Promise<boolean> {
        return this.getServerCapabilitiesManager().doesServerAdvertiseSynapseRustFeature(feature);
    }

    public async getSynapseRustFeatureSupport(): Promise<SynapseRustFeatureSupport> {
        return this.getServerCapabilitiesManager().getSynapseRustFeatureSupport();
    }

    public async doesServerForceEncryptionForPreset(presetName: Preset): Promise<boolean> {
        return this.getServerCapabilitiesManager().doesServerForceEncryptionForPreset(presetName);
    }

    public async doesServerSupportThread(): Promise<{
        threads: FeatureSupport;
        list: FeatureSupport;
        fwdPagination: FeatureSupport;
    }> {
        return this.getServerCapabilitiesManager().doesServerSupportThread();
    }

    public hasLazyLoadMembersEnabled(): boolean {
        return this.getServerCapabilitiesManager().hasLazyLoadMembersEnabled();
    }

    public setCanResetTimelineCallback(cb: ResetTimelineCallback): void {
        this.canResetTimelineCallback = cb;
    }

    public getCanResetTimelineCallback(): ResetTimelineCallback | undefined {
        return this.canResetTimelineCallback;
    }

    /**
     * Returns relations for a given event. Handles encryption transparently,
     * with the caveat that the amount of events returned might be 0, even though you get a nextBatch.
     * When the returned promise resolves, all messages should have finished trying to decrypt.
     * @param roomId - the room of the event
     * @param eventId - the id of the event
     * @param relationType - the rel_type of the relations requested
     * @param eventType - the event type of the relations requested
     * @param opts - options with optional values for the request.
     * @returns an object with `events` as `MatrixEvent[]` and optionally `nextBatch` if more relations are available.
     */
    public async relations(
        roomId: string,
        eventId: string,
        relationType: RelationType | string | null,
        eventType?: EventType | string | null,
        opts: IRelationsRequestOpts = { dir: Direction.Backward },
    ): Promise<{
        originalEvent?: MatrixEvent | null;
        events: MatrixEvent[];
        nextBatch?: string | null;
        prevBatch?: string | null;
    }> {
        return this.getRelationsManager().relations(roomId, eventId, relationType, eventType, opts, {
            getEncryptedIfNeededEventType: (r: string, e: string | null | undefined) =>
                this.getEncryptedIfNeededEventType(r, e),
            fetchRoomEvent: (r: string, e: string) => this.fetchRoomEvent(r, e),
            fetchRelations: (
                r: string,
                e: string,
                relType: RelationType | string | null,
                evtType?: string | null,
                requestOpts?: IRelationsRequestOpts,
            ) => this.fetchRelations(r, e, relType, evtType, requestOpts),
            getEventMapper: () => this.getEventMapper(),
            decryptEventIfNeeded: (ev: MatrixEvent) => this.decryptEventIfNeeded(ev),
        });
    }

    /**
     * Get aggregations for an event
     * @param roomId - The room ID
     * @param eventId - The event ID
     * @param relType - The relation type
     * @returns Aggregation data
     */
    public async getAggregations(
        roomId: string,
        eventId: string,
        relType: string,
    ): Promise<{ chunk: Array<{ type: string; key: string; count: number }> }> {
        return this.getRelationsManager().getAggregations(roomId, eventId, relType) as Promise<{
            chunk: Array<{ type: string; key: string; count: number }>;
        }>;
    }

    /**
     * Generates a random string suitable for use as a client secret. <strong>This
     * method is experimental and may change.</strong>
     * @returns A new client secret
     */
    public generateClientSecret(): string {
        return secureRandomString(32);
    }

    /**
     * Attempts to decrypt an event
     * @param event - The event to decrypt
     * @returns A decryption promise
     */
    public decryptEventIfNeeded(event: MatrixEvent, options?: IDecryptOptions): Promise<void> {
        return this.getEventManager().decryptEventIfNeeded(
            event,
            {
                enableEncryptedStateEvents: this.enableEncryptedStateEvents,
                getCrypto: () => this.getCrypto(),
                cryptoBackend: this.cryptoBackend!,
            },
            options,
        );
    }

    /**
     * Get the Homeserver URL of this client
     * @returns Homeserver URL of this client
     */
    public getHomeserverUrl(): string {
        return this.getCredentialsManager().getBaseUrl();
    }

    /**
     * Get the access token associated with this account.
     * @returns The access_token or null
     */
    public getAccessToken(): string | null {
        return this.http.opts.accessToken || null;
    }

    /**
     * Get the refresh token associated with this account.
     * @returns The refresh_token or null
     */
    public getRefreshToken(): string | null {
        return this.http.opts.refreshToken ?? null;
    }

    /**
     * Set the access token associated with this account.
     * @param token - The new access token.
     */
    public setAccessToken(token: string): void {
        this.http.opts.accessToken = token;
        // The /versions response can vary for different users so clear the cache
        this.serverVersionsPromise = undefined;
    }

    /**
     * @returns true if there is a valid access_token for this client.
     */
    public isLoggedIn(): boolean {
        return this.getCredentialsManager().isLoggedIn();
    }

    /**
     * Make up a new transaction id
     *
     * @returns a new, unique, transaction id
     */
    public makeTxnId(): string {
        return "m" + new Date().getTime() + "." + this.txnCtr++;
    }

    public async isUsernameAvailable(username: string): Promise<boolean> {
        return this.getAuthManager().isUsernameAvailable(username);
    }

    public register(
        username: string,
        password: string,
        sessionId: string | null,
        auth: { session?: string; type: string },
        bindThreepids?: { email?: boolean; msisdn?: boolean },
        guestAccessToken?: string,
        inhibitLogin?: boolean,
    ): Promise<RegisterResponse> {
        return this.getAuthManager().register(
            username,
            password,
            sessionId,
            auth,
            bindThreepids,
            guestAccessToken,
            inhibitLogin,
        );
    }

    public registerGuest({ body }: { body?: RegisterRequest } = {}): Promise<RegisterResponse> {
        return this.getAuthManager().registerGuest(body);
    }

    public registerRequest(data: RegisterRequest, kind?: string): Promise<RegisterResponse> {
        return this.getAuthManager().registerRequest(data, kind);
    }

    public async refreshToken(refreshToken: string): Promise<IRefreshTokenResponse> {
        return this.getAuthManager().refreshToken(refreshToken);
    }

    public loginFlows(): Promise<ILoginFlowsResponse> {
        return this.getAccountManager().loginFlows();
    }

    public getCasLoginUrl(redirectUrl: string): string {
        return this.getAccountManager().getCasLoginUrl(redirectUrl);
    }

    public getSsoLoginUrl(redirectUrl: string, loginType = "sso", idpId?: string, action?: SSOAction): string {
        return this.getAccountManager().getSsoLoginUrl(redirectUrl, loginType, idpId, action);
    }

    public loginRequest(data: LoginRequest): Promise<LoginResponse> {
        return this.getAccountManager().loginRequest(data);
    }

    public logout(stopClient = false): Promise<EmptyObject> {
        return this.getAccountManager().logout(stopClient);
    }

    public deactivateAccount(
        auth?: AuthDict,
        erase?: boolean,
    ): Promise<{ id_server_unbind_result: IdServerUnbindResult }> {
        return this.getAccountManager().deactivateAccount(auth, erase);
    }

    public requestLoginToken(auth?: AuthDict): Promise<LoginTokenPostResponse> {
        return this.getAccountManager().requestLoginToken(auth);
    }

    public getFallbackAuthUrl(loginType: string, authSessionId: string): string {
        return this.getAccountManager().getFallbackAuthUrl(loginType, authSessionId);
    }

    public async createRoom(options: ICreateRoomOpts): Promise<{ room_id: string }> {
        return this.getRoomManager().createRoom(options);
    }

    public fetchRelations(
        roomId: string,
        eventId: string,
        relationType: RelationType | string | null,
        eventType?: string | null,
        opts: IRelationsRequestOpts = { dir: Direction.Backward },
    ): Promise<IRelationsResponse> {
        return this.getRelationsManager().fetchRelations(roomId, eventId, relationType, eventType, opts);
    }

    public roomState(roomId: string): Promise<IStateEventWithRoomId[]> {
        return this.getEventManager().getState(roomId) as Promise<IStateEventWithRoomId[]>;
    }

    public fetchRoomEvent(roomId: string, eventId: string): Promise<Partial<IEvent>> {
        return this.getEventManager().getEvent(roomId, eventId) as Promise<Partial<IEvent>>;
    }

    public members(
        roomId: string,
        includeMembership?: string,
        excludeMembership?: string,
        atEventId?: string,
    ): Promise<{ [userId: string]: IStateEventWithRoomId[] }> {
        return membersRequest(roomId, includeMembership, excludeMembership, atEventId, this.authedRequestProxy);
    }

    public upgradeRoom(
        roomId: string,
        newVersion: string,
        additionalCreators?: string[],
    ): Promise<{ replacement_room: string }> {
        return this.getRoomManager().upgradeRoom(roomId, newVersion, additionalCreators);
    }

    public getStateEvent(roomId: string, eventType: string, stateKey = ""): Promise<IContent> {
        return this.getEventManager().getStateEvent(roomId, eventType, stateKey);
    }

    public async sendStateEvent<K extends keyof StateEvents>(
        roomId: string,
        eventType: K,
        content: StateEvents[K],
        stateKey = "",
        opts: IRequestOpts = {},
    ): Promise<ISendEventResponse> {
        return this.getEventManager().sendStateEventWithEncryption(
            roomId,
            eventType as string,
            content as IContent,
            stateKey,
            {
                getRoom: (id) => this.getRoom(id),
                encryptStateEventIfNeeded: (event, room) => this.encryptStateEventIfNeeded(event, room),
                dispatchStateEventRequest: (params) =>
                    dispatchStateEventRequest({
                        roomId: params.roomId,
                        eventType: params.eventType,
                        content: params.content as Body,
                        stateKey: params.stateKey,
                        http: this.http,
                        requestOpts: opts,
                    }) as Promise<ISendEventResponse>,
                http: this.http,
                requestOpts: opts,
            },
        );
    }

    private async encryptStateEventIfNeeded(event: MatrixEvent, room?: Room): Promise<void> {
        return this.encryptionUtils.encryptStateEventIfNeeded(event, room);
    }

    public roomInitialSync(roomId: string, _limit: number): Promise<IRoomInitialSyncResponse> {
        return this.getRoomManager().roomInitialSync(roomId);
    }

    public getJoinedRooms(): Promise<IJoinedRoomsResponse> {
        return getJoinedRoomsRequest(this.authedRequestProxy);
    }

    public getJoinedRoomMembers(roomId: string): Promise<IJoinedMembersResponse> {
        return getJoinedRoomMembersRequest(roomId, this.authedRequestProxy);
    }

    public publicRooms({
        server,
        limit,
        since,
        ...options
    }: IRoomDirectoryOptions = {}): Promise<IPublicRoomsResponse> {
        const request = { server, limit, since, ...options };
        const key = stableSerialize(request);
        return this.publicRoomsRequestCache.getOrCreate(key, () =>
            publicRoomsRequest(request, this.authedRequestProxy),
        );
    }

    public createAlias(alias: string, roomId: string): Promise<EmptyObject> {
        return this.getRoomManager().createAlias(alias, roomId);
    }

    public deleteAlias(alias: string): Promise<EmptyObject> {
        return this.getRoomManager().deleteAlias(alias);
    }

    public getLocalAliases(roomId: string): Promise<{ aliases: string[] }> {
        return this.getRoomManager().getLocalAliases(roomId);
    }

    public getRoomIdForAlias(alias: string): Promise<{ room_id: string; servers: string[] }> {
        return this.getRoomManager().getRoomIdForAlias(alias);
    }

    public getRoomDirectoryVisibility(roomId: string): Promise<{ visibility: Visibility }> {
        return this.getRoomManager().getRoomDirectoryVisibility(roomId);
    }

    public setRoomDirectoryVisibility(roomId: string, visibility: Visibility): Promise<EmptyObject> {
        return this.getRoomManager().setRoomDirectoryVisibility(roomId, visibility);
    }

    public searchUserDirectory({ term, limit }: { term: string; limit?: number }): Promise<IUserDirectoryResponse> {
        return this.getSearchManager().searchUserDirectory({ term, limit });
    }

    public uploadContent(file: FileType, opts?: UploadOpts): Promise<UploadResponse> {
        return this.http.uploadContent(file, opts);
    }

    public cancelUpload(upload: Promise<UploadResponse>): boolean {
        return this.getMediaManager().cancelUpload(upload);
    }

    public getCurrentUploads(): Upload[] {
        return this.http.getCurrentUploads();
    }

    public async doesServerSupportExtendedProfiles(): Promise<boolean> {
        return this.getProfileManager().doesServerSupportExtendedProfiles();
    }

    public async getExtendedProfile(userId: string): Promise<IExtendedProfile> {
        return this.getProfileManager().getExtendedProfile(userId);
    }

    public async getExtendedProfileProperty(userId: string, key: string): Promise<unknown> {
        return this.getProfileManager().getExtendedProfileProperty(userId, key);
    }

    public async setExtendedProfileProperty(key: string, value: unknown): Promise<void> {
        return this.getProfileManager().setExtendedProfileProperty(key, value);
    }

    public async deleteExtendedProfileProperty(key: string): Promise<void> {
        return this.getProfileManager().deleteExtendedProfileProperty(key);
    }

    public async patchExtendedProfile(profile: IExtendedProfile): Promise<IExtendedProfile> {
        return this.getProfileManager().patchExtendedProfile(profile);
    }

    public async setExtendedProfile(profile: IExtendedProfile): Promise<void> {
        return this.getProfileManager().setExtendedProfile(profile);
    }

    public setPassword(authDict: AuthDict, newPassword: string, logoutDevices?: boolean): Promise<EmptyObject> {
        return this.getPasswordResetManager().setPassword(authDict, newPassword, logoutDevices);
    }

    public setLocalNotificationSettings(
        deviceId: string,
        notificationSettings: LocalNotificationSettings,
    ): Promise<EmptyObject> {
        return this.getNotificationsManager().setLocalNotificationSettings(deviceId, notificationSettings);
    }

    public search(
        { body, next_batch: nextBatch }: { body: ISearchRequestBody; next_batch?: string },
        abortSignal?: AbortSignal,
    ): Promise<ISearchResponse> {
        return this.getSearchManager().search({ body, next_batch: nextBatch, abortSignal });
    }

    public uploadKeysRequest(content: IUploadKeysRequest, _opts?: void): Promise<IKeysUploadResponse> {
        return this.getCryptoKeysManager().uploadKeys(content);
    }

    public uploadKeySignatures(content: KeySignatures): Promise<IUploadKeySignaturesResponse> {
        return this.getCryptoKeysManager().uploadKeySignatures(content);
    }

    public downloadKeysForUsers(userIds: string[], { token }: { token?: string } = {}): Promise<IDownloadKeyResult> {
        return this.getCryptoKeysManager().queryKeys(userIds, { token });
    }

    public claimOneTimeKeys(
        devices: [string, string][],
        keyAlgorithm = "signed_curve25519",
        timeout?: number,
    ): Promise<IClaimOTKsResult> {
        return this.getCryptoKeysManager().claimKeys(devices, keyAlgorithm, timeout);
    }

    public getKeyChanges(oldToken: string, newToken: string): Promise<{ changed: string[]; left: string[] }> {
        return this.getCryptoKeysManager().getKeysChanges(oldToken, newToken) as Promise<{
            changed: string[];
            left: string[];
        }>;
    }

    public uploadDeviceSigningKeys(auth?: AuthDict, keys?: CrossSigningKeys): Promise<EmptyObject> {
        return uploadDeviceSigningKeysHttpRequest<EmptyObject>(auth, keys, this.authedRequestProxy);
    }

    public requestRoomKey(request: ICreateRoomKeyRequest): Promise<IRoomKeyRequestCreateResponse> {
        return requestRoomKeyHttpRequest<IRoomKeyRequestCreateResponse>(request, this.authedRequestProxy);
    }

    public getRoomKeyRequests(query: IGetRoomKeyRequestsQuery = {}): Promise<IRoomKeyRequestsResponse> {
        return getRoomKeyRequestsHttpRequest<IRoomKeyRequestsResponse>(query, this.authedRequestProxy);
    }

    public deleteRoomKeyRequest(requestId: string): Promise<EmptyObject> {
        return deleteRoomKeyRequestHttpRequest<EmptyObject>(requestId, this.authedRequestProxy);
    }

    public async getThirdpartyProtocols(): Promise<{ [protocol: string]: IProtocol }> {
        return this.getThirdPartyManager().getThirdpartyProtocols();
    }

    public getThirdpartyLocation(
        protocol: string,
        params: { searchFields?: string[] },
    ): Promise<IThirdPartyLocation[]> {
        return this.getThirdPartyManager().getThirdpartyLocation(protocol, params);
    }

    public getThirdpartyUser(protocol: string, params?: QueryDict): Promise<IThirdPartyUser[]> {
        return this.getThirdPartyManager().getThirdpartyUser(protocol, params);
    }

    public getRoomHierarchy(
        roomId: string,
        limit?: number,
        maxDepth?: number,
        suggestedOnly = false,
        fromToken?: string,
    ): Promise<IRoomHierarchy> {
        return this.getRoomManager().getRoomHierarchy(roomId, limit, maxDepth, suggestedOnly, fromToken);
    }

    public async unstableCreateFileTree(name: string): Promise<MSC3089TreeSpace> {
        return createFileTreeSpaceRequest(
            name,
            this.getUserId.bind(this),
            this.createRoom.bind(this),
            (roomId) => new MSC3089TreeSpace(this, roomId),
        );
    }

    public unstableGetFileTreeSpace(roomId: string): MSC3089TreeSpace | null {
        return getFileTreeSpaceReference(
            roomId,
            (targetRoomId) => this.getRoom(targetRoomId),
            (targetRoomId) => new MSC3089TreeSpace(this, targetRoomId),
        );
    }

    public slidingSync(
        req: MSC3575SlidingSyncRequest,
        proxyBaseUrl?: string,
        abortSignal?: AbortSignal,
    ): Promise<MSC3575SlidingSyncResponse> {
        return this.getRoomManager().slidingSync(req, proxyBaseUrl, abortSignal) as Promise<MSC3575SlidingSyncResponse>;
    }

    public async isSlidingSyncSupported(): Promise<boolean> {
        return this.getRoomManager().isSlidingSyncSupported();
    }

    public supportsThreads(): boolean {
        return this.getServerCapabilitiesManager().supportsThreads();
    }

    public supportsIntentionalMentions(): boolean {
        return this.getServerCapabilitiesManager().supportsIntentionalMentions();
    }

    public async getMyRooms(): Promise<{ rooms: IMyRoomInfo[]; total: number }> {
        return this.getRoomManager().getMyRooms() as Promise<{ rooms: IMyRoomInfo[]; total: number }>;
    }

    public async createSecureBackup(passphrase: string): Promise<ISecureBackupInfo> {
        return createSecureBackupRequest<ISecureBackupInfo>(passphrase, this.authedRequestProxy);
    }

    public async searchRooms(
        searchTerm: string,
        limit?: number,
    ): Promise<{ results: unknown[]; count: number; next_batch: string | null }> {
        return this.getRoomManager().searchRooms(searchTerm, limit);
    }

    public async searchRecipients(
        searchTerm: string,
        limit?: number,
    ): Promise<{ results: unknown[]; count: number; next_batch: string | null }> {
        return this.getSearchManager().searchRecipients({ term: searchTerm, limit });
    }

    public async getClientConfig(): Promise<{
        homeserver: { base_url: string; server_name: string };
        identity_server: { base_url: string };
        push: { enabled: boolean };
        email: { enabled: boolean };
        features: Record<string, boolean>;
        defaults: Record<string, unknown>; // Dynamic: server-defined default configuration values
    }> {
        return getClientConfigRequest(this.authedRequestProxy);
    }

    public async getSSOUserInfo(): Promise<{
        sub: string;
        name?: string;
        picture?: string;
        email?: string;
    }> {
        return getSSOUserInfoRequest(this.authedRequestProxy);
    }

    public async getSecureBackup(backupId: string): Promise<ISecureBackupInfo> {
        return getSecureBackupRequest<ISecureBackupInfo>(backupId, this.authedRequestProxy);
    }

    public async verifySecureBackupPassphrase(
        backupId: string,
        passphrase: string,
    ): Promise<ISecureBackupVerifyResponse> {
        return verifySecureBackupPassphraseRequest<ISecureBackupVerifyResponse>(
            backupId,
            passphrase,
            this.authedRequestProxy,
        );
    }

    public async storeSecureBackupKeys(
        backupId: string,
        passphrase: string,
        sessionKeys: ISecureBackupSessionKey[],
    ): Promise<ISecureBackupStoreKeysResponse> {
        return storeSecureBackupKeysRequest<ISecureBackupStoreKeysResponse>(
            backupId,
            passphrase,
            sessionKeys,
            this.authedRequestProxy,
        );
    }

    public async restoreSecureBackup(backupId: string, passphrase: string): Promise<ISecureBackupRestoreResponse> {
        return restoreSecureBackupRequest<ISecureBackupRestoreResponse>(backupId, passphrase, this.authedRequestProxy);
    }

    public async deleteSecureBackup(backupId: string): Promise<EmptyObject> {
        return deleteSecureBackupRequest(backupId, this.authedRequestProxy);
    }

    public processThreadEvents(room: Room, threadedEvents: MatrixEvent[], toStartOfTimeline: boolean): void {
        this.getTimelineManager().processThreadEvents(room, threadedEvents, toStartOfTimeline);
    }

    public processThreadRoots(room: Room, threadedEvents: MatrixEvent[], toStartOfTimeline: boolean): void {
        this.getTimelineManager().processThreadRoots(room, threadedEvents, toStartOfTimeline, this.supportsThreads());
    }

    public processBeaconEvents(room?: Room, events?: MatrixEvent[]): void {
        this.getTimelineManager().processBeaconEvents(room, events);
    }

    public processAggregatedTimelineEvents(room?: Room, events?: MatrixEvent[]): void {
        this.getTimelineManager().processAggregatedTimelineEvents(room, events);
    }

    private processPaginationEvents(
        eventTimeline: EventTimeline,
        matrixEvents: MatrixEvent[],
        backwards: boolean,
        token: string | null,
        room?: Room,
        options: {
            partitionThreads?: boolean;
            processThreadRoots?: boolean;
        } = {},
    ): void {
        this.getTimelineManager().processPaginationEvents(
            eventTimeline,
            matrixEvents,
            backwards,
            token,
            room,
            options,
            this.supportsThreads(),
        );
    }

    public async whoami(): Promise<IWhoamiResponse> {
        return this.http.authedRequest(Method.Get, "/account/whoami");
    }

    public async timestampToEvent(
        roomId: string,
        timestamp: number,
        dir: Direction,
    ): Promise<TimestampToEventResponse> {
        return timestampToEventRequest<TimestampToEventResponse>(roomId, timestamp, dir, this.authedRequestProxy);
    }

    public async getAuthMetadata(): Promise<OidcClientConfig> {
        return fetchAuthMetadataWithFallback(this.http.request.bind(this.http), this.isVersionSupported.bind(this));
    }

    public getCryptoAlgorithm(): unknown {
        return undefined;
    }
    public setCryptoAlgorithm(_algorithm: unknown): void {}
    public hasCrypto(): boolean {
        return false;
    }
    public async initCrypto(): Promise<void> {}
    public stopCrypto(): void {}
    public cryptoStore: unknown = undefined;
    public async deleteCryptoStore(): Promise<void> {}
    public isCryptoStoreReady(): boolean {
        return false;
    }
    public rotateEncryptionKeys(): Promise<void> {
        return this.getKeyRotationManager()
            .rotateKey()
            .then(() => {});
    }
    public isRotationNeeded(): boolean {
        return false;
    }
    public getRotationPeriod(): number {
        return 0;
    }
    public setRotationPeriod(_period: number): void {
        // No-op: encryption-rotation module removed, use getKeyRotationManager() instead
    }
    public getLastRotationTime(): number {
        return 0;
    }
    public getRoomWithHighestUnread(): Room | null {
        return null;
    }
    public getRoomsWithUnreadNotifications(): Room[] {
        return [];
    }
    public rooms: Room[] = [];
    public getRoomByAlias(_alias: string): Room | null {
        return null;
    }
    public sortRoomsByLastMessage(): void {}
    public claimKeys(_users: Record<string, string[]>): Promise<unknown> {
        return Promise.resolve(undefined);
    }
    public claimedKeys: Record<string, Record<string, string>> = {};
    public getUserStorageUsage(_userId: string): Promise<{ size: number; ntFiles: number } | null> {
        return Promise.resolve(null);
    }
    public getNotificationCount(_roomId: string): number {
        return 0;
    }
    public getHighlightCount(_roomId: string): number {
        return 0;
    }
    public hasUnreadNotifications(_roomId: string): boolean {
        return false;
    }
    public hasUnreadHighlights(_roomId: string): boolean {
        return false;
    }
    public notificationCallback: unknown = undefined;
    public getTotalNotificationCount(): number {
        return 0;
    }
    public getTotalHighlightCount(): number {
        return 0;
    }
    public getPendingEvents(_roomId: string): MatrixEvent[] {
        return [];
    }
    public hasPendingEvents(_roomId: string): boolean {
        return false;
    }
    public getUnsentEvents(_roomId: string): MatrixEvent[] {
        return [];
    }
    public reactToMessage(roomId: string, eventId: string, key: string): Promise<void> {
        return this.getRoomEventsManager()
            .sendReaction(roomId, eventId, key)
            .then(() => undefined);
    }
    public async redactReaction(_roomId: string, _eventId: string): Promise<void> {}
    public getReactionUsers(roomId: string, eventId: string): Promise<Array<{ userId: string }>> {
        return this.getReactionsManager()
            .getReactionUsers(roomId, eventId)
            .then((users) => users.map((userId) => ({ userId })));
    }
    public hasReaction(roomId: string, eventId: string, userId: string, key: string): Promise<boolean> {
        return this.getReactionsManager().hasReaction(roomId, eventId, userId, key);
    }
    public getRoomRetention(_roomId: string): Promise<unknown> {
        return Promise.resolve(undefined);
    }
    public setRoomRetention(_roomId: string, _retention: unknown): Promise<void> {
        return Promise.resolve();
    }
    public getServerRetention(): Promise<unknown> {
        return Promise.resolve(undefined);
    }
    public shareRoomKey(_roomId: string, _users: string[]): Promise<unknown> {
        return Promise.resolve(undefined);
    }
    public getSharedWithUsers(_roomId: string): Promise<SharedWithUsersMap> {
        return Promise.resolve({});
    }
    public hasSharedKeyWithUser(_userId: string): Promise<boolean> {
        return Promise.resolve(false);
    }
    public exportRoomKeys(): Promise<unknown> {
        return Promise.resolve(undefined);
    }
    public importRoomKeys(_keys: unknown[], _options?: unknown): Promise<unknown> {
        return Promise.resolve(undefined);
    }
    public isSecretStorageReady(): Promise<boolean> {
        return this.getSecretStorageManager().isSecretStorageReady();
    }
    public getSecretStorageKey(keyId: string): Promise<[string, string] | null> {
        return this.getSecretStorageManager().getSecretStorageKey(keyId);
    }
    public storeSecret(name: string, secret: string, keys?: string[]): Promise<void> {
        return this.getSecretStorageManager().storeSecret(name, secret, keys);
    }
    public getSecret(name: string): Promise<string | null> {
        return this.getSecretStorageManager().getSecret(name);
    }
    public hasSecret(name: string): Promise<boolean> {
        return this.getSecretStorageManager().hasSecret(name);
    }
    public getSecretStorageKeys(): Promise<Record<string, string>> {
        return this.getSecretStorageManager().getSecretStorageKeys();
    }
    public getServerCapabilities(): Promise<Capabilities> {
        return this.getServerCapabilitiesManager().getServerCapabilities();
    }
    public hasServerSupport(feature: string): boolean {
        return this.getServerCapabilitiesManager().hasServerSupport(feature);
    }
    public getServerVersion(): Promise<string> {
        return this.getServerCapabilitiesManager().getServerVersion();
    }
    public supportsLocation(): boolean {
        return this.getServerCapabilitiesManager().supportsLocation();
    }
    public serverClockDiff: number = 0;
    public getLocalTimestampForServerTime(serverTs: number): number {
        return this.getServerTimeManager().getLocalTimestampForServerTime(serverTs);
    }
    public getServerTimestamp(): number {
        return this.getServerTimeManager().getServerTimestamp();
    }
    public updateServerTimeInfo(serverTime: number, serverDate: string): void {
        this.getServerTimeManager().updateServerTimeInfo(serverTime, serverDate);
    }
    public waitForPendingRequests(_timeoutMs: number): Promise<void> {
        return Promise.resolve();
    }
    public hasStartedSync(): boolean {
        return false;
    }
    public isSyncing(): boolean {
        return this.getSyncManager().isSyncing();
    }
    public async waitForSync(): Promise<void> {}
    public syncToken: string | null = null;
    public syncing: boolean = false;
    public getTurnServerURIs(): Promise<string[]> {
        return this.getTurnServerManager().getTurnServerURIs();
    }
    public getUserWidgets(): Promise<WidgetData> {
        return Promise.resolve({});
    }
    public getRoomWidgets(_roomId: string): Promise<WidgetData> {
        return Promise.resolve({});
    }
    public setUserWidgets(_widgets: WidgetData): Promise<void> {
        return Promise.resolve();
    }
    public setRoomWidgets(_roomId: string, _widgets: WidgetData): Promise<void> {
        return Promise.resolve();
    }
    public getAllWidgetEvents(_roomId: string): Promise<MatrixEvent[]> {
        return Promise.resolve([]);
    }
    public getProfileManager(): ProfileManager {
        return null!;
    }
}

export { fixNotificationCountOnDecryption, inMainTimelineForReceipt, threadIdForReceipt };
