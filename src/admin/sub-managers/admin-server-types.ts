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

import type { ServerNotification } from "./admin-notification-manager";

// ===== Server payloads =====

export interface WhoamiResponse {
    user_id: string;
    name?: string;
    is_admin?: boolean;
    role?: string;
}

/**
 * `POST /_synapse/admin/v1/register` 的请求体 —— 后端 `register.rs::RegisterRequest`
 * （无 `deny_unknown_fields`，多传的键被静默忽略）。
 *
 * ⚠️ 2026-10-08 对照后端修正：
 * - 后端**必填**（serde 无 `default` 且非 `Option`）：`nonce` / `username` / `password` /
 *   `admin` / `mac`。原类型把 `nonce` / `admin` 标成可选、且**完全没有 `mac`**
 *   ⇒ 照类型调用必然 422（`missing field mac`）；
 * - 缺 4 个可选字段：`user_type` / `captcha_id` / `captcha_code` / `approval_token`；
 * - 去掉 `[key: string]: unknown`（它让"少传必填字段"在类型上也无提示）。
 *
 * `mac` 是**请求签名**（`Hmac<Sha256>`，小写十六进制），布局由
 * `synapse-services/src/admin_registration_service.rs::update_admin_registration_mac` 固定：
 * `nonce \0 username \0 password \0` +（`admin` ? `admin\0\0\0` : `notadmin`）+（`user_type` 存在时 `\0 user_type`），
 * 密钥是注册共享密钥。注意这**不是**上游 Synapse 的 SHA-1 / 大写十六进制布局。
 */
export interface AdminRegisterRequest {
    nonce: string;
    username: string;
    password: string;
    admin: boolean;
    /** 共享密钥 HMAC（大写十六进制）。 */
    mac: string;
    displayname?: string;
    user_type?: string;
    captcha_id?: string;
    captcha_code?: string;
    approval_token?: string;
}

/**
 * `POST /_synapse/admin/v1/register` 的响应 —— 就是 `routes/admin/register.rs::RegisterResponse`
 * 的 6 个字段。
 *
 * ⚠️ 原先多声明了 `nonce`：nonce 是**请求侧**参数（由
 * `GET /_synapse/admin/v1/register/nonce` 取得、放进请求体），后端从不把它回显到响应里，
 * 读它恒为 `undefined`。
 */
export interface AdminRegisterResult {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    device_id?: string;
    user_id: string;
    home_server?: string;
}

/**
 * `POST /_synapse/admin/v1/purge_history` 的请求体。
 *
 * 2026-10-08 对照后端 `admin/room/management.rs::purge_history`：该处理器是
 * `Json<Value>` + 手工 `body.get("…")`，**只读三个键**（`room_id` / `purge_up_to_ts` /
 * `dry_run`）。原先声明的 `purge_up_to_event_id` 与 `delete_local_events` 后端从不读，
 * 属于**静默忽略**（调用方以为按事件 ID 截断，实际只按时间戳）。
 */
export interface PurgeHistoryRequest {
    room_id: string;
    purge_up_to_ts?: number;
    /** 只统计不删除（后端 `purge_history_before(.., dry_run)`）。 */
    dry_run?: boolean;
}

/**
 * `POST /_synapse/admin/v1/shutdown_room` 的请求体。
 *
 * ⚠️ 2026-10-08 对照后端 `admin/room/mod.rs::shutdown_room`：处理器只读 `room_id`，
 * 随后 `shutdown_room_and_remove_members(room_id)` —— **没有任何 purge / block /
 * message / 改名逻辑**。原先声明的 `purge` / `force_purge` / `block` / `message` /
 * `new_room_name` / `new_room_topic` 全部被静默忽略（"purge 并关房"实际不会 purge）。
 * 需要真 purge 请单独调 `purgeRoomHistory` / `deleteRoom`。
 */
export interface ShutdownRoomRequest {
    room_id: string;
}

// `CleanupRoomsRequest` 的**唯一**声明在 `./admin-cleanup-manager`（`{min_age_ms?}`，
// 与后端 `cleanup_rooms` 实际读取的键一致）。此处曾有一份同名的 `{room_id?, [key]: unknown}`
// 陈旧副本：它与清理管理器里的那份**同名不同形**，让"哪个形状生效"取决于文件遍历顺序
// （见 `scripts/quality/lib/admin-contract.mjs` 的 `typeShapesByFile` 注释）。

// ===== Server info/stats/status types =====

/**
 * `GET /_synapse/admin/v1/statistics` 的响应。
 *
 * 字段逐个对照后端处理器 `synapse-web/src/routes/admin/server.rs::get_statistics`
 * （2026-10-07 核对；此前是照上游 Synapse Python 的形状猜的，`user_count` /
 * `room_count` / `total_nonlocal_users` / `total_room_events` / `server_start_time`
 * 在本后端**根本不存在**，而真实字段缺了一大半）。
 */
export interface ServerStats {
    total_users?: number;
    non_deactivated_user_count?: number;
    non_deactivated_user_count_by_app_service?: Record<string, number>;
    total_rooms?: number;
    daily_active_users?: number;
    monthly_active_users?: number;
    r30_users?: number;
    r30v2_users?: number;
    total_messages?: number;
    daily_messages?: number;
    active_rooms_7d?: number;
    total_members?: number;
    encrypted_rooms?: number;
    average_messages_per_room?: number;
}

/**
 * `GET /_synapse/admin/v1/status` 的响应。
 *
 * 后端 `…::get_status` 返回的就是这三个布尔量；此前声明的
 * `status: "online" | "offline" | "degraded"` / `uptime` / `version` / `timestamp`
 * 是本 SDK **凭空的形状**（上游 Synapse 连 `/_synapse/admin/v1/status` 都没有这个端点）。
 */
export interface ServerStatus {
    db_ok: boolean;
    server_ok: boolean;
    up: boolean;
}

/** `GET /_synapse/admin/v1/health` 的响应 —— 后端 `…::get_health` 返回 `{status, database}`。 */
export interface ServerHealth {
    status: "ok" | "error";
    database: "ok" | "error";
}

/**
 * `GET /_synapse/admin/info` 的响应（`/v1/server` 走同一处理器 `…::get_admin_info`）。
 *
 * 注意这里的 `server_version` 与 `GET /v1/server_version` 的响应不同：后者返回
 * `{server_version, python_version: "Rust", server_name}`（`python_version` 是本后端
 * 为兼容 Synapse 客户端而保留的字段，值恒为字符串 `"Rust"`）。
 */
export interface ServerInfo {
    server_name?: string;
    server_version?: string;
    implementation?: string;
}

/** `GET /_synapse/admin/v1/config` 的响应 —— 后端 `…::get_config` 只返回这 4 个字段。 */
export interface AdminServerConfig {
    server_name: string;
    public_baseurl?: string;
    registration_enabled?: boolean;
    max_upload_size?: number;
}

/** `GET /_synapse/admin/info` 的响应（与 {@link ServerInfo} 同端点、同形状）。 */
export interface AdminInfoResponse {
    server_name: string;
    server_version: string;
    implementation?: string;
}

// `AdminCleanupResponse`（`{cleaned?, cleaned_count?, message?}`）已于 2026-10-07 删除：
// 后端三个 cleanup 端点**从不返回**这三个键（见 `routes/admin/cleanup.rs`），
// 它是由"未核对后端就写类型"留下的虚构形状。正确类型见
// `./admin-cleanup-manager.ts` 的 CleanupAllResponse / CleanupRoomsResponse / CleanupTokensResponse。

// ===== Notification types =====

/**
 * 已投递的 server notice
 *
 * 键取自后端 `server_notification/repository.rs::get_server_notices_paginated` 的
 * 内联 `json!`（5 键）。⚠️ 原先漏了 `id`（表格主键，删除/查详情都要用）。
 */
export interface ServerNotice {
    id: number;
    event_id: string;
    user_id: string;
    content: string;
    /** 投递时间（毫秒） */
    sent_ts: number;
}

/**
 * `GET /_synapse/admin/v1/server_notices` 的响应
 *
 * 后端返回 `{notices, total, next_batch}`；⚠️ 没有 `next_token`（原声明读它，恒为 `undefined`）。
 */
export interface ServerNoticePage {
    notices: ServerNotice[];
    /** 全量条数 */
    total: number;
    next_batch: string | null;
}

/**
 * `POST /_synapse/admin/v1/send_server_notice` 的响应
 *
 * ⚠️ 后端返回 3 个键；原声明只声明了 `event_id`。
 */
export interface SendServerNoticeResult {
    event_id: string;
    room_id: string;
    notice_id: number;
}

// `SystemNotificationInfo`（`{notification_id, content, type, target_users, created_ts}`）
// 已于 2026-10-08 删除：它声明的是"系统通知"的**自造**形状，而后端
// `POST/GET/PUT /_synapse/admin/v1/notifications...` 返回的就是
// `synapse-storage/src/server_notification/models.rs::ServerNotification`（16 个字段）。
// 五个键里只有 `created_ts` 真实存在，`notification_id` 的真名是 `id`。
// 正确的类型是 `admin-notification-manager.ts` 里的 **`ServerNotification`**。

/**
 * `GET /_synapse/admin/v1/notifications` 的响应（`{notifications, next_batch}`）。
 *
 * 游标键是 **`next_batch`**（原先声明 `next_token`，恒 `undefined`）；
 * 元素类型是 {@link ServerNotification}。
 *
 * ⚠️ 与 `admin-notification-manager.ts` 的 `NotificationsListResponse` 形状相同 ——
 * 两个 Manager 覆盖了同一批端点（见该文件头注释），合并属公开 API 决策，暂不动。
 */
export interface SystemNotificationPage {
    notifications: ServerNotification[];
    next_batch?: string | null;
}

// ===== Server operation result types =====

/**
 * `POST /_synapse/admin/v1/shutdown_room` 的响应。
 *
 * 2026-10-07 对照后端 `room/mod.rs::shutdown_room`：
 * `{closed_room, kicked_users, failed_to_kick_users}` —— 原先声明里的
 * `local_aliases` / `new_room_id` 后端**从不返回**（那是上游 Synapse 的字段），
 * 而真实的 `closed_room` 缺失。
 */
export interface AdminShutdownRoomResult {
    closed_room: boolean;
    kicked_users?: string[];
    failed_to_kick_users?: string[];
}

export interface AdminBackupInfo {
    backup_id: string;
    room_id?: string;
    session_count?: number;
    key_count?: number;
    created_ts?: number;
    version?: string;
}

export interface AdminBackupPage {
    backups: AdminBackupInfo[];
    total: number;
    total_keys: number;
    limit: number;
    offset: number;
}

/**
 * `GET /_synapse/admin/v1/experimental_features` 的响应。
 *
 * 后端 `…::get_experimental_features` 返回的是 **flagKey → 是否生效** 的映射对象
 * （`{features: {...}, total: n}`），而不是两个字符串数组；`total_flags` 不存在。
 */
export interface AdminExperimentalFeatures {
    features: Record<string, boolean>;
    total: number;
}

// ===== Restart / purge server types =====

/**
 * `POST /_synapse/admin/v1/restart` 的请求体。
 *
 * 2026-10-08 对照后端 `admin/server.rs::restart_server`：唯一被读的键是 `timeout_ms`
 * （毫秒，默认 100，后端上限 10 000），其余键一律忽略。原先只有一个索引签名
 * （`[key: string]: unknown`）—— 等于"任何键都合法"，而真实键集就这一个。
 */
export interface RestartServerPayload {
    timeout_ms?: number;
}

/** Response for POST /restart — restart server result */
/**
 * `POST /_synapse/admin/v1/restart` 的响应。
 *
 * 2026-10-07 对照后端 `server.rs::restart_server`：`{message, restart_pending}` ——
 * 原先只有一个索引签名，两个真实字段都没声明。
 */
export interface RestartServerResponse {
    message: string;
    restart_pending: boolean;
}

/**
 * `POST /_synapse/admin/v1/purge_room` 的响应。
 *
 * ⚠️ 与 `purgeRoomHistory` 的 `{success, deleted_events, dry_run}` 是**两个不同端点**：
 * 这里的 `purge_id` 只由本端点返回。原先两者曾共用一个类型（互相污染）。
 */
export interface PurgeRoomResponse {
    purge_id: string;
    success: boolean;
}

// ===== Security / IP types =====

export interface SecurityEvent {
    event_id?: string;
    event_type?: string;
    user_id?: string;
    ts?: number;
}

export interface SecurityEventPage {
    events: SecurityEvent[];
    next_token?: string;
}

export interface IpBlock {
    ip: string;
    cidr?: number;
    reason?: string;
    expire_at?: number;
}

export interface ServerLogEntry {
    level: string;
    ts: number;
    message: string;
}

// ===== Media quota/change types (used by media manager) =====

/** Response for GET /media/quota — media storage quota info */
export interface MediaQuotaResponse {
    total_size: number;
    total_count: number;
    default_size_limit: number;
    default_count_limit: number;
}

/**
 * Response item for `GET /quarantine_media/{media_id}/changes` — single quarantine change record.
 *
 * 字段与后端处理器 `synapse-web/src/routes/admin/media.rs::get_media_quarantine_changes`
 * 逐条对齐（2026-10-07）。此前声明的 `action` / `changed_ts` / `reason` 后端**都不返回**
 * （真实键是 `change_type` / `created_ts`，且没有 `reason`），而 `stream_id` / `server_name`
 * 被漏掉了。
 */
export interface MediaQuarantineChange {
    /** 单调递增的流位置；可用作下一次请求的 `since` */
    stream_id: number;
    /** The media ID the change applies to */
    media_id: string;
    /** 媒体所属服务器名 */
    server_name: string;
    /** The quarantine action taken: `"quarantine"` or `"unquarantine"` */
    change_type: "quarantine" | "unquarantine";
    /** The user who performed the change */
    changed_by: string;
    /** Timestamp (in milliseconds) when the change occurred */
    created_ts: number;
}

/**
 * Response for `GET /quarantine_media/{media_id}/changes` — quarantine change history.
 *
 * ⚠️ 顶层**没有** `media_id`（由请求路径决定）、也**没有**游标 —— 后端只返回 `{changes, total}`；
 * 翻页需把最后一条的 `stream_id` 作为下一次请求的 `since`。
 */
export interface MediaQuarantineChangesResponse {
    /** List of quarantine change records */
    changes: MediaQuarantineChange[];
    /** Number of records in this response (后端 `total` = `changes.len()`) */
    total: number;
}
