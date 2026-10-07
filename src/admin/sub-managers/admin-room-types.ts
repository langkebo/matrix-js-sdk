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

// ===== Room operation payloads =====

export interface AdminReasonPayload {
    reason?: string;
}

export interface AdminBanKickPayload {
    user_id?: string;
    reason?: string;
}

export interface AdminMakeRoomAdminPayload {
    user_id?: string;
}

export interface RoomSearchPayload {
    search_term?: string;
    limit?: number;
    order_by?: string;
    from?: number;
    direction?: "f" | "b";
    [key: string]: unknown;
}

export interface RoomDeletePayload {
    block?: boolean;
    purge?: boolean;
    force_purge?: boolean;
    reason?: string;
    [key: string]: unknown;
}

export interface PurgeHistoryPayload {
    purge_up_to_event_id?: string;
    purge_up_to_ts?: number;
    delete_local_events?: boolean;
    [key: string]: unknown;
}

export interface RoomEventSearchPayload {
    search_term?: string;
    filter?: import("../../models/event").IContent;
    limit?: number;
    [key: string]: unknown;
}

/**
 * 请求体：`POST /_matrix/client/v3/admin/room/{room_id}/redact`（后端 `admin::room`）。
 *
 * 按 `origin_server_ts` 落在 `(after_ts, before_ts)` 区间内的事件批量撤回，
 * 与 Element Synapse 的同名管理端点一致。全部字段可选，省略即"不限"。
 */
export interface AdminRoomRedactPayload {
    /** 仅撤回 `origin_server_ts < before_ts` 的事件（毫秒时间戳）。 */
    before_ts?: number;
    /** 仅撤回 `origin_server_ts > after_ts` 的事件（毫秒时间戳）。 */
    after_ts?: number;
    /** 单次最多撤回的事件条数，取值 1..10000；后端默认 1000，越界返回 400。 */
    limit?: number;
    /** 写入审计日志的原因。 */
    reason?: string;
    [key: string]: unknown;
}

/** 响应体：`{"redacted": <实际撤回条数>}`。 */
export interface AdminRoomRedactResult {
    redacted: number;
}

// ===== Room info types =====

/**
 * 房间信息
 *
 * 后端**返回两种形状**，字段集不重合（对照 `synapse-web/src/routes/admin/room/mod.rs`，2026-10-07 核对）：
 *
 * - 列表 `GET /_synapse/admin/v1/rooms`（`get_rooms`）的条目：
 *   `room_id` `name` `topic` `creator` `joined_members` `joined_local_members` `is_public`
 * - 详情 `GET /_synapse/admin/v1/rooms/{room_id}`（`get_room`）：
 *   `room_id` `name` `topic` `creator` `member_count` `room_version` `encryption` `is_public`
 *   `join_rule` `tombstoned` `replacement_room`
 *
 * 故除 `room_id` 外一律可选。
 *
 * ⚠️ 键名与"看起来应该叫的名字"不同，此前声明全错：
 * `is_public`（不是 `public`）、`room_version`（不是 `version`）、`join_rule`（不是 `join_rules`）。
 * 原先多出的 `avatar_url` / `invited_members` / `created_ts` / `guest_access` /
 * `history_visibility` / `state_events` 两个端点**都不返回**（房间表里有 `created_ts` /
 * `history_visibility` 列，但处理器没有把它们放进响应）。
 */
export interface RoomInfo {
    room_id: string;
    name?: string;
    topic?: string;
    creator?: string;
    /** 仅列表端点返回 */
    joined_members?: number;
    /** 仅列表端点返回（后端此值与 `joined_members` 相同） */
    joined_local_members?: number;
    /** 仅详情端点返回 */
    member_count?: number;
    /** 仅详情端点返回；后端键名是 `room_version` */
    room_version?: string;
    /** 仅详情端点返回；加密算法名，未加密时为 `null` */
    encryption?: string | null;
    /** 列表与详情都返回；后端键名是 `is_public` */
    is_public?: boolean;
    /** 仅详情端点返回；后端键名是 `join_rule`（单数） */
    join_rule?: string;
    /** 仅详情端点返回 */
    tombstoned?: boolean;
    /** 仅详情端点返回；有墓碑事件时指向替代房间，否则 `null` */
    replacement_room?: string | null;
}

/**
 * `GET /_synapse/admin/v1/rooms/{room_id}/members` 的成员条目
 *
 * 后端只返回这 4 个键（`avatar_url` / `displayname` 可为 `null`）；
 * 此前 `getRoomMembers` 声明成 `AdminAccountDetails[]`，其字段集与真实条目完全不同。
 */
export interface AdminRoomMember {
    user_id: string;
    displayname: string | null;
    avatar_url: string | null;
    membership: string;
}

/** `GET /_synapse/admin/v1/rooms/{room_id}/members` 的响应壳 */
export interface AdminRoomMemberPage {
    members: AdminRoomMember[];
    /** 该房间 join 成员总数（全量，不是本页条数） */
    total: number;
    /** 下一页游标（取本页最后一位用户 id）；`null` 表示末页 */
    next_batch: string | null;
}

/** `GET /_synapse/admin/v1/room_stats` —— **全局概览对象**，不是一个房间数组 */
export interface RoomStatsOverview {
    total_rooms: number;
    encrypted_rooms: number;
    public_rooms: number;
    total_messages: number;
    total_members: number;
    /** 最近 7 天内有事件的房间数 */
    active_rooms: number;
    average_messages_per_room: number;
}

/**
 * `GET /_synapse/admin/v1/room_stats/{room_id}` —— 单房间统计
 *
 * ⚠️ 原先声明的 `name` / `topic` / `avatar_url` / `created_ts` 后端**不返回**；
 * `last_message_ts` 在房间无事件时是 `null`（`MAX(origin_server_ts)` 无行）。
 */
export interface RoomStats {
    room_id: string;
    member_count: number;
    message_count: number;
    last_message_ts: number | null;
    is_encrypted: boolean;
    admin_count: number;
}

/**
 * `GET /_synapse/admin/v1/rooms/{room_id}/state` 的状态事件条目
 *
 * ⚠️ 后端处理器对 5 个键**逐个**写了 `unwrap_or(Value::Null)` 兜底
 * （`room/mod.rs::get_room_state_admin`）：源事件里缺字段时该键就是 `null`，
 * 而不是缺键。故这里全部声明为可空。
 */
export interface RoomStateEvent {
    type: string | null;
    state_key: string | null;
    content: import("../../models/event").IContent | null;
    sender: string | null;
    event_id: string | null;
}

export interface RoomMessage {
    event_id: string;
    type: string;
    content: import("../../models/event").IContent;
    sender: string;
    origin_server_ts: number;
}

/** `GET /rooms/{room_id}/messages` 的响应壳；`next_batch` 为 `null` 表示末页 */
export interface RoomMessagePage {
    chunk: RoomMessage[];
    start: string;
    end: string;
    next_batch: string | null;
}

// ===== Space types =====

/**
 * Space 条目
 *
 * 后端 `admin/room/spaces.rs::get_spaces` / `get_space` 返回
 * `{space_id, room_id, name, topic, creator, created_ts}`。
 * 原先声明的 `child_rooms` / `member_count` 后端**不返回**（子房间数与成员数在
 * `/spaces/{id}/rooms`、`/spaces/{id}/stats` 两个端点里）。
 */
export interface SpaceInfo {
    space_id: string;
    room_id: string;
    name: string | null;
    topic: string | null;
    creator: string | null;
    created_ts: number;
}

/** `GET /_synapse/admin/v1/spaces` 的响应壳 —— 后端返回 `{spaces, total}`，**没有游标** */
export interface SpacePage {
    spaces: SpaceInfo[];
    total: number;
}

/** `GET /_synapse/admin/v1/spaces/{space_id}/stats` */
export interface SpaceStats {
    space_id: string;
    member_count: number;
    child_room_count: number;
}

/**
 * `GET /_synapse/admin/v1/spaces/{space_id}/users`
 *
 * ⚠️ `users` 是 **user id 字符串数组**，不是对象数组（后端直接把 `Vec<String>` 塞进 `json!`）。
 */
export interface SpaceUsersResponse {
    users: string[];
    total: number;
}

/**
 * `GET /_synapse/admin/v1/spaces/{space_id}/rooms`
 *
 * ⚠️ `rooms` 是 **room id 字符串数组**，不是对象数组。
 */
export interface SpaceRoomsResponse {
    rooms: string[];
    total: number;
}

// ===== Room admin response types =====

export interface AdminRoomVersionResponse {
    room_version: string;
    room_id?: string;
}

/**
 * `GET /_synapse/admin/v1/rooms/{room_id}/block`
 *
 * 后端未封锁时只返回 `{block: false}`（**没有 `blocked_at`**），
 * 已封锁时返回 `{block: true, blocked_at: <ts>}`。
 * 原先声明的 `room_id` / `user_id` 后端从不返回。
 */
export interface AdminRoomBlockStatus {
    block: boolean;
    /** 仅在已封锁时出现 */
    blocked_at?: number;
}

// ===== Room event context and search types =====

export interface AdminEventContextEvent {
    event_id: string;
    type: string;
    content: import("../../models/event").IContent;
    sender: string;
    origin_server_ts?: number;
    state_key?: string | null;
    room_id?: string;
}

/**
 * `GET /_synapse/admin/v1/rooms/{room_id}/event_context/{event_id}`
 *
 * 后端（`room/messaging/events.rs::get_event_context_admin`）返回
 * `{event, events_before, events_after, state}`；
 * `state` 目前恒为空数组。原先声明的 `events` 数组与 `start` / `end` **都不存在**。
 */
export interface AdminEventContext {
    /** 目标事件本身 */
    event: AdminEventContextEvent;
    /** 时间上早于目标事件的前后文（最多 5 条） */
    events_before: AdminEventContextEvent[];
    /** 时间上晚于目标事件的前后文（最多 5 条） */
    events_after: AdminEventContextEvent[];
    /** 后端当前恒为 `[]` */
    state: AdminEventContextEvent[];
}

/**
 * `GET /_synapse/admin/v1/rooms/{room_id}/forward_extremities`
 *
 * ⚠️ `forward_extremities` 是**前向极点数（整数）**，不是对象数组。
 * 原先声明成 `AdminForwardExtremity[]`（`{event_id, state_group, depth, received_ts}` 数组）
 * 与真实响应毫无关系。
 */
export interface AdminRoomForwardExtremities {
    room_id: string;
    forward_extremities: number;
}

/** `GET /rooms/{room_id}/token_sync` 的结果条目（18 个键，对照后端 `AdminRoomTokenSyncEntry`） */
export interface AdminTokenSyncEntry {
    user_id: string;
    device_id: string;
    conn_id: string | null;
    list_key: string | null;
    pos: number | null;
    token_created_ts: number | null;
    token_expires_at: number | null;
    /** 缺失时后端回填 0 */
    room_timestamp: number;
    room_updated_ts: number;
    /** 缺失时后端回填 0 */
    bump_stamp: number;
    highlight_count: number;
    notification_count: number;
    is_dm: boolean;
    is_encrypted: boolean;
    is_tombstoned: boolean;
    /** 后端键名是 `invited`，值来自 `is_invited` */
    invited: boolean;
    name: string | null;
    avatar: string | null;
    is_expired: boolean;
}

/** `GET /rooms/{room_id}/token_sync` 的 `summary` 子对象 */
export interface AdminTokenSyncSummary {
    active_token_count: number;
    expired_token_count: number;
    distinct_users: number;
    distinct_devices: number;
}

/**
 * `GET /_synapse/admin/v1/rooms/{room_id}/token_sync`
 *
 * ⚠️ 原先声明的 `{stream_ordering, room_id}` 与真实响应毫无关系：
 * 后端返回的是**分页的 token 列表 + 汇总统计**，没有 `stream_ordering` 这个键。
 */
export interface AdminTokenSync {
    room_id: string;
    results: AdminTokenSyncEntry[];
    total: number;
    next_batch: string | null;
    summary: AdminTokenSyncSummary;
}

/**
 * 全库房间搜索（`GET`/`POST /_synapse/admin/v1/rooms/search`）的结果**条目**
 *
 * 键取自后端存储层 `room/admin.rs::search_all_rooms_admin` 的 `json!`（8 键）。
 * 注意时间戳键是 `creation_ts`（不是 `created_ts`）。
 */
export interface AdminRoomSearchItem {
    room_id: string;
    name: string | null;
    topic: string | null;
    creator: string | null;
    is_public: boolean;
    member_count: number;
    is_encrypted: boolean;
    creation_ts: number;
}

/**
 * 全库房间搜索的响应：`{results, count, total, limit, next_batch}`
 *
 * ⚠️ 原先用同一个 `AdminRoomSearchResult` 同时描述它与房间内消息搜索，二者条目类型不同
 * （这里是房间记录，那里是事件），且字段集也不重合（无 `highlights`，多 `total` / `limit`）。
 */
export interface AdminRoomSearchPage {
    results: AdminRoomSearchItem[];
    count: number;
    /** 命中总数（全量，不是本页条数） */
    total: number;
    /** 后端回显生效的 limit */
    limit: number;
    /** 下一页游标；`null` 表示没有更多 */
    next_batch: string | null;
}

/**
 * 房间内消息搜索（`POST /_synapse/admin/v1/rooms/{room_id}/search`）的响应：`{results, count, room_id}`
 *
 * `results` 是事件（后端在原始事件对象上注入 `room_id`），**没有** `next_batch` / `total` / `highlights`。
 */
export interface AdminRoomEventSearchPage {
    results: AdminEventContextEvent[];
    count: number;
    room_id: string;
}

/**
 * `GET /_synapse/admin/v1/rooms/{room_id}/listings`
 *
 * ⚠️ 后端返回的是**单个房间的目录可见性状态** `{room_id, public, in_directory}`，
 * 不是"公开房间列表"。原先声明的 `{rooms: AdminRoomListing[], total?, next_batch?}`
 * 与真实响应毫无关系（且 `/listings` 不接受分页参数）。
 */
export interface AdminRoomListings {
    room_id: string;
    /** 房间是否公开 */
    public: boolean;
    /** 是否已加入房间目录 */
    in_directory: boolean;
}

// ===== AdminReport types (shared with config manager) =====

/**
 * 事件举报条目
 *
 * 对照后端 `report.rs::report_to_json`（2026-10-07 核对）。原先声明的 `name` / `sender`
 * 后端从不返回，且漏了 `reported_user_id` / `content` / `status`；
 * `id` 在后端是整数（`Path<i64>`），不是字符串。
 */
export interface AdminReport {
    /** 举报 id（整数） */
    id: number;
    room_id: string;
    event_id: string;
    /** 举报人（后端键名 `user_id`，值来自 `reporter_user_id`） */
    user_id: string;
    reported_user_id: string | null;
    reason: string | null;
    /** 举报描述（后端键名 `content`，值来自 `description`） */
    content: string | null;
    status: string;
    score: number;
    received_ts: number;
}

/**
 * `GET /_synapse/admin/v1/reports` 的响应壳
 *
 * ⚠️ 后端返回 `{reports, total}`，**没有 `next_token`**；翻页游标是请求侧的
 * `since_ts` / `since_id`（`from` 后端不读）。
 */
export interface AdminReportPage {
    reports: AdminReport[];
    /** 本页条数（后端 `report_list.len()`） */
    total: number;
}

// ===== Purge history result (shared with server manager) =====

/**
 * `POST /_synapse/admin/v1/purge_history`（及 `POST /rooms/{room_id}/purge_history`）
 * 的响应
 *
 * ⚠️ 后端返回 `{success, deleted_events, dry_run}`，**没有 `purge_id`**。
 * `purge_id` 只出现在另一个端点 `POST /_synapse/admin/v1/purge_room` 的响应里
 * （`{purge_id, success}`）—— 原先的类型把两个端点的字段混在了一起。
 */
export interface AdminPurgeHistoryResult {
    success: boolean;
    /** 被删除（或 dry-run 统计出）的事件数 */
    deleted_events: number;
    /** 后端回显请求里的 `dry_run`（默认 `false`） */
    dry_run: boolean;
}
