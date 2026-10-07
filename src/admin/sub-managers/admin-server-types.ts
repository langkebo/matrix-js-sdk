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

// ===== Server payloads =====

export interface WhoamiResponse {
    user_id: string;
    name?: string;
    is_admin?: boolean;
    role?: string;
}

export interface AdminRegisterRequest {
    username: string;
    password: string;
    nonce?: string;
    admin?: boolean;
    displayname?: string;
    [key: string]: unknown;
}

export interface AdminRegisterResult {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    device_id?: string;
    user_id: string;
    home_server?: string;
    nonce?: string;
}

export interface PurgeHistoryRequest {
    room_id?: string;
    purge_up_to_event_id?: string;
    purge_up_to_ts?: number;
    delete_local_events?: boolean;
    [key: string]: unknown;
}

export interface ShutdownRoomRequest {
    room_id: string;
    new_room_name?: string;
    new_room_topic?: string;
    message?: string;
    block?: boolean;
    purge?: boolean;
    force_purge?: boolean;
    [key: string]: unknown;
}

export interface CleanupRoomsRequest {
    room_id?: string;
    [key: string]: unknown;
}

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
    [key: string]: unknown;
}

/** `GET /_synapse/admin/info` 的响应（与 {@link ServerInfo} 同端点、同形状）。 */
export interface AdminInfoResponse {
    server_name: string;
    server_version: string;
    implementation?: string;
    [key: string]: unknown;
}

export interface AdminCleanupResponse {
    cleaned?: number;
    cleaned_count?: number;
    message?: string;
}

// ===== Notification types =====

export interface ServerNotice {
    event_id: string;
    user_id: string;
    content: import("../../models/event").IContent;
    sent_ts: number;
}

export interface SystemNotificationInfo {
    notification_id: string;
    content?: string;
    type?: string;
    target_users?: string[];
    created_ts?: number;
    [key: string]: unknown;
}

export interface SystemNotificationPage {
    notifications: SystemNotificationInfo[];
    next_token?: string;
}

// ===== Server operation result types =====

export interface AdminShutdownRoomResult {
    kicked_users?: string[];
    failed_to_kick_users?: string[];
    local_aliases?: string[];
    new_room_id?: string;
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

/** Payload for POST /restart — restart server options */
export interface RestartServerPayload {
    [key: string]: unknown;
}

/** Response for POST /restart — restart server result */
export interface RestartServerResponse {
    [key: string]: unknown;
}

/** Response for POST /purge_room — purge room result */
export interface PurgeRoomResponse {
    [key: string]: unknown;
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
