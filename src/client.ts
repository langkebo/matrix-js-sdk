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
import { FeatureSupport, THREAD_RELATION_TYPE, ThreadFilterType } from "./models/thread";
import { NamespacedValue, UnstableValue } from "./NamespacedValue";
import { ToDeviceMessageQueue } from "./ToDeviceMessageQueue";
import { IgnoredInvites } from "./models/invites-ignorer";
import { type LocalNotificationSettings } from "./@types/local_notifications";
import { Feature, ServerSupport } from "./feature";
import { M_BEACON_INFO, type MBeaconInfoEventContent } from "./@types/beacon";
import { type CryptoBackend } from "./common-crypto/CryptoBackend";
import { RUST_SDK_STORE_PREFIX } from "./rust-crypto/constants";
import { type CryptoApi, type CryptoCallbacks, CryptoEvent, type CryptoEventHandlerMap } from "./crypto-api/index";
import type { UserDeviceMap } from "./matrix-client-extensions";
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
import { prepareSendCompleteEventLifecycle } from "./client-send-lifecycle";
import { encryptAndSendEventWorkflow } from "./client-encrypt-send";
import { dispatchSendEventHttpRequest } from "./client-send-http";
import { buildEditContent, buildReplyContent, normalizeThreadBodyArgs } from "./client-message-composition.ts";
import { createSchedulerProcessFunction } from "./client-scheduler-process.ts";
import { makeKeyBackupPath } from "./key-backup-paths.ts";
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
    type ISecureBackupCreateBody,
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
import {
    buildSyncApiOptions as buildSyncApiOptionsHelper,
    startClientLifecycleServices,
} from "./client-lifecycle-start";
import { releaseCryptoBackend, stopClientLifecycleServices } from "./client-lifecycle-stop";
import { clearClientStores } from "./client-store-cleanup";
import { createGroupCallForRoom } from "./client-voip-group-call";
import { EventManager } from "./event/EventManager";

export type {
    IClientWellKnown,
    ICreateRoomKeyRequest,
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
    ISecureBackupCreateBody,
    ISecureBackupInfo,
    ISecureBackupRestoreResponse,
    ISecureBackupSessionKey,
    ISecureBackupStoreKeysResponse,
    ISecureBackupVerifyResponse,
    IServerVersions,
    ITileServerWellKnown,
    ITurnServer,
    ITurnServerResponse,
    IUploadKeySignaturesResponse,
    RoomSummary,
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

export { TURN_CHECK_INTERVAL } from "./client-lifecycle-start";

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

    public readonly logger: Logger; // Intended private, used in lifecycle helpers.

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

    public cryptoBackend?: CryptoBackend; // Intended private, used in lifecycle helpers.

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
    public peekSync: SyncApi | null = null; // Intended protected, used in lifecycle helpers.
    protected isGuestAccount = false;

    /**
     * Legacy crypto store used for migration from the legacy crypto to the rust crypto
     * @private
     */
    public readonly legacyCryptoStore?: CryptoStore; // Intended private, used in lifecycle helpers.
    protected verificationMethods?: string[];
    protected fallbackICEServerAllowed = false;
    public syncApi?: SlidingSyncSdk | SyncApi; // Intended protected, used in lifecycle helpers.
    public roomNameGenerator?: ICreateClientOpts["roomNameGenerator"];
    public pushRules?: IPushRules;
    protected syncLeftRoomsPromise?: Promise<Room[]>;
    protected syncedLeftRooms = false;
    public clientOpts?: IStoredClientOpts; // Intended protected, used in lifecycle helpers.
    public clientWellKnownIntervalID?: ReturnType<typeof setInterval>; // Intended protected, used in lifecycle helpers.
    public canResetTimelineCallback?: ResetTimelineCallback; // Intended protected, used in lifecycle helpers.

    public canSupport = new Map<Feature, ServerSupport>();

    // The pushprocessor caches useful things, so keep one and re-use it
    public readonly pushProcessor = new PushProcessor(this);

    // Promise to a response of the server's /versions response
    // Tracking issue: https://github.com/matrix-org/matrix-js-sdk/issues/1020
    protected serverVersionsPromise?: Promise<IServerVersions>;

    public clientWellKnown?: IClientWellKnown; // Intended protected, used in lifecycle helpers.
    protected clientWellKnownPromise?: Promise<IClientWellKnown>;
    public turnServers: ITurnServer[] = []; // Intended protected, used in lifecycle helpers.
    public turnServersExpiry = 0; // Intended protected, used in lifecycle helpers.
    public checkTurnServersIntervalID?: ReturnType<typeof setInterval>; // Intended protected, used in lifecycle helpers.
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
    public toDeviceMessageQueue: ToDeviceMessageQueue; // Intended private, used in lifecycle helpers.
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

    public serverCapabilitiesService: ServerCapabilities; // Intended private, used in lifecycle helpers.

    /**
     * Manager 扩展初始化完成的 Promise（由 createClient 注入）。
     * createClient 同步返回时仅 8 个核心 manager 可用，其余约 55 个私有
     * manager（friend/ai/...）经异步动态 import 挂载。调用方在使用这些
     * manager 前应 `await client.whenManagerExtensionsReady()`。
     */
    private managerExtensionsReady?: Promise<void>;

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
            logger: this.logger,
        });

        if (opts.pickleKey) {
            this.legacyPickleKey = opts.pickleKey;
        }

        this.useLivekitForGroupCalls = Boolean(opts.useLivekitForGroupCalls);

        this.scheduler = opts.scheduler;
        if (this.scheduler) {
            // 回调实现已抽到 client-scheduler-process.ts（P3-5），这里只注入依赖
            this.scheduler.setProcessFunction(
                createSchedulerProcessFunction({
                    getRoom: (roomId) => this.getRoom(roomId),
                    updatePendingEventStatus: (room, event, status) =>
                        this.updatePendingEventStatus(room, event, status),
                    sendEventHttpRequest: (event) => this.sendEventHttpRequest(event),
                }),
            );
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

    /**
     * 注入 manager 扩展初始化的 Promise（由 createClient 调用）。
     * @internal
     *
     * @example
     * ```typescript
     * client.setManagerExtensionsReady(Promise.resolve());
     * ```
     */
    public setManagerExtensionsReady(promise: Promise<void>): void {
        this.managerExtensionsReady = promise;
    }

    /**
     * 等待所有 manager 扩展异步挂载完成。
     *
     * `createClient()` 同步返回时仅核心 manager 可用，friend/ai/... 等私有
     * manager 经异步动态 import 挂载。使用这些 manager 前应 `await` 本方法。
     *
     * @returns 当 manager 初始化完成（或已跳过/失败）时 resolve 的 Promise。
     *
     * @example
     * ```typescript
     * await client.whenManagerExtensionsReady();
     * const friendManager = client.getFriendManager();
     * ```
     */
    public whenManagerExtensionsReady(): Promise<void> {
        return this.managerExtensionsReady ?? Promise.resolve();
    }

    /**
     * 获取事件管理器。
     *
     * @returns 与当前客户端关联的 EventManager
     *
     * @example
     * ```typescript
     * const eventManager = client.getEventManager();
     * ```
     */
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
     *
     * @example
     * ```typescript
     * client.on(ClientEvent.Sync, (state) => {
     *     if (state === SyncState.Prepared) console.log(`已加入 ${client.getRooms().length} 个房间`);
     * });
     *
     * await client.startClient({ initialSyncLimit: 20 });
     * ```
     *
     * @example
     * ```typescript
     * // 不需要异步扩展 manager 时，可省掉动态 import 的开销
     * const client = createClient({ baseUrl, accessToken, userId, deviceId, disableDynamicExtensions: true });
     * await client.startClient();
     * ```
     */
    public async startClient(opts?: IStartClientOpts): Promise<void> {
        if (this.clientRunning) {
            // client is already running.
            return;
        }
        this.clientRunning = true;

        this.on(ClientEvent.Sync, this.startMatrixRTC);

        this.clientOpts = opts ?? {};
        await startClientLifecycleServices(this, this.clientOpts);
    }

    /**
     * Construct a SyncApiOptions for this client, suitable for passing into the SyncApi constructor
     *
     * @example
     * ```typescript
     * const syncApiOptions = client.buildSyncApiOptions();
     * ```
     */
    public buildSyncApiOptions(): SyncApiOptions {
        return buildSyncApiOptionsHelper(this);
    }

    /**
     * High level helper method to stop the client from polling and allow a
     * clean shutdown.
     *
     * Idempotent: calling it when the client is already stopped is a no-op. Always call this
     * before dropping the client — leaving the sync loop running leaks timers and in-flight
     * requests in long-lived hosts.
     *
     * @example
     * ```typescript
     * const shutdown = (): void => {
     *     client.stopClient();
     *     process.exit(0);
     * };
     * process.on("SIGINT", shutdown);
     * process.on("SIGTERM", shutdown);
     * ```
     */
    public stopClient(): void {
        releaseCryptoBackend(this); // crypto may be live even if the client was never started

        this.off(ClientEvent.Sync, this.startMatrixRTC);

        if (!this.clientRunning) return; // already stopped

        this.logger.debug("stopping MatrixClient");

        this.clientRunning = false;
        stopClientLifecycleServices(this);
    }

    /**
     * Clear any data out of the persistent stores used by the client.
     *
     * @param args.cryptoDatabasePrefix - The database name to use for indexeddb, defaults to 'matrix-js-sdk'.
     * @returns Promise which resolves when the stores have been cleared.
     *
     * @example
     * ```typescript
     * await client.clearStores();
     * ```
     */
    public async clearStores(
        args: {
            cryptoDatabasePrefix?: string;
        } = {},
    ): Promise<void> {
        return clearClientStores(this, args);
    }

    /**
     * Get the user-id of the logged-in user
     *
     * @returns MXID for the logged-in user, or null if not logged in
     *
     * @example
     * ```typescript
     * const userId = client.getUserId();
     * console.log(userId);
     * ```
     */
    public getUserId(): string | null {
        return this.credentials?.userId ?? null;
    }

    /**
     * Get the user-id of the logged-in user
     *
     * @returns MXID for the logged-in user
     * @throws Error if not logged in
     *
     * @example
     * ```typescript
     * try {
     *     const userId = client.getSafeUserId();
     *     console.log(userId);
     * } catch (e) {
     *     console.error("用户未登录", e);
     * }
     * ```
     */
    public getSafeUserId(): string {
        const userId = this.credentials?.userId ?? null;
        if (!userId) {
            throw new Error("Expected logged in user but found none.");
        }
        return userId;
    }

    /**
     * Get the domain for this client's MXID
     * @returns Domain of this MXID
     *
     * @example
     * ```typescript
     * const domain = client.getDomain();
     * console.log(domain);
     * ```
     */
    public getDomain(): string | null {
        const userId = this.credentials?.userId ?? null;
        if (userId) {
            return userId.split(":")[1] || null;
        }
        return null;
    }

    /**
     * Get the local part of the current user ID e.g. "foo" in "\@foo:bar".
     * @returns The user ID localpart or null.
     *
     * @example
     * ```typescript
     * const localpart = client.getUserIdLocalpart();
     * console.log(localpart);
     * ```
     */
    public getUserIdLocalpart(): string | null {
        return this.credentials?.userId?.split(":")[0].substring(1) ?? null;
    }

    /**
     * Get the device ID of this client
     * @returns device ID
     *
     * @example
     * ```typescript
     * const deviceId = client.getDeviceId();
     * console.log(deviceId);
     * ```
     */
    public getDeviceId(): string | null {
        return this.deviceId ?? null;
    }

    /**
     * Get the session ID of this client
     * @returns session ID
     *
     * @example
     * ```typescript
     * const sessionId = client.getSessionId();
     * console.log(sessionId);
     * ```
     */
    public getSessionId(): string {
        return this.sessionId;
    }

    /**
     * Check if the runtime environment supports VoIP calling.
     * @returns True if VoIP is supported.
     *
     * @example
     * ```typescript
     * if (client.supportsVoip()) {
     *     console.log("当前环境支持 VoIP 通话");
     * }
     * ```
     */
    public supportsVoip(): boolean {
        return !this.disableVoip && this.canSupportVoip;
    }

    /**
     * @returns
     *
     * @example
     * ```typescript
     * const mediaHandler = client.getMediaHandler();
     * ```
     */
    public getMediaHandler(): MediaHandler {
        return this.mediaHandler;
    }

    /**
     * Set whether VoIP calls are forced to use only TURN
     * candidates. This is the same as the forceTURN option
     * when creating the client.
     * @param force - True to force use of TURN servers
     *
     * @example
     * ```typescript
     * client.setForceTURN(true);
     * ```
     */
    public setForceTURN(force: boolean): void {
        this.forceTURN = force;
    }

    /**
     * Set whether to advertise transfer support to other parties on Matrix calls.
     * @param support - True to advertise the 'm.call.transferee' capability
     *
     * @example
     * ```typescript
     * client.setSupportsCallTransfer(true);
     * ```
     */
    public setSupportsCallTransfer(support: boolean): void {
        this.supportsCallTransfer = support;
    }

    /**
     * Returns true if to-device signalling for group calls will be encrypted with Olm.
     * If false, it will be sent unencrypted.
     * @returns boolean Whether group call signalling will be encrypted
     *
     * @example
     * ```typescript
     * const encrypted = client.getUseE2eForGroupCall();
     * console.log(encrypted);
     * ```
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
     *
     * @example
     * ```typescript
     * const call = client.createCall("!room:example.org");
     * await call?.placeVoiceCall();
     * ```
     */
    public createCall(roomId: string): MatrixCall | null {
        return createNewMatrixCall(this, roomId);
    }

    /**
     * Creates a new group call and sends the associated state event
     * to alert other members that the room now has a group call.
     *
     * @param roomId - The room the call is to be placed in.
     *
     * @example
     * ```typescript
     * const groupCall = await client.createGroupCall("!room:example.org", GroupCallType.Voice, false, GroupCallIntent.Prompt);
     * ```
     */
    public async createGroupCall(
        roomId: string,
        type: GroupCallType,
        isPtt: boolean,
        intent: GroupCallIntent,
        dataChannelsEnabled?: boolean,
        dataChannelOptions?: IGroupCallDataChannelOptions,
    ): Promise<GroupCall> {
        return createGroupCallForRoom(this, roomId, type, isPtt, intent, dataChannelsEnabled, dataChannelOptions);
    }

    /**
     * 获取 LiveKit 服务 URL。
     *
     * @returns 已配置的 LiveKit 服务 URL；未配置时返回 undefined
     *
     * @example
     * ```typescript
     * const url = client.getLivekitServiceURL();
     * console.log(url);
     * ```
     */
    public getLivekitServiceURL(): string | undefined {
        return this.livekitServiceURL;
    }

    // This shouldn't need to exist, but the widget API has startup ordering problems that
    // mean it doesn't know the livekit URL fast enough: remove this once this is fixed.
    /**
     * 设置 LiveKit 服务 URL。
     *
     * @param newURL - 新的 LiveKit 服务 URL
     *
     * @example
     * ```typescript
     * client.setLivekitServiceURL("wss://livekit.example.org");
     * ```
     */
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
     *
     * @example
     * ```typescript
     * await client.waitUntilRoomReadyForGroupCalls("!room:example.org");
     * const groupCall = client.getGroupCallForRoom("!room:example.org");
     * ```
     */
    public waitUntilRoomReadyForGroupCalls(roomId: string): Promise<void> {
        return this.groupCallEventHandler!.waitUntilRoomReadyForGroupCalls(roomId);
    }

    /**
     * Get an existing group call for the provided room.
     * @returns The group call or null if it doesn't already exist.
     *
     * @example
     * ```typescript
     * const groupCall = client.getGroupCallForRoom("!room:example.org");
     * ```
     */
    public getGroupCallForRoom(roomId: string): GroupCall | null {
        return this.groupCallEventHandler!.groupCalls.get(roomId) || null;
    }

    /**
     * Get the current sync state.
     * @returns the sync state, which may be null.
     * @see MatrixClient#event:"sync"
     *
     * @example
     * ```typescript
     * const state = client.getSyncState();
     * console.log(state);
     * ```
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
     *
     * @example
     * ```typescript
     * const data = client.getSyncStateData();
     * console.log(data?.error);
     * ```
     */
    public getSyncStateData(): ISyncStateData | null {
        return this.getSyncManager().getSyncStateData();
    }

    /**
     * Whether the initial sync has completed.
     * @returns True if at least one sync has happened.
     *
     * @example
     * ```typescript
     * if (client.isInitialSyncComplete()) {
     *     console.log("初始同步已完成");
     * }
     * ```
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
     *
     * @example
     * ```typescript
     * const guest = client.isGuest();
     * console.log(guest);
     * ```
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
     *
     * @example
     * ```typescript
     * client.setGuest(true);
     * ```
     */
    public setGuest(guest: boolean): void {
        this.isGuestAccount = guest;
    }

    /**
     * Return the provided scheduler, if any.
     * @returns The scheduler or undefined
     *
     * @example
     * ```typescript
     * const scheduler = client.getScheduler();
     * console.log(scheduler);
     * ```
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
     *
     * @example
     * ```typescript
     * const retried = client.retryImmediately();
     * console.log(retried);
     * ```
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
     *
     * @example
     * ```typescript
     * const notifTimelineSet = client.getNotifTimelineSet();
     * ```
     */
    public getNotifTimelineSet(): EventTimelineSet | null {
        return this.getNotificationsManager().getNotifTimelineSet();
    }

    /**
     * Set the global notification EventTimelineSet
     *
     * @example
     * ```typescript
     * client.setNotifTimelineSet(timelineSet);
     * ```
     */
    public setNotifTimelineSet(set: EventTimelineSet): void {
        this.getNotificationsManager().setNotifTimelineSet(set);
    }

    /**
     * Gets the cached capabilities of the homeserver, returning cached ones if available.
     * If there are no cached capabilities and none can be fetched, throw an exception.
     *
     * @returns Promise resolving with The capabilities of the homeserver
     *
     * @example
     * ```typescript
     * const capabilities = await client.getCapabilities();
     * console.log(capabilities);
     * ```
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
     *
     * @example
     * ```typescript
     * const caps = client.getCachedCapabilities();
     * console.log(caps);
     * ```
     */
    public getCachedCapabilities(): Capabilities | undefined {
        return this.serverCapabilitiesService.getCachedCapabilities();
    }

    /**
     * Fetches the latest capabilities from the homeserver, ignoring any cached
     * versions. The newly returned version is cached.
     *
     * @returns A promise which resolves to the capabilities of the homeserver
     *
     * @example
     * ```typescript
     * const caps = await client.fetchCapabilities();
     * console.log(caps);
     * ```
     */
    public fetchCapabilities(): Promise<Capabilities> {
        return this.serverCapabilitiesService.fetchCapabilities();
    }

    /**
     * The top-level `unstable_features` map from the last `/capabilities`
     * fetch, or `undefined` if the server did not send one.
     *
     * synapse-rust returns this alongside `capabilities`
     * (`synapse-services/src/capability_governance.rs:451-465`); stock servers
     * omit it.
     *
     * @example
     * ```typescript
     * const features = client.getUnstableFeatures();
     * console.log(features);
     * ```
     */
    public getUnstableFeatures(): Record<string, boolean> | undefined {
        return this.serverCapabilitiesService.getUnstableFeatures();
    }

    /**
     * Whether the homeserver advertises a specific unstable feature.
     *
     * Matching is exact against the keys the server sent — see
     * {@link ServerCapabilities.hasUnstableFeature} for the real key set and
     * why prefix guessing was removed.
     *
     * @param name - exact feature key, or a bare `"4204"` / `"msc4204"` form
     *
     * @example
     * ```typescript
     * const supported = client.hasUnstableFeature("msc4204");
     * ```
     */
    public hasUnstableFeature(name: string): boolean {
        return this.serverCapabilitiesService.hasUnstableFeature(name);
    }

    /**
     * Get the device-key map for an arbitrary user via `POST /keys/query`.
     *
     * Returns a map of `deviceId → device content` for the requested user, which
     * is the shape `DeviceKeysManager.getUserDevices()` and the frontend device
     * list consume.
     *
     * **Why not `GET /devices`?** That endpoint is scoped to the *authenticated*
     * caller: `synapse-web/src/routes/device.rs` has no `{user_id}` path segment
     * and resolves the user from `auth_user.user_id`, returning
     * `{ devices: [ { device_id, display_name, ... } ] }` — an array, not a map.
     * Routing a third-party lookup (e.g. a friend's device list) through it
     * silently returns the caller's own devices and always misses the requested
     * `userId` key. `POST /keys/query` is the only endpoint that can look up
     * another user's devices, and it is what the E2EE stack uses anyway.
     *
     * @param userId - The user ID to query devices for
     * @returns A promise resolving to the `deviceId → device content` map; an
     *          empty object when the server reports no keys for the user.
     *
     * @example
     * ```typescript
     * const devices = await client.getUserDevices("@alice:example.org");
     * for (const [deviceId, device] of Object.entries(devices)) {
     *     console.log(deviceId, device);
     * }
     * ```
     *
     * @throws {Error} 当 userId 为空时抛出
     */
    public async getUserDevices(userId: string): Promise<UserDeviceMap> {
        if (!userId) {
            throw new Error("getUserDevices requires a userId");
        }
        const response = await this.http.authedRequest<{ device_keys?: Record<string, UserDeviceMap> }>(
            Method.Post,
            "/keys/query",
            undefined,
            // Empty device list means "all devices of this user".
            { device_keys: { [userId]: [] } },
            // 5th parameter is IRequestOpts, not a bare prefix.
            { prefix: ClientPrefix.V3 },
        );
        return response?.device_keys?.[userId] ?? {};
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
     * @param args.allowInMemoryStore - Explicit opt-out from the ISSUE-08b default-deny guard on unencrypted
     *    in-memory crypto stores. **For tests / temporary sessions only** — it is rejected outright when
     *    `NODE_ENV=production`. Production callers must pass a `storageKey` derived from a system keychain.
     *
     * @returns a Promise which will resolve when the crypto layer has been
     *    successfully initialised.
     *
     * @example
     * ```typescript
     * // 生产：密钥来自系统钥匙串的 32 字节 key
     * await client.initRustCrypto({ useIndexedDB: true, storageKey: await readFromKeychain("tjg.crypto.store") });
     *
     * const crypto = client.getCrypto();
     * await crypto?.bootstrapCrossSigning({});
     * ```
     *
     * @example
     * ```typescript
     * // 仅测试 / 临时会话：内存密钥库（生产构建会拒绝）
     * await client.initRustCrypto({ useIndexedDB: false, allowInMemoryStore: true });
     * ```
     *
     * @throws {Error} If `userId` or `deviceId` is unknown — call `createClient({ userId, deviceId })` first.
     * @throws {Error} `Refusing to open unencrypted in-memory crypto store; ...` when neither a store key
     *    nor `allowInMemoryStore` is supplied.
     * @throws {Error} `allowInMemoryStore is not permitted in production builds` under `NODE_ENV=production`.
     */
    public async initRustCrypto(
        args: {
            useIndexedDB?: boolean;
            cryptoDatabasePrefix?: string;
            storageKey?: Uint8Array;
            storagePassword?: string;
            /**
             * Explicit opt-out from the ISSUE-08b default-deny guard on unencrypted in-memory
             * crypto stores. For tests / temporary sessions only.
             *
             * Production callers must instead provide `storageKey`/`storagePassword` derived
             * from a system keychain. Not auto-implied by `useIndexedDB: false`.
             */
            allowInMemoryStore?: boolean;
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

        // ISSUE-08: "DEFAULT_KEY" 公开兜底已删除。不在 client 层早期失败——
        // createClient() 总会创建空 MemoryCryptoStore，故 legacyCryptoStore 恒被设置。
        // pickleKey 仅在 store 实际持有待迁移加密数据时才需要；空 store 直接跳过迁移。
        // 真正需要 pickleKey 的检查下沉到 migrateFromLegacyCrypto() 内（libolm_migration.ts）。
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
            // ISSUE-08b: 显式转发 opt-out，不自动隐含（保生产安全）
            allowInMemoryStore: args.allowInMemoryStore,

            legacyCryptoStore: this.legacyCryptoStore,
            // ISSUE-08: 不再兜底公开的 "DEFAULT_KEY"；空 store 无需 pickleKey，有数据时迁移层校验
            legacyPickleKey: this.legacyPickleKey,
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
     *
     * @returns The {@link CryptoApi}, or `undefined` when crypto is not initialised.
     *
     * @example
     * ```typescript
     * await client.initRustCrypto({ useIndexedDB: true, storageKey });
     *
     * const crypto = client.getCrypto();
     * if (!crypto) throw new Error("crypto 未初始化");
     *
     * console.log(await crypto.isCrossSigningReady());
     * console.log((await crypto.getOwnDeviceKeys()).ed25519);
     * ```
     */
    public getCrypto(): CryptoApi | undefined {
        return this.cryptoBackend;
    }

    /**
     * Get the crypto backend instance.
     * This is intended for internal use by managers that need direct access to crypto functionality.
     * @returns The crypto backend instance, or undefined if crypto is not enabled.
     * @internal
     *
     * @example
     * ```typescript
     * const backend = client.getCryptoBackend();
     * ```
     */
    public getCryptoBackend(): CryptoBackend | undefined {
        return this.cryptoBackend;
    }

    /**
     * Get the stored client options.
     * This is intended for internal use by managers that need access to client configuration.
     * @returns The stored client options, or undefined if not set.
     * @internal
     *
     * @example
     * ```typescript
     * const opts = client.getClientOpts();
     * ```
     */
    public getClientOpts(): IStoredClientOpts | undefined {
        return this.clientOpts;
    }

    /**
     * Build sync API options for this client.
     * This is intended for internal use by managers that need to create SyncApi instances.
     * @returns The sync API options.
     * @internal
     *
     * @example
     * ```typescript
     * const opts = client.getSyncApiOptions();
     * ```
     */
    public getSyncApiOptions(): SyncApiOptions {
        return this.buildSyncApiOptions();
    }

    /**
     * Check whether the key backup private key is stored in secret storage.
     * @returns map of key name to key info the secret is
     *     encrypted with, or null if it is not present or not encrypted with a
     *     trusted key
     *
     * @example
     * ```typescript
     * const storedKeys = await client.isKeyBackupKeyStored();
     * ```
     */
    public isKeyBackupKeyStored(): Promise<Record<string, SecretStorageKeyDescription> | null> {
        return Promise.resolve(this.secretStorage.isStored("m.megolm_backup.v1"));
    }

    private makeKeyBackupPath(roomId?: string, sessionId?: string, version?: string): IKeyBackupPath {
        // 实现已抽到 key-backup-paths.ts（P3-5），保留私有方法以维持调用点不变
        return makeKeyBackupPath(roomId, sessionId, version);
    }

    /**
     * 从服务端密钥备份中删除指定房间/会话的密钥。
     *
     * @param roomId - 房间 ID
     * @param sessionId - 会话 ID
     * @param version - 要删除的备份版本；省略时使用当前版本
     * @returns 删除完成时 resolve 的 Promise
     *
     * @example
     * ```typescript
     * await client.deleteKeysFromBackup("!room:example.org", "sessionId", "1");
     * ```
     */
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
     *
     * @example
     * ```typescript
     * const mediaConfig = await client.getMediaConfig();
     * ```
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
     *
     * @example
     * ```typescript
     * const room = client.getRoom("!room:example.org");
     * ```
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
     *
     * @example
     * ```typescript
     * const rooms = client.getRooms();
     * ```
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
     *
     * @example
     * ```typescript
     * const rooms = client.getVisibleRooms();
     * ```
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
     *
     * @example
     * ```typescript
     * const user = client.getUser("@alice:example.org");
     * ```
     */
    public getUser(userId: string): User | null {
        return this.store.getUser(userId);
    }

    /**
     * Retrieve all known users.
     * @returns A list of users, or an empty list if there is no data store.
     *
     * @example
     * ```typescript
     * const users = client.getUsers();
     * ```
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
     *
     * @example
     * ```typescript
     * await client.setAccountData("m.direct", { "@alice:example.org": ["!room:example.org"] });
     * ```
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
     *
     * @example
     * ```typescript
     * await client.setAccountDataRaw("m.direct", { "@alice:example.org": ["!room:example.org"] });
     * ```
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
     *
     * @example
     * ```typescript
     * const event = client.getAccountData("m.direct");
     * console.log(event?.getContent());
     * ```
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
     *
     * @example
     * ```typescript
     * const content = await client.getAccountDataFromServer("m.direct");
     * console.log(content);
     * ```
     */
    public async getAccountDataFromServer<K extends keyof AccountDataEvents>(
        eventType: K,
    ): Promise<AccountDataEvents[K] | null> {
        return this.getAccountDataManager().getAccountDataFromServer(eventType);
    }

    /**
     * 删除当前用户的指定类型的账户数据。
     *
     * @param eventType - 要删除的账户数据事件类型
     * @returns 删除完成时 resolve 的 Promise
     *
     * @example
     * ```typescript
     * await client.deleteAccountData("m.direct");
     * ```
     */
    public async deleteAccountData(eventType: keyof WritableAccountDataEvents): Promise<void> {
        return this.getAccountDataManager().deleteAccountData(eventType);
    }

    /**
     * Gets the users that are ignored by this client
     * @returns The array of users that are ignored (empty if none)
     *
     * @example
     * ```typescript
     * const ignored = client.getIgnoredUsers();
     * console.log(ignored);
     * ```
     */
    public getIgnoredUsers(): string[] {
        return this.getAccountDataManager().getIgnoredUsers();
    }

    /**
     * Sets the users that the current user should ignore.
     * @param userIds - the user IDs to ignore
     * @returns Promise which resolves: an empty object
     * @returns Rejects: with an error response.
     *
     * @example
     * ```typescript
     * await client.setIgnoredUsers(["@spammer:example.org"]);
     * ```
     */
    public setIgnoredUsers(userIds: string[]): Promise<EmptyObject> {
        return this.getAccountDataManager().setIgnoredUsers(userIds);
    }

    /**
     * Gets whether or not a specific user is being ignored by this client.
     * @param userId - the user ID to check
     * @returns true if the user is ignored, false otherwise
     *
     * @example
     * ```typescript
     * const ignored = client.isUserIgnored("@spammer:example.org");
     * ```
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
     *
     * @example
     * ```typescript
     * const room = await client.joinRoom("#example:example.org");
     * ```
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
     *
     * @example
     * ```typescript
     * const { room_id } = await client.knockRoom("#example:example.org");
     * ```
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
     *
     * @example
     * ```typescript
     * const res = await client.resendEvent(event, room);
     * console.log(res.event_id);
     * ```
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
     *
     * @example
     * ```typescript
     * client.cancelPendingEvent(event);
     * ```
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
     *
     * @example
     * ```typescript
     * await client.setRoomName("!room:example.org", "新房间名");
     * ```
     */
    public setRoomName(roomId: string, name: string): Promise<ISendEventResponse> {
        return this.getRoomManager().setRoomName(roomId, name);
    }

    /**
     * 设置房间主题（可选同时设置 HTML 版本主题）。
     *
     * @param roomId - 房间 ID
     * @param topic - 纯文本主题；不传则清除主题
     * @param htmlTopic - 主题的 HTML 版本
     * @returns Promise，解析为发送结果（含新事件的 `event_id`）
     *
     * @example
     * ```typescript
     * await client.setRoomTopic("!room:example.org", "项目讨论", "<b>项目</b>讨论");
     * ```
     */
    public setRoomTopic(roomId: string, topic?: string, htmlTopic?: string): Promise<ISendEventResponse> {
        return this.getRoomManager().setRoomTopic(roomId, topic, htmlTopic);
    }

    /**
     * 获取房间的标签（tag）及其元数据。
     *
     * @param roomId - 房间 ID
     * @returns Promise，解析为房间标签集合
     *
     * @example
     * ```typescript
     * const { tags } = await client.getRoomTags("!room:example.org");
     * console.log(tags);
     * ```
     */
    public getRoomTags(roomId: string): Promise<ITagsResponse> {
        return this.getRoomManager().getRoomTags(roomId);
    }

    /**
     * 为房间添加或更新一个标签。
     *
     * @param roomId - 房间 ID
     * @param tagName - 标签名称（如 `m.favourite`、`u.work`）
     * @param metadata - 标签的元数据（如 `order`）
     * @returns Promise，解析为空对象 `{}`
     *
     * @example
     * ```typescript
     * await client.setRoomTag("!room:example.org", "m.favourite", { order: 0.5 });
     * ```
     */
    public setRoomTag(roomId: string, tagName: string, metadata: ITagMetadata = {}): Promise<EmptyObject> {
        return this.getRoomManager().setRoomTag(roomId, tagName, metadata);
    }

    /**
     * 删除房间上的一个标签。
     *
     * @param roomId - 房间 ID
     * @param tagName - 要删除的标签名称
     * @returns Promise，解析为空对象 `{}`
     *
     * @example
     * ```typescript
     * await client.deleteRoomTag("!room:example.org", "m.favourite");
     * ```
     */
    public deleteRoomTag(roomId: string, tagName: string): Promise<EmptyObject> {
        return this.getRoomManager().deleteRoomTag(roomId, tagName);
    }

    /**
     * @param roomId - the ID of the room this event should be stored within
     * @param eventType - event type to be set
     * @param content - event content
     * @returns Promise which resolves: to an empty object `{}`
     * @returns Rejects: with an error response.
     *
     * @example
     * ```typescript
     * await client.setRoomAccountData("!room:example.org", "m.fully_read", { event_id: "$event:example.org" });
     * ```
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
     *
     * @example
     * ```typescript
     * await client.setPowerLevel("!room:example.org", "@alice:example.org", 50);
     * ```
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
     *
     * @example
     * ```typescript
     * const res = await client.unstable_createLiveBeacon("!room:example.org", beaconInfoContent);
     * console.log(res.event_id);
     * ```
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
     *
     * @example
     * ```typescript
     * const res = await client.unstable_setLiveBeacon("!room:example.org", beaconInfoContent);
     * console.log(res.event_id);
     * ```
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
    /**
     * Send a Matrix timeline event, optionally into a thread.
     *
     * Call the four-argument form to send into the room's main timeline, or the
     * five-argument form with a `threadId` to send the event into a thread.
     *
     * @param roomId - The room to send the event to.
     * @param threadId - The thread to send the event into, or `null` for the main timeline.
     *   Omitted entirely when calling the four-argument form.
     * @param eventType - The event type, for example `m.room.message`.
     * @param content - The event content.
     * @param txnId - An optional ID to deduplicate requests in case of repeated attempts.
     * @returns Promise which resolves: to an object containing the new event's `event_id`.
     * @returns Rejects: with an error response if the event could not be sent.
     * @throws May throw a `MatrixSafetyError` if content is deemed unsafe.
     * @see MatrixSafetyError
     * @example
     * ```typescript
     * // Send an event into the room's main timeline.
     * await client.sendEvent("!abcdef:example.org", "m.room.message", {
     *     msgtype: "m.text",
     *     body: "Hello world",
     * });
     *
     * // Send an event into a thread (pass the thread's root event ID second).
     * const threadId = "$root-event:example.org";
     * await client.sendEvent("!abcdef:example.org", threadId, "m.room.message", {
     *     msgtype: "m.text",
     *     body: "Hello from a thread",
     * });
     *
     * // Pass an explicit transaction ID so a retry is deduplicated by the server.
     * await client.sendEvent("!abcdef:example.org", "m.room.message", { msgtype: "m.text", body: "Hi" }, "txn-1");
     * ```
     */
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
     *
     * @example
     * ```typescript
     * await client.redactEvent("!room:example.org", "$event:example.org", undefined, { reason: "误发" });
     * ```
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

    /**
     * Send an `m.room.message` event to a room.
     *
     * Two call shapes are supported:
     * - `sendMessage(roomId, content)` — send to the room's top level (object overload).
     * - `sendMessage(roomId, threadId, content, txnId)` — send into a thread; pass `null` for `threadId`
     *   to target the top level explicitly.
     *
     * The second parameter is **`threadId`, not the message body**. If you only want to send text,
     * prefer {@link MatrixClient.sendTextMessage}, whose parameter meaning is unambiguous.
     *
     * @param roomId - The room to send to.
     * @param threadId - Thread root event id, or the message content itself (object overload).
     * @param content - The `m.room.message` content.
     * @param txnId - Optional local transaction id, used for local echo de-duplication
     *   and retry idempotency.
     * @returns The send result, including the server-assigned `event_id`.
     *
     * @example
     * ```typescript
     * // Top-level text message (object overload).
     * const res = await client.sendMessage(roomId, { msgtype: MsgType.Text, body: "hello" });
     * console.log(res.event_id);
     *
     * // Explicitly target the top level.
     * await client.sendMessage(roomId, null, { msgtype: MsgType.Text, body: "hello" });
     *
     * // Send into a thread.
     * await client.sendMessage(roomId, threadRootEventId, { msgtype: MsgType.Text, body: "in thread" });
     * ```
     *
     * @throws {SdkError} If the send fails — e.g. no permission in the room, unknown room,
     *   or content rejected by server-side policy. Inspect `err.isRetryable` / `err.retryAfter`
     *   to decide whether to retry.
     */
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

    /**
     * Replies to a given event with the given content.
     *
     * The reply content's `m.relates_to.m.in_reply_to` relation is built
     * automatically from the target event, and the reply is sent in the
     * target event's thread (if any).
     *
     * @param roomId - The room ID the target event is in.
     * @param event - The event to reply to.
     * @param content - The content of the reply event.
     * @param txnId - Optional transaction ID.
     * @returns Promise which resolves to the sent event's response.
     *
     * @example
     * ```typescript
     * await client.replyToEvent("!room:example.org", event, { msgtype: MsgType.Text, body: "收到" });
     * ```
     */
    public replyToEvent(
        roomId: string,
        event: MatrixEvent,
        content: RoomMessageEventContent,
        txnId?: string,
    ): Promise<ISendEventResponse> {
        // 关系构建与房间校验已抽到 client-message-composition.ts（P3-5）
        return this.sendMessage(roomId, event.threadRootId ?? null, buildReplyContent(roomId, event, content), txnId);
    }

    /**
     * Edits the given event with the given content.
     *
     * The edit is sent as an `m.replace` relation, with the new content
     * stored under `m.new_content`. The edit is sent in the target event's
     * thread (if any).
     *
     * @param roomId - The room ID the target event is in.
     * @param event - The event to edit.
     * @param content - The new content for the event.
     * @param txnId - Optional transaction ID.
     * @returns Promise which resolves to the sent event's response.
     *
     * @example
     * ```typescript
     * await client.editEvent("!room:example.org", event, { msgtype: MsgType.Text, body: "修正后的内容" });
     * ```
     */
    public editEvent(
        roomId: string,
        event: MatrixEvent,
        content: RoomMessageEventContent,
        txnId?: string,
    ): Promise<ISendEventResponse> {
        // 关系构建与房间校验已抽到 client-message-composition.ts（P3-5）
        return this.sendMessage(roomId, event.threadRootId ?? null, buildEditContent(roomId, event, content), txnId);
    }

    /**
     * Send a plain-text `m.room.message` to a room, or into a thread.
     *
     * This is the recommended entry point for sending chat text: unlike
     * {@link MatrixClient.sendMessage} there is no overload ambiguity between
     * "thread id" and "message content".
     *
     * Two call shapes:
     * - `sendTextMessage(roomId, body, txnId?)` — send to the top level.
     * - `sendTextMessage(roomId, threadId, body, txnId?)` — send into a thread.
     *
     * @param roomId - The room to send to.
     * @param body - The plaintext body. With the 4-argument form this slot is `threadId`.
     * @param txnId - Optional local transaction id.
     * @returns The send result, including the server-assigned `event_id`.
     *
     * @example
     * ```typescript
     * // Top level
     * const res = await client.sendTextMessage(roomId, "hello from quickstart");
     * console.log(res.event_id);
     *
     * // Into a thread
     * await client.sendTextMessage(roomId, threadRootEventId, "thread reply");
     * ```
     *
     * @throws {SdkError} If the send fails; see {@link MatrixClient.sendMessage}.
     */
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
        const { threadId, body, txnId: actualTxnId } = normalizeThreadBodyArgs(threadIdOrBody, bodyOrTxnId, txnId);

        return this.sendMessage(roomId, threadId, { msgtype: MsgType.Text, body }, actualTxnId);
    }

    /**
     * Send a notice (`msgtype: m.notice`) to a room, or into a thread.
     *
     * Notices are rendered by clients as system/bot output rather than a human
     * message — use them for automated status text, not for chat.
     *
     * Two call shapes:
     * - `sendNotice(roomId, body, txnId?)` — send to the top level.
     * - `sendNotice(roomId, threadId, body, txnId?)` — send into a thread.
     *
     * @param roomId - The room to send to.
     * @param body - The plaintext body. With the 4-argument form this slot is `threadId`.
     * @param txnId - Optional local transaction id.
     * @returns The send result, including the server-assigned `event_id`.
     *
     * @example
     * ```typescript
     * await client.sendNotice(roomId, "构建完成：3 项检查通过");
     * ```
     *
     * @throws {SdkError} If the send fails; see {@link MatrixClient.sendMessage}.
     */
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
        const { threadId, body, txnId: actualTxnId } = normalizeThreadBodyArgs(threadIdOrBody, bodyOrTxnId, txnId);

        return this.sendMessage(roomId, threadId, { msgtype: MsgType.Notice, body }, actualTxnId);
    }

    /**
     * 向房间或线程发送动作消息（`msgtype: m.emote`，即 `/me` 动作）。
     *
     * 支持两种调用形式：
     * - `sendEmoteMessage(roomId, body, txnId?)` —— 发送到房间主时间线。
     * - `sendEmoteMessage(roomId, threadId, body, txnId?)` —— 发送到指定线程。
     *
     * @param roomId - 目标房间 ID
     * @param body - 动作消息正文；四参数形式下该位置为 `threadId`
     * @param txnId - 可选的本地事务 ID
     * @returns Promise，解析为发送结果（含 `event_id`）
     *
     * @example
     * ```typescript
     * await client.sendEmoteMessage("!room:example.org", "笑了起来");
     * ```
     */
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
        const { threadId, body, txnId: actualTxnId } = normalizeThreadBodyArgs(threadIdOrBody, bodyOrTxnId, txnId);

        return this.sendMessage(roomId, threadId, { msgtype: MsgType.Emote, body }, actualTxnId);
    }

    /**
     * 向房间或线程发送图片消息（`msgtype: m.image`）。
     *
     * @param roomId - 目标房间 ID
     * @param threadId - 线程根事件 ID；传 `null` 表示发送到房间主时间线
     * @param url - 图片的 MXC URL 或 `ImageInfo` 对象
     * @param info - 图片元数据（或作为正文的字符串）
     * @param text - 图片的替代文本，默认 `"Image"`
     * @returns Promise，解析为发送结果（含 `event_id`）
     *
     * @example
     * ```typescript
     * await client.sendImageMessage("!room:example.org", null, "mxc://example.org/abc", { w: 800, h: 600 }, "示例图片");
     * ```
     */
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

    /**
     * 向房间或线程发送贴纸消息。
     *
     * @param roomId - 目标房间 ID
     * @param threadId - 线程根事件 ID；传 `null` 表示发送到房间主时间线
     * @param url - 贴纸的 MXC URL 或 `ImageInfo` 对象
     * @param info - 贴纸元数据（或作为正文的字符串）
     * @param text - 贴纸的替代文本，默认 `"Sticker"`
     * @returns Promise，解析为发送结果（含 `event_id`）
     *
     * @example
     * ```typescript
     * await client.sendStickerMessage("!room:example.org", null, "mxc://example.org/sticker", { w: 128, h: 128 });
     * ```
     */
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

    /**
     * 发送带 HTML 格式的文本消息（`format: org.matrix.custom.html`）。
     *
     * @param roomId - 目标房间 ID
     * @param threadIdOrBody - 线程根事件 ID；三参数形式下该位置为纯文本正文
     * @param bodyOrHtml - 纯文本正文；四参数形式下为 HTML 正文
     * @param htmlBody - HTML 正文
     * @returns Promise，解析为发送结果（含 `event_id`）
     *
     * @example
     * ```typescript
     * await client.sendHtmlMessage("!room:example.org", null, "加粗文本", "<strong>加粗文本</strong>");
     * ```
     */
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

    /**
     * 发送带 HTML 格式的提示消息（`msgtype: m.notice`）。
     *
     * @param roomId - 目标房间 ID
     * @param threadIdOrBody - 线程根事件 ID；三参数形式下该位置为纯文本正文
     * @param bodyOrHtml - 纯文本正文；四参数形式下为 HTML 正文
     * @param htmlBody - HTML 正文
     * @returns Promise，解析为发送结果（含 `event_id`）
     *
     * @example
     * ```typescript
     * await client.sendHtmlNotice("!room:example.org", null, "构建通过", "<b>构建通过</b>");
     * ```
     */
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

    /**
     * 发送带 HTML 格式的动作消息（`msgtype: m.emote`）。
     *
     * @param roomId - 目标房间 ID
     * @param threadIdOrBody - 线程根事件 ID；三参数形式下该位置为纯文本正文
     * @param bodyOrHtml - 纯文本正文；四参数形式下为 HTML 正文
     * @param htmlBody - HTML 正文
     * @returns Promise，解析为发送结果（含 `event_id`）
     *
     * @example
     * ```typescript
     * await client.sendHtmlEmote("!room:example.org", null, "笑了", "<i>笑了</i>");
     * ```
     */
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
     * Cancel the scheduled delivery of the delayed event matching the provided delayId.
     *
     * Note: This endpoint is unstable, and can throw an `Error`.
     *   Check progress on [MSC4140](https://github.com/matrix-org/matrix-spec-proposals/pull/4140) for more details.
     *
     * SDK-BL-005: Delegates to {@link DelayedEventsManager.cancelScheduledDelayedEvent}.
     * The manager uses the action-in-BODY single request format
     * (`POST /delayed_events/{delay_id}` body `{ action }`), removing the previous
     * action-in-PATH + fallback flow that issued an extra failed request per call.
     *
     * @throws A M_NOT_FOUND error if no matching delayed event could be found.
     */
    public async _unstable_cancelScheduledDelayedEvent(
        delayId: string | number,
        requestOptions: IRequestOpts = {},
    ): Promise<EmptyObject> {
        return await this.getDelayedEventsManager().cancelScheduledDelayedEvent(delayId, requestOptions);
    }

    /**
     * Restart the scheduled delivery of the delayed event matching the given delayId.
     *
     * Note: This endpoint is unstable, and can throw an `Error`.
     *   Check progress on [MSC4140](https://github.com/matrix-org/matrix-spec-proposals/pull/4140) for more details.
     *
     * SDK-BL-005: Delegates to {@link DelayedEventsManager.restartScheduledDelayedEvent}
     * (action-in-BODY single request, no fallback).
     *
     * @throws A M_NOT_FOUND error if no matching delayed event could be found.
     */
    public async _unstable_restartScheduledDelayedEvent(
        delayId: string | number,
        requestOptions: IRequestOpts = {},
    ): Promise<EmptyObject> {
        return await this.getDelayedEventsManager().restartScheduledDelayedEvent(delayId, requestOptions);
    }

    /**
     * Immediately send the delayed event matching the given delayId,
     * instead of waiting for its scheduled delivery.
     *
     * Note: This endpoint is unstable, and can throw an `Error`.
     *   Check progress on [MSC4140](https://github.com/matrix-org/matrix-spec-proposals/pull/4140) for more details.
     *
     * SDK-BL-005: Delegates to {@link DelayedEventsManager.sendScheduledDelayedEvent}
     * (action-in-BODY single request, no fallback).
     *
     * @throws A M_NOT_FOUND error if no matching delayed event could be found.
     * @throws May throw a `MatrixSafetyError` if content is deemed unsafe.
     * @see MatrixSafetyError
     */
    public async _unstable_sendScheduledDelayedEvent(
        delayId: string | number,
        requestOptions: IRequestOpts = {},
    ): Promise<EmptyObject> {
        return await this.getDelayedEventsManager().sendScheduledDelayedEvent(delayId, requestOptions);
    }

    /**
     *
     * @param roomId
     * @param notificationEventId
     * @returns
     * @throws May throw a `MatrixSafetyError` if content is deemed unsafe.
     * @see MatrixSafetyError
     *
     * @example
     * ```typescript
     * await client.sendRtcDecline("!room:example.org", "$notification:example.org");
     * ```
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
     *
     * @example
     * ```typescript
     * const preview = await client.getUrlPreview("https://example.org", Date.now());
     * console.log(preview["og:title"]);
     * ```
     */
    public getUrlPreview(url: string, ts: number): Promise<IPreviewUrlResponse> {
        return this.getRoomManager().getUrlPreview(url, ts);
    }

    /**
     * @returns Promise which resolves: to an empty object `{}`
     * @returns Rejects: with an error response.
     * @example
     * ```typescript
     * // Mark the user as typing for 5 seconds.
     * await client.sendTyping("!abcdef:example.org", true, 5000);
     *
     * // Stop showing the user as typing.
     * await client.sendTyping("!abcdef:example.org", false, 0);
     * ```
     */
    public sendTyping(roomId: string, isTyping: boolean, timeoutMs: number): Promise<EmptyObject> {
        return this.getTypingManager().sendTyping(roomId, isTyping, timeoutMs);
    }

    /**
     * Get typing users in a room
     * @param roomId - The room ID
     * @returns Array of user IDs currently typing
     * @example
     * ```typescript
     * const typingUserIds = await client.getRoomTyping("!abcdef:example.org");
     * console.log("Currently typing:", typingUserIds);
     * ```
     */
    public async getRoomTyping(roomId: string): Promise<string[]> {
        return this.getRoomManager().getRoomTyping(roomId);
    }

    /**
     * Get typing users in multiple rooms
     * @param roomIds - Array of room IDs
     * @returns Map of room ID to array of typing user IDs
     * @example
     * ```typescript
     * const typingByRoom = await client.getBatchTyping(["!abcdef:example.org", "!ghijkl:example.org"]);
     * for (const [roomId, userIds] of Object.entries(typingByRoom)) {
     *     console.log(`${roomId}: ${userIds.length} user(s) typing`);
     * }
     * ```
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
     *
     * @example
     * ```typescript
     * const rooms = client.getRoomUpgradeHistory("!room:example.org", true);
     * console.log(rooms.map((room) => room.roomId));
     * ```
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
     *
     * @example
     * ```typescript
     * await client.invite("!room:example.org", "@alice:example.org", { reason: "欢迎加入" });
     * ```
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
     *
     * @example
     * ```typescript
     * await client.inviteByEmail("!room:example.org", "alice@example.org");
     * ```
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
     *
     * @example
     * ```typescript
     * await client.inviteByThreePid("!room:example.org", "email", "alice@example.org");
     * ```
     */
    public async inviteByThreePid(roomId: string, medium: string, address: string): Promise<EmptyObject> {
        return this.getRoomManager().inviteByThreePid(roomId, medium, address);
    }

    /**
     * @returns Promise which resolves: `{}` an empty object.
     * @returns Rejects: with an error response.
     *
     * @example
     * ```typescript
     * await client.leave("!room:example.org");
     * ```
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
     *
     * @example
     * ```typescript
     * const errors = await client.leaveRoomChain("!room:example.org", true);
     * for (const [roomId, error] of Object.entries(errors)) {
     *     if (error) console.error(`离开 ${roomId} 失败`, error);
     * }
     * ```
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
     *
     * @example
     * ```typescript
     * await client.ban("!room:example.org", "@spammer:example.org", "违反社区准则");
     * ```
     */
    public ban(roomId: string, userId: string, reason?: string): Promise<EmptyObject> {
        return this.getRoomManager().ban(roomId, userId, reason);
    }

    /**
     * @param deleteRoom - True to delete the room from the store on success.
     * Default: true.
     * @returns Promise which resolves: `{}` an empty object.
     * @returns Rejects: with an error response.
     *
     * @example
     * ```typescript
     * await client.forget("!room:example.org", true);
     * ```
     */
    public async forget(roomId: string, deleteRoom = true): Promise<EmptyObject> {
        return this.getRoomManager().forget(roomId, deleteRoom);
    }

    /**
     * 将用户从房间封禁名单中移除。
     *
     * @param roomId - 房间 ID
     * @param userId - 要解封的用户 ID
     * @returns Promise，解析为空对象 `{}`
     *
     * @example
     * ```typescript
     * await client.unban("!room:example.org", "@alice:example.org");
     * ```
     */
    public unban(roomId: string, userId: string): Promise<EmptyObject> {
        return this.getRoomManager().unban(roomId, userId);
    }

    /**
     * 将用户踢出房间。
     *
     * @param roomId - 房间 ID
     * @param userId - 要被踢出的用户 ID
     * @param reason - 可选的原因
     * @returns Promise，解析为空对象 `{}`
     *
     * @example
     * ```typescript
     * await client.kick("!room:example.org", "@alice:example.org", "请遵守房间规则");
     * ```
     */
    public kick(roomId: string, userId: string, reason?: string): Promise<EmptyObject> {
        return this.getRoomManager().kick(roomId, userId, reason);
    }

    /**
     * 获取某个事件应触发的推送动作。
     *
     * 若事件尚未计算过推送详情，或 `forceRecalculate` 为 true，则重新计算并缓存结果。
     *
     * @param event - 目标事件
     * @param forceRecalculate - 是否强制重新计算，默认 false
     * @returns 推送动作对象；无可用动作时返回 null
     *
     * @example
     * ```typescript
     * const actions = client.getPushActionsForEvent(event);
     * if (actions?.notify) {
     *     console.log("该事件会触发通知");
     * }
     * ```
     */
    public getPushActionsForEvent(event: MatrixEvent, forceRecalculate = false): IActionsObject | null {
        if (!event.getPushActions() || forceRecalculate) {
            const { actions, rule } = this.pushProcessor.actionsAndRuleForEvent(event);
            event.setPushDetails(actions, rule);
        }
        return event.getPushActions();
    }

    /**
     * 获取某个事件的推送详情（动作与命中的推送规则）。
     *
     * 若事件尚未计算过推送详情，或 `forceRecalculate` 为 true，则重新计算并缓存结果。
     *
     * @param event - 目标事件
     * @param forceRecalculate - 是否强制重新计算，默认 false
     * @returns 推送详情；无可用详情时返回 null
     *
     * @example
     * ```typescript
     * const details = client.getPushDetailsForEvent(event);
     * console.log(details?.rule);
     * ```
     */
    public getPushDetailsForEvent(event: MatrixEvent, forceRecalculate = false): PushDetails | null {
        if (!event.getPushDetails() || forceRecalculate) {
            const { actions, rule } = this.pushProcessor.actionsAndRuleForEvent(event);
            event.setPushDetails(actions, rule);
        }
        return event.getPushDetails();
    }

    /**
     * 设置同步时使用的在线状态。
     *
     * @param presence - 在线状态；不传则由底层同步 API 决定
     * @returns Promise，在状态设置完成后解析
     *
     * @example
     * ```typescript
     * await client.setSyncPresence("online");
     * ```
     */
    public async setSyncPresence(presence?: SetPresence): Promise<void> {
        this.syncApi?.setPresence(presence);
    }

    /**
     * 从服务器加载房间的历史消息（向后翻页）。
     *
     * @param room - 目标房间
     * @param limit - 拉取的事件数量上限，默认 30
     * @returns Promise，解析为该房间
     *
     * @example
     * ```typescript
     * await client.scrollback(room, 50);
     * ```
     */
    public scrollback(room: Room, limit = 30): Promise<Room> {
        return this.getTimelineManager().scrollback(room, limit);
    }

    /**
     * Get the event context for a given event.
     * @param roomId - The room ID.
     * @param eventId - The event ID.
     * @param params - Optional parameters.
     * @returns The event context.
     *
     * @example
     * ```typescript
     * const context = await client.getEventContext("!room:example.org", "$event:example.org", { limit: 10 });
     * console.log(context.event);
     * ```
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
     *
     * @example
     * ```typescript
     * const events = client.storeScrollback(room, 30);
     * console.log(events.length);
     * ```
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
     *
     * @example
     * ```typescript
     * client.storeEvents(room, events, token, true);
     * ```
     */
    public storeEvents(room: Room, events: MatrixEvent[], token: string | null, backwards: boolean): void {
        this.store.storeEvents(room, events, token, backwards);
    }

    /**
     * 创建一个为该客户端配置的事件映射器（event mapper）。
     *
     * @param options - 映射器选项
     * @returns 事件映射器实例
     *
     * @example
     * ```typescript
     * const mapper = client.getEventMapper();
     * const event = mapper(roomId, rawEvent);
     * ```
     */
    public getEventMapper(options?: MapperOpts): EventMapper {
        return eventMapperFor(this, options || {});
    }

    /**
     * 获取包含指定事件的 timeline。
     *
     * @param timelineSet - 目标 timeline set
     * @param eventId - 事件 ID
     * @returns Promise，解析为对应的事件 timeline；未找到时返回 null
     *
     * @example
     * ```typescript
     * const timeline = await client.getEventTimeline(timelineSet, "$event:example.org");
     * ```
     */
    public async getEventTimeline(timelineSet: EventTimelineSet, eventId: string): Promise<EventTimeline | null> {
        return this.getTimelineManager().getEventTimeline(timelineSet, eventId);
    }

    /**
     * 获取包含指定事件（线程根事件）的线程 timeline。
     *
     * @param timelineSet - 目标 timeline set
     * @param eventId - 线程根事件 ID
     * @returns Promise，解析为对应的线程 timeline；未找到时返回 undefined
     *
     * @example
     * ```typescript
     * const thread = await client.getThreadTimeline(timelineSet, "$root:example.org");
     * ```
     */
    public async getThreadTimeline(timelineSet: EventTimelineSet, eventId: string): Promise<EventTimeline | undefined> {
        return this.getThreadingManager().getThreadTimeline(timelineSet, eventId);
    }

    /**
     * 获取 timeline set 中最新的事件 timeline。
     *
     * @param timelineSet - 目标 timeline set
     * @returns Promise，解析为最新的 timeline；不存在时返回 null
     *
     * @example
     * ```typescript
     * const timeline = await client.getLatestTimeline(timelineSet);
     * ```
     */
    public async getLatestTimeline(timelineSet: EventTimelineSet): Promise<EventTimeline | null> {
        return this.getTimelineManager().getLatestTimeline(timelineSet);
    }

    /**
     * 构造 `/messages` 分页请求。
     *
     * @param roomId - 房间 ID
     * @param fromToken - 分页起始 token；`null` 表示从头开始
     * @param limit - 单次拉取数量上限，默认 30
     * @param dir - 分页方向（向前或向后）
     * @param timelineFilter - 可选的时间线过滤器
     * @returns Promise，解析为 `/messages` 响应
     *
     * @example
     * ```typescript
     * const res = await client.createMessagesRequest("!room:example.org", null, 30, Direction.Backward);
     * console.log(res.chunk);
     * ```
     */
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

    /**
     * 构造线程列表的 `/messages` 分页请求。
     *
     * @param roomId - 房间 ID
     * @param fromToken - 分页起始 token；`null` 表示从头开始
     * @param limit - 单次拉取数量上限，默认 30
     * @param dir - 分页方向，默认向前
     * @param threadListType - 线程列表类型，默认 `ThreadFilterType.All`
     * @param timelineFilter - 可选的时间线过滤器
     * @returns Promise，解析为 `/messages` 响应
     *
     * @example
     * ```typescript
     * const res = await client.createThreadListMessagesRequest("!room:example.org", null);
     * console.log(res.chunk);
     * ```
     */
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

    /**
     * 对指定的事件 timeline 进行分页，按方向拉取更多事件。
     *
     * @param eventTimeline - 要分页的事件 timeline
     * @param opts - 分页选项（方向、数量、是否仅本地等）
     * @returns Promise，解析为 true 表示本次分页成功获取到数据
     *
     * @example
     * ```typescript
     * const hasMore = await client.paginateEventTimeline(timeline, { backwards: true, limit: 20 });
     * ```
     */
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

    /**
     * 重置通知 timeline set，清空当前的通知事件集合。
     *
     * @example
     * ```typescript
     * client.resetNotifTimelineSet();
     * ```
     */
    public resetNotifTimelineSet(): void {
        this.getNotificationsManager().resetNotifTimelineSet();
    }

    /**
     * 以只读方式查看（peek）某个房间，无需加入即可读取其内容。
     *
     * @param roomId - 要查看的房间 ID
     * @param limit - 首次拉取的事件数量上限
     * @returns Promise，解析为查看得到的房间对象
     *
     * @example
     * ```typescript
     * const room = await client.peekInRoom("!room:example.org", 20);
     * ```
     */
    public peekInRoom(roomId: string, limit: number = 20): Promise<Room> {
        return this.getRoomManager().peekInRoom(roomId, limit);
    }

    /**
     * 停止对房间的查看（peek），释放相关资源。
     *
     * @example
     * ```typescript
     * client.stopPeeking();
     * ```
     */
    public stopPeeking(): void {
        this.getRoomManager().stopPeeking();
    }

    /**
     * 设置房间的访客访问权限。
     *
     * @param roomId - 要设置的目标房间 ID
     * @param opts - 访客访问选项（是否允许加入、是否允许读取）
     * @returns Promise，解析为设置完成
     *
     * @example
     * ```typescript
     * await client.setGuestAccess("!room:example.org", { allowJoin: true, allowRead: true });
     * ```
     */
    public setGuestAccess(roomId: string, opts: IGuestAccessOpts): Promise<void> {
        return this.getRoomManager().setGuestAccess(roomId, opts);
    }

    /**
     * 请求向邮箱发送注册验证 token。
     *
     * @param email - 目标邮箱地址
     * @param clientSecret - 客户端密钥，用于后续校验
     * @param sendAttempt - 发送尝试次数，用于幂等
     * @param nextLink - 验证完成后跳转的链接（可选）
     * @returns Promise，解析为 token 请求响应
     *
     * @example
     * ```typescript
     * const res = await client.requestRegisterEmailToken("alice@example.org", secret, 1);
     * ```
     */
    public requestRegisterEmailToken(
        email: string,
        clientSecret: string,
        sendAttempt: number,
        nextLink?: string,
    ): Promise<IRequestTokenResponse> {
        return this.getAuthManager().requestRegisterEmailToken(email, clientSecret, sendAttempt, nextLink);
    }

    /**
     * 请求向手机号发送注册验证 token。
     *
     * @param phoneCountry - 电话号码国家代码
     * @param phoneNumber - 电话号码
     * @param clientSecret - 客户端密钥，用于后续校验
     * @param sendAttempt - 发送尝试次数，用于幂等
     * @param nextLink - 验证完成后跳转的链接（可选）
     * @returns Promise，解析为 msisdn token 请求响应
     *
     * @example
     * ```typescript
     * const res = await client.requestRegisterMsisdnToken("CN", "13800000000", secret, 1);
     * ```
     */
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

    /**
     * 请求向邮箱发送添加第三方标识（3pid）的验证 token。
     *
     * @param email - 目标邮箱地址
     * @param clientSecret - 客户端密钥，用于后续校验
     * @param sendAttempt - 发送尝试次数，用于幂等
     * @param nextLink - 验证完成后跳转的链接（可选）
     * @returns Promise，解析为 token 请求响应
     *
     * @example
     * ```typescript
     * const res = await client.requestAdd3pidEmailToken("alice@example.org", secret, 1);
     * ```
     */
    public requestAdd3pidEmailToken(
        email: string,
        clientSecret: string,
        sendAttempt: number,
        nextLink?: string,
    ): Promise<IRequestTokenResponse> {
        return this.getAuthManager().requestAdd3pidEmailToken(email, clientSecret, sendAttempt, nextLink);
    }

    /**
     * 请求向手机号发送添加第三方标识（3pid）的验证 token。
     *
     * @param phoneCountry - 电话号码国家代码
     * @param phoneNumber - 电话号码
     * @param clientSecret - 客户端密钥，用于后续校验
     * @param sendAttempt - 发送尝试次数，用于幂等
     * @param nextLink - 验证完成后跳转的链接（可选）
     * @returns Promise，解析为 msisdn token 请求响应
     *
     * @example
     * ```typescript
     * const res = await client.requestAdd3pidMsisdnToken("CN", "13800000000", secret, 1);
     * ```
     */
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

    /**
     * 请求向邮箱发送密码重置验证 token。
     *
     * @param email - 目标邮箱地址
     * @param clientSecret - 客户端密钥，用于后续校验
     * @param sendAttempt - 发送尝试次数，用于幂等
     * @param nextLink - 验证完成后跳转的链接（可选）
     * @returns Promise，解析为 token 请求响应
     *
     * @example
     * ```typescript
     * const res = await client.requestPasswordEmailToken("alice@example.org", secret, 1);
     * ```
     */
    public requestPasswordEmailToken(
        email: string,
        clientSecret: string,
        sendAttempt: number,
        nextLink?: string,
    ): Promise<IRequestTokenResponse> {
        return this.getPasswordResetManager().requestPasswordEmailToken(email, clientSecret, sendAttempt, nextLink);
    }

    /**
     * 请求向手机号发送密码重置验证 token。
     *
     * @param phoneCountry - 电话号码国家代码
     * @param phoneNumber - 电话号码
     * @param clientSecret - 客户端密钥，用于后续校验
     * @param sendAttempt - 发送尝试次数，用于幂等
     * @param nextLink - 验证完成后跳转的链接
     * @returns Promise，解析为 msisdn token 请求响应
     *
     * @example
     * ```typescript
     * const res = await client.requestPasswordMsisdnToken("CN", "13800000000", secret, 1, link);
     * ```
     */
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

    /**
     * 获取针对指定房间的推送规则。
     *
     * @param scope - 推送规则作用域（global 或 device）
     * @param roomId - 目标房间 ID
     * @returns 匹配到的推送规则，未找到时返回 undefined
     *
     * @example
     * ```typescript
     * const rule = client.getRoomPushRule("global", "!room:example.org");
     * ```
     */
    public getRoomPushRule(scope: "global" | "device", roomId: string): IPushRule | undefined {
        return this.getPushManager().getRoomPushRule(scope, roomId);
    }

    /**
     * 设置或取消指定房间的静音推送规则。
     *
     * @param scope - 推送规则作用域（global 或 device）
     * @param roomId - 目标房间 ID
     * @param mute - 是否静音该房间的推送
     * @returns Promise，解析为设置完成；当无需变更时返回 undefined
     *
     * @example
     * ```typescript
     * await client.setRoomMutePushRule("global", "!room:example.org", true);
     * ```
     */
    public setRoomMutePushRule(scope: "global" | "device", roomId: string, mute: boolean): Promise<void> | undefined {
        return this.getPushManager().setRoomMutePushRule(scope, roomId, mute);
    }

    /**
     * 在消息正文中搜索文本。
     *
     * @param opts - 搜索选项（查询关键词与搜索字段）
     * @returns Promise，解析为搜索结果
     *
     * @example
     * ```typescript
     * const results = await client.searchMessageText({ query: "会议纪要", keys: ["content.body"] });
     * ```
     */
    public searchMessageText(opts: ISearchOpts): Promise<ISearchResponse> {
        return this.getSearchManager().searchMessageText({ term: opts.query, keys: opts.keys });
    }

    /**
     * Search the room timeline for events matching the given criteria.
     *
     * @param opts - Search options including the search term, order and result count.
     * @returns A promise resolving to the search results.
     *
     * @example
     * ```typescript
     * const results = await client.searchRoomEvents({ term: "会议纪要", orderBy: "recent" });
     * ```
     */
    public async searchRoomEvents(opts: IEventSearchOpts): Promise<ISearchResults> {
        return this.getSearchManager().searchRoomEventsProcessed(opts);
    }

    /**
     * Paginate backwards through the results of a previous room event search.
     *
     * @param searchResults - The search results to paginate backwards from.
     * @returns A promise resolving to the extended search results.
     *
     * @example
     * ```typescript
     * const more = await client.backPaginateRoomEventsSearch(searchResults);
     * ```
     */
    public backPaginateRoomEventsSearch<T extends ISearchResults>(searchResults: T): Promise<T> {
        return this.getSearchManager().backPaginateRoomEventsSearch(searchResults);
    }

    /** @internal */
    /**
     * Process a raw `/search` response, appending the parsed events onto the given results object.
     *
     * @param searchResults - The results object to extend in place.
     * @param response - The raw search response to process.
     * @returns The same `searchResults` object, for chaining.
     *
     * @example
     * ```typescript
     * const results = client.processRoomEventsSearch(searchResults, response);
     * ```
     */
    public processRoomEventsSearch<T extends ISearchResults>(searchResults: T, response: ISearchResponse): T {
        return this.getSearchManager().processRoomEventsSearch(searchResults, response);
    }

    /**
     * Force a re-sync of the rooms the user has left.
     *
     * @returns A promise resolving to the rooms flushed from the store during the resync.
     *
     * @example
     * ```typescript
     * const leftRooms = await client.syncLeftRooms();
     * ```
     */
    public syncLeftRooms(): Promise<Room[]> {
        return this.getSyncManager().syncLeftRooms();
    }

    /**
     * Create a new filter on the server from a filter definition.
     *
     * @param content - The filter definition to upload.
     * @returns A promise resolving to the created {@link Filter}.
     *
     * @example
     * ```typescript
     * const filter = await client.createFilter({ room: { timelines: { limit: 10 } } });
     * ```
     */
    public async createFilter(content: IFilterDefinition): Promise<Filter> {
        const result = await this.getFilterManager().createFilter(content);
        return Filter.fromJson(this.credentials.userId, result.filterId, content);
    }

    /**
     * Retrieve a filter previously stored on the server by id.
     *
     * @param userId - The user the filter belongs to.
     * @param filterId - The id of the filter to fetch.
     * @param allowCached - When `true`, a locally cached filter may be returned.
     * @returns A promise resolving to the {@link Filter}.
     *
     * @example
     * ```typescript
     * const filter = await client.getFilter(userId, filterId, true);
     * ```
     */
    public async getFilter(userId: string, filterId: string, allowCached: boolean): Promise<Filter> {
        return this.getFilterManager().getFilter(userId, filterId, allowCached);
    }

    /**
     * Retrieve the server-side filter with the given name, creating it from `filter` if absent.
     *
     * @param filterName - The name to look up / store the filter under.
     * @param filter - The filter definition to create when none exists.
     * @returns A promise resolving to the filter id.
     *
     * @example
     * ```typescript
     * const filterId = await client.getOrCreateFilter("lazy_loading", filter);
     * ```
     */
    public async getOrCreateFilter(filterName: string, filter: Filter): Promise<string> {
        return this.getFilterManager().getOrCreateFilter(filterName, filter);
    }

    /**
     * Get an OpenID token for this account, usable to authenticate against other services.
     *
     * @returns A promise resolving to the OpenID token.
     *
     * @example
     * ```typescript
     * const { access_token } = await client.getOpenIdToken();
     * ```
     */
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

    /**
     * Ask the homeserver for a TURN server to use for VoIP.
     *
     * @returns A promise resolving to the TURN server response.
     *
     * @example
     * ```typescript
     * const turn = await client.turnServer();
     * ```
     */
    public turnServer(): Promise<ITurnServerResponse> {
        return this.http.authedRequest(Method.Get, "/voip/turnServer");
    }

    /**
     * Get the cached TURN servers obtained from the homeserver.
     *
     * @returns The currently known TURN servers.
     *
     * @example
     * ```typescript
     * const servers = client.getTurnServers();
     * ```
     */
    public getTurnServers(): ITurnServer[] {
        return this.getTurnServerManager().getTurnServers();
    }

    /**
     * Get the time (epoch ms) at which the cached TURN servers expire.
     *
     * @returns The expiry timestamp in milliseconds.
     *
     * @example
     * ```typescript
     * const expiry = client.getTurnServersExpiry();
     * ```
     */
    public getTurnServersExpiry(): number {
        return this.getTurnServerManager().getTurnServerExpiry();
    }

    public get pollingTurnServers(): boolean {
        return this.checkTurnServersIntervalID !== undefined;
    }

    /**
     * Check whether the cached TURN servers need refreshing and fetch new ones if so.
     *
     * @returns A promise resolving to `true` when new servers were fetched, otherwise `undefined`.
     *
     * @example
     * ```typescript
     * const refreshed = await client.checkTurnServers();
     * ```
     */
    public async checkTurnServers(): Promise<boolean | undefined> {
        return this.getTurnServerManager().checkTurnServers();
    }

    /**
     * Set whether a fallback ICE server may be used when no TURN server is available.
     *
     * @param allow - Whether the fallback ICE server is allowed.
     *
     * @example
     * ```typescript
     * client.setFallbackICEServerAllowed(true);
     * ```
     */
    public setFallbackICEServerAllowed(allow: boolean): void {
        this.fallbackICEServerAllowed = allow;
    }

    /**
     * Whether a fallback ICE server is allowed when no TURN server is available.
     *
     * @returns `true` if the fallback ICE server is allowed.
     *
     * @example
     * ```typescript
     * if (client.isFallbackICEServerAllowed()) {
     *     // fall back to the default ICE server
     * }
     * ```
     */
    public isFallbackICEServerAllowed(): boolean {
        return this.fallbackICEServerAllowed;
    }

    /**
     * Check whether the logged-in user is a Synapse server administrator.
     *
     * @returns A promise resolving to `true` if the user is an administrator.
     *
     * @example
     * ```typescript
     * const isAdmin = await client.isSynapseAdministrator();
     * ```
     */
    public async isSynapseAdministrator(): Promise<boolean> {
        return this.getAdminManager().isSynapseAdministrator(this.getUserId()!);
    }

    /**
     * Get the Synapse admin "whois" information for a user.
     *
     * @param userId - The user to query.
     * @returns A promise resolving to the whois response.
     *
     * @example
     * ```typescript
     * const whois = await client.whoisSynapseUser("@alice:example.org");
     * ```
     */
    public whoisSynapseUser(userId: string): Promise<ISynapseAdminWhoisResponse> {
        return this.getAdminManager().whoisSynapseUser(userId);
    }

    /**
     * Deactivate a user via the Synapse admin API.
     *
     * @param userId - The user to deactivate.
     * @returns A promise resolving to the deactivation response.
     *
     * @example
     * ```typescript
     * await client.deactivateSynapseUser("@alice:example.org");
     * ```
     */
    public deactivateSynapseUser(userId: string): Promise<ISynapseAdminDeactivateResponse> {
        return this.getAdminManager().deactivateSynapseUser(userId);
    }

    /**
     * Fetch the client configuration from the homeserver's `.well-known` endpoint and cache it.
     *
     * The underlying lookup absorbs network errors and resolves with `{}` rather than rejecting.
     *
     * @returns A promise that resolves once the configuration has been stored and emitted.
     *
     * @example
     * ```typescript
     * await client.fetchClientWellKnown();
     * ```
     */
    public async fetchClientWellKnown(): Promise<void> {
        // `getRawClientConfig` does not throw or reject on network errors, instead
        // it absorbs errors and returns `{}`.
        this.clientWellKnownPromise = AutoDiscovery.getRawClientConfig(this.getDomain() ?? undefined);
        this.clientWellKnown = await this.clientWellKnownPromise;
        this.emit(ClientEvent.ClientWellKnown, this.clientWellKnown);
    }

    /**
     * Get the cached client well-known configuration.
     *
     * @returns The cached configuration, or `undefined` if it has not been fetched yet.
     *
     * @example
     * ```typescript
     * const wellKnown = client.getClientWellKnown();
     * ```
     */
    public getClientWellKnown(): IClientWellKnown | undefined {
        return this.clientWellKnown;
    }

    /**
     * Wait for the client well-known configuration to be fetched.
     *
     * @returns A promise resolving to the client well-known configuration.
     *
     * @example
     * ```typescript
     * const wellKnown = await client.waitForClientWellKnown();
     * ```
     *
     * @throws {Error} If the client has not been started.
     */
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
     *
     * @example
     * ```typescript
     * await client.storeClientOptions();
     * ```
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

    /**
     * Get the protocol versions supported by the homeserver.
     *
     * @returns A promise resolving to the server versions response.
     *
     * @example
     * ```typescript
     * const { versions } = await client.getVersions();
     * ```
     */
    public async getVersions(): Promise<IServerVersions> {
        return this.getServerCapabilitiesManager().getVersions();
    }

    /**
     * Check whether the homeserver supports the given specification version.
     *
     * @param version - The version string to check for.
     * @returns A promise resolving to `true` if the version is supported.
     *
     * @example
     * ```typescript
     * const supported = await client.isVersionSupported("v1.11");
     * ```
     */
    public async isVersionSupported(version: string): Promise<boolean> {
        return this.getServerCapabilitiesManager().isVersionSupported(version);
    }

    /**
     * Check whether the homeserver advertises support for an unstable feature.
     *
     * @param feature - The unstable feature identifier to check for.
     * @returns A promise resolving to `true` if the feature is advertised.
     *
     * @example
     * ```typescript
     * const supported = await client.doesServerSupportUnstableFeature("org.matrix.msc3916");
     * ```
     */
    public async doesServerSupportUnstableFeature(feature: string): Promise<boolean> {
        return this.getServerCapabilitiesManager().doesServerSupportUnstableFeature(feature);
    }

    /**
     * Check whether the homeserver advertises support for a synapse-rust specific feature.
     *
     * @param feature - The synapse-rust feature name to check for.
     * @returns A promise resolving to `true` if the feature is advertised.
     *
     * @example
     * ```typescript
     * const supported = await client.doesServerAdvertiseSynapseRustFeature(SynapseRustFeatureName.SlidingSync);
     * ```
     */
    public async doesServerAdvertiseSynapseRustFeature(feature: SynapseRustFeatureName): Promise<boolean> {
        return this.getServerCapabilitiesManager().doesServerAdvertiseSynapseRustFeature(feature);
    }

    /**
     * Get the full map of synapse-rust feature support advertised by the homeserver.
     *
     * @returns A promise resolving to the feature support map.
     *
     * @example
     * ```typescript
     * const features = await client.getSynapseRustFeatureSupport();
     * ```
     */
    public async getSynapseRustFeatureSupport(): Promise<SynapseRustFeatureSupport> {
        return this.getServerCapabilitiesManager().getSynapseRustFeatureSupport();
    }

    /**
     * Check whether the homeserver forces encryption for a given room preset.
     *
     * @param presetName - The room preset to check.
     * @returns A promise resolving to `true` if encryption is forced for the preset.
     *
     * @example
     * ```typescript
     * const forced = await client.doesServerForceEncryptionForPreset(Preset.PrivateChat);
     * ```
     */
    public async doesServerForceEncryptionForPreset(presetName: Preset): Promise<boolean> {
        return this.getServerCapabilitiesManager().doesServerForceEncryptionForPreset(presetName);
    }

    /**
     * Check whether the homeserver supports threaded messages, and to what degree.
     *
     * @returns A promise resolving to the per-aspect thread feature support.
     *
     * @example
     * ```typescript
     * const { threads, list, fwdPagination } = await client.doesServerSupportThread();
     * ```
     */
    public async doesServerSupportThread(): Promise<{
        threads: FeatureSupport;
        list: FeatureSupport;
        fwdPagination: FeatureSupport;
    }> {
        return this.getServerCapabilitiesManager().doesServerSupportThread();
    }

    /**
     * Whether lazy-loading of room members is enabled for this client.
     *
     * @returns `true` if lazy loading of members is enabled.
     *
     * @example
     * ```typescript
     * const lazy = client.hasLazyLoadMembersEnabled();
     * ```
     */
    public hasLazyLoadMembersEnabled(): boolean {
        return this.getServerCapabilitiesManager().hasLazyLoadMembersEnabled();
    }

    /**
     * Set the callback used to decide whether a room's timeline may be reset.
     *
     * @param cb - The callback invoked to determine resettability.
     *
     * @example
     * ```typescript
     * client.setCanResetTimelineCallback((room) => room.getMyMembership() !== "leave");
     * ```
     */
    public setCanResetTimelineCallback(cb: ResetTimelineCallback): void {
        this.canResetTimelineCallback = cb;
    }

    /**
     * Get the callback currently used to decide whether a room's timeline may be reset.
     *
     * @returns The registered callback, or `undefined` if none is set.
     *
     * @example
     * ```typescript
     * const cb = client.getCanResetTimelineCallback();
     * ```
     */
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
     *
     * @example
     * ```typescript
     * const { events, nextBatch } = await client.relations(roomId, eventId, RelationType.Annotation);
     * ```
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
     *
     * @example
     * ```typescript
     * const { chunk } = await client.getAggregations(roomId, eventId, RelationType.Annotation);
     * ```
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
     *
     * @example
     * ```typescript
     * const secret = client.generateClientSecret();
     * ```
     */
    public generateClientSecret(): string {
        return secureRandomString(32);
    }

    /**
     * Attempts to decrypt an event
     * @param event - The event to decrypt
     * @returns A decryption promise
     *
     * @example
     * ```typescript
     * await client.decryptEventIfNeeded(event);
     * ```
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
     *
     * @example
     * ```typescript
     * const url = client.getHomeserverUrl();
     * ```
     */
    public getHomeserverUrl(): string {
        return this.baseUrl;
    }

    /**
     * Get the access token associated with this account.
     * @returns The access_token or null
     *
     * @example
     * ```typescript
     * const token = client.getAccessToken();
     * ```
     */
    public getAccessToken(): string | null {
        return this.http.opts.accessToken || null;
    }

    /**
     * Get the refresh token associated with this account.
     * @returns The refresh_token or null
     *
     * @example
     * ```typescript
     * const refreshToken = client.getRefreshToken();
     * ```
     */
    public getRefreshToken(): string | null {
        return this.http.opts.refreshToken ?? null;
    }

    /**
     * Set the access token associated with this account.
     * @param token - The new access token.
     *
     * @example
     * ```typescript
     * client.setAccessToken("syt_new_token");
     * ```
     */
    public setAccessToken(token: string): void {
        this.http.opts.accessToken = token;
        // The /versions response can vary for different users so clear the cache
        this.serverVersionsPromise = undefined;
    }

    /**
     * @returns true if there is a valid access_token for this client.
     *
     * @example
     * ```typescript
     * if (!client.isLoggedIn()) {
     *     await client.loginRequest({ type: "m.login.password", identifier, password });
     * }
     * ```
     */
    public isLoggedIn(): boolean {
        return !!this.credentials?.userId;
    }

    /**
     * Make up a new transaction id
     *
     * @returns a new, unique, transaction id
     *
     * @example
     * ```typescript
     * const txnId = client.makeTxnId();
     * ```
     */
    public makeTxnId(): string {
        return "m" + new Date().getTime() + "." + this.txnCtr++;
    }

    /**
     * Check whether a username is available for registration on the homeserver.
     *
     * @param username - The username to check (without the leading `@` or domain).
     * @returns A promise resolving to `true` if the username is available.
     *
     * @example
     * ```typescript
     * const available = await client.isUsernameAvailable("alice");
     * ```
     */
    public async isUsernameAvailable(username: string): Promise<boolean> {
        return this.getAuthManager().isUsernameAvailable(username);
    }

    /**
     * Register a new account on the homeserver.
     *
     * @param username - The desired username.
     * @param password - The account password.
     * @param sessionId - The UI auth session id, if continuing an interactive registration.
     * @param auth - The auth dict describing the completed auth stage.
     * @param bindThreepids - Whether to bind email / msisdn third-party identifiers.
     * @param guestAccessToken - An access token to upgrade a guest account with.
     * @param inhibitLogin - When `true`, do not log the new account in on the server.
     * @returns A promise resolving to the registration response.
     *
     * @example
     * ```typescript
     * const { user_id } = await client.register("alice", "secret", null, { type: "m.login.dummy" });
     * ```
     */
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

    /**
     * Register a new guest account on the homeserver.
     *
     * @param options - Optional `body` containing the guest registration request.
     * @returns A promise resolving to the registration response.
     *
     * @example
     * ```typescript
     * const { user_id } = await client.registerGuest();
     * ```
     */
    public registerGuest({ body }: { body?: RegisterRequest } = {}): Promise<RegisterResponse> {
        return this.getAuthManager().registerGuest(body);
    }

    /**
     * Send a raw registration request to the homeserver.
     *
     * @param data - The registration request body.
     * @param kind - The kind of account to register (`guest` or `user`); defaults server-side.
     * @returns A promise resolving to the registration response.
     *
     * @example
     * ```typescript
     * const res = await client.registerRequest({ username: "alice", password: "secret" });
     * ```
     */
    public registerRequest(data: RegisterRequest, kind?: string): Promise<RegisterResponse> {
        return this.getAuthManager().registerRequest(data, kind);
    }

    /**
     * Exchange a refresh token for a new access / refresh token pair.
     *
     * @param refreshToken - The refresh token to redeem.
     * @returns A promise resolving to the new token response.
     *
     * @example
     * ```typescript
     * const res = await client.refreshToken(oldRefreshToken);
     * ```
     */
    public async refreshToken(refreshToken: string): Promise<IRefreshTokenResponse> {
        return this.getAuthManager().refreshToken(refreshToken);
    }

    /**
     * Get the login flows supported by the homeserver.
     *
     * @returns A promise resolving to the available login flows.
     *
     * @example
     * ```typescript
     * const { flows } = await client.loginFlows();
     * ```
     */
    public loginFlows(): Promise<ILoginFlowsResponse> {
        return this.getAccountManager().loginFlows();
    }

    /**
     * Build the CAS single-sign-on login URL for the given redirect target.
     *
     * @param redirectUrl - Where the homeserver should redirect after login.
     * @returns The CAS login URL.
     *
     * @example
     * ```typescript
     * const url = client.getCasLoginUrl("https://app.example.org/callback");
     * ```
     */
    public getCasLoginUrl(redirectUrl: string): string {
        return this.getAccountManager().getCasLoginUrl(redirectUrl);
    }

    /**
     * Build the SSO login URL for the given redirect target.
     *
     * @param redirectUrl - Where the homeserver should redirect after login.
     * @param loginType - The SSO login type, defaulting to `"sso"`.
     * @param action - Whether the flow should log in or register.
     * @returns The SSO login URL.
     *
     * @example
     * ```typescript
     * const url = client.getSsoLoginUrl("https://app.example.org/callback");
     * ```
     */
    public getSsoLoginUrl(redirectUrl: string, loginType = "sso", action?: SSOAction): string {
        return this.getAccountManager().getSsoLoginUrl(redirectUrl, loginType, action);
    }

    /**
     * Send a login request and return the server's response.
     *
     * ⚠️ This method does **not** update this client's credentials — it only performs the
     * request. After a successful call you must either build a new client with the returned
     * `access_token` / `user_id` / `device_id`, or use
     * {@link AccountManager.login} (via `client.getAccountManager().login(...)`), which writes
     * the credentials onto the existing client. Forgetting this is the most common cause of
     * a subsequent `401 M_MISSING_TOKEN`.
     *
     * The response's `expires_in` is normalised to `expires_in_ms` (milliseconds) by this fork.
     *
     * @param data - The login request body; `type` is required.
     * @returns The login response with `access_token`, `user_id` and `device_id`.
     *
     * @example
     * ```typescript
     * const bootstrap = createClient({ baseUrl: "https://matrix.test" });
     * const res = await bootstrap.loginRequest({
     *     type: "m.login.password",
     *     identifier: { type: "m.id.user", user: "alice" },
     *     password: "alice-secret",
     * });
     *
     * // loginRequest 不会改写 bootstrap 的凭据 —— 必须用返回值新建 client。
     * const client = createClient({
     *     baseUrl: "https://matrix.test",
     *     accessToken: res.access_token,
     *     userId: res.user_id,
     *     deviceId: res.device_id,
     * });
     * ```
     *
     * @throws {AuthError} When credentials are rejected (`M_FORBIDDEN`, HTTP 403).
     * @throws {RetryableError} On rate limiting (`M_LIMIT_EXCEEDED`) or server errors.
     */
    public loginRequest(data: LoginRequest): Promise<LoginResponse> {
        return this.getAccountManager().loginRequest(data);
    }

    /**
     * Invalidate the access token on the server and optionally stop syncing.
     *
     * @param stopClient - When `true`, also calls {@link MatrixClient.stopClient} and aborts
     *   in-flight HTTP requests before logging out.
     * @returns An empty object on success.
     *
     * @example
     * ```typescript
     * // 退出并停止同步
     * await client.logout(true);
     * ```
     *
     * @throws {SdkError} If the logout request fails. Callers usually want to tear down local
     *   state regardless — consider catching and logging rather than blocking the UI.
     */
    public logout(stopClient = false): Promise<EmptyObject> {
        return this.getAccountManager().logout(stopClient);
    }

    /**
     * Deactivate the logged-in account.
     *
     * @param auth - The auth dict required to authorise deactivation.
     * @param erase - When `true`, request that the server erase user data.
     * @returns A promise resolving to the identity-server unbind result.
     *
     * @example
     * ```typescript
     * const res = await client.deactivateAccount({ type: "m.login.password", password: "secret" });
     * ```
     */
    public deactivateAccount(
        auth?: AuthDict,
        erase?: boolean,
    ): Promise<{ id_server_unbind_result: IdServerUnbindResult }> {
        return this.getAccountManager().deactivateAccount(auth, erase);
    }

    /**
     * Request a login token (a.k.a. "email login") from the homeserver.
     *
     * @param auth - The auth dict required to authorise the request.
     * @returns A promise resolving to the login token response.
     *
     * @example
     * ```typescript
     * const { login_token } = await client.requestLoginToken({ type: "m.login.dummy" });
     * ```
     */
    public requestLoginToken(auth?: AuthDict): Promise<LoginTokenPostResponse> {
        return this.getAccountManager().requestLoginToken(auth);
    }

    /**
     * Build the fallback authentication URL for a UI auth session that cannot use the in-app flow.
     *
     * @param loginType - The login type requesting the fallback.
     * @param authSessionId - The UI auth session id to complete.
     * @returns The fallback authentication URL.
     *
     * @example
     * ```typescript
     * const url = client.getFallbackAuthUrl("m.login.recaptcha", sessionId);
     * ```
     */
    public getFallbackAuthUrl(loginType: string, authSessionId: string): string {
        return this.getAccountManager().getFallbackAuthUrl(loginType, authSessionId);
    }

    /**
     * Create a new room.
     *
     * ⚠️ `visibility` is the **enum** {@link Visibility} (`Visibility.Private`), not the string
     * literal `"private"`. Note this differs from the Space APIs
     * (`spaceManager.lifecycle.createSpace`), which take `"public" | "private"` strings.
     *
     * To create a space, pass `creation_content: { type: RoomType.Space }` — a space is still a
     * room underneath, and `SpaceManager.lifecycle.createSpace` only registers an existing room
     * as a space.
     *
     * @param options - Room creation options; all fields are optional.
     * @returns `{ room_id }` of the newly created room.
     *
     * @example
     * ```typescript
     * // 普通私有房间
     * const { room_id } = await client.createRoom({
     *     name: "backend",
     *     visibility: Visibility.Private,
     * });
     *
     * // 创建一个 Space 底层的房间
     * const space = await client.createRoom({
     *     name: "工程团队",
     *     visibility: Visibility.Private,
     *     creation_content: { type: RoomType.Space },
     * });
     * ```
     *
     * @throws {ValidationError} If the options are rejected client-side (e.g. malformed alias).
     * @throws {SdkError} If the server rejects the request — commonly `M_UNKNOWN` when the
     *   requested room alias is already taken.
     */
    public async createRoom(options: ICreateRoomOpts): Promise<{ room_id: string }> {
        return this.getRoomManager().createRoom(options);
    }

    /**
     * Fetch the raw relations for an event from the server.
     *
     * @param roomId - The room containing the event.
     * @param eventId - The event to fetch relations for.
     * @param relationType - The relation type to filter by.
     * @param eventType - Optional event type to filter by.
     * @param opts - Request options, defaulting to backwards pagination.
     * @returns A promise resolving to the relations response.
     *
     * @example
     * ```typescript
     * const res = await client.fetchRelations(roomId, eventId, RelationType.Annotation);
     * ```
     */
    public fetchRelations(
        roomId: string,
        eventId: string,
        relationType: RelationType | string | null,
        eventType?: string | null,
        opts: IRelationsRequestOpts = { dir: Direction.Backward },
    ): Promise<IRelationsResponse> {
        return this.getRelationsManager().fetchRelations(roomId, eventId, relationType, eventType, opts);
    }

    /**
     * Get all current state events for a room.
     *
     * @param roomId - The room to query.
     * @returns A promise resolving to the room's state events.
     *
     * @example
     * ```typescript
     * const state = await client.roomState(roomId);
     * ```
     */
    public roomState(roomId: string): Promise<IStateEventWithRoomId[]> {
        return this.getEventManager().getState(roomId) as Promise<IStateEventWithRoomId[]>;
    }

    /**
     * Fetch a single event from a room by id.
     *
     * @param roomId - The room containing the event.
     * @param eventId - The event to fetch.
     * @returns A promise resolving to the raw event.
     *
     * @example
     * ```typescript
     * const event = await client.fetchRoomEvent(roomId, eventId);
     * ```
     */
    public fetchRoomEvent(roomId: string, eventId: string): Promise<Partial<IEvent>> {
        return this.getEventManager().getEvent(roomId, eventId) as Promise<Partial<IEvent>>;
    }

    /**
     * Get the members of a room, optionally filtered by membership.
     *
     * @param roomId - The room to query.
     * @param includeMembership - Only include members with this membership (e.g. `"join"`).
     * @param excludeMembership - Exclude members with this membership.
     * @param atEventId - Return membership as of this point in the timeline.
     * @returns A promise resolving to member state events keyed by user id.
     *
     * @example
     * ```typescript
     * const members = await client.members(roomId, "join");
     * ```
     */
    public members(
        roomId: string,
        includeMembership?: string,
        excludeMembership?: string,
        atEventId?: string,
    ): Promise<{ [userId: string]: IStateEventWithRoomId[] }> {
        return membersRequest(roomId, includeMembership, excludeMembership, atEventId, this.authedRequestProxy);
    }

    /**
     * Upgrade a room to a new room version, creating a replacement room.
     *
     * @param roomId - The room to upgrade.
     * @param newVersion - The target room version.
     * @param additionalCreators - Extra users to grant power to create the new room.
     * @returns A promise resolving to `{ replacement_room }`.
     *
     * @example
     * ```typescript
     * const { replacement_room } = await client.upgradeRoom(roomId, "10");
     * ```
     */
    public upgradeRoom(
        roomId: string,
        newVersion: string,
        additionalCreators?: string[],
    ): Promise<{ replacement_room: string }> {
        return this.getRoomManager().upgradeRoom(roomId, newVersion, additionalCreators);
    }

    /**
     * Get a single state event's content from a room.
     *
     * @param roomId - The room to query.
     * @param eventType - The type of state event.
     * @param stateKey - The state key, defaulting to `""`.
     * @returns A promise resolving to the event content.
     *
     * @example
     * ```typescript
     * const content = await client.getStateEvent(roomId, EventType.RoomName);
     * ```
     */
    public getStateEvent(roomId: string, eventType: string, stateKey = ""): Promise<IContent> {
        return this.getEventManager().getStateEvent(roomId, eventType, stateKey);
    }

    /**
     * Send a state event into a room.
     *
     * Unlike `m.room.message`, state events are keyed by `(eventType, stateKey)` — sending to the
     * same pair replaces the previous value, so this is idempotent by nature (no de-duplication
     * needed).
     *
     * @param roomId - The target room.
     * @param eventType - A state event type from {@link StateEvents}.
     * @param content - The new state content; fully replaces the previous content.
     * @param stateKey - State key, defaults to `""`.
     * @param opts - Request options.
     * @returns The send result, including the server-assigned `event_id`.
     *
     * @example
     * ```typescript
     * await client.sendStateEvent(roomId, EventType.RoomName, { name: "工程团队" } as StateEvents[EventType.RoomName]);
     * ```
     *
     * @throws {SdkError} If the caller lacks the required power level (`M_FORBIDDEN`).
     */
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

    /**
     * Perform an initial sync of a single room.
     *
     * @param roomId - The room to sync.
     * @param _limit - Deprecated; the backend no longer honours a limit.
     * @returns A promise resolving to the room initial sync response.
     *
     * @example
     * ```typescript
     * const data = await client.roomInitialSync(roomId, 20);
     * ```
     */
    public roomInitialSync(roomId: string, _limit: number): Promise<IRoomInitialSyncResponse> {
        return this.getRoomManager().roomInitialSync(roomId);
    }

    /**
     * Fetch the ids of every room this account has joined.
     *
     * This is a direct server query, useful before the first `/sync` completes. Once syncing,
     * {@link MatrixClient.getRooms} is usually cheaper — it reads the local store and returns
     * `Room` objects, not just ids.
     *
     * @returns `{ joined_rooms: string[] }`.
     *
     * @example
     * ```typescript
     * const { joined_rooms } = await client.getJoinedRooms();
     * console.log(`已加入 ${joined_rooms.length} 个房间`);
     * ```
     *
     * @throws {AuthError} When the access token is missing or expired.
     */
    public getJoinedRooms(): Promise<IJoinedRoomsResponse> {
        return getJoinedRoomsRequest(this.authedRequestProxy);
    }

    /**
     * Get the members that are currently joined to a room.
     *
     * @param roomId - The ID of the room whose joined members to fetch.
     * @returns The `{ joined: { [userId]: { display_name?, avatar_url? } } }` response.
     *
     * @example
     * ```typescript
     * const { joined } = await client.getJoinedRoomMembers(roomId);
     * console.log(`${Object.keys(joined).length} members joined`);
     * ```
     */
    public getJoinedRoomMembers(roomId: string): Promise<IJoinedMembersResponse> {
        return getJoinedRoomMembersRequest(roomId, this.authedRequestProxy);
    }

    /**
     * Query the public room directory, optionally against a remote server.
     *
     * Results are cached by the request parameters via `publicRoomsRequestCache`.
     *
     * @param options - Directory query options: `server` (defaults to the local
     *   homeserver), `limit`, `since` for pagination, plus `filter` /
     *   `include_all_networks` / `third_party_instance_id`.
     * @returns The public rooms response (`chunk`, `next_batch`, `total_room_count_estimate`).
     *
     * @example
     * ```typescript
     * const { chunk, next_batch } = await client.publicRooms({ limit: 20 });
     * for (const room of chunk) console.log(room.room_id, room.name);
     * ```
     */
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

    /**
     * Create a new room alias (e.g. `#foo:example.org`) pointing at a room.
     *
     * @param alias - The fully-qualified alias to create.
     * @param roomId - The room the alias should point to.
     * @returns An empty object on success.
     *
     * @example
     * ```typescript
     * await client.createAlias("#foo:example.org", roomId);
     * ```
     */
    public createAlias(alias: string, roomId: string): Promise<EmptyObject> {
        return this.getRoomManager().createAlias(alias, roomId);
    }

    /**
     * Delete a room alias so it no longer resolves to a room.
     *
     * @param alias - The fully-qualified alias to remove.
     * @returns An empty object on success.
     *
     * @example
     * ```typescript
     * await client.deleteAlias("#foo:example.org");
     * ```
     */
    public deleteAlias(alias: string): Promise<EmptyObject> {
        return this.getRoomManager().deleteAlias(alias);
    }

    /**
     * Get the local aliases currently mapped to a room.
     *
     * @param roomId - The room whose local aliases to list.
     * @returns `{ aliases: string[] }` with the room's local aliases.
     *
     * @example
     * ```typescript
     * const { aliases } = await client.getLocalAliases(roomId);
     * ```
     */
    public getLocalAliases(roomId: string): Promise<{ aliases: string[] }> {
        return this.getRoomManager().getLocalAliases(roomId);
    }

    /**
     * Resolve a room alias to its room ID and the servers that know about it.
     *
     * @param alias - The alias to resolve.
     * @returns `{ room_id, servers }` for the alias.
     *
     * @example
     * ```typescript
     * const { room_id } = await client.getRoomIdForAlias("#foo:example.org");
     * ```
     */
    public getRoomIdForAlias(alias: string): Promise<{ room_id: string; servers: string[] }> {
        return this.getRoomManager().getRoomIdForAlias(alias);
    }

    /**
     * Get a room's visibility in the room directory.
     *
     * @param roomId - The room to query.
     * @returns `{ visibility }`, either `"public"` or `"private"`.
     *
     * @example
     * ```typescript
     * const { visibility } = await client.getRoomDirectoryVisibility(roomId);
     * ```
     */
    public getRoomDirectoryVisibility(roomId: string): Promise<{ visibility: Visibility }> {
        return this.getRoomManager().getRoomDirectoryVisibility(roomId);
    }

    /**
     * Set a room's visibility in the room directory.
     *
     * @param roomId - The room to update.
     * @param visibility - `"public"` to list the room, `"private"` to hide it.
     * @returns An empty object on success.
     *
     * @example
     * ```typescript
     * await client.setRoomDirectoryVisibility(roomId, Visibility.Public);
     * ```
     */
    public setRoomDirectoryVisibility(roomId: string, visibility: Visibility): Promise<EmptyObject> {
        return this.getRoomManager().setRoomDirectoryVisibility(roomId, visibility);
    }

    /**
     * Search the homeserver's user directory for users matching a term.
     *
     * @param options - `term` to search for and an optional `limit` on the number of results.
     * @returns The user directory response containing the matched users.
     *
     * @example
     * ```typescript
     * const { results } = await client.searchUserDirectory({ term: "alice", limit: 10 });
     * ```
     */
    public searchUserDirectory({ term, limit }: { term: string; limit?: number }): Promise<IUserDirectoryResponse> {
        return this.getSearchManager().searchUserDirectory({ term, limit });
    }

    /**
     * Upload a file to the media repository and get back an `mxc://` URI.
     *
     * The returned `content_uri` is what you put into message content (`url` for
     * `m.image` / `m.file` / `m.audio` / `m.video`). Use {@link MatrixClient.mxcUrlToHttp} to turn
     * it back into a fetchable HTTP URL for rendering.
     *
     * @param file - A `File` / `Blob` (browser) or any object with a `name` and byte content.
     * @param opts - Upload options; `opts.name` sets the filename, `opts.type` the MIME type.
     *   `opts.onlyContentUri` returns just the URI string.
     * @returns The upload response containing `content_uri` (and `file` metadata when requested).
     *
     * @example
     * ```typescript
     * const { content_uri } = await client.uploadContent(pngBlob, { name: "diagram.png", type: "image/png" });
     *
     * await client.sendMessage(roomId, {
     *     msgtype: MsgType.Image,
     *     body: "diagram.png",
     *     url: content_uri,
     * });
     * ```
     *
     * @throws {SdkError} If the upload fails — commonly `M_TOO_LARGE` when the file exceeds the
     *   homeserver's `m.upload.size` limit.
     */
    public uploadContent(file: FileType, opts?: UploadOpts): Promise<UploadResponse> {
        return this.http.uploadContent(file, opts);
    }

    /**
     * Attempt to cancel an in-flight upload started by `uploadContent`.
     *
     * @param upload - The promise returned by `uploadContent`.
     * @returns `true` if the upload was found and cancelled, `false` otherwise.
     *
     * @example
     * ```typescript
     * const upload = client.uploadContent(file);
     * const cancelled = client.cancelUpload(upload);
     * ```
     */
    public cancelUpload(upload: Promise<UploadResponse>): boolean {
        return this.getMediaManager().cancelUpload(upload);
    }

    /**
     * List the uploads that are currently in progress.
     *
     * @returns An array of the in-flight `Upload` objects.
     *
     * @example
     * ```typescript
     * for (const upload of client.getCurrentUploads()) {
     *     console.log(upload.sourceUrl, upload.promise);
     * }
     * ```
     */
    public getCurrentUploads(): Upload[] {
        return this.http.getCurrentUploads();
    }

    /**
     * Check whether the homeserver advertises support for extended profiles
     * (custom profile fields beyond `displayname` / `avatar_url`).
     *
     * @returns `true` when extended profiles are supported.
     *
     * @example
     * ```typescript
     * if (await client.doesServerSupportExtendedProfiles()) {
     *     await client.setExtendedProfileProperty("m.nickname", "Alice");
     * }
     * ```
     */
    public async doesServerSupportExtendedProfiles(): Promise<boolean> {
        return this.getProfileManager().doesServerSupportExtendedProfiles();
    }

    /**
     * Get a user's full extended profile, including custom fields.
     *
     * @param userId - The user whose extended profile to fetch.
     * @returns The user's extended profile (base fields plus any custom fields).
     *
     * @example
     * ```typescript
     * const profile = await client.getExtendedProfile("@alice:example.org");
     * ```
     */
    public async getExtendedProfile(userId: string): Promise<IExtendedProfile> {
        return this.getProfileManager().getExtendedProfile(userId);
    }

    /**
     * Read a single custom field from a user's extended profile.
     *
     * @param userId - The user whose profile to read.
     * @param key - The custom profile field name.
     * @returns The value of the field, or `undefined` if unset.
     *
     * @example
     * ```typescript
     * const nickname = await client.getExtendedProfileProperty("@alice:example.org", "m.nickname");
     * ```
     */
    public async getExtendedProfileProperty(userId: string, key: string): Promise<unknown> {
        return this.getProfileManager().getExtendedProfileProperty(userId, key);
    }

    /**
     * Set a single custom field on the logged-in user's extended profile.
     *
     * @param key - The custom profile field name.
     * @param value - The value to store for the field.
     * @returns Resolves once the field has been written.
     *
     * @example
     * ```typescript
     * await client.setExtendedProfileProperty("m.nickname", "Alice");
     * ```
     */
    public async setExtendedProfileProperty(key: string, value: unknown): Promise<void> {
        return this.getProfileManager().setExtendedProfileProperty(key, value);
    }

    /**
     * Delete a single custom field from the logged-in user's extended profile.
     *
     * @param key - The custom profile field name to remove.
     * @returns Resolves once the field has been deleted.
     *
     * @example
     * ```typescript
     * await client.deleteExtendedProfileProperty("m.nickname");
     * ```
     */
    public async deleteExtendedProfileProperty(key: string): Promise<void> {
        return this.getProfileManager().deleteExtendedProfileProperty(key);
    }

    /**
     * Patch the logged-in user's extended profile, changing only the supplied fields.
     *
     * @param profile - The subset of profile fields to update.
     * @returns The resulting extended profile after the patch.
     *
     * @example
     * ```typescript
     * const updated = await client.patchExtendedProfile({ displayname: "Alice" });
     * ```
     */
    public async patchExtendedProfile(profile: IExtendedProfile): Promise<IExtendedProfile> {
        return this.getProfileManager().patchExtendedProfile(profile);
    }

    /**
     * Replace the logged-in user's extended profile with the given fields.
     *
     * @param profile - The full extended profile to store.
     * @returns Resolves once the profile has been written.
     *
     * @example
     * ```typescript
     * await client.setExtendedProfile({ displayname: "Alice", avatar_url: "mxc://example.org/abc" });
     * ```
     */
    public async setExtendedProfile(profile: IExtendedProfile): Promise<void> {
        return this.getProfileManager().setExtendedProfile(profile);
    }

    /**
     * Set a new password for an account, typically as part of account recovery.
     *
     * @param authDict - The auth dict (UIA) proving the caller may change the password.
     * @param newPassword - The new password to set.
     * @param logoutDevices - When `true`, log out all other sessions/devices.
     * @returns An empty object on success.
     *
     * @example
     * ```typescript
     * await client.setPassword({ type: "m.login.password", password: "old" }, "new-password", true);
     * ```
     */
    public setPassword(authDict: AuthDict, newPassword: string, logoutDevices?: boolean): Promise<EmptyObject> {
        return this.getPasswordResetManager().setPassword(authDict, newPassword, logoutDevices);
    }

    /**
     * Store per-device local notification settings on the homeserver.
     *
     * @param deviceId - The device whose notification settings to update.
     * @param notificationSettings - The local notification settings to store.
     * @returns An empty object on success.
     *
     * @example
     * ```typescript
     * await client.setLocalNotificationSettings(deviceId, { is_silenced: true });
     * ```
     */
    public setLocalNotificationSettings(
        deviceId: string,
        notificationSettings: LocalNotificationSettings,
    ): Promise<EmptyObject> {
        return this.getNotificationsManager().setLocalNotificationSettings(deviceId, notificationSettings);
    }

    /**
     * Run a full-text search over the user's rooms.
     *
     * @param query - The search request: `body` holds the search criteria and `next_batch`
     *   resumes a previous paginated search.
     * @param abortSignal - Optional signal to abort the in-flight request.
     * @returns The search response with results grouped by room.
     *
     * @example
     * ```typescript
     * const res = await client.search({ body: { search_categories: { room_events: { search_term: "hello" } } } });
     * ```
     */
    public search(
        { body, next_batch: nextBatch }: { body: ISearchRequestBody; next_batch?: string },
        abortSignal?: AbortSignal,
    ): Promise<ISearchResponse> {
        return this.getSearchManager().search({ body, next_batch: nextBatch, abortSignal });
    }

    /**
     * Upload the caller's device keys (and any one-time keys) to the homeserver.
     *
     * @param content - The device keys and one-time keys to upload.
     * @returns The upload response, including the counts of one-time keys still on the server.
     *
     * @example
     * ```typescript
     * const res = await client.uploadKeysRequest({ device_keys: keys });
     * ```
     */
    public uploadKeysRequest(content: IUploadKeysRequest, _opts?: void): Promise<IKeysUploadResponse> {
        return this.getCryptoKeysManager().uploadKeys(content);
    }

    /**
     * Upload cross-signing signatures over other users' device keys.
     *
     * @param content - A map of user ID → key ID → key/signature to upload.
     * @returns The upload response with the number of failures.
     *
     * @example
     * ```typescript
     * const { failures } = await client.uploadKeySignatures(signatures);
     * ```
     */
    public uploadKeySignatures(content: KeySignatures): Promise<IUploadKeySignaturesResponse> {
        return this.getCryptoKeysManager().uploadKeySignatures(content);
    }

    /**
     * Download the device keys for a set of users.
     *
     * @param userIds - The users whose device keys to query.
     * @param options - Optional `token` to get an incremental (changed-only) result.
     * @returns The download result with each user's device keys.
     *
     * @example
     * ```typescript
     * const result = await client.downloadKeysForUsers(["@alice:example.org"]);
     * ```
     */
    public downloadKeysForUsers(userIds: string[], { token }: { token?: string } = {}): Promise<IDownloadKeyResult> {
        return this.getCryptoKeysManager().queryKeys(userIds, { token });
    }

    /**
     * Claim one-time keys for a set of devices, typically to start an Olm session.
     *
     * @param devices - List of `[userId, deviceId]` pairs whose one-time keys to claim.
     * @param keyAlgorithm - The key algorithm to claim (defaults to `"signed_curve25519"`).
     * @param timeout - Optional timeout in milliseconds for the claim request.
     * @returns The claimed one-time keys, keyed by user and device.
     *
     * @example
     * ```typescript
     * const keys = await client.claimOneTimeKeys([["@alice:example.org", "DEVICEID"]]);
     * ```
     */
    public claimOneTimeKeys(
        devices: [string, string][],
        keyAlgorithm = "signed_curve25519",
        timeout?: number,
    ): Promise<IClaimOTKsResult> {
        return this.getCryptoKeysManager().claimKeys(devices, keyAlgorithm, timeout);
    }

    /**
     * Get the users whose device keys have changed between two sync tokens.
     *
     * @param oldToken - The sync token the client last saw key changes at.
     * @param newToken - The current sync token.
     * @returns `{ changed, left }` — users with key changes and users who are no longer tracked.
     *
     * @example
     * ```typescript
     * const { changed, left } = await client.getKeyChanges(oldToken, newToken);
     * ```
     */
    public getKeyChanges(oldToken: string, newToken: string): Promise<{ changed: string[]; left: string[] }> {
        return this.getCryptoKeysManager().getKeysChanges(oldToken, newToken) as Promise<{
            changed: string[];
            left: string[];
        }>;
    }

    /**
     * Upload the caller's cross-signing signing keys to the homeserver.
     *
     * @param auth - Optional auth dict for the user-interactive auth flow.
     * @param keys - The cross-signing keys (master, self-signing, user-signing) to upload.
     * @returns An empty object on success.
     *
     * @example
     * ```typescript
     * await client.uploadDeviceSigningKeys(auth, crossSigningKeys);
     * ```
     */
    public uploadDeviceSigningKeys(auth?: AuthDict, keys?: CrossSigningKeys): Promise<EmptyObject> {
        return uploadDeviceSigningKeysHttpRequest<EmptyObject>(auth, keys, this.authedRequestProxy);
    }

    /**
     * Request a room key from other devices for an undecryptable event.
     *
     * @param request - The room key request details (algorithm, room, session, optional request id).
     * @returns The created request's `{ request_id }`.
     *
     * @example
     * ```typescript
     * const { request_id } = await client.requestRoomKey({ algorithm: "m.megolm.v1.aes-sha2", room_id, session_id });
     * ```
     */
    public requestRoomKey(request: ICreateRoomKeyRequest): Promise<IRoomKeyRequestCreateResponse> {
        return requestRoomKeyHttpRequest<IRoomKeyRequestCreateResponse>(request, this.authedRequestProxy);
    }

    /**
     * List pending room key requests for the current user.
     *
     * @param query - Optional filters: `status`, `room_id`, `session_id` and `limit`.
     * @returns The matching room key requests.
     *
     * @example
     * ```typescript
     * const { requests } = await client.getRoomKeyRequests({ status: "pending" });
     * ```
     */
    public getRoomKeyRequests(query: IGetRoomKeyRequestsQuery = {}): Promise<IRoomKeyRequestsResponse> {
        return getRoomKeyRequestsHttpRequest<IRoomKeyRequestsResponse>(query, this.authedRequestProxy);
    }

    /**
     * Cancel a previously created room key request.
     *
     * @param requestId - The ID of the room key request to cancel.
     * @returns An empty object on success.
     *
     * @example
     * ```typescript
     * await client.deleteRoomKeyRequest(requestId);
     * ```
     */
    public deleteRoomKeyRequest(requestId: string): Promise<EmptyObject> {
        return deleteRoomKeyRequestHttpRequest<EmptyObject>(requestId, this.authedRequestProxy);
    }

    /**
     * Get the third-party protocols supported by the homeserver.
     *
     * @returns A map of protocol name to its protocol definition.
     *
     * @example
     * ```typescript
     * const protocols = await client.getThirdpartyProtocols();
     * ```
     */
    public async getThirdpartyProtocols(): Promise<{ [protocol: string]: IProtocol }> {
        return this.getThirdPartyManager().getThirdpartyProtocols();
    }

    /**
     * Look up third-party locations (e.g. IRC channels) by search fields.
     *
     * @param protocol - The third-party protocol name (e.g. `"irc"`).
     * @param params - Optional `searchFields` to filter the locations.
     * @returns The matching third-party locations.
     *
     * @example
     * ```typescript
     * const locations = await client.getThirdpartyLocation("irc", { searchFields: ["matrix"] });
     * ```
     */
    public getThirdpartyLocation(
        protocol: string,
        params: { searchFields?: string[] },
    ): Promise<IThirdPartyLocation[]> {
        return this.getThirdPartyManager().getThirdpartyLocation(protocol, params);
    }

    /**
     * Look up third-party users (e.g. IRC nicks) by search fields.
     *
     * @param protocol - The third-party protocol name (e.g. `"irc"`).
     * @param params - Optional query parameters to filter the users.
     * @returns The matching third-party users.
     *
     * @example
     * ```typescript
     * const users = await client.getThirdpartyUser("irc", { userid: "alice" });
     * ```
     */
    public getThirdpartyUser(protocol: string, params?: QueryDict): Promise<IThirdPartyUser[]> {
        return this.getThirdPartyManager().getThirdpartyUser(protocol, params);
    }

    /**
     * Fetch the room hierarchy (a space and, transitively, its child rooms/spaces).
     *
     * @param roomId - The space/room to start from.
     * @param limit - Optional maximum number of rooms per level.
     * @param maxDepth - Optional maximum depth of the hierarchy to traverse.
     * @param suggestedOnly - When `true`, return only rooms marked as suggested.
     * @param fromToken - Optional pagination token from a previous call.
     * @returns The room hierarchy response.
     *
     * @example
     * ```typescript
     * const hierarchy = await client.getRoomHierarchy(spaceId, 50, 3);
     * ```
     */
    public getRoomHierarchy(
        roomId: string,
        limit?: number,
        maxDepth?: number,
        suggestedOnly = false,
        fromToken?: string,
    ): Promise<IRoomHierarchy> {
        return this.getRoomManager().getRoomHierarchy(roomId, limit, maxDepth, suggestedOnly, fromToken);
    }

    /**
     * Create a new MSC3089 file tree (a room-backed file store) with the given name.
     *
     * @param name - The name of the file tree to create.
     * @returns The created {@link MSC3089TreeSpace}.
     *
     * @example
     * ```typescript
     * const tree = await client.unstableCreateFileTree("My Files");
     * ```
     */
    public async unstableCreateFileTree(name: string): Promise<MSC3089TreeSpace> {
        return createFileTreeSpaceRequest(
            name,
            this.getUserId.bind(this),
            this.createRoom.bind(this),
            (roomId) => new MSC3089TreeSpace(this, roomId),
        );
    }

    /**
     * Resolve a room ID to its MSC3089 file tree wrapper, if it is one.
     *
     * @param roomId - The room ID to interpret as a file tree.
     * @returns The {@link MSC3089TreeSpace} for the room, or `null` if it is not one.
     *
     * @example
     * ```typescript
     * const tree = client.unstableGetFileTreeSpace(roomId);
     * if (tree) await tree.getFile("notes.md");
     * ```
     */
    public unstableGetFileTreeSpace(roomId: string): MSC3089TreeSpace | null {
        return getFileTreeSpaceReference(
            roomId,
            (targetRoomId) => this.getRoom(targetRoomId),
            (targetRoomId) => new MSC3089TreeSpace(this, targetRoomId),
        );
    }

    /**
     * Issue a Sliding Sync (MSC3575) request against the homeserver or a proxy.
     *
     * @param req - The Sliding Sync request describing lists, ranges and extensions.
     * @param proxyBaseUrl - Optional base URL of a Sliding Sync proxy to use.
     * @param abortSignal - Optional signal to abort the request.
     * @returns The Sliding Sync response.
     *
     * @example
     * ```typescript
     * const res = await client.slidingSync({ lists: {}, extensions: {} });
     * ```
     */
    public slidingSync(
        req: MSC3575SlidingSyncRequest,
        proxyBaseUrl?: string,
        abortSignal?: AbortSignal,
    ): Promise<MSC3575SlidingSyncResponse> {
        return this.getRoomManager().slidingSync(req, proxyBaseUrl, abortSignal) as Promise<MSC3575SlidingSyncResponse>;
    }

    /**
     * Check whether the homeserver (or configured proxy) supports Sliding Sync.
     *
     * @returns `true` when Sliding Sync is available.
     *
     * @example
     * ```typescript
     * if (await client.isSlidingSyncSupported()) {
     *     await client.slidingSync({ lists: {}, extensions: {} });
     * }
     * ```
     */
    public async isSlidingSyncSupported(): Promise<boolean> {
        return this.getRoomManager().isSlidingSyncSupported();
    }

    /**
     * Check whether the homeserver supports threaded events.
     *
     * @returns `true` when thread support is advertised.
     *
     * @example
     * ```typescript
     * if (client.supportsThreads()) {
     *     await client.sendEvent(roomId, "m.room.message", { "m.relates_to": { rel_type: "m.thread" } });
     * }
     * ```
     */
    public supportsThreads(): boolean {
        return this.getServerCapabilitiesManager().supportsThreads();
    }

    /**
     * Check whether the homeserver supports intentional mentions (MSC3952).
     *
     * @returns `true` when intentional mentions are advertised.
     *
     * @example
     * ```typescript
     * const mentionsOk = client.supportsIntentionalMentions();
     * ```
     */
    public supportsIntentionalMentions(): boolean {
        return this.getServerCapabilitiesManager().supportsIntentionalMentions();
    }

    /**
     * List the rooms the current user is a member of, using the server-side room list.
     *
     * @returns `{ rooms, total }` with the user's rooms and the total count.
     *
     * @example
     * ```typescript
     * const { rooms, total } = await client.getMyRooms();
     * ```
     */
    public async getMyRooms(): Promise<{ rooms: IMyRoomInfo[]; total: number }> {
        return this.getRoomManager().getMyRooms() as Promise<{ rooms: IMyRoomInfo[]; total: number }>;
    }

    /**
     * Create a server-side secure backup (key backup) version.
     *
     * @param body - The backup creation body: `algorithm` plus the client-derived `auth_data`.
     * @returns Information about the newly created backup.
     *
     * @example
     * ```typescript
     * const backup = await client.createSecureBackup({ algorithm: "m.megolm_backup.v1.curve25519-aes-sha2", auth_data });
     * ```
     */
    public async createSecureBackup(body: ISecureBackupCreateBody): Promise<ISecureBackupInfo> {
        return createSecureBackupRequest<ISecureBackupInfo>(body.algorithm, body.auth_data, this.authedRequestProxy);
    }

    /**
     * Search across the user's joined rooms for a term.
     *
     * @param searchTerm - The term to search for.
     * @param limit - Optional maximum number of results.
     * @returns `{ results, count, next_batch }` for the search.
     *
     * @example
     * ```typescript
     * const { results, count } = await client.searchRooms("roadmap", 20);
     * ```
     */
    public async searchRooms(
        searchTerm: string,
        limit?: number,
    ): Promise<{ results: unknown[]; count: number; next_batch: string | null }> {
        return this.getRoomManager().searchRooms(searchTerm, limit);
    }

    /**
     * Search for message recipients (users) by name or ID.
     *
     * @param searchTerm - The term to search recipients for.
     * @param limit - Optional maximum number of results.
     * @returns `{ results, count, next_batch }` for the search.
     *
     * @example
     * ```typescript
     * const { results } = await client.searchRecipients("alice", 10);
     * ```
     */
    public async searchRecipients(
        searchTerm: string,
        limit?: number,
    ): Promise<{ results: unknown[]; count: number; next_batch: string | null }> {
        return this.getSearchManager().searchRecipients({ term: searchTerm, limit });
    }

    /**
     * Fetch the homeserver's client configuration (URLs, enabled features and defaults).
     *
     * @returns The parsed client config: homeserver / identity server URLs, push and
     *   email feature flags, a `features` map and server-defined `defaults`.
     *
     * @example
     * ```typescript
     * const config = await client.getClientConfig();
     * console.log(config.homeserver.base_url);
     * ```
     */
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

    /**
     * Fetch the user info associated with the current SSO/OIDC login.
     *
     * @returns The SSO user info, including the subject (`sub`) and optional name/picture/email.
     *
     * @example
     * ```typescript
     * const { sub, email } = await client.getSSOUserInfo();
     * ```
     */
    public async getSSOUserInfo(): Promise<{
        sub: string;
        name?: string;
        picture?: string;
        email?: string;
    }> {
        return getSSOUserInfoRequest(this.authedRequestProxy);
    }

    /**
     * Get the metadata for an existing secure backup version.
     *
     * @param backupId - The backup version to fetch.
     * @returns Information about the backup, including `key_count` and `auth_data`.
     *
     * @example
     * ```typescript
     * const backup = await client.getSecureBackup(backupId);
     * ```
     */
    public async getSecureBackup(backupId: string): Promise<ISecureBackupInfo> {
        return getSecureBackupRequest<ISecureBackupInfo>(backupId, this.authedRequestProxy);
    }

    /**
     * Verify a passphrase against a secure backup version.
     *
     * @param backupId - The backup version to verify against.
     * @param passphrase - The passphrase to check.
     * @returns `{ valid }` indicating whether the passphrase matched.
     *
     * @example
     * ```typescript
     * const { valid } = await client.verifySecureBackupPassphrase(backupId, "my passphrase");
     * ```
     */
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

    /**
     * Store Megolm session keys into a secure backup version.
     *
     * @param backupId - The backup version to write keys into.
     * @param sessionKeys - The session keys to store.
     * @returns `{ key_count }` with the number of keys stored.
     *
     * @example
     * ```typescript
     * const { key_count } = await client.storeSecureBackupKeys(backupId, sessionKeys);
     * ```
     */
    public async storeSecureBackupKeys(
        backupId: string,
        sessionKeys: ISecureBackupSessionKey[],
    ): Promise<ISecureBackupStoreKeysResponse> {
        return storeSecureBackupKeysRequest<ISecureBackupStoreKeysResponse>(
            backupId,
            sessionKeys,
            this.authedRequestProxy,
        );
    }

    /**
     * Restore session keys from a secure backup version.
     *
     * @param backupId - The backup version to restore from.
     * @param rooms - Optional list of room IDs to restrict the restore to.
     * @returns `{ total_keys, sessions }` with the restored session keys.
     *
     * @example
     * ```typescript
     * const { total_keys, sessions } = await client.restoreSecureBackup(backupId);
     * ```
     */
    public async restoreSecureBackup(backupId: string, rooms?: string[]): Promise<ISecureBackupRestoreResponse> {
        return restoreSecureBackupRequest<ISecureBackupRestoreResponse>(backupId, rooms, this.authedRequestProxy);
    }

    /**
     * Delete a secure backup version from the server.
     *
     * @param backupId - The backup version to delete.
     * @returns An empty object on success.
     *
     * @example
     * ```typescript
     * await client.deleteSecureBackup(backupId);
     * ```
     */
    public async deleteSecureBackup(backupId: string): Promise<EmptyObject> {
        return deleteSecureBackupRequest(backupId, this.authedRequestProxy);
    }

    /**
     * Process a batch of threaded events, adding them to the appropriate thread.
     *
     * @param room - The room the events belong to.
     * @param threadedEvents - The thread-reply events to process.
     * @param toStartOfTimeline - `true` when the events are older than what is loaded.
     *
     * @example
     * ```typescript
     * client.processThreadEvents(room, threadedEvents, false);
     * ```
     */
    public processThreadEvents(room: Room, threadedEvents: MatrixEvent[], toStartOfTimeline: boolean): void {
        this.getTimelineManager().processThreadEvents(room, threadedEvents, toStartOfTimeline);
    }

    /**
     * Process a batch of thread root events, creating their threads as needed.
     *
     * @param room - The room the events belong to.
     * @param threadedEvents - The thread root events to process.
     * @param toStartOfTimeline - `true` when the events are older than what is loaded.
     *
     * @example
     * ```typescript
     * client.processThreadRoots(room, threadRoots, false);
     * ```
     */
    public processThreadRoots(room: Room, threadedEvents: MatrixEvent[], toStartOfTimeline: boolean): void {
        this.getTimelineManager().processThreadRoots(room, threadedEvents, toStartOfTimeline, this.supportsThreads());
    }

    /**
     * Process a batch of beacon (location) events for a room.
     *
     * @param room - The room the beacon events belong to.
     * @param events - The beacon events to process.
     *
     * @example
     * ```typescript
     * client.processBeaconEvents(room, beaconEvents);
     * ```
     */
    public processBeaconEvents(room?: Room, events?: MatrixEvent[]): void {
        this.getTimelineManager().processBeaconEvents(room, events);
    }

    /**
     * Process a batch of aggregated timeline events (edits, reactions, etc.) for a room.
     *
     * @param room - The room the events belong to.
     * @param events - The aggregated events to process.
     *
     * @example
     * ```typescript
     * client.processAggregatedTimelineEvents(room, events);
     * ```
     */
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

    /**
     * Get the user ID and (optionally) device ID for the current access token.
     *
     * @returns The `{ user_id, device_id?, is_guest? }` response for the logged-in session.
     *
     * @example
     * ```typescript
     * const { user_id } = await client.whoami();
     * ```
     */
    public async whoami(): Promise<IWhoamiResponse> {
        return this.http.authedRequest(Method.Get, "/account/whoami");
    }

    /**
     * Convert an absolute timestamp to the closest event, for jump-to-date.
     *
     * @param roomId - The room to search for events in.
     * @param timestamp - The timestamp (ms since epoch) to locate.
     * @param dir - Direction to search in (`"b"` for backwards or `"f"` for forwards).
     * @returns The closest event, or a "no event" fallback when none is found.
     *
     * @example
     * ```typescript
     * const res = await client.timestampToEvent(roomId, Date.now() - 86_400_000, Direction.Backward);
     * ```
     */
    public async timestampToEvent(
        roomId: string,
        timestamp: number,
        dir: Direction,
    ): Promise<TimestampToEventResponse> {
        return timestampToEventRequest<TimestampToEventResponse>(roomId, timestamp, dir, this.authedRequestProxy);
    }

    /**
     * Fetch the OIDC/OAuth2 authorization server metadata for authentication.
     *
     * Falls back to the legacy endpoint when the server predates OIDC metadata support.
     *
     * @returns The authorization server configuration, or `null` when none is available.
     *
     * @example
     * ```typescript
     * const metadata = await client.getAuthMetadata();
     * ```
     */
    public async getAuthMetadata(): Promise<OidcClientConfig> {
        return fetchAuthMetadataWithFallback(this.http.request.bind(this.http), this.isVersionSupported.bind(this));
    }

    /**
     * Get the crypto algorithm currently configured for this client.
     *
     * @returns The configured crypto algorithm, or `undefined` when crypto is disabled.
     *
     * @example
     * ```typescript
     * const algorithm = client.getCryptoAlgorithm();
     * ```
     */
    public getCryptoAlgorithm(): unknown {
        return undefined;
    }
    /**
     * Set the crypto algorithm for this client.
     *
     * No-op stub retained for backward compatibility: the crypto-algorithm
     * selection API has been removed and this method does not change any state.
     *
     * @param _algorithm - Ignored.
     *
     * @example
     * ```typescript
     * client.setCryptoAlgorithm("m.megolm.v1.aes-sha2");
     * ```
     */
    public setCryptoAlgorithm(_algorithm: unknown): void {}
    /**
     * Whether this client currently has a crypto stack initialised.
     *
     * Always returns `false` in this build; encryption is provided by the Rust
     * WASM crypto backend initialised through the dedicated crypto entry point.
     *
     * @returns Always `false`.
     *
     * @example
     * ```typescript
     * const enabled = client.hasCrypto();
     * ```
     */
    public hasCrypto(): boolean {
        return false;
    }
    /**
     * Initialise crypto for this client.
     *
     * No-op stub retained for backward compatibility; use `initRustCrypto`
     * to set up the Rust WASM crypto backend.
     *
     * @example
     * ```typescript
     * await client.initCrypto();
     * ```
     */
    public async initCrypto(): Promise<void> {}
    /**
     * Stop crypto for this client.
     *
     * No-op stub retained for backward compatibility.
     *
     * @example
     * ```typescript
     * client.stopCrypto();
     * ```
     */
    public stopCrypto(): void {}
    public cryptoStore: unknown = undefined;
    /**
     * Delete the persisted crypto store.
     *
     * No-op stub retained for backward compatibility.
     *
     * @example
     * ```typescript
     * await client.deleteCryptoStore();
     * ```
     */
    public async deleteCryptoStore(): Promise<void> {}
    /**
     * Whether the persisted crypto store has finished loading.
     *
     * Always returns `false` in this build.
     *
     * @returns Always `false`.
     *
     * @example
     * ```typescript
     * const ready = client.isCryptoStoreReady();
     * ```
     */
    public isCryptoStoreReady(): boolean {
        return false;
    }
    /**
     * Rotate the client's encryption keys via the key-rotation manager.
     *
     * @returns A promise that resolves once the rotation has been requested.
     *
     * @example
     * ```typescript
     * await client.rotateEncryptionKeys();
     * ```
     */
    public rotateEncryptionKeys(): Promise<void> {
        return this.getKeyRotationManager()
            .rotateKey()
            .then(() => {});
    }
    /**
     * Whether the encryption keys need to be rotated.
     *
     * Always returns `false` in this build.
     *
     * @returns Always `false`.
     *
     * @example
     * ```typescript
     * const needed = client.isRotationNeeded();
     * ```
     */
    public isRotationNeeded(): boolean {
        return false;
    }
    /**
     * Get the configured encryption key-rotation period.
     *
     * Always returns `0` in this build.
     *
     * @returns Always `0`.
     *
     * @example
     * ```typescript
     * const period = client.getRotationPeriod();
     * ```
     */
    public getRotationPeriod(): number {
        return 0;
    }
    /**
     * Set the encryption key-rotation period.
     *
     * No-op stub retained for backward compatibility: the encryption-rotation
     * module has been removed, use `client.getKeyRotationManager()` instead.
     *
     * @param _period - Ignored.
     *
     * @example
     * ```typescript
     * client.setRotationPeriod(7 * 24 * 60 * 60 * 1000);
     * ```
     */
    public setRotationPeriod(_period: number): void {
        // No-op: encryption-rotation module removed, use getKeyRotationManager() instead
    }
    /**
     * Get the timestamp of the last encryption key rotation.
     *
     * Always returns `0` in this build.
     *
     * @returns Always `0`.
     *
     * @example
     * ```typescript
     * const lastRotation = client.getLastRotationTime();
     * ```
     */
    public getLastRotationTime(): number {
        return 0;
    }
    /**
     * Get the room with the highest unread-notification count.
     *
     * Always returns `null` in this build.
     *
     * @returns Always `null`.
     *
     * @example
     * ```typescript
     * const room = client.getRoomWithHighestUnread();
     * ```
     */
    public getRoomWithHighestUnread(): Room | null {
        return null;
    }
    /**
     * Get all rooms that currently have unread notifications.
     *
     * Always returns an empty array in this build.
     *
     * @returns Always an empty array.
     *
     * @example
     * ```typescript
     * const rooms = client.getRoomsWithUnreadNotifications();
     * ```
     */
    public getRoomsWithUnreadNotifications(): Room[] {
        return [];
    }
    public rooms: Room[] = [];
    /**
     * Look up a room by its alias.
     *
     * Always returns `null` in this build.
     *
     * @param _alias - The room alias to look up (ignored).
     * @returns Always `null`.
     *
     * @example
     * ```typescript
     * const room = client.getRoomByAlias("#example:matrix.org");
     * ```
     */
    public getRoomByAlias(_alias: string): Room | null {
        return null;
    }
    /**
     * Sort the client's rooms by their last message.
     *
     * No-op stub retained for backward compatibility.
     *
     * @example
     * ```typescript
     * client.sortRoomsByLastMessage();
     * ```
     */
    public sortRoomsByLastMessage(): void {}
    /**
     * Claim one-time encryption keys for the given users.
     *
     * Stub implementation: resolves with `undefined` without contacting the server.
     *
     * @param _users - Map of user ID to the algorithms/devices to claim keys for (ignored).
     * @returns A promise that resolves with `undefined`.
     *
     * @example
     * ```typescript
     * await client.claimKeys({ "@alice:example.org": ["signed_curve25519"] });
     * ```
     */
    public claimKeys(_users: Record<string, string[]>): Promise<unknown> {
        return Promise.resolve(undefined);
    }
    public claimedKeys: Record<string, Record<string, string>> = {};
    /**
     * Get the storage usage for a user.
     *
     * Stub implementation: always resolves with `null`.
     *
     * @param _userId - The user whose storage usage to query (ignored).
     * @returns A promise that resolves with `null`.
     *
     * @example
     * ```typescript
     * const usage = await client.getUserStorageUsage("@alice:example.org");
     * ```
     */
    public getUserStorageUsage(_userId: string): Promise<{ size: number; ntFiles: number } | null> {
        return Promise.resolve(null);
    }
    /**
     * Get the notification (highlight and non-highlight) count for a room.
     *
     * Always returns `0` in this build.
     *
     * @param _roomId - The room to query (ignored).
     * @returns Always `0`.
     *
     * @example
     * ```typescript
     * const count = client.getNotificationCount("!room:example.org");
     * ```
     */
    public getNotificationCount(_roomId: string): number {
        return 0;
    }
    /**
     * Get the highlight notification count for a room.
     *
     * Always returns `0` in this build.
     *
     * @param _roomId - The room to query (ignored).
     * @returns Always `0`.
     *
     * @example
     * ```typescript
     * const count = client.getHighlightCount("!room:example.org");
     * ```
     */
    public getHighlightCount(_roomId: string): number {
        return 0;
    }
    /**
     * Whether a room has any unread notifications.
     *
     * Always returns `false` in this build.
     *
     * @param _roomId - The room to query (ignored).
     * @returns Always `false`.
     *
     * @example
     * ```typescript
     * const hasUnread = client.hasUnreadNotifications("!room:example.org");
     * ```
     */
    public hasUnreadNotifications(_roomId: string): boolean {
        return false;
    }
    /**
     * Whether a room has any unread highlight notifications.
     *
     * Always returns `false` in this build.
     *
     * @param _roomId - The room to query (ignored).
     * @returns Always `false`.
     *
     * @example
     * ```typescript
     * const hasHighlights = client.hasUnreadHighlights("!room:example.org");
     * ```
     */
    public hasUnreadHighlights(_roomId: string): boolean {
        return false;
    }
    public notificationCallback: unknown = undefined;
    /**
     * Get the total notification count across all rooms.
     *
     * Always returns `0` in this build.
     *
     * @returns Always `0`.
     *
     * @example
     * ```typescript
     * const total = client.getTotalNotificationCount();
     * ```
     */
    public getTotalNotificationCount(): number {
        return 0;
    }
    /**
     * Get the total highlight notification count across all rooms.
     *
     * Always returns `0` in this build.
     *
     * @returns Always `0`.
     *
     * @example
     * ```typescript
     * const total = client.getTotalHighlightCount();
     * ```
     */
    public getTotalHighlightCount(): number {
        return 0;
    }
    /**
     * Get the events queued for sending in a room.
     *
     * Always returns an empty array in this build.
     *
     * @param _roomId - The room to query (ignored).
     * @returns Always an empty array.
     *
     * @example
     * ```typescript
     * const pending = client.getPendingEvents("!room:example.org");
     * ```
     */
    public getPendingEvents(_roomId: string): MatrixEvent[] {
        return [];
    }
    /**
     * Whether a room has any events queued for sending.
     *
     * Always returns `false` in this build.
     *
     * @param _roomId - The room to query (ignored).
     * @returns Always `false`.
     *
     * @example
     * ```typescript
     * const pending = client.hasPendingEvents("!room:example.org");
     * ```
     */
    public hasPendingEvents(_roomId: string): boolean {
        return false;
    }
    /**
     * Get the events in a room that failed to send.
     *
     * Always returns an empty array in this build.
     *
     * @param _roomId - The room to query (ignored).
     * @returns Always an empty array.
     *
     * @example
     * ```typescript
     * const unsent = client.getUnsentEvents("!room:example.org");
     * ```
     */
    public getUnsentEvents(_roomId: string): MatrixEvent[] {
        return [];
    }
    /**
     * Send a reaction to a message.
     *
     * @param roomId - The room containing the event.
     * @param eventId - The event to react to.
     * @param key - The reaction key (typically an emoji).
     * @returns A promise that resolves with the reaction event ID, or `undefined`
     *   when the server response did not include one.
     *
     * @example
     * ```typescript
     * const reactionId = await client.reactToMessage(roomId, eventId, "👍");
     * ```
     */
    public reactToMessage(roomId: string, eventId: string, key: string): Promise<string | undefined> {
        return this.getRoomEventsManager()
            .sendReaction(roomId, eventId, key)
            .then((response: { event_id?: string }) => response?.event_id);
    }
    /**
     * Redact a previously sent reaction.
     *
     * @param roomId - The room containing the reaction event.
     * @param eventId - The reaction event to redact.
     * @param reason - Optional reason for the redaction.
     * @returns A promise that resolves with the redaction event.
     *
     * @example
     * ```typescript
     * await client.redactReaction(roomId, reactionEventId, "spam");
     * ```
     */
    public redactReaction(roomId: string, eventId: string, reason?: string): Promise<{ event_id: string }> {
        return this.redactEvent(roomId, eventId, reason);
    }
    /**
     * Get the users who reacted to a message.
     *
     * @param roomId - The room containing the event.
     * @param eventId - The event to inspect.
     * @returns A promise that resolves with the list of reacting users.
     *
     * @example
     * ```typescript
     * const users = await client.getReactionUsers(roomId, eventId);
     * ```
     */
    public getReactionUsers(roomId: string, eventId: string): Promise<Array<{ userId: string }>> {
        return this.getReactionsManager()
            .getReactionUsers(roomId, eventId)
            .then((users) => users.map((userId) => ({ userId })));
    }
    /**
     * Whether a specific user has reacted to a message with a given key.
     *
     * @param roomId - The room containing the event.
     * @param eventId - The event to inspect.
     * @param userId - The user whose reaction to check for.
     * @param key - The reaction key (typically an emoji).
     * @returns A promise that resolves with `true` when such a reaction exists.
     *
     * @example
     * ```typescript
     * const reacted = await client.hasReaction(roomId, eventId, userId, "👍");
     * ```
     */
    public hasReaction(roomId: string, eventId: string, userId: string, key: string): Promise<boolean> {
        return this.getReactionsManager().hasReaction(roomId, eventId, userId, key);
    }
    /**
     * Get the retention policy configured for a room.
     *
     * Stub implementation: always resolves with `undefined`.
     *
     * @param _roomId - The room to query (ignored).
     * @returns A promise that resolves with `undefined`.
     *
     * @example
     * ```typescript
     * const retention = await client.getRoomRetention("!room:example.org");
     * ```
     */
    public getRoomRetention(_roomId: string): Promise<unknown> {
        return Promise.resolve(undefined);
    }
    /**
     * Set the retention policy for a room.
     *
     * Stub implementation: resolves without contacting the server.
     *
     * @param _roomId - The room to configure (ignored).
     * @param _retention - The retention policy to apply (ignored).
     * @returns A promise that resolves once the (no-op) operation completes.
     *
     * @example
     * ```typescript
     * await client.setRoomRetention("!room:example.org", { max_lifetime: 86_400_000 });
     * ```
     */
    public setRoomRetention(_roomId: string, _retention: unknown): Promise<void> {
        return Promise.resolve();
    }
    /**
     * Get the server-wide retention policy.
     *
     * Stub implementation: always resolves with `undefined`.
     *
     * @returns A promise that resolves with `undefined`.
     *
     * @example
     * ```typescript
     * const retention = await client.getServerRetention();
     * ```
     */
    public getServerRetention(): Promise<unknown> {
        return Promise.resolve(undefined);
    }
    /**
     * Share a room's encryption key with the given users.
     *
     * Stub implementation: always resolves with `undefined`.
     *
     * @param _roomId - The room whose key to share (ignored).
     * @param _users - The users to share the key with (ignored).
     * @returns A promise that resolves with `undefined`.
     *
     * @example
     * ```typescript
     * await client.shareRoomKey("!room:example.org", ["@alice:example.org"]);
     * ```
     */
    public shareRoomKey(_roomId: string, _users: string[]): Promise<unknown> {
        return Promise.resolve(undefined);
    }
    /**
     * Get the users with whom a room's encryption key has been shared.
     *
     * Always resolves with an empty map in this build.
     *
     * @param _roomId - The room to query (ignored).
     * @returns A promise that resolves with an empty map.
     *
     * @example
     * ```typescript
     * const shared = await client.getSharedWithUsers("!room:example.org");
     * ```
     */
    public getSharedWithUsers(_roomId: string): Promise<SharedWithUsersMap> {
        return Promise.resolve({});
    }
    /**
     * Whether a room's encryption key has been shared with a given user.
     *
     * Always resolves with `false` in this build.
     *
     * @param _userId - The user to check for (ignored).
     * @returns A promise that resolves with `false`.
     *
     * @example
     * ```typescript
     * const shared = await client.hasSharedKeyWithUser("@alice:example.org");
     * ```
     */
    public hasSharedKeyWithUser(_userId: string): Promise<boolean> {
        return Promise.resolve(false);
    }
    /**
     * Export the client's room encryption keys.
     *
     * Stub implementation: always resolves with `undefined`.
     *
     * @returns A promise that resolves with `undefined`.
     *
     * @example
     * ```typescript
     * const exported = await client.exportRoomKeys();
     * ```
     */
    public exportRoomKeys(): Promise<unknown> {
        return Promise.resolve(undefined);
    }
    /**
     * Import room encryption keys into the client.
     *
     * Stub implementation: always resolves with `undefined`.
     *
     * @param _keys - The keys to import (ignored).
     * @param _options - Optional import options (ignored).
     * @returns A promise that resolves with `undefined`.
     *
     * @example
     * ```typescript
     * await client.importRoomKeys(keys);
     * ```
     */
    public importRoomKeys(_keys: unknown[], _options?: unknown): Promise<unknown> {
        return Promise.resolve(undefined);
    }
    /**
     * Whether secret storage is ready for use.
     *
     * @returns A promise that resolves with the secret-storage readiness state.
     *
     * @example
     * ```typescript
     * const ready = await client.isSecretStorageReady();
     * ```
     */
    public isSecretStorageReady(): Promise<boolean> {
        return this.getSecretStorageManager().isSecretStorageReady();
    }
    /**
     * Get the secret-storage key identified by the given key ID.
     *
     * @param keyId - The ID of the secret-storage key to retrieve.
     * @returns A promise that resolves with the `[keyId, key]` pair, or `null`
     *   when the key is not available.
     *
     * @example
     * ```typescript
     * const keyInfo = await client.getSecretStorageKey(keyId);
     * ```
     */
    public getSecretStorageKey(keyId: string): Promise<[string, string] | null> {
        return this.getSecretStorageManager().getSecretStorageKey(keyId);
    }
    /**
     * Store a secret in secret storage.
     *
     * @param name - The name of the secret.
     * @param secret - The secret value to store.
     * @param keys - Optional secret-storage key IDs allowed to decrypt the secret.
     * @returns A promise that resolves once the secret has been stored.
     *
     * @example
     * ```typescript
     * await client.storeSecret("m.cross_signing.master", secret);
     * ```
     */
    public storeSecret(name: string, secret: string, keys?: string[]): Promise<void> {
        return this.getSecretStorageManager().storeSecret(name, secret, keys);
    }
    /**
     * Retrieve a secret from secret storage.
     *
     * @param name - The name of the secret to retrieve.
     * @returns A promise that resolves with the secret value, or `null` when it
     *   is not present.
     *
     * @example
     * ```typescript
     * const secret = await client.getSecret("m.cross_signing.master");
     * ```
     */
    public getSecret(name: string): Promise<string | null> {
        return this.getSecretStorageManager().getSecret(name);
    }
    /**
     * Whether a secret exists in secret storage.
     *
     * @param name - The name of the secret to look for.
     * @returns A promise that resolves with `true` when the secret exists.
     *
     * @example
     * ```typescript
     * const exists = await client.hasSecret("m.cross_signing.master");
     * ```
     */
    public hasSecret(name: string): Promise<boolean> {
        return this.getSecretStorageManager().hasSecret(name);
    }
    /**
     * Get all secret-storage keys known to the client.
     *
     * @returns A promise that resolves with a map of key ID to key.
     *
     * @example
     * ```typescript
     * const keys = await client.getSecretStorageKeys();
     * ```
     */
    public getSecretStorageKeys(): Promise<Record<string, string>> {
        return this.getSecretStorageManager().getSecretStorageKeys();
    }
    /**
     * Get the capabilities advertised by the homeserver.
     *
     * @returns A promise that resolves with the server capabilities.
     *
     * @example
     * ```typescript
     * const capabilities = await client.getServerCapabilities();
     * ```
     */
    public getServerCapabilities(): Promise<Capabilities> {
        return this.getServerCapabilitiesManager().getServerCapabilities();
    }
    /**
     * Whether the homeserver advertises support for a feature.
     *
     * @param feature - The feature identifier to check for.
     * @returns `true` when the server supports the feature.
     *
     * @example
     * ```typescript
     * const supported = client.hasServerSupport("m.change_password");
     * ```
     */
    public hasServerSupport(feature: string): boolean {
        return this.getServerCapabilitiesManager().hasServerSupport(feature);
    }
    /**
     * Get the homeserver's version string.
     *
     * @returns A promise that resolves with the server version.
     *
     * @example
     * ```typescript
     * const version = await client.getServerVersion();
     * ```
     */
    public getServerVersion(): Promise<string> {
        return this.getServerCapabilitiesManager().getServerVersion();
    }
    /**
     * Whether the homeserver supports location (beacon) events.
     *
     * @returns `true` when location sharing is supported.
     *
     * @example
     * ```typescript
     * const supportsLocation = client.supportsLocation();
     * ```
     */
    public supportsLocation(): boolean {
        return this.getServerCapabilitiesManager().supportsLocation();
    }
    public serverClockDiff: number = 0;
    /**
     * Convert a server timestamp to the equivalent local timestamp.
     *
     * @param serverTs - The server-side timestamp (ms since epoch).
     * @returns The equivalent local timestamp (ms since epoch).
     *
     * @example
     * ```typescript
     * const localTs = client.getLocalTimestampForServerTime(serverTs);
     * ```
     */
    public getLocalTimestampForServerTime(serverTs: number): number {
        return this.getServerTimeManager().getLocalTimestampForServerTime(serverTs);
    }
    /**
     * Get the current server timestamp, compensated for clock drift.
     *
     * @returns The current server timestamp (ms since epoch).
     *
     * @example
     * ```typescript
     * const serverTs = client.getServerTimestamp();
     * ```
     */
    public getServerTimestamp(): number {
        return this.getServerTimeManager().getServerTimestamp();
    }
    /**
     * Update the cached server-time information from a server response.
     *
     * @param serverTime - The server timestamp (ms since epoch).
     * @param serverDate - The server `Date` header value.
     *
     * @example
     * ```typescript
     * client.updateServerTimeInfo(Date.now(), new Date().toUTCString());
     * ```
     */
    public updateServerTimeInfo(serverTime: number, serverDate: string): void {
        this.getServerTimeManager().updateServerTimeInfo(serverTime, serverDate);
    }
    /**
     * Wait for any in-flight requests to settle.
     *
     * Stub implementation: resolves immediately regardless of `_timeoutMs`.
     *
     * @param _timeoutMs - Maximum time to wait in milliseconds (ignored).
     * @returns A promise that resolves immediately.
     *
     * @example
     * ```typescript
     * await client.waitForPendingRequests(5000);
     * ```
     */
    public waitForPendingRequests(_timeoutMs: number): Promise<void> {
        return Promise.resolve();
    }
    /**
     * Whether the client has started syncing.
     *
     * Always returns `false` in this build.
     *
     * @returns Always `false`.
     *
     * @example
     * ```typescript
     * const started = client.hasStartedSync();
     * ```
     */
    public hasStartedSync(): boolean {
        return false;
    }
    /**
     * Whether the client is currently syncing.
     *
     * @returns `true` when a sync is in progress.
     *
     * @example
     * ```typescript
     * const syncing = client.isSyncing();
     * ```
     */
    public isSyncing(): boolean {
        return this.getSyncManager().isSyncing();
    }
    /**
     * Wait until the client has finished its initial sync.
     *
     * Stub implementation: resolves immediately.
     *
     * @example
     * ```typescript
     * await client.waitForSync();
     * ```
     */
    public async waitForSync(): Promise<void> {}
    public syncToken: string | null = null;
    public syncing: boolean = false;
    /**
     * Get the TURN server URIs available to this client.
     *
     * @returns A promise that resolves with the list of TURN server URIs.
     *
     * @example
     * ```typescript
     * const uris = await client.getTurnServerURIs();
     * ```
     */
    public getTurnServerURIs(): Promise<string[]> {
        return this.getTurnServerManager().getTurnServerURIs();
    }
    /**
     * Get the profile manager for this client.
     *
     * Stub implementation: always returns `null` in this build.
     *
     * @returns Always `null`.
     *
     * @example
     * ```typescript
     * const profileManager = client.getProfileManager();
     * ```
     */
    public getProfileManager(): ProfileManager {
        return null!;
    }
}

export { fixNotificationCountOnDecryption, inMainTimelineForReceipt, threadIdForReceipt };
