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

/** Dynamic configuration object — structure varies by module/provider */
export type DynamicConfig = Record<string, unknown>; // Dynamic: configuration shape varies by module

// Room operation payloads
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
    filter?: import("../models/event").IContent;
    limit?: number;
    [key: string]: unknown;
}

export interface SpaceStats {
    joined_members: number;
    rooms_count: number;
    [key: string]: unknown;
}

// User payloads
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

// Server payloads
export interface AdminRegisterRequest {
    username: string;
    password: string;
    nonce?: string;
    admin?: boolean;
    displayname?: string;
    [key: string]: unknown;
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

// Config payloads
export interface FeatureFlagUpdatePayload {
    target_scope?: string;
    rollout_percent?: number;
    [key: string]: unknown;
}

export interface AuditEventCreateRequest {
    action: string;
    target_type?: string;
    target_id?: string;
    actor_id?: string;
    resource_type?: string;
    resource_id?: string;
    result?: string;
    request_id?: string;
    details?: import("../models/event").IContent;
    [key: string]: unknown;
}

export interface AccountValidityRequest {
    user_id: string;
    expiration_ts?: number;
    enable_renewal_emails?: boolean;
    [key: string]: unknown;
}

export interface AccountValidityRenewRequest {
    expiration_ts?: number;
    enable_renewal_emails?: boolean;
    [key: string]: unknown;
}

export interface LoginWellKnown {
    /** The homeserver's base URL */
    "m.homeserver"?: { base_url: string };
    /** The identity server's base URL */
    "m.identity_server"?: { base_url: string };
    /** Additional well-known properties */
    [key: string]: unknown;
}

export interface PusherData {
    /** The URL to use for sending push notifications */
    url?: string;
    /** The format of the push notification */
    format?: string;
    /** Additional pusher data fields */
    [key: string]: unknown;
}

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
    content: import("../models/event").IContent;
    sender: string;
    event_id: string;
}

export interface RoomMessage {
    event_id: string;
    type: string;
    content: import("../models/event").IContent;
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
    content: import("../models/event").IContent;
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

/** 单个联邦目的地的详细信息（GET /federation/destinations/{destination}） */
export interface AdminFederationDestinationDetail extends FederationDestination {
    failure_count: number;
    last_successful_ts?: number;
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

export interface AdminRoomVersionResponse {
    room_version: string;
    room_id?: string;
}

export interface AdminRoomBlockStatus {
    block: boolean;
    room_id: string;
    user_id?: string;
}

export interface AdminEventContextEvent {
    event_id: string;
    type: string;
    content: import("../models/event").IContent;
    sender: string;
    origin_server_ts: number;
    state_key?: string;
}

export interface AdminEventContext {
    events: AdminEventContextEvent[];
    state?: AdminEventContextEvent[];
    start?: string;
    end?: string;
}

export interface AdminForwardExtremity {
    event_id: string;
    state_group: number;
    depth: number;
    received_ts: number;
}

export interface AdminTokenSync {
    stream_ordering: number;
    room_id: string;
}

export interface AdminRoomSearchResult {
    results: AdminEventContextEvent[];
    count: number;
    next_batch?: string;
    highlights?: string[];
}

export interface AdminRoomListing {
    room_id: string;
    name?: string;
    alias?: string;
    joined_members?: number;
    public?: boolean;
}

export interface AdminRoomListings {
    rooms: AdminRoomListing[];
    total?: number;
    next_batch?: string;
}

export interface AdminFederationCacheEntry {
    key: string;
    value: Record<string, unknown>; // Dynamic: feature flag value shape varies
    size?: number;
    last_access_ts?: number;
}

export interface AdminFederationCache {
    entries: AdminFederationCacheEntry[];
    total?: number;
}

export interface AdminFederationDestinationRoom {
    room_id: string;
    stream_ordering?: number;
    event_id?: string;
    sent_ts?: number;
}

export interface AdminFederationDestinationRooms {
    rooms: AdminFederationDestinationRoom[];
    total: number;
    next_token?: string;
}

export interface AdminAccountDetails {
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
    erased?: boolean;
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

export interface AdminReport {
    id: string;
    event_id?: string;
    room_id?: string;
    name?: string;
    score?: number;
    reason?: string;
    received_ts?: number;
    user_id?: string;
    sender?: string;
}

export interface AdminReportPage {
    reports: AdminReport[];
    total?: number;
    next_token?: string;
}

export interface AdminModuleInfo {
    module_id: string;
    module_type?: string;
    config?: DynamicConfig;
    is_enabled?: boolean;
    description?: string;
}

export interface AdminModulePage {
    modules: AdminModuleInfo[];
    total?: number;
    next_token?: string;
}

export interface AdminModuleLog {
    log_id: string;
    module_id: string;
    level?: string;
    message?: string;
    ts?: number;
}

export interface AdminModuleLogPage {
    logs: AdminModuleLog[];
    total?: number;
    next_token?: string;
}

export interface AdminAccountValidityInfo {
    user_id: string;
    expiration_ts?: number;
    is_valid?: boolean;
}

export interface AdminPasswordAuthProvider {
    provider_name: string;
    provider_type: string;
    config?: DynamicConfig;
}

export interface AdminPasswordAuthProviderPage {
    providers: AdminPasswordAuthProvider[];
    total?: number;
}

export interface AdminPresenceRoute {
    route_name: string;
    route_type: string;
    config?: DynamicConfig;
}

export interface AdminPresenceRoutePage {
    routes: AdminPresenceRoute[];
    total?: number;
}

export interface AdminMediaCallback {
    callback_name: string;
    callback_type: string;
    url?: string;
    config?: DynamicConfig;
}

export interface AdminMediaCallbackPage {
    callbacks: AdminMediaCallback[];
    total?: number;
}

export interface AdminRateLimitCallback {
    callback_name: string;
    callback_type: string;
    config?: DynamicConfig;
}

export interface AdminRateLimitCallbackPage {
    callbacks: AdminRateLimitCallback[];
    total?: number;
}

export interface AdminAccountDataCallback {
    callback_name: string;
    callback_type: string;
    config?: DynamicConfig;
}

export interface AdminAccountDataCallbackPage {
    callbacks: AdminAccountDataCallback[];
    total?: number;
}

export interface AdminInviteList {
    user_ids: string[];
}

export interface AdminJitsiConfig {
    config?: DynamicConfig;
}

export interface AdminPurgeHistoryResult {
    purge_id: string;
}

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

export interface AdminLogoutResponse {
    device_id?: string;
    [key: string]: unknown;
}

export interface AdminEvictResponse {
    evicted: boolean;
    [key: string]: unknown;
}

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
    details?: import("../models/event").IContent;
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
    data?: PusherData;
}

export interface SpacePage {
    spaces: SpaceInfo[];
    next_batch?: string;
}

export interface SpaceUser {
    user_id: string;
}

export interface SpaceRoom {
    room_id: string;
}

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

export interface PaginatedResponse<T> {
    items: T[];
    nextToken?: string;
    total?: number;
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

/** Response for GET /users/{userId}/notification — user notification setting */
export interface UserNotificationResponse {
    enabled: boolean;
}

/** Payload for PUT /users/{userId}/notification — set user notification setting */
export interface UserNotificationPayload {
    enabled: boolean;
}

// ===== Server operation types =====

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

// ===== Federation resolve/rewrite types =====

/** Response for POST /federation/resolve — federation resolve result */
export interface FederationResolveResponse {
    server_name: string;
    resolved: boolean;
    blacklisted: boolean;
    in_destinations: boolean;
    resolved_by?: string;
}

/** Response for POST /federation/rewrite — federation rewrite result */
export interface FederationRewriteResponse {
    from: string;
    to: string;
    rewritten: boolean;
    rooms_affected: number;
    rewritten_by?: string;
}

// ===== Media quota type =====

/** Response for GET /media/quota — media storage quota info */
export interface MediaQuotaResponse {
    total_size: number;
    total_count: number;
    default_size_limit: number;
    default_count_limit: number;
}

// ===== Module check types =====

/** Payload for POST /modules/check_third_party_rule — third-party rule check request */
export interface ThirdPartyRuleCheckPayload {
    event_id: string;
    room_id: string;
    sender: string;
    event_type: string;
    content: import("../models/event").IContent;
    state_events: import("../models/event").IContent[];
}

/** Response for GET /modules/spam_check/{eventId} — spam check result */
export interface SpamCheckResult {
    id: number;
    event_id: string;
    room_id: string;
    sender: string;
    event_type: string;
    content?: import("../models/event").IContent;
    result: string;
    score: number;
    reason?: string;
    checker_module: string;
    checked_ts: number;
    action_taken?: string;
}

/** Response for GET /modules/third_party_rule/{eventId} — third-party rule result */
export interface ThirdPartyRuleCheckResult {
    allowed?: boolean;
    reason?: string;
    [key: string]: unknown;
}

export interface ThirdPartyRuleResult {
    id: number;
    event_id: string;
    room_id: string;
    sender: string;
    event_type: string;
    rule_name: string;
    allowed: boolean;
    reason?: string;
    modified_content?: import("../models/event").IContent;
    checked_ts: number;
}
