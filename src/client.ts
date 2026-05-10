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

import { type ISyncStateData, type SetPresence, SyncApi, type SyncApiOptions, SyncState } from "./sync.ts";
import type { MatrixClientExtensionMethods, MatrixClientInternalMethods } from "./matrix-client-extensions.d.ts";
import {
    EventStatus,
    type IContent,
    type IDecryptOptions,
    type IEvent,
    MatrixEvent,
    MatrixEventEvent,
    type MatrixEventHandlerMap,
    type PushDetails,
} from "./models/event.ts";
import { StubStore } from "./store/stub.ts";
import {
    type CallEvent,
    type CallEventHandlerMap,
    createNewMatrixCall,
    type MatrixCall,
    supportsMatrixCall,
} from "./webrtc/call.ts";
import { Filter, type IFilterDefinition } from "./filter.ts";
import {
    CallEventHandler,
    type CallEventHandlerEvent,
    type CallEventHandlerEventHandlerMap,
} from "./webrtc/callEventHandler.ts";
import {
    GroupCallEventHandler,
    type GroupCallEventHandlerEvent,
    type GroupCallEventHandlerEventHandlerMap,
} from "./webrtc/groupCallEventHandler.ts";
import * as utils from "./utils.ts";
import { deepCompare, noUnsafeEventProps, type QueryDict, sleep } from "./utils.ts";
import { Direction, EventTimeline } from "./models/event-timeline.ts";
import { type IActionsObject, PushProcessor } from "./pushprocessor.ts";
import { AutoDiscovery } from "./autodiscovery.ts";
import { TypedReEmitter } from "./ReEmitter.ts";
import { logger, type Logger } from "./logger.ts";
import { SERVICE_TYPES } from "./service-types.ts";
import {
    type Body,
    ClientPrefix,
    type FileType,
    type HttpApiEvent,
    type HttpApiEventHandlerMap,
    type HTTPError,
    IdentityPrefix,
    type IHttpOpts,
    type IRequestOpts,
    MatrixError,
    MatrixHttpApi,
    MediaPrefix,
    Method,
    retryNetworkOperation,
    type Upload,
    type UploadOpts,
    type UploadResponse,
} from "./http-api/index.ts";
import { User, UserEvent, type UserEventHandlerMap } from "./models/user.ts";
import { ProfileManager } from "./profile/index.ts";
import { SearchResult } from "./models/search-result.ts";
import { type IIdentityServerProvider } from "./@types/IIdentityServerProvider.ts";
import { type MatrixScheduler } from "./scheduler.ts";
import { type BeaconEvent, type BeaconEventHandlerMap } from "./models/beacon.ts";
import { type AuthDict } from "./interactive-auth.ts";
import { type IRoomEvent, type ReceivedToDeviceMessage } from "./sync-accumulator.ts";
import type { EventTimelineSet } from "./models/event-timeline-set.ts";
import { InflightRequestCache, stableSerialize } from "./utils/inflight-request-cache.ts";
import { LRUCache } from "./utils/lru-cache.ts";
import { NotificationCountType, type Room, type RoomEvent, type RoomEventHandlerMap } from "./models/room.ts";
import { RoomMemberEvent, type RoomMemberEventHandlerMap } from "./models/room-member.ts";
import { type RoomStateEvent, type RoomStateEventHandlerMap } from "./models/room-state.ts";
import {
    isSendDelayedEventRequestOpts,
    UpdateDelayedEventAction,
    type DelayedEventInfo,
    type IAddThreePidOnlyBody,
    type IBindThreePidBody,
    type IContextResponse,
    type ICreateRoomOpts,
    type IEventSearchOpts,
    type IFilterResponse,
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
} from "./@types/requests.ts";
import {
    type AccountDataEvents,
    EventType,
    LOCAL_NOTIFICATION_SETTINGS_PREFIX,
    RelationType,
    type RoomAccountDataEvents,
    type StateEvents,
    type TimelineEvents,
    type WritableAccountDataEvents,
} from "./@types/event.ts";
import {
    GuestAccess,
    HistoryVisibility,
    type IdServerUnbindResult,
    Preset,
    type Terms,
    type Visibility,
} from "./@types/partials.ts";
import { type EventMapper, eventMapperFor, type MapperOpts } from "./event-mapper.ts";
import { secureRandomString } from "./randomstring.ts";
import { MSC3089TreeSpace } from "./models/MSC3089TreeSpace.ts";
import { type IStore } from "./store/index.ts";
import {
    type ISearchRequestBody,
    type ISearchResponse,
    type ISearchResults,
    type IStateEventWithRoomId,
    SearchOrderBy,
} from "./@types/search.ts";
import { type ISynapseAdminDeactivateResponse, type ISynapseAdminWhoisResponse } from "./@types/synapse.ts";
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
} from "./client-internal-types.ts";
import { type IPushRule, type IPushRules } from "./@types/PushRules.ts";
import { type IThreepid } from "./@types/threepids.ts";
import { type CryptoStore } from "./crypto/store/base.ts";
import {
    GroupCall,
    type GroupCallIntent,
    type GroupCallType,
    type IGroupCallDataChannelOptions,
} from "./webrtc/groupCall.ts";
import { MediaHandler } from "./webrtc/mediaHandler.ts";
import {
    type ILoginFlowsResponse,
    type IRefreshTokenResponse,
    type LoginRequest,
    type LoginResponse,
    type LoginTokenPostResponse,
    type SSOAction,
} from "./@types/auth.ts";
import { TypedEventEmitter } from "./models/typed-event-emitter.ts";
import { ReceiptType } from "./@types/read_receipts.ts";
import { type MSC3575SlidingSyncRequest, type MSC3575SlidingSyncResponse } from "./sliding-sync.ts";
import { SlidingSyncSdk } from "./sliding-sync-sdk.ts";
import {
    determineFeatureSupport,
    FeatureSupport,
    Thread,
    THREAD_RELATION_TYPE,
    ThreadFilterType,
} from "./models/thread.ts";
import { NamespacedValue, UnstableValue } from "./NamespacedValue.ts";
import { ToDeviceMessageQueue } from "./ToDeviceMessageQueue.ts";
import { type ToDeviceBatch, type ToDevicePayload } from "./models/ToDeviceMessage.ts";
import { IgnoredInvites } from "./models/invites-ignorer.ts";
import { type UIARequest } from "./@types/uia.ts";
import { type LocalNotificationSettings } from "./@types/local_notifications.ts";
import { buildFeatureSupportMap, Feature, ServerSupport } from "./feature.ts";
import { M_BEACON_INFO, type MBeaconInfoEventContent } from "./@types/beacon.ts";
import { type CryptoBackend } from "./common-crypto/CryptoBackend.ts";
import { RUST_SDK_STORE_PREFIX } from "./rust-crypto/constants.ts";
import { type CryptoApi, type CryptoCallbacks, CryptoEvent, type CryptoEventHandlerMap } from "./crypto-api/index.ts";
import {
    type SecretStorageKeyDescription,
    type ServerSideSecretStorage,
    ServerSideSecretStorageImpl,
} from "./secret-storage.ts";
import { type RegisterRequest, type RegisterResponse } from "./@types/registration.ts";
import { MatrixRTCSessionManager } from "./matrixrtc/MatrixRTCSessionManager.ts";
import { type Membership } from "./@types/membership.ts";
import { type RoomMessageEventContent } from "./@types/events.ts";
import { type ImageInfo } from "./@types/media.ts";
import { type Capabilities, ServerCapabilities } from "./serverCapabilities.ts";
import { type OidcClientConfig } from "./oidc/index.ts";
import { type EmptyObject } from "./@types/common.ts";
import { UnsupportedDelayedEventsEndpointError, UnsupportedStickyEventsEndpointError } from "./errors.ts";
import { type Transport } from "./matrixrtc/index.ts";
import { getLegacyClientPrefix } from "./client-internals.ts";
import { buildDelayedEventsQuery, buildUnstableFeaturePrefix } from "./client-delayed-events.ts";
import {
    updateScheduledDelayedEventWithActionInBody as updateScheduledDelayedEventWithActionInBodyRequest,
    updateScheduledDelayedEventWithFallback,
} from "./client-delayed-events-updater.ts";
import { prepareSendCompleteEventLifecycle } from "./client-send-lifecycle.ts";
import { encryptAndSendEventWorkflow } from "./client-encrypt-send.ts";
import { dispatchSendEventHttpRequest } from "./client-send-http.ts";
import { dispatchDelayedStateEventRequest, dispatchStateEventRequest } from "./client-send-state.ts";
import { prepareSendEventParams, type PreparedSendEventParams } from "./client-send-event.ts";
import {
    buildEmoteMessagePayload,
    buildHtmlEmotePayload,
    buildHtmlMessagePayload,
    buildHtmlNoticePayload,
    buildImageMessagePayload,
    buildNoticeMessagePayload,
    buildStickerMessagePayload,
    buildTextMessagePayload,
    normalizeSendMessageArgs,
} from "./client-send-message.ts";
import { normalizeRedactEventArgs } from "./client-send-args.ts";
import { buildRedactEventContent } from "./client-send-redaction.ts";
import {
    buildEmailTokenRequestParams,
    buildMsisdnTokenRequestParams,
    fetchAuthMetadataWithFallback,
    requestTokenFromEndpoint,
} from "./client-auth.ts";
import { fixNotificationCountOnDecryption, inMainTimelineForReceipt, threadIdForReceipt } from "./client-receipts.ts";
import { sendReceiptRequest, setRoomReadMarkersWithLocalEcho } from "./client-receipt-requests.ts";
import {
    identityHashedLookupRequest,
    lookupThreePidRequest,
    bulkLookupThreePidsRequest,
} from "./client-identity-lookup.ts";
import { sendToDeviceRequest } from "./client-to-device.ts";
import {
    getThirdpartyLocationRequest,
    getThirdpartyUserRequest,
    getThirdpartyProtocolsRequest,
} from "./client-thirdparty.ts";
import { leaveRoomChainRequest, membershipChangeRequest } from "./client-membership.ts";
import { buildRoomUpgradeHistory, selectVisibleRoomsForClient } from "./client-room-upgrade.ts";
import { mapStateAndChunkFromMessages, deriveBackPaginationTokenFromMessages } from "./client-timeline-core.ts";
import { paginateEventTimelineRequest } from "./client-timeline-pagination.ts";
import {
    getAccountDataFromStoreWhenReady,
    isAccountDataNotFoundError,
    shouldFallbackDeleteAccountDataToEmptyContent,
} from "./client-account-data-core.ts";
import { assertExtendedProfileSupported } from "./client-profile-core.ts";
import { processRelationEvents } from "./client-relations-core.ts";
import { createEncryptionUtils } from "./client-encryption-utils.ts";
import {
    type CrossSigningKeys,
    type IClientWellKnown,
    type ICreateRoomKeyRequest,
    type IDeviceSigningVerificationAcceptRequest,
    type IDeviceSigningVerificationAcceptResponse,
    type IDeviceSigningVerificationCancelRequest,
    type IDeviceSigningVerificationCancelResponse,
    type IDeviceSigningVerificationDoneRequest,
    type IDeviceSigningVerificationDoneResponse,
    type IDeviceSigningVerificationKeyAgreementRequest,
    type IDeviceSigningVerificationKeyAgreementResponse,
    type IDeviceSigningVerificationMacRequest,
    type IDeviceSigningVerificationMacResponse,
    type IDeviceSigningVerificationStartRequest,
    type IDeviceSigningVerificationStartResponse,
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
    type IScanQrCodeRequest,
    type IScanQrCodeResponse,
    type ISecureBackupInfo,
    type ISecureBackupRestoreResponse,
    type ISecureBackupSessionKey,
    type ISecureBackupStoreKeysResponse,
    type ISecureBackupVerifyResponse,
    type IShowQrCodeResponse,
    type IServerVersions,
    type ITurnServer,
    type ITurnServerResponse,
    type IUploadKeySignaturesResponse,
    type TimestampToEventResponse,
    type IUploadKeysRequest,
    type IVerificationRequestsResponse,
    type KeySignatures,
    type SendToDeviceContentMap,
} from "./client-api-types.ts";
import {
    type ICreateClientOpts,
    type IKeysUploadResponse,
    type IMatrixClientCreateOpts,
    type IStartClientOpts,
    type IStoredClientOpts,
} from "./client-config-types.ts";
import {
    acceptDeviceSigningVerificationRequest,
    buildCreateFilterPath,
    buildFilterPath,
    deleteUserAccountDataRequest,
    getUserAccountDataRequest,
    setUserAccountDataRequest,
    cancelDeviceSigningVerificationRequest,
    claimOneTimeKeysHttpRequest,
    completeDeviceSigningVerificationRequest,
    confirmDeviceSigningVerificationMacRequest,
    createSecureBackupRequest,
    deleteExtendedProfilePropertyRequest,
    deleteRoomKeyRequestHttpRequest,
    deleteSecureBackupRequest,
    getExtendedProfilePropertyRequest,
    getExtendedProfileRequest,
    getJoinedRoomMembersRequest,
    getJoinedRoomsRequest,
    getKeyChangesRequest,
    getMyRoomsRequest,
    getSSOUserInfoRequest,
    searchRoomsRequest,
    getClientConfigRequest,
    getOpenIdTokenRequest,
    getRoomHierarchyRequest,
    getRoomKeyRequestsHttpRequest,
    getSecureBackupRequest,
    getVerificationRequestsHttpRequest,
    membersRequest,
    patchExtendedProfileRequest,
    performSearchRequest,
    publicRoomsRequest,
    queryKeysForUsersRequest,
    reportEventRequest,
    reportRoomRequest,
    requestRoomKeyHttpRequest,
    restoreSecureBackupRequest,
    scanQrCodeHttpRequest,
    searchMessageTextRequest,
    sendDeviceSigningVerificationKeyAgreementRequest,
    sendTypingRequest,
    selectDeleteAccountDataRequestOptions,
    selectExtendedProfileRequestPrefix,
    setExtendedProfilePropertyRequest,
    setExtendedProfileRequest,
    setRoomReadMarkersRequest,
    showQrCodeHttpRequest,
    startDeviceSigningVerificationRequest,
    storeSecureBackupKeysRequest,
    timestampToEventRequest,
    uploadDeviceSigningKeysHttpRequest,
    uploadKeySignaturesHttpRequest,
    uploadKeysHttpRequest,
    verifySecureBackupPassphraseRequest,
} from "./client-request-delegates.ts";
import { createFileTreeSpaceRequest, getFileTreeSpaceReference, setGuestAccessRequest } from "./client-room-access.ts";
import { beginRoomPeek, endRoomPeek } from "./client-room-peek.ts";
import { getUrlPreviewRequest } from "./client-url-preview.ts";
import { getRoomPushRuleRequest, setRoomMutePushRuleRequest } from "./client-push-rules.ts";
import { EventManager } from "./event/EventManager.ts";

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
} from "./client-api-types.ts";
export { PendingEventOrdering } from "./client-config-types.ts";
export type {
    ICreateClientOpts,
    IKeysUploadResponse,
    IMatrixClientCreateOpts,
    IStartClientOpts,
    IStoredClientOpts,
} from "./client-config-types.ts";

export type Store = IStore;

export type ResetTimelineCallback = (roomId: string) => boolean;

const SCROLLBACK_DELAY_MS = 3000;

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
/* eslint-enable camelcase */

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
    /** @deprecated Use {@link ReceivedToDeviceMessage}.
     * Fires whenever the SDK receives a new to-device event.
     * The payload is the matrix event ({@link MatrixEvent}) which caused this event to fire.
     * @example
     * ```
     * matrixClient.on("toDeviceEvent", function(event){
     *   var sender = event.getSender();
     * });
     * ```
     */
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

const SSO_ACTION_PARAM = new UnstableValue("action", "org.matrix.msc3824.action");

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
    private readonly urlPreviewRequestCache = new InflightRequestCache<IPreviewUrlResponse>(this.urlPreviewCache);
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
    protected ongoingScrollbacks: { [roomId: string]: { promise?: Promise<Room>; errorTs?: number } } = {};
    protected notifTimelineSet: EventTimelineSet | null = null;

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
        return this.credentials?.userId ?? null;
    }

    /**
     * Get the user-id of the logged-in user
     *
     * @returns MXID for the logged-in user
     * @throws Error if not logged in
     */
    public getSafeUserId(): string {
        const userId = this.getUserId();
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
        if (this.credentials?.userId) {
            return this.credentials.userId.replace(/^.*?:/, "");
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
        return this.deviceId;
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
        return this.syncApi?.getSyncState() ?? null;
    }

    /**
     * Returns the additional data object associated with
     * the current sync state, or null if there is no
     * such data.
     * Sync errors, if available, are put in the 'error' key of
     * this object.
     */
    public getSyncStateData(): ISyncStateData | null {
        if (!this.syncApi) {
            return null;
        }
        return this.syncApi.getSyncStateData();
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
        return this.notifTimelineSet;
    }

    /**
     * Set the global notification EventTimelineSet
     *
     */
    public setNotifTimelineSet(set: EventTimelineSet): void {
        this.notifTimelineSet = set;
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
        const RustCrypto = await import("./rust-crypto/index.ts");

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
     * Whether encryption is enabled for a room.
     * @param roomId - the room id to query.
     * @returns whether encryption is enabled.
     *
     * @deprecated Not correctly supported for Rust Cryptography. Use {@link CryptoApi.isEncryptionEnabledInRoom} and/or
     *    {@link Room.hasEncryptionStateEvent}.
     */
    public isRoomEncrypted(roomId: string): boolean {
        const room = this.getRoom(roomId);
        if (!room) {
            // we don't know about this room, so can't determine if it should be
            // encrypted. Let's assume not.
            return false;
        }

        // if there is an 'm.room.encryption' event in this room, it should be
        // encrypted (independently of whether we actually support encryption)
        return room.hasEncryptionStateEvent();
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
        const path = useAuthenticatedMedia ? "/media/config" : "/config";
        return this.http.authedRequest(Method.Get, path, undefined, undefined, {
            prefix: useAuthenticatedMedia ? ClientPrefix.V1 : MediaPrefix.V3,
        });
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
        return this.store.getRooms();
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
        // If the sync loop is not running, fall back to setAccountDataRaw.
        if (!this.clientRunning) {
            this.logger.warn(
                "Calling `setAccountData` before the client is started: `getAccountData` may return inconsistent results.",
            );
            return await retryNetworkOperation(5, () => this.setAccountDataRaw(eventType, content));
        }

        // If the account data is already correct, then we cannot expect an update over sync, and the operation
        // is, in any case, a no-op.
        //
        // NB that we rely on this operation being synchronous to avoid a race condition: there must be no `await`
        // between here and `this.addListener` below, in case we miss an update.
        const existingData = this.store.getAccountData(eventType as string);
        if (existingData && deepCompare(existingData.event.content, content)) return {};

        // Create a promise which will resolve when the update is received
        const updatedResolvers = Promise.withResolvers<void>();
        function accountDataListener(event: MatrixEvent): void {
            // Note that we cannot safely check that the content matches what we expected, because there is a race:
            //   * We set the new content
            //   * Another client sets alternative content
            //   * Then /sync returns, but only reflects the latest content.
            //
            // Of course there is room for debate over what we should actually do in that case -- a subsequent
            // `getAccountData` isn't going to return the expected value, but whose fault is that? Databases are hard.
            //
            // Anyway, what we *shouldn't* do is get stuck in a loop. I think the best we can do is check that the event
            // type matches.
            if (event.getType() === eventType) updatedResolvers.resolve();
        }
        this.addListener(ClientEvent.AccountData, accountDataListener);

        try {
            const result = await retryNetworkOperation(5, () => this.setAccountDataRaw(eventType, content));
            await updatedResolvers.promise;
            return result;
        } finally {
            this.removeListener(ClientEvent.AccountData, accountDataListener);
        }
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
        return setUserAccountDataRequest(
            this.credentials.userId,
            eventType as string,
            content as Record<string, unknown>,
            this.authedRequestProxy,
        );
    }

    /**
     * Get account data event of given type for the current user.
     * @param eventType - The event type
     * @returns The contents of the given account data event
     */
    public getAccountData<K extends keyof AccountDataEvents>(eventType: K): MatrixEvent | undefined {
        return this.store.getAccountData(eventType as string);
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
        const localContent = getAccountDataFromStoreWhenReady<AccountDataEvents[K]>(
            this.isInitialSyncComplete(),
            this.store.getAccountData(eventType as string),
        );
        if (localContent !== undefined) {
            return localContent;
        }
        try {
            return await getUserAccountDataRequest<AccountDataEvents[K]>(
                this.credentials.userId,
                eventType as string,
                this.authedRequestProxy,
            );
            // @swallow-error { owner: "refactor-bot", expires: "2026-12-31" }
        } catch (e) {
            if (isAccountDataNotFoundError(e)) {
                return null;
            }
            throw e;
        }
    }

    public async deleteAccountData(eventType: keyof WritableAccountDataEvents): Promise<void> {
        const msc3391DeleteAccountDataServerSupport = this.canSupport.get(Feature.AccountDataDeletion);
        // if deletion is not supported overwrite with empty content
        if (shouldFallbackDeleteAccountDataToEmptyContent(msc3391DeleteAccountDataServerSupport)) {
            await this.setAccountData(eventType, {});
            return;
        }
        return await deleteUserAccountDataRequest(
            this.getSafeUserId(),
            eventType as string,
            this.authedRequestProxy,
            selectDeleteAccountDataRequestOptions(msc3391DeleteAccountDataServerSupport),
        );
    }

    /**
     * Gets the users that are ignored by this client
     * @returns The array of users that are ignored (empty if none)
     */
    public getIgnoredUsers(): string[] {
        const event = this.getAccountData(EventType.IgnoredUserList);
        const ignoredUsers = event?.getContent()["ignored_users"];
        if (!ignoredUsers || typeof ignoredUsers !== "object") return [];
        return Object.keys(ignoredUsers);
    }

    /**
     * Sets the users that the current user should ignore.
     * @param userIds - the user IDs to ignore
     * @returns Promise which resolves: an empty object
     * @returns Rejects: with an error response.
     */
    public setIgnoredUsers(userIds: string[]): Promise<EmptyObject> {
        const content = { ignored_users: {} as Record<string, EmptyObject> };
        userIds.forEach((u) => {
            content.ignored_users[u] = {};
        });
        return this.setAccountData(EventType.IgnoredUserList, content);
    }

    /**
     * Gets whether or not a specific user is being ignored by this client.
     * @param userId - the user ID to check
     * @returns true if the user is ignored, false otherwise
     */
    public isUserIgnored(userId: string): boolean {
        return this.getIgnoredUsers().includes(userId);
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
        // also kick the to-device queue to retry
        this.toDeviceMessageQueue.sendQueue();

        this.updatePendingEventStatus(room, event, EventStatus.SENDING);
        return this.encryptAndSendEvent(room, event);
    }

    /**
     * Cancel a queued or unsent event.
     *
     * @param event -   Event to cancel
     * @throws Error if the event is not in QUEUED, NOT_SENT or ENCRYPTING state
     */
    public cancelPendingEvent(event: MatrixEvent): void {
        if (![EventStatus.QUEUED, EventStatus.NOT_SENT, EventStatus.ENCRYPTING].includes(event.status!)) {
            throw new Error("cannot cancel an event with status " + event.status);
        }

        // If the event is currently being encrypted then remove it from the pending list, to indicate that it should
        // not be sent.
        if (event.status === EventStatus.ENCRYPTING) {
            this.eventsBeingEncrypted.delete(event.getId()!);
        } else if (this.scheduler && event.status === EventStatus.QUEUED) {
            // tell the scheduler to forget about it, if it's queued
            this.scheduler.removeEventFromQueue(event);
        }

        // then tell the room about the change of state, which will remove it
        // from the room's list of pending events.
        const room = this.getRoom(event.getRoomId());
        this.updatePendingEventStatus(room, event, EventStatus.CANCELLED);
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
    // eslint-disable-next-line @typescript-eslint/naming-convention
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
    // eslint-disable-next-line @typescript-eslint/naming-convention
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
     * Determine whether a given event should be encrypted when we send it to the given room.
     *
     * This takes into account event type and room configuration.
     */
    private async shouldEncryptEventForRoom(event: MatrixEvent, room: Room): Promise<boolean> {
        return this.encryptionUtils.shouldEncryptEventForRoom(event, room);
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

    /**
     * @param txnId - Optional.
     * @returns Promise which resolves: to an ISendEventResponse object
     * @returns Rejects: with an error response.
     */
    public sendMessage(roomId: string, content: RoomMessageEventContent, txnId?: string): Promise<ISendEventResponse>;
    public sendMessage(
        roomId: string,
        threadId: string | null,
        content: RoomMessageEventContent,
        txnId?: string,
    ): Promise<ISendEventResponse>;
    public sendMessage(
        roomId: string,
        threadId: string | null | RoomMessageEventContent,
        content?: RoomMessageEventContent | string,
        txnId?: string,
    ): Promise<ISendEventResponse> {
        const normalized = normalizeSendMessageArgs(threadId, content, txnId);
        return this.sendEvent(roomId, normalized.threadId, EventType.RoomMessage, normalized.content, normalized.txnId);
    }

    /**
     * @param txnId - Optional.
     * @returns
     * @returns Rejects: with an error response.
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
        threadId: string | null,
        body: string,
        txnId?: string,
    ): Promise<ISendEventResponse> {
        const normalized = buildTextMessagePayload(threadId, body, txnId, EVENT_ID_PREFIX);
        return this.sendMessage(roomId, normalized.threadId, normalized.content, normalized.txnId);
    }

    /**
     * @param txnId - Optional.
     * @returns Promise which resolves: to a ISendEventResponse object
     * @returns Rejects: with an error response.
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
        threadId: string | null,
        body: string,
        txnId?: string,
    ): Promise<ISendEventResponse> {
        const normalized = buildNoticeMessagePayload(threadId, body, txnId, EVENT_ID_PREFIX);
        return this.sendMessage(roomId, normalized.threadId, normalized.content, normalized.txnId);
    }

    /**
     * @param txnId - Optional.
     * @returns Promise which resolves: to a ISendEventResponse object
     * @returns Rejects: with an error response.
     * @throws May throw a `MatrixSafetyError` if content is deemed unsafe.
     * @see MatrixSafetyError
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
        threadId: string | null,
        body: string,
        txnId?: string,
    ): Promise<ISendEventResponse> {
        const normalized = buildEmoteMessagePayload(threadId, body, txnId, EVENT_ID_PREFIX);
        return this.sendMessage(roomId, normalized.threadId, normalized.content, normalized.txnId);
    }

    /**
     * @returns Promise which resolves: to a ISendEventResponse object
     * @returns Rejects: with an error response.
     * @throws May throw a `MatrixSafetyError` if content is deemed unsafe.
     * @see MatrixSafetyError
     */
    public sendImageMessage(roomId: string, url: string, info?: ImageInfo, text?: string): Promise<ISendEventResponse>;
    public sendImageMessage(
        roomId: string,
        threadId: string | null,
        url: string,
        info?: ImageInfo,
        text?: string,
    ): Promise<ISendEventResponse>;
    public sendImageMessage(
        roomId: string,
        threadId: string | null,
        url?: string | ImageInfo,
        info?: ImageInfo | string,
        text = "Image",
    ): Promise<ISendEventResponse> {
        const normalized = buildImageMessagePayload(threadId, url, info, text, EVENT_ID_PREFIX);
        return this.sendMessage(roomId, normalized.threadId, normalized.content);
    }

    /**
     * @returns Promise which resolves: to a ISendEventResponse object
     * @returns Rejects: with an error response.
     * @throws May throw a `MatrixSafetyError` if content is deemed unsafe.
     * @see MatrixSafetyError
     */
    public sendStickerMessage(
        roomId: string,
        url: string,
        info?: ImageInfo,
        text?: string,
    ): Promise<ISendEventResponse>;
    public sendStickerMessage(
        roomId: string,
        threadId: string | null,
        url: string,
        info?: ImageInfo,
        text?: string,
    ): Promise<ISendEventResponse>;
    public sendStickerMessage(
        roomId: string,
        threadId: string | null,
        url?: string | ImageInfo,
        info?: ImageInfo | string,
        text = "Sticker",
    ): Promise<ISendEventResponse> {
        const normalized = buildStickerMessagePayload(threadId, url, info, text, EVENT_ID_PREFIX);
        return this.sendEvent(roomId, normalized.threadId, EventType.Sticker, normalized.content);
    }

    /**
     * @returns Promise which resolves: to a ISendEventResponse object
     * @returns Rejects: with an error response.
     * @throws May throw a `MatrixSafetyError` if content is deemed unsafe.
     * @see MatrixSafetyError
     */
    public sendHtmlMessage(roomId: string, body: string, htmlBody: string): Promise<ISendEventResponse>;
    public sendHtmlMessage(
        roomId: string,
        threadId: string | null,
        body: string,
        htmlBody: string,
    ): Promise<ISendEventResponse>;
    public sendHtmlMessage(
        roomId: string,
        threadId: string | null,
        body: string,
        htmlBody?: string,
    ): Promise<ISendEventResponse> {
        const normalized = buildHtmlMessagePayload(threadId, body, htmlBody, EVENT_ID_PREFIX);
        return this.sendMessage(roomId, normalized.threadId, normalized.content);
    }

    /**
     * @returns Promise which resolves: to a ISendEventResponse object
     * @returns Rejects: with an error response.
     * @throws May throw a `MatrixSafetyError` if content is deemed unsafe.
     * @see MatrixSafetyError
     */
    public sendHtmlNotice(roomId: string, body: string, htmlBody: string): Promise<ISendEventResponse>;
    public sendHtmlNotice(
        roomId: string,
        threadId: string | null,
        body: string,
        htmlBody: string,
    ): Promise<ISendEventResponse>;
    public sendHtmlNotice(
        roomId: string,
        threadId: string | null,
        body: string,
        htmlBody?: string,
    ): Promise<ISendEventResponse> {
        const normalized = buildHtmlNoticePayload(threadId, body, htmlBody, EVENT_ID_PREFIX);
        return this.sendMessage(roomId, normalized.threadId, normalized.content);
    }

    /**
     * @returns Promise which resolves: to a ISendEventResponse object
     * @returns Rejects: with an error response.
     * @throws May throw a `MatrixSafetyError` if content is deemed unsafe.
     * @see MatrixSafetyError
     */
    public sendHtmlEmote(roomId: string, body: string, htmlBody: string): Promise<ISendEventResponse>;
    public sendHtmlEmote(
        roomId: string,
        threadId: string | null,
        body: string,
        htmlBody: string,
    ): Promise<ISendEventResponse>;
    public sendHtmlEmote(
        roomId: string,
        threadId: string | null,
        body: string,
        htmlBody?: string,
    ): Promise<ISendEventResponse> {
        const normalized = buildHtmlEmotePayload(threadId, body, htmlBody, EVENT_ID_PREFIX);
        return this.sendMessage(roomId, normalized.threadId, normalized.content);
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
    // eslint-disable-next-line
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
    // eslint-disable-next-line
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
    // eslint-disable-next-line
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
    // eslint-disable-next-line
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
    // eslint-disable-next-line
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
     * Manage a delayed event associated with the given delay_id.
     *
     * Note: This endpoint is unstable, and can throw an `Error`.
     *   Check progress on [MSC4140](https://github.com/matrix-org/matrix-spec-proposals/pull/4140) for more details.
     *
     * @deprecated Instead use one of:
     * - {@link _unstable_cancelScheduledDelayedEvent}
     * - {@link _unstable_restartScheduledDelayedEvent}
     * - {@link _unstable_sendScheduledDelayedEvent}
     */
    // eslint-disable-next-line @typescript-eslint/naming-convention
    public async _unstable_updateDelayedEvent(
        delayId: string,
        action: UpdateDelayedEventAction,
        requestOptions: IRequestOpts = {},
    ): Promise<EmptyObject> {
        await this.assertDelayedEventsSupported("updateDelayedEvent");
        return await this.updateScheduledDelayedEventWithActionInBody(delayId, action, requestOptions);
    }

    /**
     * Cancel the scheduled delivery of the delayed event matching the provided delayId.
     *
     * Note: This endpoint is unstable, and can throw an `Error`.
     *   Check progress on [MSC4140](https://github.com/matrix-org/matrix-spec-proposals/pull/4140) for more details.
     *
     * @throws A M_NOT_FOUND error if no matching delayed event could be found.
     */
    // eslint-disable-next-line @typescript-eslint/naming-convention
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
    // eslint-disable-next-line @typescript-eslint/naming-convention
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
    // eslint-disable-next-line @typescript-eslint/naming-convention
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
     * @deprecated Present for backwards compatibility with an older version of MSC4140
     * which had a single, authenticated endpoint for updating a delayed event, instead
     * of one unauthenticated endpoint per update action.
     */
    private async updateScheduledDelayedEventWithActionInBody(
        delayId: string,
        action: UpdateDelayedEventAction,
        requestOptions: IRequestOpts = {},
    ): Promise<EmptyObject> {
        return await updateScheduledDelayedEventWithActionInBodyRequest(
            this.http,
            delayId,
            action,
            UNSTABLE_MSC4140_DELAYED_EVENTS,
            requestOptions,
        );
    }

    /**
     * Send a receipt.
     * @param event - The event being acknowledged
     * @param receiptType - The kind of receipt e.g. "m.read". Other than
     * ReceiptType.Read are experimental!
     * @param body - Additional content to send alongside the receipt.
     * @param unthreaded - An unthreaded receipt will clear room+thread notifications
     * @returns Promise which resolves: to an empty object `{}`
     * @returns Rejects: with an error response.
     */
    public async sendReceipt(
        event: MatrixEvent,
        receiptType: ReceiptType,
        body?: Record<string, unknown>,
        unthreaded = false,
    ): Promise<EmptyObject> {
        return sendReceiptRequest(this, {
            event,
            receiptType,
            body,
            unthreaded,
            isGuest: this.isGuest(),
            supportsThreads: this.supportsThreads(),
            userId: this.credentials.userId,
        });
    }

    /**
     * Send a read receipt.
     * @param event - The event that has been read.
     * @param receiptType - other than ReceiptType.Read are experimental! Optional.
     * @returns Promise which resolves: to an empty object `{}`
     * @returns Rejects: with an error response.
     */
    public async sendReadReceipt(
        event: MatrixEvent | null,
        receiptType = ReceiptType.Read,
        unthreaded = false,
    ): Promise<EmptyObject | undefined> {
        if (!event) return;
        const eventId = event.getId()!;
        const room = this.getRoom(event.getRoomId());
        if (room?.hasPendingEvent(eventId)) {
            throw new Error(`Cannot set read receipt to a pending event (${eventId})`);
        }

        return this.sendReceipt(event, receiptType, {}, unthreaded);
    }

    /**
     * Set a marker to indicate the point in a room before which the user has read every
     * event. This can be retrieved from room account data (the event type is `m.fully_read`)
     * and displayed as a horizontal line in the timeline that is visually distinct to the
     * position of the user's own read receipt.
     * @param roomId - ID of the room that has been read
     * @param rmEventId - ID of the event that has been read
     * @param rrEvent - the event tracked by the read receipt. This is here for
     * convenience because the RR and the RM are commonly updated at the same time as each
     * other. The local echo of this receipt will be done if set. Optional.
     * @param rpEvent - the m.read.private read receipt event for when we don't
     * want other users to see the read receipts. This is experimental. Optional.
     * @returns Promise which resolves: the empty object, `{}`.
     */
    public async setRoomReadMarkers(
        roomId: string,
        rmEventId: string,
        rrEvent?: MatrixEvent,
        rpEvent?: MatrixEvent,
    ): Promise<EmptyObject> {
        return setRoomReadMarkersWithLocalEcho(
            this,
            this.getRoom(roomId),
            { roomId, rmEventId, rrEvent, rpEvent, userId: this.credentials.userId! },
            this.setRoomReadMarkersHttpRequest.bind(this),
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
        return getUrlPreviewRequest<IPreviewUrlResponse>(url, ts, this.urlPreviewRequestCache, this.authedRequestProxy);
    }

    /**
     * @returns Promise which resolves: to an empty object `{}`
     * @returns Rejects: with an error response.
     */
    public sendTyping(roomId: string, isTyping: boolean, timeoutMs: number): Promise<EmptyObject> {
        if (this.isGuest()) {
            return Promise.resolve({}); // guests cannot send typing notifications so don't bother.
        }
        return sendTypingRequest(roomId, this.getUserId()!, isTyping, timeoutMs, this.authedRequestProxy);
    }

    /**
     * Get typing users in a room
     * @param roomId - The room ID
     * @returns Array of user IDs currently typing
     */
    public async getRoomTyping(roomId: string): Promise<string[]> {
        const path = `/rooms/${encodeURIComponent(roomId)}/typing`;
        const response = await this.http.authedRequest<{ user_ids: string[] }>(Method.Get, path, undefined, undefined, {
            prefix: ClientPrefix.V3,
        });
        return response.user_ids || [];
    }

    /**
     * Get typing users in multiple rooms
     * @param roomIds - Array of room IDs
     * @returns Map of room ID to array of typing user IDs
     */
    public async getBatchTyping(roomIds: string[]): Promise<Record<string, string[]>> {
        const path = "/rooms/typing";
        const response = await this.http.authedRequest<{
            rooms: Record<string, { user_ids: string[] }>;
        }>(Method.Post, path, undefined, { room_ids: roomIds }, { prefix: ClientPrefix.V3 });

        const result: Record<string, string[]> = {};
        for (const [roomId, data] of Object.entries(response.rooms || {})) {
            result[roomId] = data.user_ids || [];
        }
        return result;
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

    /**
     * @returns Promise which resolves: Object (currently empty)
     * @returns Rejects: with an error response.
     */
    public unban(roomId: string, userId: string): Promise<EmptyObject> {
        return this.getRoomManager().unban(roomId, userId);
    }

    /**
     * @param reason - Optional.
     * @returns Promise which resolves: `{}` an empty object.
     * @returns Rejects: with an error response.
     */
    public kick(roomId: string, userId: string, reason?: string): Promise<EmptyObject> {
        return this.getRoomManager().kick(roomId, userId, reason);
    }

    private membershipChange(
        roomId: string,
        userId: string | undefined,
        membership: Membership,
        reason?: string,
    ): Promise<EmptyObject> {
        return membershipChangeRequest(roomId, userId, membership, reason, this.authedRequestProxy);
    }

    /**
     * Obtain a dict of actions which should be performed for this event according
     * to the push rules for this user.  Caches the dict on the event.
     * @param event - The event to get push actions for.
     * @param forceRecalculate - forces to recalculate actions for an event
     * Useful when an event just got decrypted
     * @returns A dict of actions to perform.
     */
    public getPushActionsForEvent(event: MatrixEvent, forceRecalculate = false): IActionsObject | null {
        if (!event.getPushActions() || forceRecalculate) {
            const { actions, rule } = this.pushProcessor.actionsAndRuleForEvent(event);
            event.setPushDetails(actions, rule);
        }
        return event.getPushActions();
    }

    /**
     * Obtain a dict of actions which should be performed for this event according
     * to the push rules for this user.  Caches the dict on the event.
     * @param event - The event to get push actions for.
     * @param forceRecalculate - forces to recalculate actions for an event
     * Useful when an event just got decrypted
     * @returns A dict of actions to perform.
     */
    public getPushDetailsForEvent(event: MatrixEvent, forceRecalculate = false): PushDetails | null {
        if (!event.getPushDetails() || forceRecalculate) {
            const { actions, rule } = this.pushProcessor.actionsAndRuleForEvent(event);
            event.setPushDetails(actions, rule);
        }
        return event.getPushDetails();
    }

    /**
     * Specify the set_presence value to be used for subsequent calls to the Sync API.
     * This has an advantage over calls to the PUT /presence API in that it
     * doesn't clobber status_msg set by other devices.
     * @param presence - the presence to specify to set_presence of sync calls
     */
    public async setSyncPresence(presence?: SetPresence): Promise<void> {
        this.syncApi?.setPresence(presence);
    }

    /**
     * Retrieve older messages from the given room and put them in the timeline.
     *
     * If this is called multiple times whilst a request is ongoing, the <i>same</i>
     * Promise will be returned. If there was a problem requesting scrollback, there
     * will be a small delay before another request can be made (to prevent tight-looping
     * when there is no connection).
     *
     * @param room - The room to get older messages in.
     * @param limit - Optional. The maximum number of previous events to
     * pull in. Default: 30.
     * @returns Promise which resolves: Room. If you are at the beginning
     * of the timeline, `Room.oldState.paginationToken` will be
     * `null`.
     * @returns Rejects: with an error response.
     */
    public scrollback(room: Room, limit = 30): Promise<Room> {
        let timeToWaitMs = 0;

        let info = this.ongoingScrollbacks[room.roomId] || {};
        if (info.promise) {
            return info.promise;
        } else if (info.errorTs) {
            const timeWaitedMs = Date.now() - info.errorTs;
            timeToWaitMs = Math.max(SCROLLBACK_DELAY_MS - timeWaitedMs, 0);
        }

        if (room.oldState.paginationToken === null) {
            return Promise.resolve(room); // already at the start.
        }
        // attempt to grab more events from the store first
        const numAdded = this.store.scrollback(room, limit).length;
        if (numAdded === limit) {
            // store contained everything we needed.
            return Promise.resolve(room);
        }
        // reduce the required number of events appropriately
        limit = limit - numAdded;

        const promise = new Promise<Room>((resolve, reject) => {
            // wait for a time before doing this request
            // (which may be 0 in order not to special case the code paths)
            sleep(timeToWaitMs)
                .then(() => {
                    return this.createMessagesRequest(
                        room.roomId,
                        room.oldState.paginationToken,
                        limit,
                        Direction.Backward,
                    );
                })
                .then((res: IMessagesResponse) => {
                    const { matrixEvents, stateEvents } = mapStateAndChunkFromMessages(
                        res,
                        noUnsafeEventProps,
                        this.getEventMapper(),
                    );
                    if (stateEvents.length > 0) {
                        room.currentState.setUnknownStateEvents(stateEvents);
                    }

                    const [timelineEvents, threadedEvents, unknownRelations] =
                        room.partitionThreadedEvents(matrixEvents);

                    this.processAggregatedTimelineEvents(room, timelineEvents);
                    room.addEventsToTimeline(timelineEvents, true, true, room.getLiveTimeline());
                    this.processThreadEvents(room, threadedEvents, true);
                    unknownRelations.forEach((event) => room.relations.aggregateChildEvent(event));

                    const nextToken = deriveBackPaginationTokenFromMessages(res);
                    room.oldState.paginationToken = nextToken;
                    this.store.storeEvents(room, matrixEvents, nextToken, true);
                    delete this.ongoingScrollbacks[room.roomId];
                    resolve(room);
                })
                .catch((err) => {
                    this.ongoingScrollbacks[room.roomId] = {
                        errorTs: Date.now(),
                    };
                    reject(err);
                });
        });

        info = { promise };

        this.ongoingScrollbacks[room.roomId] = info;
        return promise;
    }

    public getEventMapper(options?: MapperOpts): EventMapper {
        return eventMapperFor(this, options || {});
    }

    /**
     * Calls the `/context` API for the given room ID & event ID.
     * Returns the response, with `event` asserted and all optional arrays defaulted to an empty array.
     * @param roomId - the room ID to request a context for
     * @param eventId - the event ID to request a context for
     * @throws if `event` in the response is missing
     * @private
     */
    private async getEventContext(
        roomId: string,
        eventId: string,
    ): Promise<IContextResponse & Omit<Required<IContextResponse>, "start" | "end">> {
        return this.getEventManager().getEventContext(roomId, eventId, {
            lazyLoadMembers: !!this.clientOpts?.lazyLoadMembers,
        });
    }

    /**
     * Get an EventTimeline for the given event
     *
     * <p>If the EventTimelineSet object already has the given event in its store, the
     * corresponding timeline will be returned. Otherwise, a /context request is
     * made, and used to construct an EventTimeline.
     * If the event does not belong to this EventTimelineSet then undefined will be returned.
     *
     * @param timelineSet -  The timelineSet to look for the event in, must be bound to a room
     * @param eventId -  The ID of the event to look for
     *
     * @returns Promise which resolves:
     *    {@link EventTimeline} including the given event
     */
    public async getEventTimeline(timelineSet: EventTimelineSet, eventId: string): Promise<EventTimeline | null> {
        return this.getTimelineManager().getEventTimeline(timelineSet, eventId);
    }

    public async getThreadTimeline(timelineSet: EventTimelineSet, eventId: string): Promise<EventTimeline | undefined> {
        return this.getThreadingManager().getThreadTimeline(timelineSet, eventId);
    }

    /**
     * Get an EventTimeline for the latest events in the room. This will just
     * call `/messages` to get the latest message in the room, then use
     * `client.getEventTimeline(...)` to construct a new timeline from it.
     *
     * @param timelineSet -  The timelineSet to find or add the timeline to
     *
     * @returns Promise which resolves:
     *    {@link EventTimeline} timeline with the latest events in the room
     */
    public async getLatestTimeline(timelineSet: EventTimelineSet): Promise<EventTimeline | null> {
        // don't allow any timeline support unless it's been enabled.
        if (!this.timelineSupport) {
            throw new Error(
                "timeline support is disabled. Set the 'timelineSupport'" +
                    " parameter to true when creating MatrixClient to enable it.",
            );
        }

        if (!timelineSet.room) {
            throw new Error("getLatestTimeline only supports room timelines");
        }

        let event: IRoomEvent | undefined;
        if (timelineSet.threadListType !== null) {
            const res = await this.createThreadListMessagesRequest(
                timelineSet.room.roomId,
                null,
                1,
                Direction.Backward,
                timelineSet.threadListType,
                timelineSet.getFilter(),
            );
            event = res.chunk?.[0];
        } else if (timelineSet.thread && Thread.hasServerSideSupport) {
            const recurse = this.canSupport.get(Feature.RelationsRecursion) !== ServerSupport.Unsupported;
            const res = await this.fetchRelations(
                timelineSet.room.roomId,
                timelineSet.thread.id,
                THREAD_RELATION_TYPE.name,
                null,
                { dir: Direction.Backward, limit: 1, recurse: recurse || undefined },
            );
            event = res.chunk?.[0];
        } else {
            const res = await this.createMessagesRequest(timelineSet.room.roomId, null, 1, Direction.Backward);
            event = res.chunk?.[0];
        }
        if (!event) {
            throw new Error("No message returned when trying to construct getLatestTimeline");
        }

        return this.getEventTimeline(timelineSet, event.event_id);
    }

    /**
     * Makes a request to /messages with the appropriate lazy loading filter set.
     * @param limit - the maximum amount of events the retrieve
     * @param dir - 'f' or 'b'
     * @param timelineFilter - the timeline filter to pass
     */
    // Intended private, used in code.
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
     * Makes a request to /messages with the appropriate lazy loading filter set.
     * @param limit - the maximum amount of events the retrieve
     * @param dir - 'f' or 'b'
     * @param timelineFilter - the timeline filter to pass
     */
    // Intended private, used by room.fetchRoomThreads
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
     * Take an EventTimeline, and back/forward-fill results.
     *
     * @param eventTimeline - timeline object to be updated
     *
     * @returns Promise which resolves to a boolean: false if there are no
     *    events and we reached either end of the timeline; else true.
     */
    public paginateEventTimeline(eventTimeline: EventTimeline, opts: IPaginateOpts): Promise<boolean> {
        return paginateEventTimelineRequest(eventTimeline, opts || {}, {
            notifTimelineSet: this.notifTimelineSet,
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
     * Reset the notifTimelineSet entirely, paginating in some historical notifs as
     * a starting point for subsequent pagination.
     */
    public resetNotifTimelineSet(): void {
        if (!this.notifTimelineSet) {
            return;
        }

        // Known limitation: this results in duplicate events being
        // added to the timeline both from /sync and /notifications, and lots of
        // slow and wasteful processing and pagination.  The correct solution is to
        // extend /messages or /search or something to filter on notifications.

        // use the fictitious token 'end'. in practice we would ideally give it
        // the oldest backwards pagination token from /sync, but /sync doesn't
        // know about /notifications, so we have no choice but to start paginating
        // from the current point in time.  This may well overlap with historical
        // notifs which are then inserted into the timeline by /sync responses.
        this.notifTimelineSet.resetLiveTimeline("end");
    }

    /**
     * Peek into a room and receive updates about the room. This only works if the
     * history visibility for the room is world_readable.
     * @param roomId - The room to attempt to peek into.
     * @param limit - The number of timeline events to initially retrieve.
     * @returns Promise which resolves: Room object
     * @returns Rejects: with an error response.
     */
    public peekInRoom(roomId: string, limit: number = 20): Promise<Room> {
        const { nextPeekSync, peekPromise } = beginRoomPeek(
            roomId,
            limit,
            this.peekSync,
            () => new SyncApi(this, this.clientOpts, this.buildSyncApiOptions()),
        );
        this.peekSync = nextPeekSync;
        return peekPromise;
    }

    /**
     * Stop any ongoing room peeking.
     */
    public stopPeeking(): void {
        this.peekSync = endRoomPeek(this.peekSync);
    }

    /**
     * Set r/w flags for guest access in a room.
     * @param roomId - The room to configure guest access in.
     * @param opts - Options
     * @returns Promise which resolves
     * @returns Rejects: with an error response.
     */
    public setGuestAccess(roomId: string, opts: IGuestAccessOpts): Promise<void> {
        return setGuestAccessRequest(
            roomId,
            opts,
            (targetRoomId, allowJoin) =>
                this.sendStateEvent(
                    targetRoomId,
                    EventType.RoomGuestAccess,
                    {
                        guest_access: allowJoin ? GuestAccess.CanJoin : GuestAccess.Forbidden,
                    },
                    "",
                ),
            (targetRoomId) =>
                this.sendStateEvent(
                    targetRoomId,
                    EventType.RoomHistoryVisibility,
                    {
                        history_visibility: HistoryVisibility.WorldReadable,
                    },
                    "",
                ),
        );
    }

    /**
     * Requests an email verification token for the purposes of registration.
     * This API requests a token from the homeserver.
     * The doesServerRequireIdServerParam() method can be used to determine if
     * the server requires the id_server parameter to be provided.
     *
     * Parameters and return value are as for requestEmailToken

     * @param email - As requestEmailToken
     * @param clientSecret - As requestEmailToken
     * @param sendAttempt - As requestEmailToken
     * @param nextLink - As requestEmailToken
     * @returns Promise which resolves: As requestEmailToken
     */
    public requestRegisterEmailToken(
        email: string,
        clientSecret: string,
        sendAttempt: number,
        nextLink?: string,
    ): Promise<IRequestTokenResponse> {
        return requestTokenFromEndpoint(
            "/register/email/requestToken",
            buildEmailTokenRequestParams(email, clientSecret, sendAttempt, nextLink),
            this.http.request.bind(this.http),
        );
    }

    /**
     * Requests a text message verification token for the purposes of registration.
     * This API requests a token from the homeserver.
     * The doesServerRequireIdServerParam() method can be used to determine if
     * the server requires the id_server parameter to be provided.
     *
     * @param phoneCountry - The ISO 3166-1 alpha-2 code for the country in which
     *    phoneNumber should be parsed relative to.
     * @param phoneNumber - The phone number, in national or international format
     * @param clientSecret - As requestEmailToken
     * @param sendAttempt - As requestEmailToken
     * @param nextLink - As requestEmailToken
     * @returns Promise which resolves: As requestEmailToken
     */
    public requestRegisterMsisdnToken(
        phoneCountry: string,
        phoneNumber: string,
        clientSecret: string,
        sendAttempt: number,
        nextLink?: string,
    ): Promise<IRequestMsisdnTokenResponse> {
        return requestTokenFromEndpoint(
            "/register/msisdn/requestToken",
            buildMsisdnTokenRequestParams(phoneCountry, phoneNumber, clientSecret, sendAttempt, nextLink),
            this.http.request.bind(this.http),
        );
    }

    /**
     * Requests an email verification token for the purposes of adding a
     * third party identifier to an account.
     * This API requests a token from the homeserver.
     * The doesServerRequireIdServerParam() method can be used to determine if
     * the server requires the id_server parameter to be provided.
     * If an account with the given email address already exists and is
     * associated with an account other than the one the user is authed as,
     * it will either send an email to the address informing them of this
     * or return M_THREEPID_IN_USE (which one is up to the homeserver).
     *
     * @param email - As requestEmailToken
     * @param clientSecret - As requestEmailToken
     * @param sendAttempt - As requestEmailToken
     * @param nextLink - As requestEmailToken
     * @returns Promise which resolves: As requestEmailToken
     */
    public requestAdd3pidEmailToken(
        email: string,
        clientSecret: string,
        sendAttempt: number,
        nextLink?: string,
    ): Promise<IRequestTokenResponse> {
        return requestTokenFromEndpoint(
            "/account/3pid/email/requestToken",
            buildEmailTokenRequestParams(email, clientSecret, sendAttempt, nextLink),
            this.http.request.bind(this.http),
        );
    }

    /**
     * Requests a text message verification token for the purposes of adding a
     * third party identifier to an account.
     * This API proxies the identity server /validate/email/requestToken API,
     * adding specific behaviour for the addition of phone numbers to an
     * account, as requestAdd3pidEmailToken.
     *
     * @param phoneCountry - As requestRegisterMsisdnToken
     * @param phoneNumber - As requestRegisterMsisdnToken
     * @param clientSecret - As requestEmailToken
     * @param sendAttempt - As requestEmailToken
     * @param nextLink - As requestEmailToken
     * @returns Promise which resolves: As requestEmailToken
     */
    public requestAdd3pidMsisdnToken(
        phoneCountry: string,
        phoneNumber: string,
        clientSecret: string,
        sendAttempt: number,
        nextLink?: string,
    ): Promise<IRequestMsisdnTokenResponse> {
        return requestTokenFromEndpoint(
            "/account/3pid/msisdn/requestToken",
            buildMsisdnTokenRequestParams(phoneCountry, phoneNumber, clientSecret, sendAttempt, nextLink),
            this.http.request.bind(this.http),
        );
    }

    /**
     * Requests an email verification token for the purposes of resetting
     * the password on an account.
     * This API proxies the identity server /validate/email/requestToken API,
     * adding specific behaviour for the password resetting. Specifically,
     * if no account with the given email address exists, it may either
     * return M_THREEPID_NOT_FOUND or send an email
     * to the address informing them of this (which one is up to the homeserver).
     *
     * requestEmailToken calls the equivalent API directly on the identity server,
     * therefore bypassing the password reset specific logic.
     *
     * @param email - As requestEmailToken
     * @param clientSecret - As requestEmailToken
     * @param sendAttempt - As requestEmailToken
     * @param nextLink - As requestEmailToken
     * @returns Promise which resolves: As requestEmailToken
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
     * Requests a text message verification token for the purposes of resetting
     * the password on an account.
     * This API proxies the identity server /validate/email/requestToken API,
     * adding specific behaviour for the password resetting, as requestPasswordEmailToken.
     *
     * @param phoneCountry - As requestRegisterMsisdnToken
     * @param phoneNumber - As requestRegisterMsisdnToken
     * @param clientSecret - As requestEmailToken
     * @param sendAttempt - As requestEmailToken
     * @param nextLink - As requestEmailToken
     * @returns Promise which resolves: As requestEmailToken
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
     * Get the room-kind push rule associated with a room.
     * @param scope - "global" or device-specific.
     * @param roomId - the id of the room.
     * @returns the rule or undefined.
     */
    public getRoomPushRule(scope: "global" | "device", roomId: string): IPushRule | undefined {
        return getRoomPushRuleRequest(this.pushRules, scope, roomId);
    }

    /**
     * Set a room-kind muting push rule in a room.
     * The operation also updates MatrixClient.pushRules at the end.
     * @param scope - "global" or device-specific.
     * @param roomId - the id of the room.
     * @param mute - the mute state.
     * @returns Promise which resolves: result object
     * @returns Rejects: with an error response.
     */
    public setRoomMutePushRule(scope: "global" | "device", roomId: string, mute: boolean): Promise<void> | undefined {
        const roomPushRule = this.getRoomPushRule(scope, roomId);
        return setRoomMutePushRuleRequest(
            scope,
            roomId,
            mute,
            roomPushRule,
            () => this.getPushManager(),
            (rules) => {
                this.pushRules = rules;
            },
        );
    }

    public searchMessageText(opts: ISearchOpts): Promise<ISearchResponse> {
        return searchMessageTextRequest(opts, (searchOpts) => this.search(searchOpts));
    }

    /**
     * Perform a server-side search for room events.
     *
     * The returned promise resolves to an object containing the fields:
     *
     *  * count:       estimate of the number of results
     *  * next_batch:  token for back-pagination; if undefined, there are no more results
     *  * highlights:  a list of words to highlight from the stemming algorithm
     *  * results:     a list of results
     *
     * Each entry in the results list is a SearchResult.
     *
     * @returns Promise which resolves: result object
     * @returns Rejects: with an error response.
     */
    public async searchRoomEvents(opts: IEventSearchOpts): Promise<ISearchResults> {
        // Future enhancement: support search groups

        const body = {
            search_categories: {
                room_events: {
                    search_term: opts.term,
                    filter: opts.filter,
                    order_by: SearchOrderBy.Recent,
                    event_context: {
                        before_limit: 1,
                        after_limit: 1,
                        include_profile: true,
                    },
                },
            },
        };

        const searchResults: ISearchResults = {
            _query: body,
            results: [],
            highlights: [],
        };

        const res = await this.search({ body: body });
        return this.processRoomEventsSearch(searchResults, res);
    }

    /**
     * Take a result from an earlier searchRoomEvents call, and backfill results.
     *
     * @param searchResults -  the results object to be updated
     * @returns Promise which resolves: updated result object
     * @returns Rejects: with an error response.
     */
    public backPaginateRoomEventsSearch<T extends ISearchResults>(searchResults: T): Promise<T> {
        // Future enhancement: implement a backoff (as per scrollback()) to deal more
        // nicely with HTTP errors.

        if (!searchResults.next_batch) {
            return Promise.reject(new Error("Cannot backpaginate event search any further"));
        }

        if (searchResults.pendingRequest) {
            // already a request in progress - return the existing promise
            return searchResults.pendingRequest as Promise<T>;
        }

        const searchOpts = {
            body: searchResults._query!,
            next_batch: searchResults.next_batch,
        };

        const promise = this.search(searchOpts, searchResults.abortSignal)
            .then((res) => this.processRoomEventsSearch(searchResults, res))
            .finally(() => {
                searchResults.pendingRequest = undefined;
            });
        searchResults.pendingRequest = promise;

        return promise;
    }

    /**
     * helper for searchRoomEvents and backPaginateRoomEventsSearch. Processes the
     * response from the API call and updates the searchResults
     *
     * @returns searchResults
     * @internal
     */
    // Intended private, used in code
    public processRoomEventsSearch<T extends ISearchResults>(searchResults: T, response: ISearchResponse): T {
        const roomEvents = response.search_categories.room_events;

        searchResults.count = roomEvents.count;
        searchResults.next_batch = roomEvents.next_batch;

        // combine the highlight list with our existing list;
        const highlights = new Set<string>(roomEvents.highlights);
        searchResults.highlights.forEach((hl) => {
            highlights.add(hl);
        });

        // turn it back into a list.
        searchResults.highlights = Array.from(highlights);

        const mapper = this.getEventMapper();

        // append the new results to our existing results
        const resultsLength = roomEvents.results?.length ?? 0;
        for (let i = 0; i < resultsLength; i++) {
            const sr = SearchResult.fromJson(roomEvents.results![i], mapper);
            const room = this.getRoom(sr.context.getEvent().getRoomId());
            if (room) {
                for (const ev of sr.context.getTimeline()) {
                    ev.setMetadata(room.currentState, false);
                }
            }
            searchResults.results.push(sr);
        }
        return searchResults;
    }

    /**
     * Populate the store with rooms the user has left.
     * @returns Promise which resolves when the rooms have
     * been added to the data store.
     * @returns Rejects: with an error response.
     */
    public syncLeftRooms(): Promise<Room[]> {
        // Guard against multiple calls whilst ongoing and multiple calls post success
        if (this.syncedLeftRooms) {
            return Promise.resolve([]); // don't call syncRooms again if it succeeded.
        }
        if (this.syncLeftRoomsPromise) {
            return this.syncLeftRoomsPromise; // return the ongoing request
        }
        const syncApi = new SyncApi(this, this.clientOpts, this.buildSyncApiOptions());
        this.syncLeftRoomsPromise = syncApi.syncLeftRooms();

        // cleanup locks
        this.syncLeftRoomsPromise
            .then(() => {
                this.logger.debug("Marking success of sync left room request");
                this.syncedLeftRooms = true; // flip the bit on success
            })
            .finally(() => {
                this.syncLeftRoomsPromise = undefined; // cleanup ongoing request state
            });

        return this.syncLeftRoomsPromise;
    }

    /**
     * Create a new filter.
     * @param content - The HTTP body for the request
     * @returns Promise which resolves to a Filter object.
     * @returns Rejects: with an error response.
     */
    public async createFilter(content: IFilterDefinition): Promise<Filter> {
        const path = buildCreateFilterPath(this.credentials.userId);
        const response = await this.http.authedRequest<IFilterResponse>(Method.Post, path, undefined, content);
        // persist the filter
        const filter = Filter.fromJson(this.credentials.userId, response.filter_id, content);
        this.store.storeFilter(filter);
        return filter;
    }

    /**
     * Retrieve a filter.
     * @param userId - The user ID of the filter owner
     * @param filterId - The filter ID to retrieve
     * @param allowCached - True to allow cached filters to be returned.
     * Default: True.
     * @returns Promise which resolves: a Filter object
     * @returns Rejects: with an error response.
     */
    public async getFilter(userId: string, filterId: string, allowCached: boolean): Promise<Filter> {
        if (allowCached) {
            const filter = this.store.getFilter(userId, filterId);
            if (filter) {
                return filter;
            }
        }

        const path = buildFilterPath(userId, filterId);

        const response = await this.http.authedRequest<IFilterDefinition>(Method.Get, path);
        // persist the filter
        const filter = Filter.fromJson(userId, filterId, response);
        this.store.storeFilter(filter);
        return filter;
    }

    /**
     * @returns Filter ID
     */
    public async getOrCreateFilter(filterName: string, filter: Filter): Promise<string> {
        const filterId = this.store.getFilterIdByName(filterName);
        let existingId: string | undefined;

        if (filterId) {
            // check that the existing filter matches our expectations
            try {
                const existingFilter = await this.getFilter(this.credentials.userId!, filterId, true);
                if (existingFilter) {
                    const oldDef = existingFilter.getDefinition();
                    const newDef = filter.getDefinition();

                    if (utils.deepCompare(oldDef, newDef)) {
                        existingId = filterId;
                    }
                }
            } catch (error) {
                if ((<MatrixError>error).errcode !== "M_UNKNOWN" && (<MatrixError>error).errcode !== "M_NOT_FOUND") {
                    throw error;
                }
            }
            // if the filter doesn't exist anymore on the server, remove from store
            if (!existingId) {
                this.store.setFilterIdByName(filterName, undefined);
            }
        }

        if (existingId) {
            return existingId;
        }

        // create a new filter
        const createdFilter = await this.createFilter(filter.getDefinition());

        this.store.setFilterIdByName(filterName, createdFilter.filterId);
        return createdFilter.filterId!;
    }

    /**
     * Gets a bearer token from the homeserver that the user can
     * present to a third party in order to prove their ownership
     * of the Matrix account they are logged into.
     * @returns Promise which resolves: Token object
     * @returns Rejects: with an error response.
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
     * @returns Promise which resolves: ITurnServerResponse object
     * @returns Rejects: with an error response.
     */
    public turnServer(): Promise<ITurnServerResponse> {
        return this.http.authedRequest(Method.Get, "/voip/turnServer");
    }

    /**
     * Get the TURN servers for this homeserver.
     * @returns The servers or an empty list.
     */
    public getTurnServers(): ITurnServer[] {
        return this.turnServers || [];
    }

    /**
     * Get the unix timestamp (in milliseconds) at which the current
     * TURN credentials (from getTurnServers) expire
     * @returns The expiry timestamp in milliseconds
     */
    public getTurnServersExpiry(): number {
        return this.turnServersExpiry;
    }

    public get pollingTurnServers(): boolean {
        return this.checkTurnServersIntervalID !== undefined;
    }

    // Intended private, used in code.
    public async checkTurnServers(): Promise<boolean | undefined> {
        if (!this.supportsVoip()) {
            return;
        }

        let credentialsGood = false;
        const remainingTime = this.turnServersExpiry - Date.now();
        if (remainingTime > TURN_CHECK_INTERVAL) {
            this.logger.debug("TURN creds are valid for another " + remainingTime + " ms: not fetching new ones.");
            credentialsGood = true;
        } else {
            this.logger.debug("Fetching new TURN credentials");
            try {
                const res = await this.turnServer();
                if (res.uris) {
                    this.logger.debug("Got TURN URIs: " + res.uris + " refresh in " + res.ttl + " secs");
                    // map the response to a format that can be fed to RTCPeerConnection
                    const servers: ITurnServer = {
                        urls: res.uris,
                        username: res.username,
                        credential: res.password,
                    };
                    this.turnServers = [servers];
                    // The TTL is in seconds but we work in ms
                    this.turnServersExpiry = Date.now() + res.ttl * 1000;
                    credentialsGood = true;
                    this.emit(ClientEvent.TurnServers, this.turnServers);
                }
            } catch (err) {
                this.logger.error("Failed to get TURN URIs", err);
                if ((<HTTPError>err).httpStatus === 403) {
                    // We got a 403, so there's no point in looping forever.
                    this.logger.info("TURN access unavailable for this account: stopping credentials checks");
                    if (this.checkTurnServersIntervalID !== null) {
                        globalThis.clearInterval(this.checkTurnServersIntervalID);
                    }
                    this.checkTurnServersIntervalID = undefined;
                    this.emit(ClientEvent.TurnServersError, <HTTPError>err, true); // fatal
                } else {
                    // otherwise, if we failed for whatever reason, try again the next time we're called.
                    this.emit(ClientEvent.TurnServersError, <Error>err, false); // non-fatal
                }
            }
        }

        return credentialsGood;
    }

    /**
     * Set whether to allow a fallback ICE server should be used for negotiating a
     * WebRTC connection if the homeserver doesn't provide any servers. Defaults to
     * false.
     *
     */
    public setFallbackICEServerAllowed(allow: boolean): void {
        this.fallbackICEServerAllowed = allow;
    }

    /**
     * Get whether to allow a fallback ICE server should be used for negotiating a
     * WebRTC connection if the homeserver doesn't provide any servers. Defaults to
     * false.
     *
     * @returns
     */
    public isFallbackICEServerAllowed(): boolean {
        return this.fallbackICEServerAllowed;
    }

    /**
     * Determines if the current user is an administrator of the Synapse homeserver.
     * Returns false if untrue or the homeserver does not appear to be a Synapse
     * homeserver. <strong>This function is implementation specific and may change
     * as a result.</strong>
     * @returns true if the user appears to be a Synapse administrator.
     */
    public async isSynapseAdministrator(): Promise<boolean> {
        const path = utils.encodeUri("/_synapse/admin/v1/users/$userId/admin", { $userId: this.getUserId()! });
        const response = await this.http.authedRequest<{ admin: boolean }>(Method.Get, path, undefined, undefined, {
            prefix: "",
        });
        return response.admin;
    }

    /**
     * Performs a whois lookup on a user using Synapse's administrator API.
     * <strong>This function is implementation specific and may change as a
     * result.</strong>
     * @param userId - the User ID to look up.
     * @returns the whois response - see Synapse docs for information.
     */
    public whoisSynapseUser(userId: string): Promise<ISynapseAdminWhoisResponse> {
        const path = utils.encodeUri("/_synapse/admin/v1/whois/$userId", { $userId: userId });
        return this.http.authedRequest(Method.Get, path, undefined, undefined, { prefix: "" });
    }

    /**
     * Deactivates a user using Synapse's administrator API. <strong>This
     * function is implementation specific and may change as a result.</strong>
     * @param userId - the User ID to deactivate.
     * @returns the deactivate response - see Synapse docs for information.
     */
    public deactivateSynapseUser(userId: string): Promise<ISynapseAdminDeactivateResponse> {
        const path = utils.encodeUri("/_synapse/admin/v1/deactivate/$userId", { $userId: userId });
        return this.http.authedRequest(Method.Post, path, undefined, undefined, { prefix: "" });
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
    // eslint-disable-next-line
    public async _unstable_getSharedRooms(userId: string): Promise<string[]> {
        // Initial variant of the MSC
        const sharedRoomsSupport = await this.doesServerSupportUnstableFeature(UNSTABLE_MSC2666_SHARED_ROOMS);

        // Newer variant that renamed shared rooms to mutual rooms
        const mutualRoomsSupport = await this.doesServerSupportUnstableFeature(UNSTABLE_MSC2666_MUTUAL_ROOMS);

        // Latest variant that changed from path elements to query elements
        const queryMutualRoomsSupport = await this.doesServerSupportUnstableFeature(
            UNSTABLE_MSC2666_QUERY_MUTUAL_ROOMS,
        );

        if (!sharedRoomsSupport && !mutualRoomsSupport && !queryMutualRoomsSupport) {
            throw Error("Server does not support the Mutual Rooms API");
        }

        let path;
        let query;

        // Cascading unstable support switching.
        if (queryMutualRoomsSupport) {
            path = "/uk.half-shot.msc2666/user/mutual_rooms";
            query = { user_id: userId };
        } else {
            path = utils.encodeUri(
                `/uk.half-shot.msc2666/user/${mutualRoomsSupport ? "mutual_rooms" : "shared_rooms"}/$userId`,
                { $userId: userId },
            );
            query = {};
        }

        // Accumulated rooms
        const rooms: string[] = [];
        let token = null;

        do {
            const tokenQuery: Record<string, string> = {};
            if (token != null && queryMutualRoomsSupport) {
                tokenQuery["batch_token"] = token;
            }

            const res = await this.http.authedRequest<{
                joined: string[];
                next_batch_token?: string;
            }>(Method.Get, path, { ...query, ...tokenQuery }, undefined, {
                prefix: ClientPrefix.Unstable,
            });

            rooms.push(...res.joined);

            if (res.next_batch_token !== undefined) {
                token = res.next_batch_token;
            } else {
                token = null;
            }
        } while (token != null);

        return rooms;
    }

    /**
     * Returns a set of configured RTC transports supported by the homeserver.
     * Requires homeserver support for MSC4143.
     * @throws A M_NOT_FOUND error if not supported by the homeserver.
     */
    // eslint-disable-next-line @typescript-eslint/naming-convention
    public async _unstable_getRTCTransports(): Promise<Transport[]> {
        // There is no /versions endpoint to check for support, so we just have to attempt a request.
        return (
            await this.http.authedRequest<{
                rtc_transports: Transport[];
            }>(Method.Get, "/rtc/transports", undefined, undefined, {
                prefix: `${ClientPrefix.Unstable}/org.matrix.msc4143`,
            })
        ).rtc_transports;
    }

    /**
     * Get the API versions supported by the server, along with any
     * unstable APIs it supports
     * @returns The server /versions response
     */
    public async getVersions(): Promise<IServerVersions> {
        if (this.serverVersionsPromise) {
            return this.serverVersionsPromise;
        }

        // We send an authenticated request as of MSC4026
        this.serverVersionsPromise = this.http
            .authedRequest<IServerVersions>(Method.Get, "/_matrix/client/versions", undefined, undefined, {
                prefix: "",
            })
            .catch((e) => {
                // Need to unset this if it fails, otherwise we'll never retry
                this.serverVersionsPromise = undefined;
                // but rethrow the exception to anything that was waiting
                throw e;
            });

        const serverVersions = await this.serverVersionsPromise;
        this.canSupport = await buildFeatureSupportMap(serverVersions);

        return this.serverVersionsPromise;
    }

    /**
     * Check if a particular spec version is supported by the server.
     * @param version - The spec version (such as "r0.5.0") to check for.
     * @returns Whether it is supported
     */
    public async isVersionSupported(version: string): Promise<boolean> {
        const { versions } = await this.getVersions();
        return versions && versions.includes(version);
    }

    /**
     * Query the server to see if it lists support for an unstable feature
     * in the /versions response
     * @param feature - the feature name
     * @returns true if the feature is supported
     */
    public async doesServerSupportUnstableFeature(feature: string): Promise<boolean> {
        const response = await this.getVersions();
        if (!response) return false;
        const unstableFeatures = response["unstable_features"];
        return unstableFeatures && !!unstableFeatures[feature];
    }

    /**
     * Query the server to see if it is forcing encryption to be enabled for
     * a given room preset, based on the /versions response.
     * @param presetName - The name of the preset to check.
     * @returns true if the server is forcing encryption
     * for the preset.
     */
    public async doesServerForceEncryptionForPreset(presetName: Preset): Promise<boolean> {
        const response = await this.getVersions();
        if (!response) return false;
        const unstableFeatures = response["unstable_features"];

        // The preset name in the versions response will be without the _chat suffix.
        const versionsPresetName = presetName.includes("_chat")
            ? presetName.substring(0, presetName.indexOf("_chat"))
            : presetName;

        return unstableFeatures && !!unstableFeatures[`io.element.e2ee_forced.${versionsPresetName}`];
    }

    public async doesServerSupportThread(): Promise<{
        threads: FeatureSupport;
        list: FeatureSupport;
        fwdPagination: FeatureSupport;
    }> {
        if (await this.isVersionSupported("v1.4")) {
            return {
                threads: FeatureSupport.Stable,
                list: FeatureSupport.Stable,
                fwdPagination: FeatureSupport.Stable,
            };
        }

        try {
            const [threadUnstable, threadStable, listUnstable, listStable, fwdPaginationUnstable, fwdPaginationStable] =
                await Promise.all([
                    this.doesServerSupportUnstableFeature("org.matrix.msc3440"),
                    this.doesServerSupportUnstableFeature("org.matrix.msc3440.stable"),
                    this.doesServerSupportUnstableFeature("org.matrix.msc3856"),
                    this.doesServerSupportUnstableFeature("org.matrix.msc3856.stable"),
                    this.doesServerSupportUnstableFeature("org.matrix.msc3715"),
                    this.doesServerSupportUnstableFeature("org.matrix.msc3715.stable"),
                ]);

            return {
                threads: determineFeatureSupport(threadStable, threadUnstable),
                list: determineFeatureSupport(listStable, listUnstable),
                fwdPagination: determineFeatureSupport(fwdPaginationStable, fwdPaginationUnstable),
            };
        } catch {
            return {
                threads: FeatureSupport.None,
                list: FeatureSupport.None,
                fwdPagination: FeatureSupport.None,
            };
        }
    }

    /**
     * Get if lazy loading members is being used.
     * @returns Whether or not members are lazy loaded by this client
     */
    public hasLazyLoadMembersEnabled(): boolean {
        return !!this.clientOpts?.lazyLoadMembers;
    }

    /**
     * Set a function which is called when /sync returns a 'limited' response.
     * It is called with a room ID and returns a boolean. It should return 'true' if the SDK
     * can SAFELY remove events from this room. It may not be safe to remove events if there
     * are other references to the timelines for this room, e.g because the client is
     * actively viewing events in this room.
     * Default: returns false.
     * @param cb - The callback which will be invoked.
     */
    public setCanResetTimelineCallback(cb: ResetTimelineCallback): void {
        this.canResetTimelineCallback = cb;
    }

    /**
     * Get the callback set via `setCanResetTimelineCallback`.
     * @returns The callback or null
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
        const fetchedEventType = eventType ? this.getEncryptedIfNeededEventType(roomId, eventType) : null;
        const [eventResult, result] = await Promise.all([
            this.fetchRoomEvent(roomId, eventId),
            this.fetchRelations(roomId, eventId, relationType, fetchedEventType, opts),
        ]);
        const mapper = this.getEventMapper();

        const originalEvent = eventResult ? mapper(eventResult) : undefined;
        let events = result.chunk.map(mapper);
        events = await processRelationEvents({
            events,
            originalEvent,
            fetchedEventType,
            requestedEventType: eventType,
            relationType,
            decryptEventIfNeeded: (event) => this.decryptEventIfNeeded(event),
        });
        return {
            originalEvent: originalEvent ?? null,
            events,
            nextBatch: result.next_batch ?? null,
            prevBatch: result.prev_batch ?? null,
        };
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
        const path = utils.encodeUri("/rooms/$roomId/aggregations/$eventId/$relType", {
            $roomId: roomId,
            $eventId: eventId,
            $relType: relType,
        });
        return this.http.authedRequest(Method.Get, path, undefined, undefined, { prefix: ClientPrefix.V1 });
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
        if (event.isState() && !this.enableEncryptedStateEvents) {
            return Promise.resolve();
        }

        if (event.shouldAttemptDecryption() && this.getCrypto()) {
            event.attemptDecryption(this.cryptoBackend!, options);
        }

        if (event.isBeingDecrypted()) {
            return event.getDecryptionPromise()!;
        } else {
            return Promise.resolve();
        }
    }

    private termsUrlForService(serviceType: SERVICE_TYPES, baseUrl: string): URL {
        switch (serviceType) {
            case SERVICE_TYPES.IS:
                return this.http.getUrl("/terms", undefined, IdentityPrefix.V2, baseUrl);
            case SERVICE_TYPES.IM:
                return this.http.getUrl("/terms", undefined, "/_matrix/integrations/v1", baseUrl);
            default:
                throw new Error("Unsupported service type");
        }
    }

    /**
     * Get the Homeserver URL of this client
     * @returns Homeserver URL of this client
     */
    public getHomeserverUrl(): string {
        return this.baseUrl;
    }

    /**
     * Get the identity server URL of this client
     * @param stripProto - whether or not to strip the protocol from the URL
     * @returns Identity server URL of this client
     */
    public getIdentityServerUrl(stripProto = false): string | undefined {
        return this.getIdentityServerManager().getIdentityServerUrl(stripProto);
    }

    /**
     * Set the identity server URL of this client
     * @param url - New identity server URL
     */
    public setIdentityServerUrl(url?: string): void {
        this.getIdentityServerManager().setIdentityServerUrl(url);
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
        return this.http.opts.accessToken !== undefined;
    }

    /**
     * Make up a new transaction id
     *
     * @returns a new, unique, transaction id
     */
    public makeTxnId(): string {
        return "m" + new Date().getTime() + "." + this.txnCtr++;
    }

    /**
     * Check whether a username is available prior to registration. An error response
     * indicates an invalid/unavailable username.
     * @param username - The username to check the availability of.
     * @returns Promise which resolves: to boolean of whether the username is available.
     */
    public async isUsernameAvailable(username: string): Promise<boolean> {
        try {
            const response = await this.http.authedRequest<{ available: true }>(Method.Get, "/register/available", {
                username,
            });
            return response.available;
            // @swallow-error { owner: "refactor-bot", expires: "2026-12-31" }
        } catch (error) {
            const response = error as { errcode?: string };
            if (response.errcode === "M_USER_IN_USE") {
                return false;
            }
            throw error;
        }
    }

    /**
     * @param _bindThreepids - Set key 'email' to true to bind any email
     *     threepid uses during registration in the identity server. Set 'msisdn' to
     *     true to bind msisdn.
     * @returns Promise which resolves to a RegisterResponse object
     * @returns Rejects: with an error response.
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
     * Register a guest account.
     * This method returns the auth info needed to create a new authenticated client,
     * Remember to call `setGuest(true)` on the (guest-)authenticated client, e.g:
     * ```javascript
     * const tmpClient = await sdk.createClient(MATRIX_INSTANCE);
     * const { user_id, device_id, access_token } = tmpClient.registerGuest();
     * const client = createClient({
     *   baseUrl: MATRIX_INSTANCE,
     *   accessToken: access_token,
     *   userId: user_id,
     *   deviceId: device_id,
     * })
     * client.setGuest(true);
     * ```
     *
     * @param body - JSON HTTP body to provide.
     * @returns Promise which resolves: JSON object that contains:
     *                   `{ user_id, device_id, access_token, home_server }`
     * @returns Rejects: with an error response.
     */
    public registerGuest({ body }: { body?: RegisterRequest } = {}): Promise<RegisterResponse> {
        return this.getAuthManager().registerGuest(body);
    }

    /**
     * @param data - parameters for registration request
     * @param kind - type of user to register. may be "guest"
     * @returns Promise which resolves: to the /register response
     * @returns Rejects: with an error response.
     */
    public registerRequest(data: RegisterRequest, kind?: string): Promise<RegisterResponse> {
        const params: { kind?: string } = {};
        if (kind) {
            params.kind = kind;
        }

        return this.http.request(Method.Post, "/register", params, data);
    }

    /**
     * Refreshes an access token using a provided refresh token. The refresh token
     * must be valid for the current access token known to the client instance.
     *
     * Note that this function will not cause a logout if the token is deemed
     * unknown by the server - the caller is responsible for managing logout
     * actions on error.
     * @param refreshToken - The refresh token.
     * @returns Promise which resolves to the new token.
     * @returns Rejects with an error response.
     */
    public async refreshToken(refreshToken: string): Promise<IRefreshTokenResponse> {
        const performRefreshRequestWithPrefix = (prefix: ClientPrefix): Promise<IRefreshTokenResponse> =>
            this.http.authedRequest(
                Method.Post,
                "/refresh",
                undefined,
                { refresh_token: refreshToken },
                {
                    prefix,
                    inhibitLogoutEmit: true, // we don't want to cause logout loops
                },
            );

        // First try with the (specced) /v3/ prefix.
        // However, before Synapse 1.72.0, Synapse incorrectly required a /v1/ prefix, so we fall
        // back to that if the request fails, for backwards compatibility.
        try {
            return await performRefreshRequestWithPrefix(ClientPrefix.V3);
        } catch (e) {
            const error = e as { errcode?: string };
            if (error.errcode === "M_UNRECOGNIZED") {
                return performRefreshRequestWithPrefix(ClientPrefix.V1);
            }
            throw e;
        }
    }

    /**
     * @returns Promise which resolves to the available login flows
     * @returns Rejects: with an error response.
     */
    public loginFlows(): Promise<ILoginFlowsResponse> {
        return this.http.request(Method.Get, "/login");
    }

    /**
     * @returns Promise which resolves to a LoginResponse object
     * @returns Rejects: with an error response.
     *
     * @deprecated This method has unintuitive behaviour: it updates the `MatrixClient` instance with *some* of the
     *    returned credentials. Instead, call {@link loginRequest} and create a new `MatrixClient` instance using the
     *    results. See https://github.com/matrix-org/matrix-js-sdk/issues/4502.
     */
    public async login(loginType: LoginRequest["type"], data: Omit<LoginRequest, "type">): Promise<LoginResponse> {
        const response = await this.loginRequest({
            ...data,
            type: loginType,
        });
        if (response.access_token && response.user_id) {
            this.http.opts.accessToken = response.access_token;
            this.credentials = {
                userId: response.user_id,
            };
        }
        return response;
    }

    /**
     * @returns Promise which resolves to a LoginResponse object
     * @returns Rejects: with an error response.
     *
     * @deprecated This method has unintuitive behaviour: it updates the `MatrixClient` instance with *some* of the
     *   returned credentials. Instead, call {@link loginRequest} with `data.type: "m.login.password"`, and create a new
     *   `MatrixClient` instance using the results. See https://github.com/matrix-org/matrix-js-sdk/issues/4502.
     */
    public loginWithPassword(user: string, password: string): Promise<LoginResponse> {
        return this.login("m.login.password", {
            user: user,
            password: password,
        });
    }

    /**
     * @param redirectUrl - The URL to redirect to after the HS
     * authenticates with CAS.
     * @returns The HS URL to hit to begin the CAS login process.
     */
    public getCasLoginUrl(redirectUrl: string): string {
        return this.getSsoLoginUrl(redirectUrl, "cas");
    }

    /**
     * @param redirectUrl - The URL to redirect to after the HS
     *     authenticates with the SSO.
     * @param loginType - The type of SSO login we are doing (sso or cas).
     *     Defaults to 'sso'.
     * @param idpId - The ID of the Identity Provider being targeted, optional.
     * @param action - the SSO flow to indicate to the IdP, optional.
     * @returns The HS URL to hit to begin the SSO login process.
     */
    public getSsoLoginUrl(redirectUrl: string, loginType = "sso", idpId?: string, action?: SSOAction): string {
        let url = "/login/" + loginType + "/redirect";
        if (idpId) {
            url += "/" + idpId;
        }

        const params = {
            redirectUrl,
            [SSO_ACTION_PARAM.stable!]: action,
            [SSO_ACTION_PARAM.unstable!]: action,
        };

        return this.http.getUrl(url, params).href;
    }

    /**
     * @param token - Login token previously received from homeserver
     * @returns Promise which resolves to a LoginResponse object
     * @returns Rejects: with an error response.
     *
     * @deprecated This method has unintuitive behaviour: it updates the `MatrixClient` instance with *some* of the
     *   returned credentials. Instead, call {@link loginRequest} with `data.type: "m.login.token"`, and create a new
     *   `MatrixClient` instance using the results. See https://github.com/matrix-org/matrix-js-sdk/issues/4502.
     */
    public loginWithToken(token: string): Promise<LoginResponse> {
        return this.login("m.login.token", {
            token: token,
        });
    }

    /**
     * Sends a `POST /login` request to the server.
     *
     * If successful, this will create a new device and access token for the user.
     *
     * @see {@link MatrixClient.loginFlows} which makes a `GET /login` request.
     * @see https://spec.matrix.org/v1.13/client-server-api/#post_matrixclientv3login
     *
     * @param data - Credentials and other details for the login request.
     */
    public async loginRequest(data: LoginRequest): Promise<LoginResponse> {
        return await this.http.authedRequest<LoginResponse>(Method.Post, "/login", undefined, data);
    }

    /**
     * Logs out the current session.
     * Obviously, further calls that require authorisation should fail after this
     * method is called. The state of the MatrixClient object is not affected:
     * it is up to the caller to either reset or destroy the MatrixClient after
     * this method succeeds.
     * @param stopClient - whether to stop the client before calling /logout to prevent invalid token errors.
     * @returns Promise which resolves: On success, the empty object `{}`
     */
    public async logout(stopClient = false): Promise<EmptyObject> {
        if (stopClient) {
            this.stopClient();
            this.http.abort();
        }

        return this.http.authedRequest(Method.Post, "/logout");
    }

    /**
     * Deactivates the logged-in account.
     * Obviously, further calls that require authorisation should fail after this
     * method is called. The state of the MatrixClient object is not affected:
     * it is up to the caller to either reset or destroy the MatrixClient after
     * this method succeeds.
     * @param auth - Optional. Auth data to supply for User-Interactive auth.
     * @param erase - Optional. If set, send as `erase` attribute in the
     * JSON request body, indicating whether the account should be erased. Defaults
     * to false.
     * @returns Promise which resolves: On success, the empty object
     */
    public deactivateAccount(
        auth?: AuthDict,
        erase?: boolean,
    ): Promise<{ id_server_unbind_result: IdServerUnbindResult }> {
        const body: Body = {};
        if (auth) {
            body.auth = auth;
        }
        if (erase !== undefined) {
            body.erase = erase;
        }

        return this.http.authedRequest(Method.Post, "/account/deactivate", undefined, body);
    }

    /**
     * Make a request for an `m.login.token` to be issued as per
     * https://spec.matrix.org/v1.7/client-server-api/#post_matrixclientv1loginget_token
     *
     * The server may require User-Interactive auth.
     *
     * @param auth - Optional. Auth data to supply for User-Interactive auth.
     * @returns Promise which resolves: On success, the token response
     * or UIA auth data.
     */
    public async requestLoginToken(auth?: AuthDict): Promise<LoginTokenPostResponse> {
        const body: UIARequest<unknown> = { auth };
        return this.http.authedRequest<LoginTokenPostResponse>(
            Method.Post,
            "/login/get_token",
            undefined, // no query params
            body,
            { prefix: ClientPrefix.V1 },
        );
    }

    /**
     * Get the fallback URL to use for unknown interactive-auth stages.
     *
     * @param loginType -     the type of stage being attempted
     * @param authSessionId - the auth session ID provided by the homeserver
     *
     * @returns HS URL to hit to for the fallback interface
     */
    public getFallbackAuthUrl(loginType: string, authSessionId: string): string {
        const path = utils.encodeUri("/auth/$loginType/fallback/web", {
            $loginType: loginType,
        });

        return this.http.getUrl(path, {
            session: authSessionId,
        }).href;
    }

    /**
     * Create a new room.
     * @param options - a list of options to pass to the /createRoom API.
     * @returns Promise which resolves: `{room_id: {string}}`
     * @returns Rejects: with an error response.
     */
    public async createRoom(options: ICreateRoomOpts): Promise<{ room_id: string }> {
        // eslint-disable-line camelcase
        // some valid options include: room_alias_name, visibility, invite

        // inject the id_access_token if inviting 3rd party addresses
        const invitesNeedingToken = (options.invite_3pid || []).filter((i) => !i.id_access_token);
        if (invitesNeedingToken.length > 0 && this.identityServer?.getAccessToken) {
            const identityAccessToken = await this.identityServer.getAccessToken();
            if (identityAccessToken) {
                for (const invite of invitesNeedingToken) {
                    invite.id_access_token = identityAccessToken;
                }
            }
        }

        return this.http.authedRequest(Method.Post, "/createRoom", undefined, options);
    }

    /**
     * Fetches relations for a given event
     * @param roomId - the room of the event
     * @param eventId - the id of the event
     * @param relationType - the rel_type of the relations requested
     * @param eventType - the event type of the relations requested
     * @param opts - options with optional values for the request.
     * @returns the response, with chunk, prev_batch and, next_batch.
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
     * @returns Promise which resolves with the room state event list.
     * @returns Rejects: with an error response.
     */
    public roomState(roomId: string): Promise<IStateEventWithRoomId[]> {
        return this.getEventManager().getState(roomId) as unknown as Promise<IStateEventWithRoomId[]>;
    }

    /**
     * Get an event in a room by its event id.
     *
     * @returns Promise which resolves to an object containing the event.
     * @returns Rejects: with an error response.
     */
    public fetchRoomEvent(roomId: string, eventId: string): Promise<Partial<IEvent>> {
        return this.getEventManager().getEvent(roomId, eventId) as unknown as Promise<Partial<IEvent>>;
    }

    /**
     * @param includeMembership - the membership type to include in the response
     * @param excludeMembership - the membership type to exclude from the response
     * @param atEventId - the id of the event for which moment in the timeline the members should be returned for
     * @returns Promise which resolves: dictionary of userid to profile information
     * @returns Rejects: with an error response.
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
     * Upgrades a room to a new protocol version
     * @param newVersion - The target version to upgrade to
     * @param additionalCreators - an optional list of user IDs of users who
     *        should have the same permissions as the user performing the
     *        upgrade
     * @returns Promise which resolves: Object with key 'replacement_room'
     * @returns Rejects: with an error response.
     */
    public upgradeRoom(
        roomId: string,
        newVersion: string,
        additionalCreators?: string[],
    ): Promise<{ replacement_room: string }> {
        const body: { new_version: string; additional_creators?: string[] } = {
            new_version: newVersion,
        };
        if (additionalCreators) {
            body.additional_creators = additionalCreators;
        }
        return this.http.authedRequest<{ replacement_room: string }>(
            Method.Post,
            utils.encodeUri("/rooms/$roomId/upgrade", { $roomId: roomId }),
            undefined,
            body,
            undefined,
        );
    }

    /**
     * Retrieve a state event.
     * @returns Promise which resolves with the state event content.
     * @returns Rejects: with an error response.
     */
    public getStateEvent(roomId: string, eventType: string, stateKey = ""): Promise<Record<string, unknown>> {
        return this.getEventManager().getStateEvent(roomId, eventType, stateKey);
    }

    /**
     * Send a state event into a room
     * @param roomId - ID of the room to send the event into
     * @param eventType - type of the state event to send
     * @param content - content of the event to send
     * @param stateKey - the stateKey to send into the room
     * @param opts - Options for the request function.
     * @returns Promise which resolves with the sent event response.
     * @returns Rejects: with an error response.
     */
    public async sendStateEvent<K extends keyof StateEvents>(
        roomId: string,
        eventType: K,
        content: StateEvents[K],
        stateKey = "",
        opts: IRequestOpts = {},
    ): Promise<ISendEventResponse> {
        const room = this.getRoom(roomId);
        const event = new MatrixEvent({
            room_id: roomId,
            type: eventType as string,
            state_key: stateKey,
            // Cast safety: StateEvents[K] is a stronger bound than IContent, which has [key: string]: any
            content: content as IContent,
        });

        await this.encryptStateEventIfNeeded(event, room ?? undefined);

        return dispatchStateEventRequest({
            roomId,
            eventType: event.getWireType(),
            content: event.getWireContent() as Body,
            stateKey: event.getWireStateKey() ?? stateKey,
            http: this.http,
            requestOpts: opts,
        }) as Promise<ISendEventResponse>;
    }

    private async encryptStateEventIfNeeded(event: MatrixEvent, room?: Room): Promise<void> {
        return this.encryptionUtils.encryptStateEventIfNeeded(event, room);
    }

    /**
     * @returns Promise which resolves with the room initial sync response.
     * @returns Rejects: with an error response.
     */
    public roomInitialSync(roomId: string, _limit: number): Promise<IRoomInitialSyncResponse> {
        return this.getRoomManager().roomInitialSync(roomId);
    }

    /**
     * Set a marker to indicate the point in a room before which the user has read every
     * event. This can be retrieved from room account data (the event type is `m.fully_read`)
     * and displayed as a horizontal line in the timeline that is visually distinct to the
     * position of the user's own read receipt.
     * @param roomId - ID of the room that has been read
     * @param rmEventId - ID of the event that has been read
     * @param rrEventId - ID of the event tracked by the read receipt. This is here
     * for convenience because the RR and the RM are commonly updated at the same time as
     * each other. Optional.
     * @param rpEventId - rpEvent the m.read.private read receipt event for when we
     * don't want other users to see the read receipts. This is experimental. Optional.
     * @returns Promise which resolves: the empty object, `{}`.
     */
    public async setRoomReadMarkersHttpRequest(
        roomId: string,
        rmEventId: string,
        rrEventId?: string,
        rpEventId?: string,
    ): Promise<EmptyObject> {
        return setRoomReadMarkersRequest(
            roomId,
            rmEventId,
            rrEventId,
            rpEventId,
            async () =>
                (await this.doesServerSupportUnstableFeature("org.matrix.msc2285.stable")) ||
                (await this.isVersionSupported("v1.4")),
            this.authedRequestProxy,
        );
    }

    /**
     * @returns Promise which resolves: A list of the user's current rooms
     * @returns Rejects: with an error response.
     */
    public getJoinedRooms(): Promise<IJoinedRoomsResponse> {
        return getJoinedRoomsRequest(this.authedRequestProxy);
    }

    /**
     * Retrieve membership info. for a room.
     * @param roomId - ID of the room to get membership for
     * @returns Promise which resolves: A list of currently joined users
     *                                 and their profile data.
     * @returns Rejects: with an error response.
     */
    public getJoinedRoomMembers(roomId: string): Promise<IJoinedMembersResponse> {
        return getJoinedRoomMembersRequest(roomId, this.authedRequestProxy);
    }

    /**
     * Get the public rooms list from the server. Supports pagination
     * @param params - Options for this request
     * @returns Promise which resolves: IPublicRoomsResponse
     * @returns Rejects: with an error response.
     * @throws May throw a `MatrixSafetyError` if content is deemed unsafe.
     * @see MatrixSafetyError
     */
    public publicRooms({
        server,
        limit,
        since,
        ...options
    }: IRoomDirectoryOptions = {}): Promise<IPublicRoomsResponse> {
        const request = { server, limit, since, ...options };
        const key = stableSerialize(request);
        return this.publicRoomsRequestCache.getOrCreate(key, () => publicRoomsRequest(request, this.authedRequestProxy));
    }

    /**
     * Create an alias to room ID mapping.
     * @param alias - The room alias to create.
     * @param roomId - The room ID to link the alias to.
     * @returns Promise which resolves: an empty object `{}`
     * @returns Rejects: with an error response.
     */
    public createAlias(alias: string, roomId: string): Promise<EmptyObject> {
        return this.getRoomManager().createAlias(alias, roomId);
    }

    /**
     * Delete an alias to room ID mapping. This alias must be on your local server,
     * and you must have sufficient access to do this operation.
     * @param alias - The room alias to delete.
     * @returns Promise which resolves: an empty object `{}`.
     * @returns Rejects: with an error response.
     */
    public deleteAlias(alias: string): Promise<EmptyObject> {
        return this.getRoomManager().deleteAlias(alias);
    }

    /**
     * Gets the local aliases for the room. Note: this includes all local aliases, unlike the
     * curated list from the m.room.canonical_alias state event.
     * @param roomId - The room ID to get local aliases for.
     * @returns Promise which resolves: an object with an `aliases` property, containing an array of local aliases
     * @returns Rejects: with an error response.
     */
    public getLocalAliases(roomId: string): Promise<{ aliases: string[] }> {
        return this.getRoomManager().getLocalAliases(roomId);
    }

    /**
     * Get room info for the given alias.
     * @param alias - The room alias to resolve.
     * @returns Promise which resolves: Object with room_id and servers.
     * @returns Rejects: with an error response.
     */
    public getRoomIdForAlias(alias: string): Promise<{ room_id: string; servers: string[] }> {
        return this.getRoomManager().getRoomIdForAlias(alias);
    }

    /**
     * Get the visibility of a room in the current HS's room directory
     * @returns Promise which resolves with the room visibility value.
     * @returns Rejects: with an error response.
     */
    public getRoomDirectoryVisibility(roomId: string): Promise<{ visibility: Visibility }> {
        return this.getRoomManager().getRoomDirectoryVisibility(roomId);
    }

    /**
     * Set the visibility of a room in the current HS's room directory
     * @param visibility - "public" to make the room visible
     *                 in the public directory, or "private" to make
     *                 it invisible.
     * @returns Promise which resolves: to an empty object `{}`
     * @returns Rejects: with an error response.
     */
    public setRoomDirectoryVisibility(roomId: string, visibility: Visibility): Promise<EmptyObject> {
        return this.getRoomManager().setRoomDirectoryVisibility(roomId, visibility);
    }

    /**
     * Query the user directory with a term matching user IDs, display names and domains.
     * @param options
     * @param options.term - the term with which to search.
     * @param options.limit - the maximum number of results to return. The server will apply a limit if unspecified.
     * @returns Promise which resolves: an array of results.
     */
    public searchUserDirectory({ term, limit }: { term: string; limit?: number }): Promise<IUserDirectoryResponse> {
        const body: Body = {
            search_term: term,
        };

        if (limit !== undefined) {
            body.limit = limit;
        }

        return this.http.authedRequest(Method.Post, "/user_directory/search", undefined, body);
    }

    /**
     * Upload a file to the media repository on the homeserver.
     *
     * @param file - The object to upload. On a browser, something that
     *   can be sent to XMLHttpRequest.send (typically a File).  Under node.js,
     *   a a Buffer, String or ReadStream.
     *
     * @param opts -  options object
     *
     * @returns Promise which resolves to response object, or rejects with an error (usually a MatrixError).
     */
    public uploadContent(file: FileType, opts?: UploadOpts): Promise<UploadResponse> {
        return this.http.uploadContent(file, opts);
    }

    /**
     * Cancel a file upload in progress
     * @param upload - The object returned from uploadContent
     * @returns true if canceled, otherwise false
     */
    public cancelUpload(upload: Promise<UploadResponse>): boolean {
        return this.http.cancelUpload(upload);
    }

    /**
     * Get a list of all file uploads in progress
     * @returns Array of objects representing current uploads.
     * Currently in progress is element 0. Keys:
     *  - promise: The promise associated with the upload
     *  - loaded: Number of bytes uploaded
     *  - total: Total number of bytes to upload
     */
    public getCurrentUploads(): Upload[] {
        return this.http.getCurrentUploads();
    }

    /**
     * Determine if the server supports extended profiles, as described by MSC4133.
     *
     * @returns `true` if supported, otherwise `false`
     */
    public async doesServerSupportExtendedProfiles(): Promise<boolean> {
        return (
            (await this.isVersionSupported("v1.16")) ||
            (await this.doesServerSupportUnstableFeature(UNSTABLE_MSC4133_EXTENDED_PROFILES)) ||
            (await this.doesServerSupportUnstableFeature(STABLE_MSC4133_EXTENDED_PROFILES))
        );
    }

    /**
     * Get the prefix used for extended profile requests.
     *
     * @returns The prefix for use with `authedRequest`
     */
    private async getExtendedProfileRequestPrefix(): Promise<string> {
        return selectExtendedProfileRequestPrefix(
            await this.isVersionSupported("v1.16"),
            await this.doesServerSupportUnstableFeature(STABLE_MSC4133_EXTENDED_PROFILES),
        );
    }

    private async assertExtendedProfileSupport(): Promise<void> {
        assertExtendedProfileSupported(await this.doesServerSupportExtendedProfiles());
    }

    /**
     * Fetch a user's *extended* profile, which may include additional keys.
     *
     * @see https://github.com/tcpipuk/matrix-spec-proposals/blob/main/proposals/4133-extended-profiles.md
     * @param userId The user ID to fetch the profile of.
     * @returns A set of keys to property values.
     *
     * @throws An error if the server does not support MSC4133.
     * @throws A M_NOT_FOUND error if the profile could not be found.
     */
    public async getExtendedProfile(userId: string): Promise<Record<string, unknown>> {
        await this.assertExtendedProfileSupport();
        return getExtendedProfileRequest(userId, await this.getExtendedProfileRequestPrefix(), this.authedRequestProxy);
    }

    /**
     * Fetch a specific key from the user's *extended* profile.
     *
     * @see https://github.com/tcpipuk/matrix-spec-proposals/blob/main/proposals/4133-extended-profiles.md
     * @param userId The user ID to fetch the profile of.
     * @param key The key of the property to fetch.
     * @returns The property value.
     *
     * @throws An error if the server does not support MSC4133.
     * @throws A M_NOT_FOUND error if the key was not set OR the profile could not be found.
     */
    public async getExtendedProfileProperty(userId: string, key: string): Promise<unknown> {
        await this.assertExtendedProfileSupport();
        return getExtendedProfilePropertyRequest(
            userId,
            key,
            await this.getExtendedProfileRequestPrefix(),
            this.authedRequestProxy,
        );
    }

    /**
     * Set a property on your *extended* profile.
     *
     * @see https://github.com/tcpipuk/matrix-spec-proposals/blob/main/proposals/4133-extended-profiles.md
     * @param key The key of the property to set.
     * @param value The value to set on the property.
     *
     * @throws An error if the server does not support MSC4133 OR the server disallows editing the user profile.
     */
    public async setExtendedProfileProperty(key: string, value: unknown): Promise<void> {
        await this.assertExtendedProfileSupport();
        return setExtendedProfilePropertyRequest(
            this.getUserId(),
            key,
            value,
            await this.getExtendedProfileRequestPrefix(),
            this.authedRequestProxy,
        );
    }

    /**
     * Delete a property on your *extended* profile.
     *
     * @see https://github.com/tcpipuk/matrix-spec-proposals/blob/main/proposals/4133-extended-profiles.md
     * @param key The key of the property to delete.
     *
     * @throws An error if the server does not support MSC4133 OR the server disallows editing the user profile.
     */
    public async deleteExtendedProfileProperty(key: string): Promise<void> {
        await this.assertExtendedProfileSupport();
        return deleteExtendedProfilePropertyRequest(
            this.getUserId(),
            key,
            await this.getExtendedProfileRequestPrefix(),
            this.authedRequestProxy,
        );
    }

    /**
     * Update multiple properties on your *extended* profile. This will
     * merge with any existing keys.
     *
     * @see https://github.com/tcpipuk/matrix-spec-proposals/blob/main/proposals/4133-extended-profiles.md
     * @param profile The profile object to merge with the existing profile.
     * @returns The newly merged profile.
     *
     * @throws An error if the server does not support MSC4133 OR the server disallows editing the user profile.
     */
    public async patchExtendedProfile(profile: Record<string, unknown>): Promise<Record<string, unknown>> {
        await this.assertExtendedProfileSupport();
        return patchExtendedProfileRequest(
            this.getUserId(),
            profile,
            await this.getExtendedProfileRequestPrefix(),
            this.authedRequestProxy,
        );
    }

    /**
     * Set multiple properties on your *extended* profile. This will completely
     * replace the existing profile, removing any unspecified keys.
     *
     * @see https://github.com/tcpipuk/matrix-spec-proposals/blob/main/proposals/4133-extended-profiles.md
     * @param profile The profile object to set.
     *
     * @throws An error if the server does not support MSC4133 OR the server disallows editing the user profile.
     */
    public async setExtendedProfile(profile: Record<string, unknown>): Promise<void> {
        await this.assertExtendedProfileSupport();
        await setExtendedProfileRequest(
            this.getUserId(),
            profile,
            await this.getExtendedProfileRequestPrefix(),
            this.authedRequestProxy,
        );
    }

    /**
     * @returns Promise which resolves to a list of the user's threepids.
     * @returns Rejects: with an error response.
     */
    public getThreePids(): Promise<{ threepids: IThreepid[] }> {
        return this.getThreePidsManager().getThreePids();
    }

    /**
     * Add a 3PID to your homeserver account. This API does not use an identity
     * server, as the homeserver is expected to handle 3PID ownership validation.
     *
     * @param data - A object with 3PID validation data from having called
     * `account/3pid/<medium>/requestToken` on the homeserver.
     * @returns Promise which resolves: to an empty object `{}`
     * @returns Rejects: with an error response.
     */
    public async addThreePidOnly(data: IAddThreePidOnlyBody): Promise<EmptyObject> {
        return this.getThreePidsManager().addThreePidOnly(data.client_secret, data.sid);
    }

    /**
     * Bind a 3PID for discovery onto an identity server via the homeserver. The
     * identity server handles 3PID ownership validation and the homeserver records
     * the new binding to track where all 3PIDs for the account are bound.
     *
     * @param data - A object with 3PID validation data from having called
     * `validate/<medium>/requestToken` on the identity server. It should also
     * contain `id_server` and `id_access_token` fields as well.
     * @returns Promise which resolves: to an empty object `{}`
     * @returns Rejects: with an error response.
     */
    public async bindThreePid(data: IBindThreePidBody): Promise<EmptyObject> {
        return this.getThreePidsManager().bindThreePid(
            data.client_secret,
            data.sid,
            data.id_server,
            data.id_access_token,
        );
    }

    /**
     * Unbind a 3PID for discovery on an identity server via the homeserver. The
     * homeserver removes its record of the binding to keep an updated record of
     * where all 3PIDs for the account are bound.
     *
     * @param medium - The threepid medium (eg. 'email')
     * @param address - The threepid address (eg. 'bob\@example.com')
     *        this must be as returned by getThreePids.
     * @returns Promise which resolves: on success
     * @returns Rejects: with an error response.
     */
    public async unbindThreePid(
        medium: string,
        address: string,
        // eslint-disable-next-line camelcase
    ): Promise<{ id_server_unbind_result: IdServerUnbindResult }> {
        return this.getThreePidsManager().unbindThreePid(medium, address, this.getIdentityServerUrl(true) ?? undefined);
    }

    /**
     * @param medium - The threepid medium (eg. 'email')
     * @param address - The threepid address (eg. 'bob\@example.com')
     *        this must be as returned by getThreePids.
     * @returns Promise which resolves: The server response on success
     *     (generally the empty JSON object)
     * @returns Rejects: with an error response.
     */
    public deleteThreePid(
        medium: string,
        address: string,
        // eslint-disable-next-line camelcase
    ): Promise<{ id_server_unbind_result: IdServerUnbindResult }> {
        return this.getThreePidsManager().deleteThreePid(medium, address);
    }

    /**
     * Make a request to change your password.
     * @param newPassword - The new desired password.
     * @param logoutDevices - Should all sessions be logged out after the password change. Defaults to true.
     * @returns Promise which resolves: to an empty object `{}`
     * @returns Rejects: with an error response.
     */
    public setPassword(authDict: AuthDict, newPassword: string, logoutDevices?: boolean): Promise<EmptyObject> {
        return this.getPasswordResetManager().setPassword(authDict, newPassword, logoutDevices);
    }

    /**
     * Persists local notification settings
     * @returns Promise which resolves: an empty object
     * @returns Rejects: with an error response.
     */
    public setLocalNotificationSettings(
        deviceId: string,
        notificationSettings: LocalNotificationSettings,
    ): Promise<EmptyObject> {
        const key = `${LOCAL_NOTIFICATION_SETTINGS_PREFIX.name}.${deviceId}` as const;
        return this.setAccountData(key, notificationSettings);
    }

    /**
     * Perform a server-side search.
     * @param params
     * @param params.next_batch - the batch token to pass in the query string
     * @param params.body - the JSON object to pass to the request body.
     * @param abortSignal - optional signal used to cancel the http request.
     * @returns Promise which resolves to the search response object.
     * @returns Rejects: with an error response.
     */
    public search(
        { body, next_batch: nextBatch }: { body: ISearchRequestBody; next_batch?: string },
        abortSignal?: AbortSignal,
    ): Promise<ISearchResponse> {
        return performSearchRequest<ISearchResponse>(body, nextBatch, abortSignal, this.authedRequestProxy);
    }

    /**
     * Upload keys
     *
     * @param content -  body of upload request
     *
     * @param opts - this method no longer takes any opts,
     *  used to take opts.device_id but this was not removed from the spec as a redundant parameter
     *
     * @returns Promise which resolves: result object. Rejects: with
     *     an error response ({@link MatrixError}).
     */
    public uploadKeysRequest(content: IUploadKeysRequest, _opts?: void): Promise<IKeysUploadResponse> {
        return uploadKeysHttpRequest<IKeysUploadResponse>(content, this.authedRequestProxy);
    }

    public uploadKeySignatures(content: KeySignatures): Promise<IUploadKeySignaturesResponse> {
        return uploadKeySignaturesHttpRequest<IUploadKeySignaturesResponse>(content, this.authedRequestProxy);
    }

    /**
     * Download device keys
     *
     * @param userIds -  list of users to get keys for
     *
     * @param token - sync token to pass in the query request, to help
     *   the HS give the most recent results
     *
     * @returns Promise which resolves: result object. Rejects: with
     *     an error response ({@link MatrixError}).
     */
    public downloadKeysForUsers(userIds: string[], { token }: { token?: string } = {}): Promise<IDownloadKeyResult> {
        return queryKeysForUsersRequest<IDownloadKeyResult>(userIds, token, this.authedRequestProxy);
    }

    /**
     * Claim one-time keys
     *
     * @param devices -  a list of [userId, deviceId] pairs
     *
     * @param keyAlgorithm -  desired key type
     *
     * @param timeout - the time (in milliseconds) to wait for keys from remote
     *     servers
     *
     * @returns Promise which resolves: result object. Rejects: with
     *     an error response ({@link MatrixError}).
     */
    public claimOneTimeKeys(
        devices: [string, string][],
        keyAlgorithm = "signed_curve25519",
        timeout?: number,
    ): Promise<IClaimOTKsResult> {
        return claimOneTimeKeysHttpRequest<IClaimOTKsResult>(devices, keyAlgorithm, timeout, this.authedRequestProxy);
    }

    /**
     * Ask the server for a list of users who have changed their device lists
     * between a pair of sync tokens
     *
     *
     * @returns Promise which resolves: result object. Rejects: with
     *     an error response ({@link MatrixError}).
     */
    public getKeyChanges(oldToken: string, newToken: string): Promise<{ changed: string[]; left: string[] }> {
        return getKeyChangesRequest<{ changed: string[]; left: string[] }>(oldToken, newToken, this.authedRequestProxy);
    }

    public uploadDeviceSigningKeys(auth?: AuthDict, keys?: CrossSigningKeys): Promise<EmptyObject> {
        return uploadDeviceSigningKeysHttpRequest<EmptyObject>(auth as Body, keys as Body, this.authedRequestProxy);
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

    public startDeviceSigningVerification(
        request: IDeviceSigningVerificationStartRequest,
        version: "v1" | "r0" = "v1",
    ): Promise<IDeviceSigningVerificationStartResponse> {
        return startDeviceSigningVerificationRequest<IDeviceSigningVerificationStartResponse>(
            request,
            getLegacyClientPrefix(version),
            this.authedRequestProxy,
        );
    }

    public acceptDeviceSigningVerification(
        request: IDeviceSigningVerificationAcceptRequest,
        version: "v1" | "r0" = "v1",
    ): Promise<IDeviceSigningVerificationAcceptResponse> {
        return acceptDeviceSigningVerificationRequest<IDeviceSigningVerificationAcceptResponse>(
            request,
            getLegacyClientPrefix(version),
            this.authedRequestProxy,
        );
    }

    public sendDeviceSigningVerificationKeyAgreement(
        request: IDeviceSigningVerificationKeyAgreementRequest,
        version: "v1" | "r0" = "v1",
    ): Promise<IDeviceSigningVerificationKeyAgreementResponse> {
        return sendDeviceSigningVerificationKeyAgreementRequest<IDeviceSigningVerificationKeyAgreementResponse>(
            request,
            getLegacyClientPrefix(version),
            this.authedRequestProxy,
        );
    }

    public confirmDeviceSigningVerificationMac(
        request: IDeviceSigningVerificationMacRequest,
        version: "v1" | "r0" = "v1",
    ): Promise<IDeviceSigningVerificationMacResponse> {
        return confirmDeviceSigningVerificationMacRequest<IDeviceSigningVerificationMacResponse>(
            request,
            getLegacyClientPrefix(version),
            this.authedRequestProxy,
        );
    }

    public completeDeviceSigningVerification(
        request: IDeviceSigningVerificationDoneRequest,
        version: "v1" | "r0" = "v1",
    ): Promise<IDeviceSigningVerificationDoneResponse> {
        return completeDeviceSigningVerificationRequest<IDeviceSigningVerificationDoneResponse>(
            request,
            getLegacyClientPrefix(version),
            this.authedRequestProxy,
        );
    }

    public cancelDeviceSigningVerification(
        request: IDeviceSigningVerificationCancelRequest,
        version: "v1" | "r0" = "v1",
    ): Promise<IDeviceSigningVerificationCancelResponse> {
        return cancelDeviceSigningVerificationRequest<IDeviceSigningVerificationCancelResponse>(
            request,
            getLegacyClientPrefix(version),
            this.authedRequestProxy,
        );
    }

    public getVerificationRequests(version: "v1" | "r0" = "v1"): Promise<IVerificationRequestsResponse> {
        return getVerificationRequestsHttpRequest<IVerificationRequestsResponse>(
            getLegacyClientPrefix(version),
            this.authedRequestProxy,
        );
    }

    public showQrCode(version: "v1" | "r0" = "v1"): Promise<IShowQrCodeResponse> {
        return showQrCodeHttpRequest<IShowQrCodeResponse>(getLegacyClientPrefix(version), this.authedRequestProxy);
    }

    public scanQrCode(request: IScanQrCodeRequest, version: "v1" | "r0" = "v1"): Promise<IScanQrCodeResponse> {
        return scanQrCodeHttpRequest<IScanQrCodeResponse>(
            request,
            getLegacyClientPrefix(version),
            this.authedRequestProxy,
        );
    }

    /**
     * Register with an identity server using the OpenID token from the user's
     * Homeserver, which can be retrieved via
     * {@link MatrixClient#getOpenIdToken}.
     *
     * Note that the `/account/register` endpoint (as well as IS authentication in
     * general) was added as part of the v2 API version.
     *
     * @returns Promise which resolves: with object containing an Identity
     * Server access token.
     * @returns Rejects: with an error response.
     */
    public registerWithIdentityServer(hsOpenIdToken: IOpenIDToken): Promise<{
        access_token: string;
        token: string;
    }> {
        if (!this.idBaseUrl) {
            throw new Error("No identity server base URL set");
        }

        const uri = this.http.getUrl("/account/register", undefined, IdentityPrefix.V2, this.idBaseUrl);
        return this.http.requestOtherUrl(Method.Post, uri, hsOpenIdToken);
    }

    /**
     * Requests an email verification token directly from an identity server.
     *
     * This API is used as part of binding an email for discovery on an identity
     * server. The validation data that results should be passed to the
     * `bindThreePid` method to complete the binding process.
     *
     * @param email - The email address to request a token for
     * @param clientSecret - A secret binary string generated by the client.
     *                 It is recommended this be around 16 ASCII characters.
     * @param sendAttempt - If an identity server sees a duplicate request
     *                 with the same sendAttempt, it will not send another email.
     *                 To request another email to be sent, use a larger value for
     *                 the sendAttempt param as was used in the previous request.
     * @param nextLink - Optional If specified, the client will be redirected
     *                 to this link after validation.
     * @param identityAccessToken - The `access_token` field of the identity
     * server `/account/register` response (see {@link registerWithIdentityServer}).
     *
     * @returns Promise which resolves with the token request response.
     * @returns Rejects: with an error response.
     * @throws Error if no identity server is set
     */
    public requestEmailToken(
        email: string,
        clientSecret: string,
        sendAttempt: number,
        nextLink?: string,
        identityAccessToken?: string,
    ): Promise<IRequestTokenResponse> {
        const params: Record<string, string> = {
            client_secret: clientSecret,
            email: email,
            send_attempt: sendAttempt?.toString(),
        };
        if (nextLink) {
            params.next_link = nextLink;
        }

        return this.http.idServerRequest<IRequestTokenResponse>(
            Method.Post,
            "/validate/email/requestToken",
            params,
            IdentityPrefix.V2,
            identityAccessToken,
        );
    }

    /**
     * Requests a MSISDN verification token directly from an identity server.
     *
     * This API is used as part of binding a MSISDN for discovery on an identity
     * server. The validation data that results should be passed to the
     * `bindThreePid` method to complete the binding process.
     *
     * @param phoneCountry - The ISO 3166-1 alpha-2 code for the country in
     *                 which phoneNumber should be parsed relative to.
     * @param phoneNumber - The phone number, in national or international
     *                 format
     * @param clientSecret - A secret binary string generated by the client.
     *                 It is recommended this be around 16 ASCII characters.
     * @param sendAttempt - If an identity server sees a duplicate request
     *                 with the same sendAttempt, it will not send another SMS.
     *                 To request another SMS to be sent, use a larger value for
     *                 the sendAttempt param as was used in the previous request.
     * @param nextLink - Optional If specified, the client will be redirected
     *                 to this link after validation.
     * @param identityAccessToken - The `access_token` field of the Identity
     * Server `/account/register` response (see {@link registerWithIdentityServer}).
     *
     * @returns Promise which resolves to an object with a sid string
     * @returns Rejects: with an error response.
     * @throws Error if no identity server is set
     */
    public requestMsisdnToken(
        phoneCountry: string,
        phoneNumber: string,
        clientSecret: string,
        sendAttempt: number,
        nextLink?: string,
        identityAccessToken?: string,
    ): Promise<IRequestMsisdnTokenResponse> {
        const params: Record<string, string> = {
            client_secret: clientSecret,
            country: phoneCountry,
            phone_number: phoneNumber,
            send_attempt: sendAttempt?.toString(),
        };
        if (nextLink) {
            params.next_link = nextLink;
        }

        return this.http.idServerRequest<IRequestMsisdnTokenResponse>(
            Method.Post,
            "/validate/msisdn/requestToken",
            params,
            IdentityPrefix.V2,
            identityAccessToken,
        );
    }

    /**
     * Submits a MSISDN token to the identity server
     *
     * This is used when submitting the code sent by SMS to a phone number.
     * The identity server has an equivalent API for email but the js-sdk does
     * not expose this, since email is normally validated by the user clicking
     * a link rather than entering a code.
     *
     * @param sid - The sid given in the response to requestToken
     * @param clientSecret - A secret binary string generated by the client.
     *                 This must be the same value submitted in the requestToken call.
     * @param msisdnToken - The MSISDN token, as entered by the user.
     * @param identityAccessToken - The `access_token` field of the Identity
     * Server `/account/register` response (see {@link registerWithIdentityServer}).
     * Some legacy identity servers had no authentication here.
     *
     * @returns Promise which resolves: Object, containing success boolean.
     * @returns Rejects: with an error response.
     * @throws Error if No identity server is set
     */
    public submitMsisdnToken(
        sid: string,
        clientSecret: string,
        msisdnToken: string,
        identityAccessToken: string | null,
    ): Promise<{ success: boolean }> {
        const params = {
            sid: sid,
            client_secret: clientSecret,
            token: msisdnToken,
        };

        return this.http.idServerRequest(
            Method.Post,
            "/validate/msisdn/submitToken",
            params,
            IdentityPrefix.V2,
            identityAccessToken ?? undefined,
        );
    }

    /**
     * Submits a MSISDN token to an arbitrary URL.
     *
     * This is used when submitting the code sent by SMS to a phone number in the
     * newer 3PID flow where the homeserver validates 3PID ownership (as part of
     * `requestAdd3pidMsisdnToken`). The homeserver response may include a
     * `submit_url` to specify where the token should be sent, and this helper can
     * be used to pass the token to this URL.
     *
     * @param url - The URL to submit the token to
     * @param sid - The sid given in the response to requestToken
     * @param clientSecret - A secret binary string generated by the client.
     *                 This must be the same value submitted in the requestToken call.
     * @param msisdnToken - The MSISDN token, as entered by the user.
     *
     * @returns Promise which resolves: Object, containing success boolean.
     * @returns Rejects: with an error response.
     */
    public submitMsisdnTokenOtherUrl(
        url: string,
        sid: string,
        clientSecret: string,
        msisdnToken: string,
    ): Promise<{ success: boolean }> {
        const params = {
            sid: sid,
            client_secret: clientSecret,
            token: msisdnToken,
        };
        return this.http.requestOtherUrl(Method.Post, url, params);
    }

    /**
     * Gets the V2 hashing information from the identity server. Primarily useful for
     * lookups.
     * @param identityAccessToken - The access token for the identity server.
     * @returns The hashing information for the identity server.
     */
    public getIdentityHashDetails(identityAccessToken: string): Promise<{
        /**
         * The algorithms the server supports. Must contain at least sha256.
         */
        algorithms: string[];
        /**
         * The pepper the client MUST use in hashing identifiers,
         * and MUST supply to the /lookup endpoint when performing lookups.
         */
        lookup_pepper: string;
    }> {
        return this.http.idServerRequest(
            Method.Get,
            "/hash_details",
            undefined,
            IdentityPrefix.V2,
            identityAccessToken,
        );
    }

    /**
     * Performs a hashed lookup of addresses against the identity server. This is
     * only supported on identity servers which have at least the version 2 API.
     * @param addressPairs - An array of 2 element arrays.
     * The first element of each pair is the address, the second is the 3PID medium.
     * Eg: `["email@example.org", "email"]`
     * @param identityAccessToken - The access token for the identity server.
     * @returns A collection of address mappings to
     * found MXIDs. Results where no user could be found will not be listed.
     */
    public async identityHashedLookup(
        addressPairs: [string, string][],
        identityAccessToken: string,
    ): Promise<{ address: string; mxid: string }[]> {
        return identityHashedLookupRequest(
            addressPairs,
            identityAccessToken,
            this.http.idServerRequest.bind(this.http),
        );
    }

    /**
     * Looks up the public Matrix ID mapping for a given 3rd party
     * identifier from the identity server
     *
     * @param medium - The medium of the threepid, eg. 'email'
     * @param address - The textual address of the threepid
     * @param identityAccessToken - The `access_token` field of the Identity
     * Server `/account/register` response (see {@link registerWithIdentityServer}).
     *
     * @returns Promise which resolves: A threepid mapping
     *                                 object or the empty object if no mapping
     *                                 exists
     * @returns Rejects: with an error response.
     */
    public async lookupThreePid(
        medium: string,
        address: string,
        identityAccessToken: string,
    ): Promise<
        | {
              address: string;
              medium: string;
              mxid: string;
          }
        | EmptyObject
    > {
        return lookupThreePidRequest(medium, address, identityAccessToken, this.http.idServerRequest.bind(this.http));
    }

    /**
     * Looks up the public Matrix ID mappings for multiple 3PIDs.
     *
     * @param query - Array of arrays containing
     * [medium, address]
     * @param identityAccessToken - The `access_token` field of the Identity
     * Server `/account/register` response (see {@link registerWithIdentityServer}).
     *
     * @returns Promise which resolves: Lookup results from IS.
     * @returns Rejects: with an error response.
     */
    public async bulkLookupThreePids(
        query: [string, string][],
        identityAccessToken: string,
    ): Promise<{
        threepids: [medium: string, address: string, mxid: string][];
    }> {
        return bulkLookupThreePidsRequest(query, identityAccessToken, this.http.idServerRequest.bind(this.http));
    }

    /**
     * Get account info from the identity server. This is useful as a neutral check
     * to verify that other APIs are likely to approve access by testing that the
     * token is valid, terms have been agreed, etc.
     *
     * @param identityAccessToken - The `access_token` field of the Identity
     * Server `/account/register` response (see {@link registerWithIdentityServer}).
     *
     * @returns Promise which resolves: an object with account info.
     * @returns Rejects: with an error response.
     */
    public getIdentityAccount(identityAccessToken: string): Promise<{ user_id: string }> {
        return this.http.idServerRequest(Method.Get, "/account", undefined, IdentityPrefix.V2, identityAccessToken);
    }

    /**
     * Send an event to a specific list of devices.
     * This is a low-level API that simply wraps the HTTP API
     * call to send to-device messages. We recommend using
     * queueToDevice() which is a higher level API.
     *
     * @param eventType -  type of event to send
     *    content to send. Map from user_id to device_id to content object.
     * @param txnId -     transaction id. One will be made up if not
     *    supplied.
     * @returns Promise which resolves: to an empty object `{}`
     */
    public sendToDevice(eventType: string, contentMap: SendToDeviceContentMap, txnId?: string): Promise<EmptyObject> {
        return sendToDeviceRequest(
            { eventType, contentMap, txnId, makeTxnId: this.makeTxnId.bind(this) },
            {
                authedRequest: this.http.authedRequest.bind(this.http),
                logger: this.logger,
            },
        );
    }

    /**
     * This will encrypt the payload for all devices in the list and will queue it.
     * The type of the sent to-device message will be `m.room.encrypted`.
     * @param eventType - The type of event to send
     * @param devices - The list of devices to send the event to.
     * @param payload - The payload to send. This will be encrypted.
     * @returns Promise which resolves once queued there is no error feedback when sending fails.
     */
    public async encryptAndSendToDevice(
        eventType: string,
        devices: { userId: string; deviceId: string }[],
        payload: ToDevicePayload,
    ): Promise<void> {
        if (!this.cryptoBackend) {
            throw new Error("Cannot encrypt to device event, your client does not support encryption.");
        }
        const batch = await this.cryptoBackend.encryptToDeviceMessages(eventType, devices, payload);

        // Known limitation: the batch mechanism removes the ability to surface per-message send errors.
        // We might want instead to do the API call directly and pass the errors back.
        await this.queueToDevice(batch);
    }

    /**
     * Sends events directly to specific devices using Matrix's to-device
     * messaging system. The batch will be split up into appropriately sized
     * batches for sending and stored in the store so they can be retried
     * later if they fail to send. Retries will happen automatically.
     * @param batch - The to-device messages to send
     */
    public queueToDevice(batch: ToDeviceBatch): Promise<void> {
        return this.toDeviceMessageQueue.queueBatch(batch);
    }

    /**
     * Get the third party protocols that can be reached using
     * this HS
     * @returns Promise which resolves to the result object
     */
    public async getThirdpartyProtocols(): Promise<{ [protocol: string]: IProtocol }> {
        return getThirdpartyProtocolsRequest(this.http.authedRequest.bind(this.http));
    }

    public getThirdpartyLocation(
        protocol: string,
        params: { searchFields?: string[] },
    ): Promise<IThirdPartyLocation[]> {
        return getThirdpartyLocationRequest(protocol, params, this.http.authedRequest.bind(this.http));
    }

    public getThirdpartyUser(protocol: string, params?: QueryDict): Promise<IThirdPartyUser[]> {
        return getThirdpartyUserRequest(protocol, params, this.http.authedRequest.bind(this.http));
    }

    public getTerms(serviceType: SERVICE_TYPES, baseUrl: string): Promise<Terms> {
        const url = this.termsUrlForService(serviceType, baseUrl);
        return this.http.requestOtherUrl(Method.Get, url);
    }

    public agreeToTerms(
        serviceType: SERVICE_TYPES,
        baseUrl: string,
        accessToken: string,
        termsUrls: string[],
    ): Promise<EmptyObject> {
        const url = this.termsUrlForService(serviceType, baseUrl);
        const headers = {
            Authorization: "Bearer " + accessToken,
        };
        return this.http.requestOtherUrl(
            Method.Post,
            url,
            {
                user_accepts: termsUrls,
            },
            { headers },
        );
    }

    /**
     * Reports an event as inappropriate to the server, which may then notify the appropriate people.
     * @param roomId - The room in which the event being reported is located.
     * @param eventId - The event to report.
     * @param score - The score to rate this content as where -100 is most offensive and 0 is inoffensive.
     * @param reason - The reason the content is being reported. May be blank.
     * @returns Promise which resolves to an empty object if successful
     */
    public reportEvent(roomId: string, eventId: string, score: number, reason: string): Promise<EmptyObject> {
        return reportEventRequest(roomId, eventId, score, reason, this.authedRequestProxy);
    }

    /**
     * Score a report
     * @param roomId - The room ID
     * @param eventId - The event ID
     * @param score - The score (-100 to 0)
     */
    public async scoreReport(roomId: string, eventId: string, score: number): Promise<void> {
        const path = utils.encodeUri("/rooms/$roomId/report/$eventId/score", {
            $roomId: roomId,
            $eventId: eventId,
        });
        await this.http.authedRequest(Method.Put, path, undefined, { score }, { prefix: ClientPrefix.V3 });
    }

    /**
     * Get scanner info for a report
     * @param roomId - The room ID
     * @param eventId - The event ID
     */
    public async getScannerInfo(roomId: string, eventId: string): Promise<any> {
        const path = utils.encodeUri("/rooms/$roomId/report/$eventId/scanner_info", {
            $roomId: roomId,
            $eventId: eventId,
        });
        return this.http.authedRequest(Method.Get, path, undefined, undefined, { prefix: ClientPrefix.V1 });
    }

    /**
     * Reports a room as inappropriate to the server, which may then notify the appropriate people.
     *
     * This API was introduced in Matrix v1.13.
     *
     * @param roomId - The room being reported.
     * @param reason - The reason the room is being reported. May be blank.
     * @returns Promise which resolves to an empty object if successful
     */
    public reportRoom(roomId: string, reason: string): Promise<EmptyObject> {
        return reportRoomRequest(roomId, reason, this.authedRequestProxy);
    }

    /**
     * Fetches or paginates a room hierarchy asmatrix-js-sdk/spec/unit/matrix-client.spec.ts defined by MSC2946.
     * Falls back gracefully to sourcing its data from `getSpaceSummary` if this API is not yet supported by the server.
     * @param roomId - The ID of the space-room to use as the root of the summary.
     * @param limit - The maximum number of rooms to return per page.
     * @param maxDepth - The maximum depth in the tree from the root room to return.
     * @param suggestedOnly - Whether to only return rooms with suggested=true.
     * @param fromToken - The opaque token to paginate a previous request.
     * @returns the response, with next_batch & rooms fields.
     */
    public getRoomHierarchy(
        roomId: string,
        limit?: number,
        maxDepth?: number,
        suggestedOnly = false,
        fromToken?: string,
    ): Promise<IRoomHierarchy> {
        return getRoomHierarchyRequest<IRoomHierarchy>(
            roomId,
            limit,
            maxDepth,
            suggestedOnly,
            fromToken,
            this.authedRequestProxy,
        );
    }

    /**
     * Creates a new file tree space with the given name. The client will pick
     * defaults for how it expects to be able to support the remaining API offered
     * by the returned class.
     *
     * Note that this is UNSTABLE and may have breaking changes without notice.
     * @param name - The name of the tree space.
     * @returns Promise which resolves to the created space.
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
     * Gets a reference to a tree space, if the room ID given is a tree space. If the room
     * does not appear to be a tree space then null is returned.
     *
     * Note that this is UNSTABLE and may have breaking changes without notice.
     * @param roomId - The room ID to get a tree space reference for.
     * @returns The tree space, or null if not a tree space.
     */
    public unstableGetFileTreeSpace(roomId: string): MSC3089TreeSpace | null {
        return getFileTreeSpaceReference(
            roomId,
            (targetRoomId) => this.getRoom(targetRoomId),
            (targetRoomId) => new MSC3089TreeSpace(this, targetRoomId),
        );
    }

    /**
     * Perform a single MSC3575 sliding sync request.
     * @param req - The request to make.
     * @param proxyBaseUrl - The base URL for the sliding sync proxy.
     * @param abortSignal - Optional signal to abort request mid-flight.
     * @returns The sliding sync response, or a standard error.
     * @throws on non 2xx status codes with an object with a field "httpStatus":number.
     */
    public slidingSync(
        req: MSC3575SlidingSyncRequest,
        proxyBaseUrl?: string,
        abortSignal?: AbortSignal,
    ): Promise<MSC3575SlidingSyncResponse> {
        const qps: QueryDict = {};
        if (req.pos !== undefined) {
            qps.pos = req.pos;
        }
        if (req.timeout !== undefined) {
            qps.timeout = req.timeout;
        }
        const clientTimeout = req.clientTimeout;
        const { pos: _pos, timeout: _timeout, clientTimeout: _clientTimeout, ...body } = req;
        return this.http.authedRequest<MSC3575SlidingSyncResponse>(Method.Post, "/sync", qps, body, {
            prefix: "/_matrix/client/unstable/org.matrix.simplified_msc3575",
            baseUrl: proxyBaseUrl,
            localTimeoutMs: clientTimeout,
            abortSignal,
        });
    }

    /**
     * A helper to determine thread support
     * @returns a boolean to determine if threads are enabled
     */
    public supportsThreads(): boolean {
        return this.clientOpts?.threadSupport || false;
    }

    /**
     * A helper to determine intentional mentions support
     * @returns a boolean to determine if intentional mentions are enabled on the server
     * @experimental
     */
    public supportsIntentionalMentions(): boolean {
        return this.canSupport.get(Feature.IntentionalMentions) !== ServerSupport.Unsupported;
    }

    /**
     * Get all rooms for the current user, including join, invite, and leave status.
     * Custom endpoint for synapse-rust.
     */
    public async getMyRooms(): Promise<{ rooms: IMyRoomInfo[]; total: number }> {
        const response = await getMyRoomsRequest<{ rooms: IMyRoomInfo[]; total: number }>(this.authedRequestProxy);
        return {
            ...response,
            rooms: response.rooms.map((room) => {
                const membership = room.membership ?? room.join_state;
                const joinState = room.join_state ?? room.membership;
                if (membership === room.membership && joinState === room.join_state) {
                    return room;
                }

                return {
                    ...room,
                    membership,
                    join_state: joinState,
                };
            }),
        };
    }

    /**
     * Create a secure key backup (synapse-rust specific).
     */
    public async createSecureBackup(passphrase: string): Promise<ISecureBackupInfo> {
        return createSecureBackupRequest<ISecureBackupInfo>(passphrase, this.authedRequestProxy);
    }

    /**
     * Search rooms by term (synapse-rust specific).
     * POST /_matrix/client/v3/search_rooms
     */
    public async searchRooms(
        searchTerm: string,
        limit?: number,
    ): Promise<{ results: unknown[]; count: number; next_batch: string | null }> {
        return searchRoomsRequest<{ results: unknown[]; count: number; next_batch: string | null }>(
            this.authedRequestProxy,
            searchTerm,
            limit,
        );
    }

    /**
     * Get client-facing server config (synapse-rust specific).
     * GET /_matrix/client/v1/config/client
     */
    public async getClientConfig(): Promise<{
        homeserver: { base_url: string; server_name: string };
        identity_server: { base_url: string };
        push: { enabled: boolean };
        email: { enabled: boolean };
        features: Record<string, boolean>;
        defaults: Record<string, unknown>;
    }> {
        return getClientConfigRequest(this.authedRequestProxy);
    }

    /**
     * Get SSO/OIDC userinfo (synapse-rust specific).
     * GET /_matrix/client/v3/login/sso/userinfo
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
     * Get secure key backup info (synapse-rust specific).
     */
    public async getSecureBackup(backupId: string): Promise<ISecureBackupInfo> {
        return getSecureBackupRequest<ISecureBackupInfo>(backupId, this.authedRequestProxy);
    }

    /**
     * Verify secure key backup passphrase (synapse-rust specific).
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
     * Store keys in secure backup (synapse-rust specific).
     */
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

    /**
     * Restore keys from secure backup (synapse-rust specific).
     */
    public async restoreSecureBackup(backupId: string, passphrase: string): Promise<ISecureBackupRestoreResponse> {
        return restoreSecureBackupRequest<ISecureBackupRestoreResponse>(backupId, passphrase, this.authedRequestProxy);
    }

    /**
     * Delete a secure key backup (synapse-rust specific).
     */
    public async deleteSecureBackup(backupId: string): Promise<EmptyObject> {
        return deleteSecureBackupRequest(backupId, this.authedRequestProxy);
    }

    /**
     * Processes a list of threaded events and adds them to their respective timelines
     * @param room - the room the adds the threaded events
     * @param threadedEvents - an array of the threaded events
     * @param toStartOfTimeline - the direction in which we want to add the events
     */
    public processThreadEvents(room: Room, threadedEvents: MatrixEvent[], toStartOfTimeline: boolean): void {
        room.processThreadedEvents(threadedEvents, toStartOfTimeline);
    }

    /**
     * Processes a list of thread roots and creates a thread model
     * @param room - the room to create the threads in
     * @param threadedEvents - an array of thread roots
     * @param toStartOfTimeline - the direction
     */
    public processThreadRoots(room: Room, threadedEvents: MatrixEvent[], toStartOfTimeline: boolean): void {
        if (!this.supportsThreads()) return;
        room.processThreadRoots(threadedEvents, toStartOfTimeline);
    }

    public processBeaconEvents(room?: Room, events?: MatrixEvent[]): void {
        this.processAggregatedTimelineEvents(room, events);
    }

    /**
     * Calls aggregation functions for event types that are aggregated
     * Polls and location beacons
     * @param room - room the events belong to
     * @param events - timeline events to be processed
     * @returns
     */
    public processAggregatedTimelineEvents(room?: Room, events?: MatrixEvent[]): void {
        if (!events?.length) return;
        if (!room) return;
        for (const ev of events) {
            room.relations.aggregateChildEvent(ev);
        }
        room.currentState.processBeaconEvents(events, this);
    }

    /**
     * Common logic for processing events received from pagination.
     * @internal
     */
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
        const timelineSet = eventTimeline.getTimelineSet();
        let eventsToProcess = matrixEvents;

        if (options.partitionThreads && room) {
            const [timelineEvents, , unknownRelations] = room.partitionThreadedEvents(matrixEvents);
            eventsToProcess = timelineEvents;
            unknownRelations.forEach((event) => room.relations.aggregateChildEvent(event));
        }

        timelineSet.addEventsToTimeline(eventsToProcess, backwards, false, eventTimeline, token);
        this.processAggregatedTimelineEvents(room, eventsToProcess);

        if (options.processThreadRoots && room) {
            this.processThreadRoots(
                room,
                options.partitionThreads
                    ? eventsToProcess.filter((it) => it.getServerAggregatedRelation(THREAD_RELATION_TYPE.name))
                    : eventsToProcess,
                options.partitionThreads ? false : backwards,
            );
        }
    }

    /**
     * Fetches information about the user for the configured access token.
     */
    public async whoami(): Promise<IWhoamiResponse> {
        return this.http.authedRequest(Method.Get, "/account/whoami");
    }

    /**
     * Find the event_id closest to the given timestamp in the given direction.
     * @returns Resolves: A promise of an object containing the event_id and
     *    origin_server_ts of the closest event to the timestamp in the given direction
     * @returns Rejects: when the request fails (module:http-api.MatrixError)
     */
    public async timestampToEvent(
        roomId: string,
        timestamp: number,
        dir: Direction,
    ): Promise<TimestampToEventResponse> {
        return timestampToEventRequest<TimestampToEventResponse>(roomId, timestamp, dir, this.authedRequestProxy);
    }

    /**
     * Discover and validate the auth metadata for the OAuth 2.0 API.
     *
     * Fetches /auth_metadata falling back to legacy implementation using /auth_issuer followed by
     * https://oidc-issuer.example.com/.well-known/openid-configuration and other files linked therein.
     * When successful, validated metadata is returned.
     *
     * @returns validated authentication metadata and optionally signing keys
     * @throws when delegated auth config is invalid or unreachable
     */
    public async getAuthMetadata(): Promise<OidcClientConfig> {
        return fetchAuthMetadataWithFallback(this.http.request.bind(this.http), this.isVersionSupported.bind(this));
    }

    public checkCrossSigningStatus(): Promise<unknown> {
        return Promise.resolve(undefined);
    }
    public getCrossSigningKeys(): Promise<unknown> {
        return Promise.resolve(undefined);
    }
    public isCrossSigningReady(): boolean {
        return false;
    }
    public getUserCrossSigningKeys(_userId: string): Promise<unknown> {
        return Promise.resolve(undefined);
    }
    public checkAndTrustCrossSigning(): Promise<void> {
        return Promise.resolve();
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
    public isCryptoBackupEnabled(): boolean {
        return false;
    }
    public enableCryptoBackup(_passphrase: string): Promise<void> {
        return Promise.resolve();
    }
    public async disableCryptoBackup(): Promise<void> {}
    public getCryptoBackup(): Promise<unknown> {
        return Promise.resolve(undefined);
    }
    public restoreCryptoBackup(_backup: unknown, _passphrase: string): Promise<void> {
        return Promise.resolve();
    }
    public cryptoStore: unknown = undefined;
    public async deleteCryptoStore(): Promise<void> {}
    public isCryptoStoreReady(): boolean {
        return false;
    }
    public rotateEncryptionKeys(): Promise<void> {
        return Promise.resolve();
    }
    public isRotationNeeded(): boolean {
        return false;
    }
    public getRotationPeriod(): number {
        return 0;
    }
    public setRotationPeriod(_period: number): void {}
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
    public getReactionUsers(_roomId: string, _eventId: string): Promise<Array<{ userId: string }>> {
        return Promise.resolve([]);
    }
    public hasReaction(_roomId: string, _eventId: string, _userId: string, _key: string): Promise<boolean> {
        return Promise.resolve(false);
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
    public getSharedWithUsers(_roomId: string): Promise<Record<string, unknown>> {
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
    public getRoomName(_roomId: string): string {
        return "";
    }
    public getRoomTopic(_roomId: string): string {
        return "";
    }
    public getRoomAvatarUrl(_roomId: string): string {
        return "";
    }
    public setRoomAvatar(_roomId: string, _avatarUrl: string): Promise<void> {
        return Promise.resolve();
    }
    public getRoomHistoryVisibility(_roomId: string): string {
        return "shared";
    }
    public setRoomHistoryVisibility(_roomId: string, _visibility: string): Promise<void> {
        return Promise.resolve();
    }
    public getRoomGuestAccess(_roomId: string): string {
        return "";
    }
    public setRoomGuestAccess(_roomId: string, _access: string | boolean): Promise<void> {
        return Promise.resolve();
    }
    public getRoomJoinRule(_roomId: string): string {
        return "invite";
    }
    public setRoomJoinRule(_roomId: string, _rule: string): Promise<void> {
        return Promise.resolve();
    }
    public isSecretStorageReady(): boolean {
        return false;
    }
    public getSecretStorageKey(_keyId: string): Promise<[string, string] | null> {
        return Promise.resolve(null);
    }
    public storeSecret(_name: string, _secret: string, _keys?: string[]): Promise<void> {
        return Promise.resolve();
    }
    public getSecret(_name: string): Promise<string | null> {
        return Promise.resolve(null);
    }
    public hasSecret(_name: string): boolean {
        return false;
    }
    public getSecretStorageKeys(): Promise<Record<string, string>> {
        return Promise.resolve({});
    }
    public getServerCapabilities(): Promise<Record<string, unknown>> {
        return Promise.resolve({});
    }
    public hasServerSupport(_feature: string): boolean {
        return false;
    }
    public getServerVersion(): Promise<string> {
        return Promise.resolve("");
    }
    public supportsLocation(): boolean {
        return false;
    }
    public serverClockDiff: number = 0;
    public getLocalTimestampForServerTime(serverTs: number): number {
        return serverTs - this.serverClockDiff;
    }
    public getServerTimestamp(): number {
        return Date.now() + this.serverClockDiff;
    }
    public updateServerTimeInfo(_serverTime: number, _serverDate: string): void {}
    public waitForPendingRequests(_timeoutMs: number): Promise<void> {
        return Promise.resolve();
    }
    public hasStartedSync(): boolean {
        return false;
    }
    public isSyncing(): boolean {
        return false;
    }
    public async waitForSync(): Promise<void> {}
    public syncToken: string | null = null;
    public syncing: boolean = false;
    public getTurnServerURIs(): Promise<string[]> {
        return Promise.resolve([]);
    }
    public getUserWidgets(): Promise<Record<string, unknown>> {
        return Promise.resolve({});
    }
    public getRoomWidgets(_roomId: string): Promise<Record<string, unknown>> {
        return Promise.resolve({});
    }
    public setUserWidgets(_widgets: Record<string, unknown>): Promise<void> {
        return Promise.resolve();
    }
    public setRoomWidgets(_roomId: string, _widgets: Record<string, unknown>): Promise<void> {
        return Promise.resolve();
    }
    public getAllWidgetEvents(_roomId: string): Promise<MatrixEvent[]> {
        return Promise.resolve([]);
    }
    public getProfileManager(): ProfileManager | null {
        return null;
    }
}

export { fixNotificationCountOnDecryption, inMainTimelineForReceipt, threadIdForReceipt };
