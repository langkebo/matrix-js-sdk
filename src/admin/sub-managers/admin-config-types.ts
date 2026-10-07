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

// ===== Config payloads =====

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
    details?: import("../../models/event").IContent;
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

// ===== Retention policy types =====

/**
 * 服务器 / 房间保留策略。
 *
 * 2026-10-07 对照后端 `synapse-web/src/routes/admin/retention.rs` 核对：
 * - 字段名是 **`is_expire_on_clients`**，原先声明的 `expire_on_clients` 后端从不返回
 *   ⇒ 读取恒 `undefined`；而且 `POST` 的请求体带 `#[serde(deny_unknown_fields)]`，
 *   发送 `{expire_on_clients}` 会被**直接 400**。
 * - 后端在三字段全为空时返回 `{max_lifetime: null, min_lifetime: null, is_expire_on_clients: false}`。
 */
export interface RetentionPolicy {
    max_lifetime: number | null;
    min_lifetime: number | null;
    is_expire_on_clients: boolean;
}

export interface RoomRetentionPolicy extends RetentionPolicy {
    room_id: string;
}

/**
 * `POST /_synapse/admin/v1/retention/run` 的响应。
 *
 * 后端有两条分支：
 * - 带 `room_id`：`{started, room_id, events_deleted, status, completed_ts}`；
 * - 不带（全库）：`{started, scope: "all_rooms", events_deleted}`。
 *
 * ⚠️ `scope` 的值是 **`"all_rooms"`**（不是 `"all"`），且它是**只读的响应字段** ——
 * 请求体 `RunRetentionRequest` 只有 `room_id`（`deny_unknown_fields`），
 * 发送 `{scope}` 会被直接 400。
 */
export interface RetentionRunResult {
    started: boolean;
    room_id?: string;
    scope?: string;
    events_deleted?: number;
    status?: string;
    completed_ts?: number;
}

/**
 * `GET /_synapse/admin/v1/retention/status` 的响应。
 *
 * 2026-10-07 对照后端 `retention.rs::get_retention_status` 核对：原先声明的
 * `cleanup_batch_size` / `queue_retention_days` 以及 `last_run` 里的
 * `cleanup_queue_items_processed` / `cleanup_queue_rows_pruned` 后端**都不返回**，已删除。
 */
export interface RetentionStatus {
    server_policy_enabled: boolean;
    rooms_with_custom_policy: number;
    lifecycle_cleanup_enabled: boolean;
    audit_retention_days: number;
    last_run: {
        started_ts: number;
        completed_ts: number;
        duration_ms: number;
        expired_events_deleted: number;
        expired_beacons_deleted: number;
        expired_uploads_deleted: number;
        expired_audit_events_deleted: number;
        failed_tasks: number;
    } | null;
}

// ===== Audit event types =====

export interface AuditEvent {
    event_id: string;
    actor_id: string;
    action: string;
    resource_type: string;
    resource_id: string;
    result: string;
    request_id: string;
    ts: number;
    details?: import("../../models/event").IContent;
}

export interface AuditEventPage {
    events: AuditEvent[];
    total: number;
    next_token: number | null;
}

// ===== Feature flag types =====

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

// ===== Registration token types =====

/**
 * 注册令牌条目。
 *
 * 2026-10-07 对照后端 `synapse-web/src/routes/admin/token.rs` 核对：
 * - 过期字段名是 **`expiry_time`**（不是 `expiry_ts`）—— 后端
 *   `get_registration_tokens` / `create_registration_token` / `get_registration_token` /
 *   `update_registration_token` 四个处理器都返回该键。
 * - `uses_allowed` / `expiry_time` 可为 `null`（后端把 `max_uses == 0` 映射为 `null`）。
 */
export interface RegistrationToken {
    token: string;
    uses_allowed?: number | null;
    pending?: number;
    completed?: number;
    expiry_time?: number | null;
    created_ts?: number;
}

/**
 * `GET /_synapse/admin/v1/registration_tokens` 的响应。
 *
 * 游标键是 **`next_batch`**；原先只返回了数组、把游标丢掉了。
 */
export interface RegistrationTokenPage {
    registration_tokens: RegistrationToken[];
    next_batch?: string | null;
}

/**
 * `POST /_synapse/admin/v1/registration_tokens` 的请求体。
 *
 * 后端 `token.rs::CreateTokenRequest` 带 `#[serde(deny_unknown_fields)]`，
 * 字段仅 `{token, uses_allowed, expiry_time, length}` —— 发送 `expiry_ts` 会被直接 400。
 * `token` 省略时由后端按 `length`（默认 16）随机生成。
 */
export interface RegistrationTokenRequest {
    token?: string;
    uses_allowed?: number | null;
    expiry_time?: number | null;
    length?: number;
}

// ===== Module and account validity types =====

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

// ===== Auth/presence/media callback types =====

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

// ===== Invite / Jitsi types =====

export interface AdminInviteList {
    user_ids: string[];
}

export interface AdminJitsiConfig {
    config?: DynamicConfig;
}

// ===== SAML types =====

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

// ===== Application service types =====

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

// ===== Module check types =====

/** Payload for POST /modules/check_third_party_rule — third-party rule check request */
export interface ThirdPartyRuleCheckPayload {
    event_id: string;
    room_id: string;
    sender: string;
    event_type: string;
    content: import("../../models/event").IContent;
    state_events: import("../../models/event").IContent[];
}

/** Response for GET /modules/spam_check/{eventId} — spam check result */
export interface SpamCheckResult {
    id: number;
    event_id: string;
    room_id: string;
    sender: string;
    event_type: string;
    content?: import("../../models/event").IContent;
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
    modified_content?: import("../../models/event").IContent;
    checked_ts: number;
}
