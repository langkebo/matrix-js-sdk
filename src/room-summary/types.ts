/*
Copyright 2024 The Matrix.org Foundation C.I.C.

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
 * Room Summary 类型定义
 *
 * 所有 Room Summary 相关的接口和类型集中定义在此文件，
 * 供 index.ts 和 sub-managers/ 共同引用，避免循环依赖。
 */

export interface RoomSummaryHero {
    user_id: string;
    display_name?: string;
    avatar_url?: string;
}

export interface RoomSummaryMember {
    user_id: string;
    display_name?: string;
    avatar_url?: string;
    membership: string;
    is_hero: boolean;
}

export interface RoomSummary {
    room_id: string;
    room_type?: string;
    name?: string;
    topic?: string;
    avatar_url?: string;
    canonical_alias?: string;
    join_rule: string;
    history_visibility: string;
    guest_access: string;
    is_direct: boolean;
    is_space: boolean;
    is_encrypted: boolean;
    member_count: number;
    joined_member_count: number;
    invited_member_count: number;
    heroes: RoomSummaryHero[];
    last_event_ts?: number;
    last_message_ts?: number;
}

export interface RoomSummaryOptions {
    limit?: number;
    maxJoinedMembers?: number;
    suggested?: boolean;
    includeAllFields?: boolean;
}

export interface RoomStats {
    room_id: string;
    total_events: number;
    total_state_events: number;
    total_messages: number;
    total_media: number;
    storage_size: number;
}

/** Result of recalculating summary heroes */
export interface HeroesRecalcResult {
    room_id: string;
    heroes?: string[];
    joined_member_count?: number;
    invited_member_count?: number;
    [key: string]: unknown;
}

/** Result of clearing summary unread counts */
export interface UnreadClearResult {
    room_id: string;
    cleared: boolean;
    [key: string]: unknown;
}

/** Room summary state event content — structure varies by event type */
export type RoomSummaryStateContent = import("../models/event").IContent;

export interface ClientRoomSummary {
    room_id: string;
    room_type?: string;
    name?: string;
    topic?: string;
    avatar_url?: string;
    canonical_alias?: string;
    join_rule?: string;
    history_visibility?: string;
    guest_access?: string;
    is_direct?: boolean;
    is_space?: boolean;
    is_encrypted?: boolean;
    num_joined_members?: number;
    heroes?: Array<string | { user_id: string; display_name?: string; avatar_url?: string }>;
    last_event_ts?: number;
    last_message_ts?: number;
}

export interface IRoomSummaryState {
    event_type: string;
    state_key: string;
    event_id: string;
    content: import("../models/event").IContent;
}

export interface RoomSummaryListResponse {
    summaries?: RoomSummary[];
    rooms?: RoomSummary[];
    chunk?: RoomSummary[];
    next_batch?: string;
}

export type RawRoomSummaryListResponse = RoomSummaryListResponse | RoomSummary[];

// ─────────────────────────────────────────────────────────────────────────────
// v3 扩展房间端点类型定义
// ─────────────────────────────────────────────────────────────────────────────

export interface NotificationItem {
    room_id: string;
    event_id: string;
    notification_type: string;
    sender: string;
    ts: number;
    content: import("../models/event").IContent;
    is_read: boolean;
    client_action: string;
    type?: string;
    timestamp?: number;
    read?: boolean;
    highlight?: boolean;
}

export interface RoomNotificationsResult {
    notifications: NotificationItem[];
    next_token?: string | null;
    next_batch?: string | null;
}

export interface RoomCapabilities {
    room_id: string;
    room_version: string;
    capabilities: {
        knock: boolean;
        restricted: boolean;
        threading: boolean;
        read_receipts: boolean;
        typing_notifications: boolean;
    };
    features: {
        encryption: boolean;
        federation: boolean;
        guest_access: boolean;
    };
    join_rule: string;
}

/** Room state in sync response: event_type → state_key → event content */
export type RoomSyncState = Record<string, Record<string, import("../models/event").IContent>>;

export interface RoomSyncResult {
    room_id: string;
    state?: RoomSyncState;
    timeline?: {
        events: unknown[];
        limited?: boolean;
        prev_batch?: string;
    };
    ephemeral?: {
        events: unknown[];
    };
    account_data?: {
        events: unknown[];
    };
}

export interface TimelineResult {
    chunk: unknown[];
    start: string;
    end: string;
    prev_batch?: string;
}

export interface UnreadCountResult {
    notification_count: number;
    highlight_count: number;
    room_id?: string;
    unread_notifications?: number;
    unread_highlight_count?: number;
    unread_thread_messages?: number;
}

export interface RoomMetadata {
    room_id: string;
    name?: string;
    topic?: string;
    avatar_url?: string;
    canonical_alias?: string;
    room_version?: string;
    is_direct?: boolean;
    is_space?: boolean;
    is_encrypted?: boolean;
    encryption?: string;
    is_public?: boolean;
    join_rule?: string;
    guest_access?: string;
    history_visibility?: string;
    member_count?: number;
    created_at?: number;
    created_ts?: number;
    creator?: string;
}

export interface RetentionPolicy {
    min_lifetime?: number;
    max_lifetime?: number;
}

/** GET /_matrix/client/v3/rooms/{room_id}/permissions */
export interface RoomPermissionsResult {
    /** The room ID */
    room_id: string;
    /** The user's power level in the room */
    power_level?: number;
    /** Whether the user can send events */
    can_send?: boolean;
    /** Whether the user can invite */
    can_invite?: boolean;
    /** Whether the user can kick */
    can_kick?: boolean;
    /** Whether the user can ban */
    can_ban?: boolean;
    /** Whether the user can redact */
    can_redact?: boolean;
    /** Per-event-type permission map: event_type → minimum power level */
    events?: Record<string, number>;
    /** The effective users_default power level */
    users_default?: number;
    /** The effective state_default power level */
    state_default?: number;
    /** The effective events_default power level */
    events_default?: number;
    /** The effective ban power level */
    ban?: number;
    /** The effective invite power level */
    invite?: number;
    /** The effective kick power level */
    kick?: number;
    /** The effective redact power level */
    redact?: number;
}

/** GET /_matrix/client/v3/rooms/{room_id}/resolve — resolve a room alias/ID to canonical info */
export interface RoomResolveResult {
    /** The resolved room ID */
    room_id: string;
    /** The canonical alias, if set */
    canonical_alias?: string;
    /** Alternative aliases for the room */
    aliases?: string[];
    /** The server names that can be used to resolve the room */
    servers?: string[];
    /** Whether the resolution was successful */
    resolved?: boolean;
}

/** GET /_matrix/client/v3/rooms/{room_id}/message_queue */
export interface RoomMessageQueueResult {
    /** Queued message events */
    events?: unknown[];
    /** Pagination token for the next batch */
    next_batch?: string | null;
    /** Total number of queued events */
    total?: number;
}

/** GET /_matrix/client/v3/rooms/{room_id}/service_types */
export interface RoomServiceTypesResult {
    /** Available service types for the room */
    service_types: string[];
}

/** GET /_matrix/client/v3/rooms/{room_id}/reduced_events */
export interface RoomReducedEventsResult {
    /** Reduced/sampled events */
    events: unknown[];
    /** Total number of events before reduction */
    total?: number;
}

/** GET /_matrix/client/v3/rooms/{room_id}/rendered/ */
export interface RoomRenderedResult {
    /** The room ID */
    room_id?: string;
    /** Rendered HTML content of the room */
    html?: string;
    /** Plain-text fallback */
    plain_text?: string;
    /** Whether rendering was successful */
    rendered?: boolean;
    /** Rendered events */
    events?: Array<{
        event_id: string;
        rendered_content?: string;
    }>;
}

/** GET /_matrix/client/v3/rooms/{room_id}/fragments/{user_id} */
export interface RoomFragmentsResult {
    /** The room ID */
    room_id: string;
    /** The user ID whose fragments were requested */
    user_id: string;
    /** Event fragments / gaps in the user's timeline */
    fragments?: Array<{
        start: string;
        end: string;
        /** Whether this fragment is limited (has a gap) */
        limited?: boolean;
    }>;
    /** Pagination token for earlier fragments */
    prev_batch?: string;
    /** Pagination token for later fragments */
    next_batch?: string;
}

/** GET /_matrix/client/v3/rooms/{room_id}/device/{device_id} */
export interface RoomDeviceResult {
    /** The device ID */
    device_id: string;
    /** The user ID that owns the device */
    user_id?: string;
    /** Display name of the device */
    display_name?: string;
    /** Identity keys: key_id → key value */
    keys?: Record<string, string>;
    /** Supported algorithms */
    algorithms?: string[];
    /** Trust level of the device */
    trust_level?: "verified" | "cross_signed" | "unverified" | "unknown";
    /** Whether the device has been verified */
    is_verified?: boolean;
    /** Last seen timestamp */
    last_seen_ts?: number;
    /** Last seen IP address */
    last_seen_ip?: string;
}

/** GET /_matrix/client/v3/rooms/{room_id}/event/{event_id}/url */
export interface RoomEventUrlResult {
    /** The media URL for the event's attachment */
    url?: string;
    /** The MXC URI for the media */
    mxc?: string;
    /** MIME type of the media */
    content_type?: string;
    /** File size in bytes */
    filesize?: number;
    /** Thumbnail URL, if available */
    thumbnail_url?: string;
}

export interface RoomTranslateResult {
    /** The room ID */
    room_id: string;
    /** The event ID */
    event_id: string;
    /** The original text from the event body */
    source_text: string;
    /** The translated text */
    translated_text: string;
    /** Auto-detected source language (if detected by the provider) */
    detected_source_lang?: string;
    /** The target language used for translation */
    target_lang: string;
    /** The translation provider that handled the request (e.g. "google", "deepl", "libretranslate", "passthrough") */
    provider: string;
}

export interface TranslateResult {
    source_text: string;
    translated_text: string;
    detected_source_lang?: string;
    target_lang: string;
    provider: string;
}

/** POST /_matrix/client/v3/rooms/{room_id}/convert/{event_id} */
export interface RoomConvertResult {
    /** The room ID */
    room_id?: string;
    /** The source event ID */
    event_id?: string;
    /** The converted content type (e.g. "markdown", "html", "pdf") */
    output_format?: string;
    /** The converted content */
    converted_content?: string;
    /** The MIME type of the converted content */
    content_type?: string;
    /** The conversion provider (e.g. "pandoc", "weasyprint") */
    provider?: string;
    /** Whether the conversion was successful */
    converted?: boolean;
}

/** PUT /_matrix/client/v3/rooms/{room_id}/sign/{event_id} */
export interface RoomSignResult {
    /** The room ID */
    room_id?: string;
    /** The signed event ID */
    event_id?: string;
    /** Signatures added to the event: user_id → key_id → signature */
    signatures?: Record<string, Record<string, string>>;
    /** Whether the signing was successful */
    signed?: boolean;
    /** Whether the operation succeeded (alias for signed) */
    success?: boolean;
}

/** POST /_matrix/client/v3/rooms/{room_id}/verify/{event_id} */
export interface RoomVerifyResult {
    /** The room ID */
    room_id?: string;
    /** The verified event ID */
    event_id?: string;
    /** Whether the event's signatures are valid */
    valid?: boolean;
    /** Whether the verification succeeded */
    verified?: boolean;
    /** Verification details per signer: user_id → key_id → { valid, reason? } */
    verification_results?: Record<string, Record<string, { valid: boolean; reason?: string }>>;
}

/**
 * GET/PUT /_matrix/client/v3/rooms/{room_id}/account_data/{type}
 *
 * Room account data content varies by event type. Common fields are listed
 * below; additional fields depend on the specific account data type.
 */
export interface RoomAccountDataResult {
    /** The event type of the account data */
    type?: string;
    /** The account data content (varies by type) */
    content?: import("../models/event").IContent;
    // Common convenience fields that appear in various account data types:
    /** Whether a feature is enabled (used by flag-type account data) */
    enabled?: boolean;
    /** Whether the operation succeeded */
    ok?: boolean;
    /** Default power level for users (m.room.power_levels) */
    users_default?: number;
    /** Default power level for events (m.room.power_levels) */
    events_default?: number;
    /** Default power level for state events (m.room.power_levels) */
    state_default?: number;
    /** Power level required to ban (m.room.power_levels) */
    ban?: number;
    /** Power level required to invite (m.room.power_levels) */
    invite?: number;
    /** Power level required to kick (m.room.power_levels) */
    kick?: number;
    /** Power level required to redact (m.room.power_levels) */
    redact?: number;
    /** Per-user power levels (m.room.power_levels) */
    users?: Record<string, number>;
    /** Per-event-type power levels (m.room.power_levels) */
    events?: Record<string, number>;
    /** Notification power levels (m.room.power_levels) */
    notifications?: Partial<Record<"room", number>>;
}

/** GET /_matrix/client/v3/rooms/{room_id}/invites */
export interface RoomInvitesResult {
    /** The room ID */
    room_id: string;
    /** Pending invite events */
    invites?: Array<{
        /** The invited user ID */
        user_id: string;
        /** Display name of the invited user */
        display_name?: string;
        /** Avatar URL of the invited user */
        avatar_url?: string;
        /** The event ID of the invite */
        event_id?: string;
        /** Timestamp of the invite */
        origin_server_ts?: number;
        /** The sender of the invite */
        sender?: string;
        /** Membership state (typically "invite") */
        membership?: string;
    }>;
    /** Total number of pending invites */
    total?: number;
}

/** POST /_matrix/client/v3/rooms/{room_id}/keys/claim */
export interface RoomKeyClaimResult {
    /** Claimed one-time keys: user_id → device_id → key_id → key data */
    one_time_keys: Record<string, Record<string, Record<string, Record<string, string>>>>;
    /** Map of request_id → error object for failed claims */
    failures: Record<string, { error?: string; message?: string }>;
}

/** GET /_matrix/client/v3/rooms/{room_id}/keys/count */
export interface RoomKeyCountResult {
    /** Total key count */
    count?: number;
    /** One-time key counts: algorithm → count */
    one_time_key_counts?: Record<string, number>;
    /** Whether unused fallback keys exist per algorithm */
    unused_fallback_key_types?: string[];
}

/** Key backup version auth data — structure varies by algorithm */
export interface KeyBackupAuthData {
    /** The backup algorithm (e.g. "m.megolm_backup.v1.curve25519-aes-sha2") */
    algorithm?: string;
    /** Public key used for backup verification */
    public_key?: string;
    /** Signatures on the auth data */
    signatures?: Record<string, Record<string, string>>;
    /** Additional algorithm-specific auth data */
    [key: string]: unknown;
}

/** GET /_matrix/client/v3/rooms/{room_id}/keys/version */
export interface RoomKeysVersionResult {
    /** The backup version */
    version: string;
    /** The backup algorithm */
    algorithm?: string;
    /** Algorithm-specific auth data */
    auth_data?: KeyBackupAuthData;
    /** Number of sessions backed up */
    count?: number;
    /** ETag for the backup */
    etag?: string;
    /** Hash of the backup data */
    hash?: string;
    /** Signatures on the backup */
    signatures?: Record<string, Record<string, string>>;
}

/** GET /_matrix/client/v3/rooms/{room_id}/members/recent */
export interface RoomMembersRecentResult {
    /** The room ID */
    room_id: string;
    /** Recently changed member events */
    chunk?: Array<{
        user_id: string;
        display_name?: string;
        avatar_url?: string;
        membership: string;
        /** The event ID of the membership change */
        event_id?: string;
        /** The sender of the membership event */
        sender?: string;
        /** Timestamp of the membership change */
        origin_server_ts?: number;
    }>;
    /** Pagination token for earlier results */
    prev_batch?: string;
    /** Pagination token for later results */
    next_batch?: string;
    /** Total number of recent membership changes */
    total?: number;
}

/** GET /_matrix/client/v3/rooms/{room_id}/receipts/{receiptType}/{eventId} */
export interface RoomReceiptsResult {
    /** The room ID */
    room_id: string;
    /** Receipts grouped by type */
    receipts?: Array<{
        /** The receipt type (e.g. "m.read") */
        type: string;
        /** The event ID the receipt refers to */
        event_id: string;
        /** User receipt data: user_id → receipt info */
        users?: Record<string, {
            /** Timestamp of the receipt */
            ts: number;
            /** Thread receipt, if applicable */
            thread_id?: string;
        }>;
    }>;
}

/** PUT /_matrix/client/v3/rooms/{room_id}/room_keys/keys */
export interface RoomForwardKeysResult {
    /** Number of keys successfully forwarded */
    count?: number;
    /** Map of session_id → error for failed forwards */
    failures?: Record<string, { error?: string; message?: string }>;
}

/** POST /_matrix/client/v3/rooms/{room_id}/search */
export interface RoomSearchResult {
    /** The room ID */
    room_id?: string;
    /** Flat list of search results (simplified response) */
    results?: Array<{
        event_id: string;
        type: string;
        content: import("../models/event").IContent;
        sender: string;
        origin_server_ts: number;
        room_id: string;
        /** Relevance score (0–1) */
        rank?: number;
        /** Context around the result */
        context?: {
            events_before?: unknown[];
            events_after?: unknown[];
            start?: string;
            end?: string;
        };
    }>;
    /** Total number of results */
    count?: number;
    /** Token for the next batch of results */
    next_batch?: string;
    /** Highlight words */
    highlights?: string[];
    /** Full search categories response (Matrix spec format) */
    search_categories?: {
        room_events?: {
            results?: Array<{
                event_id: string;
                type: string;
                content: import("../models/event").IContent;
                sender: string;
                origin_server_ts: number;
                room_id: string;
                rank?: number;
                context?: {
                    events_before?: unknown[];
                    events_after?: unknown[];
                    start?: string;
                    end?: string;
                };
            }>;
            count?: number;
            groups?: Record<string, Record<string, { next_batch?: string; order?: number; results?: string[] }>>;
            next_batch?: string;
            highlights?: string[];
        };
    };
}

export interface ExternalId {
    provider: string;
    external_id: string;
}

export interface RoomSpace {
    room_id: string;
    name?: string;
    canonical_alias?: string;
    avatar_url?: string;
    topic?: string;
}

export interface EventPerspective {
    room_id: string;
    event_id: string;
    content?: import("../models/event").IContent;
    auth_events?: unknown[];
    prev_events?: unknown[];
    depth?: number;
    hashes?: Record<string, string>;
    signatures?: Record<string, Record<string, string>>;
}

export interface EncryptedEventsResult {
    room_id: string;
    events: Array<{
        event_id: string;
        sender: string;
        type: string;
        content: import("../models/event").IContent;
        timestamp: number;
    }>;
    next_batch?: string;
}

/** Event signing key data */
export interface EventKeyData {
    /** The key ID */
    key_id?: string;
    /** The key algorithm */
    algorithm?: string;
    /** The public key value */
    key?: string;
    /** Signatures on this key */
    signatures?: Record<string, Record<string, string>>;
    /** Additional key properties */
    [key: string]: unknown;
}

/**
 * GET /_matrix/client/v3/rooms/{room_id}/keys/{event_id}
 * 获取事件签名密钥
 */
export interface EventKeysResult {
    event_id: string;
    room_id: string;
    keys: EventKeyData[];
}

/**
 * GET /_matrix/client/v3/rooms/{room_id}/thread/{event_id}
 * 获取线程根事件及其回复
 */
export interface ThreadReply {
    event_id: string;
    thread_id: string;
    room_id: string;
    sender: string;
    content: import("../models/event").IContent;
    origin_server_ts: number;
    in_reply_to_event_id?: string | null;
    is_edited: boolean;
    is_redacted: boolean;
}

export interface ThreadRoot {
    event_id: string;
    room_id: string;
    sender: string;
    type: string;
    content: import("../models/event").IContent;
    origin_server_ts: number;
    state_key?: string;
}

export interface RoomThreadResult {
    root: ThreadRoot;
    replies: ThreadReply[];
    reply_count: number;
    participants: string[];
}

export interface RoomThreadDetailRoot {
    id: number;
    room_id: string;
    root_event_id: string;
    sender: string;
    thread_id: string | null;
    reply_count: number;
    last_reply_event_id: string | null;
    last_reply_sender: string | null;
    last_reply_ts: number | null;
    participants: unknown;
    is_fetched: boolean;
    created_ts: number;
    updated_ts: number | null;
}

export interface RoomThreadDetailReply {
    id: number;
    room_id: string;
    thread_id: string;
    event_id: string;
    root_event_id: string;
    sender: string;
    in_reply_to_event_id: string | null;
    content: import("../models/event").IContent;
    origin_server_ts: number;
    is_edited: boolean;
    is_redacted: boolean;
    created_ts: number;
}

export interface RoomThreadSummary {
    id: number;
    room_id: string;
    thread_id: string;
    root_event_id: string;
    root_sender: string;
    root_content: import("../models/event").IContent;
    root_origin_server_ts: number;
    latest_event_id: string | null;
    latest_sender: string | null;
    latest_content: import("../models/event").IContent | null;
    latest_origin_server_ts: number | null;
    reply_count: number;
    participants: unknown;
    is_frozen: boolean;
    created_ts: number;
    updated_ts: number;
}

export interface RoomThreadReadReceipt {
    id: number;
    room_id: string;
    thread_id: string;
    user_id: string;
    last_read_event_id: string | null;
    last_read_ts: number;
    unread_count: number;
    updated_ts: number;
}

export interface RoomThreadSubscription {
    id: number;
    room_id: string;
    thread_id: string;
    user_id: string;
    notification_level: string;
    is_muted: boolean;
    subscribed_ts: number;
    updated_ts: number;
}

export interface RoomThreadDetailResult {
    room_id: string;
    thread_id: string;
    root: RoomThreadDetailRoot;
    replies: RoomThreadDetailReply[];
    reply_count: number;
    participants: string[];
    summary: RoomThreadSummary | null;
    user_receipt: RoomThreadReadReceipt | null;
    user_subscription: RoomThreadSubscription | null;
}

export interface TurnServerConfig {
    uris: string[];
    username?: string;
    password?: string;
    ttl?: number;
}

export interface StickyEvent {
    event_type: string;
    content: import("../models/event").IContent;
    sender?: string;
    ts?: number;
}

export interface InviteBlocklist {
    room_id: string;
    blocked: Array<{
        user_id: string;
        blocked_by: string;
        blocked_at: number;
    }>;
}

export interface InviteAllowlist {
    room_id: string;
    allowed: Array<{
        user_id: string;
        allowed_by: string;
        allowed_at: number;
    }>;
}

/** POST /_synapse/room_summary/v1/summaries/batch — raw batch response */
export interface BatchSummaryResponse {
    rooms?: ClientRoomSummary[];
    total_room_count_estimate?: number;
    next_batch?: string;
}

/** POST /_synapse/room_summary/v1/summaries/batch — batch fetch request body (MSC3266) */
export interface BatchSummaryRequest {
    /** Room IDs to fetch summaries for */
    rooms: string[];
    /** Whether to only return suggested rooms (default: false) */
    is_suggested_only?: boolean;
    /** Alias for is_suggested_only supported by some server implementations */
    suggested_only?: boolean;
}

/** PUT /_matrix/client/v3/rooms/{room_id}/summary — update body */
export interface UpdateSummaryBody {
    name?: string;
    topic?: string;
    avatar_url?: string;
}

/** POST /_matrix/client/v3/rooms/{room_id}/summary/sync — sync result */
export interface SyncSummaryResult extends RoomSummary {}

/** POST /_synapse/room_summary/v1/updates/process — process updates result */
export interface ProcessUpdatesResult {
    processed: number;
}

/** GET /_matrix/client/v3/rooms/{room_id}/vault_data — vault data result */
export interface RoomVaultDataResult {
    room_id: string;
    vault_data: import("../models/event").IContent;
    updated_ts?: number | null;
}
