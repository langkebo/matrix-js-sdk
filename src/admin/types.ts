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

export interface DeviceInfo {
    device_id: string;
    display_name?: string;
    last_seen_ip?: string;
    last_seen_ts?: number;
    user_id?: string;
}

export interface MediaInfo {
    created_ts?: number;
    last_access_ts?: number;
    media_id: string;
    media_type?: string;
    upload_name?: string;
    quarantined_by?: string;
}

export interface RoomStateEvent {
    type: string;
    state_key: string;
    content: Record<string, unknown>;
    sender: string;
    event_id: string;
}

export interface RoomMessage {
    event_id: string;
    type: string;
    content: Record<string, unknown>;
    sender: string;
    origin_server_ts: number;
}

export interface SpaceInfo {
    space_id: string;
    name?: string;
    room_id: string;
    creator?: string;
    child_rooms?: string[];
    member_count?: number;
}

export interface UserSession {
    session_id: string;
    device_id?: string;
    last_seen_ts?: number;
    last_seen_ip?: string;
    user_agent?: string;
}

export interface UserInfo {
    user_id: string;
    name?: string;
    displayname?: string;
    avatar_url?: string;
    admin?: boolean;
    deactivated?: boolean;
    suspended?: boolean;
    created_ts?: number;
    last_seen_ts?: number;
    last_seen_ip?: string;
    user_type?: string;
    is_guest?: boolean;
}

export interface RoomInfo {
    room_id: string;
    name?: string;
    topic?: string;
    avatar_url?: string;
    creator?: string;
    joined_members?: number;
    joined_local_members?: number;
    invited_members?: number;
    version?: string;
    created_ts?: number;
    join_rules?: string;
    public?: boolean;
    guest_access?: string;
    history_visibility?: string;
    state_events?: number;
}

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

export interface AdminCleanupResponse {
    cleaned?: number;
    cleaned_count?: number;
    message?: string;
}

export interface AccountStatus {
    user_id: string;
    exists: boolean;
    deactivated?: boolean;
    locked?: boolean;
    suspended?: boolean;
}

export interface ServerNotice {
    event_id: string;
    user_id: string;
    content: Record<string, unknown>;
    sent_ts: number;
}

export interface FederationBlacklistEntry {
    server_name: string;
    added_ts?: number;
    reason?: string;
}

export interface ShadowBanStatus {
    user_id: string;
    banned: boolean;
    banned_at?: number;
}

export interface RateLimitConfig {
    messages_per_second?: number;
    burst_count?: number;
}

export interface RegistrationToken {
    token: string;
    uses_allowed?: number;
    pending?: number;
    completed?: number;
    expiry_ts?: number;
    created_ts?: number;
}

export interface FederationDestination {
    destination: string;
    retry_last_ts?: number;
    retry_interval?: number;
    failure_ts?: number;
    last_successful_stream_ordering?: number;
    status?: "pending" | "active" | "rejected";
    updated_ts?: number;
}

export interface FederationAdmissionResult {
    server_name: string;
    status: "active" | "rejected";
    previous_status: string;
    updated_ts: number;
    confirmed_by: string;
}

export interface PendingFederationServer {
    server_name: string;
    failure_count: number;
    last_failed_connect_at?: number;
    last_successful_connect_at?: number;
    status: "pending";
    updated_ts?: number;
}

export interface PendingFederationList {
    servers: PendingFederationServer[];
    total: number;
    limit: number;
    offset: number;
}

export interface RoomStats {
    room_id: string;
    name?: string;
    topic?: string;
    avatar_url?: string;
    member_count?: number;
    message_count?: number;
    last_message_ts?: number;
    is_encrypted?: boolean;
    admin_count?: number;
    created_ts?: number;
}

export interface AdminRegisterResponse {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    device_id: string;
    user_id: string;
    home_server: string;
}

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

export interface RetentionPolicy {
    max_lifetime: number | null;
    min_lifetime: number | null;
    expire_on_clients: boolean;
}

export interface RoomRetentionPolicy extends RetentionPolicy {
    room_id: string;
}

export interface RetentionRunResult {
    started: boolean;
    room_id?: string;
    scope?: string;
    events_deleted?: number;
    status?: string;
    completed_ts?: number;
}

export interface RetentionStatus {
    server_policy_enabled: boolean;
    rooms_with_custom_policy: number;
    lifecycle_cleanup_enabled: boolean;
    cleanup_batch_size: number;
    audit_retention_days: number;
    queue_retention_days: number;
    last_run: {
        started_ts: number;
        completed_ts: number;
        duration_ms: number;
        expired_events_deleted: number;
        expired_beacons_deleted: number;
        expired_uploads_deleted: number;
        expired_audit_events_deleted: number;
        cleanup_queue_items_processed: number;
        cleanup_queue_rows_pruned: number;
        failed_tasks: number;
    } | null;
}

export interface AuditEvent {
    event_id: string;
    actor_id: string;
    action: string;
    resource_type: string;
    resource_id: string;
    result: string;
    request_id: string;
    ts: number;
    details?: Record<string, unknown>;
}

export interface AuditEventPage {
    events: AuditEvent[];
    total: number;
    next_token: number | null;
}

export interface FeatureFlagTarget {
    subject_type: string;
    subject_id: string;
}

export interface FeatureFlag {
    flag_key: string;
    target_scope: string;
    rollout_percent: number;
    expires_at: number | null;
    reason: string;
    status: string;
    created_by: string;
    created_ts: number;
    updated_ts: number;
    targets: FeatureFlagTarget[];
}

export interface FeatureFlagPage {
    flags: FeatureFlag[];
    total: number;
}

export interface SamlMapping {
    name_id: string;
    user_id?: string;
    [key: string]: unknown;
}

export interface SamlMappingPage {
    mappings: SamlMapping[];
    next_token?: string;
}

export interface SamlMetadata {
    entity_id: string;
    sso_url: string;
    slo_url?: string | null;
    certificate?: string | null;
    [key: string]: unknown;
}

export interface ApplicationServiceInfo {
    id: string;
    as_token?: string;
    hs_token?: string;
    url?: string;
    sender_localpart?: string;
    [key: string]: unknown;
}

export interface ApplicationServicePage {
    services: ApplicationServiceInfo[];
    next_token?: string;
}

export interface ApplicationServicePingResult {
    ok: boolean;
    duration_ms?: number;
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

export interface UserPusher {
    pushkey: string;
    app_id: string;
    kind?: string;
    app_display_name?: string;
    device_display_name?: string;
    profile_tag?: string;
    lang?: string;
    data?: Record<string, unknown>;
}

export interface SpacePage {
    spaces: SpaceInfo[];
    next_batch?: string;
}

export interface SpaceUser {
    user_id: string;
    [key: string]: unknown;
}

export interface SpaceRoom {
    room_id: string;
    [key: string]: unknown;
}

export interface SecurityEvent {
    event_id?: string;
    event_type?: string;
    user_id?: string;
    ts?: number;
    [key: string]: unknown;
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
    [key: string]: unknown;
}

export interface ServerLogEntry {
    level: string;
    ts: number;
    message: string;
    [key: string]: unknown;
}

export interface PaginatedResponse<T> {
    items: T[];
    nextToken?: string;
    total?: number;
}

export class AdminApiError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly statusCode: number,
        public readonly details?: Record<string, unknown>,
    ) {
        super(message);
        this.name = "AdminApiError";
    }
}
