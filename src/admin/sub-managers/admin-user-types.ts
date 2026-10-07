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

import type { PaginatedResult } from "../../common/pagination";

/**
 * Generic paginated response wrapper used across all admin modules.
 *
 * Re-exported from the shared pagination module so admin endpoints and the
 * rest of the SDK speak one canonical shape (`items` + `next`/`total`/`hasMore`).
 *
 * The legacy alias `PaginatedResponse` is preserved for backward compatibility
 * with existing admin consumers. New code should prefer `PaginatedResult`.
 *
 * @see `buildPaginationParams` in `src/common/pagination.ts`
 */
export type { PaginatedResult, PaginationCursor, PaginatedPage } from "../../common/pagination";

/** @deprecated Use `PaginatedResult` from the shared pagination module instead. */
export type PaginatedResponse<T> = PaginatedResult<T>;

/** Admin API error class */
export class AdminApiError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly statusCode: number,
        public readonly details?: Record<string, unknown>, // Dynamic: error details shape varies
    ) {
        super(message);
        this.name = "AdminApiError";
    }
}

/** Central admin event enum */
export enum AdminEvent {
    UserCreated = "UserCreated",
    UserDeactivated = "UserDeactivated",
    UserShadowBanned = "UserShadowBanned",
    UserUnshadowBanned = "UserUnshadowBanned",
    RoomDeleted = "RoomDeleted",
    RoomBlocked = "RoomBlocked",
    ServerStatsUpdated = "ServerStatsUpdated",
    AdminError = "AdminError",
}

// ===== User payloads =====

export interface AdminToken {
    id: number;
    device_id: string;
    user_id: string;
    name?: string;
    [key: string]: unknown;
}

export interface AdminRefreshToken {
    id: number;
    user_id: string;
    device_id: string;
    token: string;
    [key: string]: unknown;
}

export interface AdminLogoutRequest {
    devices?: string[];
    revoke_all?: boolean;
}

export interface AdminEvictRequest {
    reason?: string;
}

export interface DeactivateUserResponse {
    id_server_unbind_result?: string;
}

// ===== Device and session types =====

/**
 * `GET /_synapse/admin/v1/users/{user_id}/devices` 的设备条目。
 *
 * 后端 `…/admin/user.rs::get_user_devices_admin` 只返回这 4 个键（**没有 `user_id`**）。
 */
export interface DeviceInfo {
    device_id: string;
    display_name?: string;
    last_seen_ip?: string;
    last_seen_ts?: number;
}

export interface UserSession {
    session_id: string;
    device_id?: string;
    last_seen_ts?: number;
    last_seen_ip?: string;
    user_agent?: string;
}

// ===== Account types =====

/**
 * 账号对象 —— 由 `/v2/users`（列表）、`/v2/users/{user_id}`（单项）与
 * `/v1/users`（v2 的 404 回退）共用。
 *
 * 2026-10-07 对照后端源码（`synapse-web/src/routes/admin/user.rs`）核对：
 * - `user_id` **只有 `/v2` 路径返回**；`/v1/users` 回退路径的条目只有 `name`，
 *   所以这里是可选的（该路径下请用 `name`）—— 若要让调用方永远拿到 `user_id`，
 *   应改由 `AdminUserManager` 在回退分支里做 `user_id ?? name` 归一（待办）。
 * - 时间戳键在两个端点间**不一致**：列表用 `creation_ts`、单项用 `created_ts`，故两者都声明。
 * - 原先声明的 `suspended` / `erased` / `last_seen_ts` / `last_seen_ip` 该后端**从不返回**，已删除。
 */
export interface AdminAccountDetails {
    user_id?: string;
    name?: string;
    displayname?: string;
    avatar_url?: string;
    admin?: boolean;
    deactivated?: boolean;
    creation_ts?: number;
    created_ts?: number;
    user_type?: string;
    is_guest?: boolean;
}

/**
 * `GET /_synapse/admin/v1/account/{user_id}` 的响应。
 *
 * 后端 `…::get_account_details` 返回
 * `{name, user_id, displayname, admin, deactivated, creation_ts, device_count, room_count}`；
 * 原先声明的 `exists`（必填）/ `locked` / `suspended` 后端一个都不返回 —— `exists` 在运行时
 * 恒为 `undefined`，而调用方按 `boolean` 用它做判断，属"类型检查通过、运行时错判"。
 */
export interface AccountStatus {
    name?: string;
    user_id: string;
    displayname?: string;
    admin?: boolean;
    deactivated?: boolean;
    creation_ts?: number;
    device_count?: number;
    room_count?: number;
}

/**
 * ⚠️ `GET /users/{user_id}/shadow_ban` **后端未实现**（只注册了 POST / DELETE），
 * 已在 `scripts/quality/path-contract-waivers.json` 豁免台账里登记（category `backend-missing`）。
 * 该类型的形状与 POST/DELETE 的响应（`{is_shadow_banned}`）无关，是一个"超前封装"的占位类型；
 * 待后端补 GET 或产品决定移除该方法时一并处理。
 */
export interface ShadowBanStatus {
    user_id: string;
    banned: boolean;
    banned_at?: number;
}

export interface RateLimitConfig {
    messages_per_second?: number;
    burst_count?: number;
}

// ===== Whois / pusher types =====

export interface WhoisResponse {
    user_id: string;
    devices: Record<
        string,
        {
            sessions: Array<{
                connections: Array<{
                    ip: string;
                    last_seen: number;
                    user_agent: string;
                }>;
            }>;
        }
    >;
}

export interface PusherData {
    /** The URL to use for sending push notifications */
    url?: string;
    /** The format of the push notification */
    format?: string;
    /** Additional pusher data fields */
    [key: string]: unknown;
}

export interface UserPusher {
    pushkey: string;
    app_id: string;
    kind?: string;
    app_display_name?: string;
    device_display_name?: string;
    profile_tag?: string;
    lang?: string;
    data?: PusherData;
}

// ===== Login as user types =====

export interface LoginWellKnown {
    /** The homeserver's base URL */
    "m.homeserver"?: { base_url: string };
    /** The identity server's base URL */
    "m.identity_server"?: { base_url: string };
    /** Additional well-known properties */
    [key: string]: unknown;
}

export interface AdminLoginAsUserRequest {
    type?: string;
    device_id?: string;
    initial_device_display_name?: string;
}

export interface AdminLoginAsUserResponse {
    access_token: string;
    device_id: string;
    user_id: string;
    well_known?: LoginWellKnown;
}

// ===== Batch user operations =====

export interface BatchCreateUsersRequest {
    users: Array<{
        user_id: string;
        password?: string;
        displayname?: string;
        admin?: boolean;
    }>;
}

export interface BatchCreateUsersResponse {
    created: string[];
    errors?: Array<{ user_id: string; error: string }>;
}

export interface BatchDeactivateUsersRequest {
    user_ids: string[];
    erase?: boolean;
}

export interface BatchDeactivateUsersResponse {
    deactivated: string[];
    errors?: Array<{ user_id: string; error: string }>;
}

// ===== Update account types =====

export interface UpdateAccountDetailsRequest {
    displayname?: string;
    avatar_url?: string;
    password?: string;
    suspended?: boolean;
    threepids?: Array<{ medium: string; address: string }>;
    external_ids?: Array<{ auth_provider: string; external_id: string }>;
}

export interface UpdateAccountDetailsResponse {
    updated: boolean;
    [key: string]: unknown;
}

// ===== Logout / evict response types =====

export interface AdminLogoutResponse {
    device_id?: string;
    [key: string]: unknown;
}

export interface AdminEvictResponse {
    evicted: boolean;
    [key: string]: unknown;
}

// ===== User stats types =====

/** Response for GET /users/{userId}/stats — single user statistics */
export interface UserStatsResponse {
    user_id: string;
    rooms_joined: number;
    messages_sent: number;
    last_seen_ts: number | null;
    creation_ts?: number;
    is_admin?: boolean;
    dashboard?: {
        total_rooms: number;
        total_messages: number;
        last_seen: number | null;
    };
}

/** Response for GET /user_stats — aggregated user statistics list */
export interface UserStatsListResponse {
    total_users: number;
    active_users: number;
    admin_users: number;
    deactivated_users: number;
    guest_users: number;
    average_rooms_per_user: number;
    user_registration_enabled: boolean;
}

/** Response for GET /users/{userId}/rooms — user's joined rooms */
export interface UserRoomsResponse {
    rooms: string[];
}

// ===== User notification types =====

/**
 * `GET /users/{userId}/notification` 的响应 —— 用户通知开关
 *
 * ⚠️ 注意 GET 与 PUT 用的是**不同的键**：GET 返回 `{enabled}`，PUT 返回 `{is_enabled}`
 * （后端 `notification.rs` 的两个处理器各写一套）。见 {@link UserNotificationUpdateResponse}。
 */
export interface UserNotificationResponse {
    enabled: boolean;
}

/**
 * `PUT /users/{userId}/notification` 的响应
 *
 * 后端返回 `{is_enabled: <请求值>}`（键名与 GET 的 `enabled` 不一致）。
 */
export interface UserNotificationUpdateResponse {
    is_enabled: boolean;
}

/**
 * Payload for PUT /users/{userId}/notification — set user notification setting
 *
 * ⚠️ 后端 `UserNotificationRequest` 带 `#[serde(deny_unknown_fields)]`，字段名是 `is_enabled`；
 * 本类型保留对调用方更自然的 `enabled`，由 `setUserNotification` 负责映射到线上字段。
 */
export interface UserNotificationPayload {
    enabled: boolean;
}

// ===== Shared media info (used by both user and media managers) =====

/**
 * 媒体条目
 *
 * 字段集合取自后端处理器 `synapse-web/src/routes/admin/media.rs`（2026-10-07 逐条核对）：
 * - `get_all_media` / `get_media_info` 返回 8 个键：
 *   `media_id` `media_type` `upload_name` `created_ts` `last_access_ts` `media_length` `user_id` `quarantined`；
 * - `get_user_media` / `get_room_media` 只返回 5 个：
 *   `media_id` `media_type` `upload_name` `created_ts` `media_length`。
 *
 * 故除 `media_id` 外一律声明为可选。
 *
 * ⚠️ 原先声明的 `quarantined_by`（string）后端**从不返回**；真实的隔离标记是布尔 `quarantined`。
 * 以 `quarantined_by` 判断隔离状态会恒为 `undefined`。
 */
export interface MediaInfo {
    media_id: string;
    media_type?: string;
    upload_name?: string;
    created_ts?: number;
    last_access_ts?: number;
    /** 字节数（后端 `media_length`，来自 `admin_media.size`） */
    media_length?: number;
    /** 上传者 user id（仅 `get_all_media` / `get_media_info` 返回） */
    user_id?: string;
    /** 是否已被隔离（布尔；仅 `get_all_media` / `get_media_info` 返回） */
    quarantined?: boolean;
}

/**
 * 分页媒体列表响应 —— `GET /_synapse/admin/v1/media` 与
 * `GET /_synapse/admin/v1/rooms/{room_id}/media`
 *
 * ⚠️ 后端的分页游标键是 **`next_batch`**（不是 `next_token`）；`next_batch` 为 `null` 表示没有下一页
 * （后端 `AdminMediaPage.next_batch: Option<String>`）。
 * ⚠️ 后端返回的 `total` 实际是 **本页条数**（处理器里写的是 `json!({ "total": media_list.len() })`），
 * **不是全局总数** —— 把它当总数用会得到「总数 == 每页 100」的假象。
 */
export interface MediaPage {
    media: MediaInfo[];
    /** 本页条数（后端语义；非全局总数） */
    total: number;
    /** 下一页游标；`null` 表示已到末页 */
    next_batch: string | null;
}

/**
 * 用户媒体列表响应 —— `GET /_synapse/admin/v1/users/{user_id}/media`
 *
 * ⚠️ 后端处理器**既不读 `limit` / `from`，也不返回游标**，只返回 `{media, total}`；
 * `total` 同样是本页（即全部）条数。
 */
export interface UserMediaList {
    media: MediaInfo[];
    total: number;
}
