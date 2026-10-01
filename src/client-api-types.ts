import type { IDeviceKeys, IOneTimeKey } from "./@types/crypto";
import type { RoomType } from "./@types/event";
import type { Membership } from "./@types/membership";
import type { JoinRule, Visibility } from "./@types/partials";
import type { IEventWithRoomId, IStateEventWithRoomId } from "./@types/search";
import type { ISignatures, ISigned } from "./@types/signed";
import type { QueryDict } from "./utils";
import type { CrossSigningKeyInfo, Curve25519AuthData, Aes256AuthData } from "./crypto-api/index";
import type { AutoDiscoveryAction } from "./autodiscovery";
import type { IEvent } from "./models/event";
import type { IMinimalEvent } from "./sync-accumulator";

export interface IRequestTokenResponse {
    sid: string;
    submit_url?: string;
}

export interface IRequestMsisdnTokenResponse extends IRequestTokenResponse {
    msisdn: string;
    success: boolean;
    intl_fmt: string;
}

export interface IUploadKeysRequest {
    device_keys?: Required<IDeviceKeys>;
    one_time_keys?: Record<string, IOneTimeKey>;
    "org.matrix.msc2732.fallback_keys"?: Record<string, IOneTimeKey>;
}

export interface IQueryKeysRequest {
    device_keys: { [userId: string]: string[] };
    timeout?: number;
    token?: string;
}

export interface IClaimKeysRequest {
    one_time_keys: { [userId: string]: { [deviceId: string]: string } };
    timeout?: number;
}

export interface IOpenIDToken {
    access_token: string;
    token_type: "Bearer" | string;
    matrix_server_name: string;
    expires_in: number;
}

export interface IRoomInitialSyncResponse {
    room_id: string;
    membership: Membership;
    messages?: {
        start?: string;
        end?: string;
        chunk: IEventWithRoomId[];
    };
    state?: IStateEventWithRoomId[];
    visibility: Visibility;
    account_data?: IMinimalEvent[];
    presence: Partial<IEvent>; // legacy and undocumented, api is deprecated so this won't get attention
}

export interface IJoinedRoomsResponse {
    joined_rooms: string[];
}

export interface IJoinedMembersResponse {
    joined: {
        [userId: string]: {
            display_name: string;
            avatar_url: string;
        };
    };
}

export interface IPublicRoomsChunkRoom {
    room_id: string;
    name?: string;
    avatar_url?: string;
    topic?: string;
    canonical_alias?: string;
    aliases?: string[];
    world_readable: boolean;
    guest_can_join: boolean;
    num_joined_members: number;
    room_type?: RoomType | string; // Added by MSC3827
    join_rule?: JoinRule.Knock | JoinRule.Public; // Added by MSC2403
}

export interface IPublicRoomsResponse {
    chunk: IPublicRoomsChunkRoom[];
    next_batch?: string;
    prev_batch?: string;
    total_room_count_estimate?: number;
}

export interface IMyDevice {
    device_id: string;
    display_name?: string;
    last_seen_ip?: string;
    last_seen_ts?: number;
    // UNSTABLE_MSC3852_LAST_SEEN_UA
    last_seen_user_agent?: string;
    "org.matrix.msc3852.last_seen_user_agent"?: string;
}

export interface Keys {
    keys: { [keyId: string]: string };
    usage: string[];
    user_id: string;
}

export interface SigningKeys extends Keys {
    signatures: ISignatures;
}

export interface DeviceKeys {
    [deviceId: string]: IDeviceKeys & {
        unsigned?: {
            device_display_name: string;
        };
    };
}

export interface IDownloadKeyResult {
    failures: { [serverName: string]: object };
    device_keys: { [userId: string]: DeviceKeys };
    // the following three fields were added in 1.1
    master_keys?: { [userId: string]: Keys };
    self_signing_keys?: { [userId: string]: SigningKeys };
    user_signing_keys?: { [userId: string]: SigningKeys };
}

export interface IClaimOTKsResult {
    failures: { [serverName: string]: object };
    one_time_keys: {
        [userId: string]: {
            [deviceId: string]: {
                [keyId: string]: {
                    key: string;
                    signatures: ISignatures;
                };
            };
        };
    };
}

export interface IFieldType {
    regexp: string;
    placeholder: string;
}

export interface IInstance {
    desc: string;
    icon?: string;
    fields: object;
    network_id: string;
    /**
     * Undocumented field that we rely on.
     * See: https://github.com/matrix-org/matrix-doc/issues/3203
     */
    instance_id: string;
}

export interface IProtocol {
    user_fields: string[];
    location_fields: string[];
    icon: string;
    field_types: Record<string, IFieldType>;
    instances: IInstance[];
}

/**
 * The summary of a room as defined by an initial version of MSC3266 and implemented in Synapse
 * Proposed at https://github.com/matrix-org/matrix-doc/pull/3266
 */
export interface RoomSummary extends Omit<IPublicRoomsChunkRoom, "canonical_alias" | "aliases"> {
    /**
     * The current membership of this user in the room.
     * Usually "leave" if the room is fetched over federation.
     */
    membership?: Membership;
    /**
     * Version of the room.
     */
    "im.nheko.summary.room_version"?: string;
    /**
     * The encryption algorithm used for this room, if the room is encrypted.
     */
    "im.nheko.summary.encryption"?: string;
}

export interface TimestampToEventResponse {
    event_id: string;
    origin_server_ts: number;
}

export type RoomKeyRequestStatus = "pending" | "fulfilled" | "cancelled" | "all";

export interface ICreateRoomKeyRequest {
    algorithm: string;
    room_id: string;
    session_id: string;
    request_type?: string;
    request_id?: string;
}

export interface IRoomKeyRequestCreateResponse {
    request_id: string;
}

export interface IRoomKeyRequest {
    request_id: string;
    user_id: string;
    device_id: string;
    room_id: string;
    session_id: string;
    algorithm: string;
    request_type?: string;
    action?: string;
    status?: Exclude<RoomKeyRequestStatus, "all">;
    created_ts: number;
    is_fulfilled: boolean;
    fulfilled_by_device?: string | null;
    fulfilled_ts?: number | null;
}

export interface IGetRoomKeyRequestsQuery extends QueryDict {
    status?: RoomKeyRequestStatus;
    room_id?: string;
    session_id?: string;
    limit?: number;
}

export interface IRoomKeyRequestsResponse {
    requests: IRoomKeyRequest[];
}

export interface IDeviceSigningVerificationStartRequest {
    from_device: string;
    to_user: string;
    to_device?: string;
    transaction_id?: string;
    method?: string;
}

export interface IDeviceSigningVerificationStartResponse {
    transaction_id: string;
    method: string;
    key_agreement_protocol: string[];
    hash: string[];
    short_authentication_string: string[];
}

export interface IDeviceSigningVerificationAcceptRequest {
    transaction_id: string;
    key_agreement_protocol: string;
    hash: string;
    commitment?: string;
}

export interface IDeviceSigningVerificationAcceptResponse {
    transaction_id: string;
    method: string;
    key_agreement_protocol: string[];
    hash: string[];
    short_authentication_string: string[];
    commitment?: string;
}

export interface IDeviceSigningVerificationKeyAgreementRequest {
    transaction_id: string;
    pubkey: string;
}

export interface IDeviceSigningVerificationKeyAgreementResponse {
    transaction_id: string;
    confirmed: boolean;
    short_authentication_string?: Record<string, unknown>; // Dynamic: SAS verification methods vary
}

export interface IDeviceSigningVerificationMacRequest {
    transaction_id: string;
    mac: string;
}

export interface IDeviceSigningVerificationMacResponse {
    transaction_id: string;
    verified: boolean;
}

export interface IDeviceSigningVerificationDoneRequest {
    transaction_id: string;
}

export interface IDeviceSigningVerificationDoneResponse {
    transaction_id: string;
}

export interface IDeviceSigningVerificationCancelRequest {
    transaction_id: string;
    code: string;
    reason: string;
}

export interface IDeviceSigningVerificationCancelResponse {
    transaction_id: string;
    state: "cancelled";
    code: string;
    reason: string;
}

export interface IVerificationRequestInfo {
    transaction_id: string;
    from_user: string;
    from_device: string;
    to_user: string;
    to_device?: string | null;
    method: "sas" | "qr" | "emoji" | "decimal";
    state: "requested" | "ready" | "pending" | "done" | "cancelled";
    created_ts: number;
    updated_ts: number;
}

export interface IVerificationRequestsResponse {
    requests: IVerificationRequestInfo[];
}

export interface IShowQrCodeResponse {
    transaction_id: string;
    server_name: string;
    user_id: string;
    device_id: string;
    device_ed25519_key: string;
    device_curve25519_key: string;
}

export interface IScanQrCodeRequest {
    transaction_id: string;
    server_name: string;
    user_id: string;
    device_id: string;
    device_ed25519_key: string;
    device_curve25519_key: string;
}

export interface IScanQrCodeResponse {
    transaction_id: string;
    state: string;
}

export interface ISecureBackupInfo {
    backup_id: string;
    version: string;
    algorithm: string;
    auth_data: ISigned & (Curve25519AuthData | Aes256AuthData);
    key_count: number;
}

export interface ISecureBackupSessionKey {
    room_id: string;
    session_id: string;
    session_key: string;
    first_message_index?: number;
    forwarded_count?: number;
    is_verified?: boolean;
}

export interface ISecureBackupVerifyResponse {
    valid: boolean;
}

export interface ISecureBackupStoreKeysResponse {
    key_count: number;
}

export interface ISecureBackupRestoreResponse {
    recovered_keys: number;
    total_keys: number;
}

export interface ISignedKey {
    keys: Record<string, string>;
    signatures: ISignatures;
    user_id: string;
    algorithms: string[];
    device_id: string;
}

export type KeySignatures = Record<string, Record<string, CrossSigningKeyInfo | ISignedKey>>;

export interface IUploadKeySignaturesResponse {
    failures: Record<
        string,
        Record<
            string,
            {
                errcode: string;
                error: string;
            }
        >
    >;
}

export type CrossSigningKeyType = "master_key" | "self_signing_key" | "user_signing_key";

export type CrossSigningKeys = Record<CrossSigningKeyType, CrossSigningKeyInfo>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SendToDeviceContentMap = Map<string, Map<string, Record<string, any>>>;

export interface IPreviewUrlResponse {
    [key: string]: undefined | string | number;
    "og:title": string;
    "og:type": string;
    "og:url": string;
    "og:image"?: string;
    "og:image:type"?: string;
    "og:image:height"?: number;
    "og:image:width"?: number;
    "og:description"?: string;
    "matrix:image:size"?: number;
}

export interface ITurnServerResponse {
    uris: string[];
    username: string;
    password: string;
    ttl: number;
}

export interface ITurnServer {
    urls: string[];
    username: string;
    credential: string;
}

export interface IServerVersions {
    versions: string[];
    unstable_features: Record<string, boolean>;
}

export interface ITileServerWellKnown {
    map_style_url?: string;
}

export interface IClientWellKnown {
    [key: string]: unknown;
    "m.homeserver"?: IWellKnownConfig;
    "m.identity_server"?: IWellKnownConfig;
    "m.tile_server"?: ITileServerWellKnown;
}

export interface IWellKnownConfig<T = IClientWellKnown> {
    raw?: T;
    action?: AutoDiscoveryAction;
    reason?: string;
    error?: Error | string;
    base_url?: string | null;
    /** Undocumented field. */
    server_name?: string;
}
