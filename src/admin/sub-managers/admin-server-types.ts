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

export interface ServerStats {
    total_users?: number;
    total_rooms?: number;
    user_count?: number;
    room_count?: number;
    daily_active_users?: number;
    monthly_active_users?: number;
    total_nonlocal_users?: number;
    total_room_events?: number;
    server_start_time?: number;
    r30_users?: number;
    r30v2_users?: number;
}

export interface ServerStatus {
    status: "online" | "offline" | "degraded";
    uptime?: number;
    version?: string;
    timestamp?: number;
}

export interface ServerHealth {
    healthy: boolean;
    checks?: Record<string, { status: string; message?: string }>;
}

export interface ServerInfo {
    server_name?: string;
    version?: string;
    python_version?: string;
    uptime?: number;
    federation_enabled?: boolean;
    registration_enabled?: boolean;
}

export interface AdminServerConfig {
    server_name: string;
    public_baseurl?: string;
    registration_enabled?: boolean;
    federation_enabled?: boolean;
    default_identity_server?: string;
    [key: string]: unknown;
}

export interface AdminInfoResponse {
    server_version: string;
    python_version: string;
    uptime_seconds?: number;
    total_users?: number;
    total_rooms?: number;
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

export interface AdminExperimentalFeatures {
    enabled: string[];
    disabled: string[];
    total: number;
    total_flags: number;
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

/** Response item for GET /quarantine_media/{media_id}/changes — single quarantine change record */
export interface MediaQuarantineChange {
    /** The media ID the change applies to */
    media_id: string;
    /** The quarantine action taken: "quarantine" or "unquarantine" */
    action: "quarantine" | "unquarantine";
    /** The user who performed the change */
    changed_by?: string;
    /** Timestamp (in milliseconds) when the change occurred */
    changed_ts?: number;
    /** Optional reason for the change */
    reason?: string;
}

/** Response for GET /quarantine_media/{media_id}/changes — quarantine change history */
export interface MediaQuarantineChangesResponse {
    /** The media ID the changes belong to */
    media_id: string;
    /** List of quarantine change records, oldest-first */
    changes: MediaQuarantineChange[];
    /** Total number of change records (may exceed `changes.length` when paginated) */
    total?: number;
    /** Pagination token for the next page, if more results are available */
    next_token?: string;
}
