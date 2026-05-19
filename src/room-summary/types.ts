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

export interface RoomSummaryStateContent extends Record<string, unknown> {}

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
    content: Record<string, unknown>;
}

export interface RoomSummaryListResponse {
    summaries?: RoomSummary[];
    rooms?: RoomSummary[];
    chunk?: RoomSummary[];
    next_batch?: string;
    [key: string]: unknown;
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
    content: Record<string, unknown>;
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
        [key: string]: unknown;
    };
    features: {
        encryption: boolean;
        federation: boolean;
        guest_access: boolean;
        [key: string]: unknown;
    };
    join_rule: string;
}

export interface RoomSyncResult {
    room_id: string;
    state?: Record<string, unknown>;
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

export interface RoomPermissionsResult {
    [key: string]: unknown;
}

export interface RoomResolveResult {
    [key: string]: unknown;
}

export interface RoomMessageQueueResult {
    events?: unknown[];
    next_batch?: string | null;
    [key: string]: unknown;
}

export interface RoomServiceTypesResult {
    service_types: string[];
    [key: string]: unknown;
}

export interface RoomReducedEventsResult {
    events: unknown[];
    total?: number;
    [key: string]: unknown;
}

export interface RoomRenderedResult {
    [key: string]: unknown;
}

export interface RoomFragmentsResult {
    [key: string]: unknown;
}

export interface RoomDeviceResult {
    [key: string]: unknown;
}

export interface RoomEventUrlResult {
    url?: string;
    [key: string]: unknown;
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

export interface RoomConvertResult {
    [key: string]: unknown;
}

export interface RoomSignResult {
    [key: string]: unknown;
}

export interface RoomVerifyResult {
    [key: string]: unknown;
}

export interface RoomAccountDataResult {
    [key: string]: unknown;
}

export interface RoomInvitesResult {
    [key: string]: unknown;
}

export interface RoomKeyClaimResult {
    [key: string]: unknown;
}

export interface RoomKeyCountResult {
    [key: string]: unknown;
}

export interface RoomKeysVersionResult {
    [key: string]: unknown;
}

export interface RoomMembersRecentResult {
    [key: string]: unknown;
}

export interface RoomReceiptsResult {
    [key: string]: unknown;
}

export interface RoomForwardKeysResult {
    [key: string]: unknown;
}

export interface RoomSearchResult {
    [key: string]: unknown;
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
    content?: Record<string, unknown>;
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
        content: Record<string, unknown>;
        timestamp: number;
    }>;
    next_batch?: string;
}

/**
 * GET /_matrix/client/v3/rooms/{room_id}/keys/{event_id}
 * 获取事件签名密钥
 */
export interface EventKeysResult {
    event_id: string;
    room_id: string;
    keys: Array<Record<string, unknown>>;
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
    content: Record<string, unknown>;
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
    content: Record<string, unknown>;
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
    content: Record<string, unknown>;
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
    root_content: Record<string, unknown>;
    root_origin_server_ts: number;
    latest_event_id: string | null;
    latest_sender: string | null;
    latest_content: Record<string, unknown> | null;
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
    content: Record<string, unknown>;
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
