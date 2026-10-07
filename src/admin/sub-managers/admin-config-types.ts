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

/**
 * 审计事件（`GET /_synapse/admin/v1/audit/events/{id}` 与 `POST /audit/events` 的响应）。
 *
 * 2026-10-07 对照后端 `synapse-storage/src/audit.rs::AuditEvent`：时间戳键是
 * **`created_ts`**（原声明写作 `ts` ⇒ 取值恒为 `undefined`）。
 */
export interface AuditEvent {
    event_id: string;
    actor_id: string;
    action: string;
    resource_type: string;
    resource_id: string;
    result: string;
    request_id: string;
    created_ts: number;
    details?: import("../../models/event").IContent;
}

/**
 * `GET /_synapse/admin/v1/audit/events` 的响应。
 *
 * 2026-10-07 对照后端 `audit.rs::list_audit_events`：游标键是 **`next_batch`**，
 * 且它是**字符串**；原先声明的 `next_token: number | null` 两个维度都错
 * （键名不对 + 类型不对），运行时恒为 `undefined`。
 */
export interface AuditEventPage {
    events: AuditEvent[];
    total: number;
    next_batch: string | null;
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

/**
 * `GET /_synapse/admin/v1/feature-flags` 的响应。
 *
 * 后端 `feature_flags.rs::FeatureFlagListResponse` 的游标键是 `next_batch`
 * （原声明漏了它，取值恒为 `undefined`）。
 */
export interface FeatureFlagPage {
    flags: FeatureFlag[];
    total: number;
    next_batch?: string | null;
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

/**
 * 模块（`ModuleResponse`）。
 *
 * 2026-10-07 对照后端 `synapse-web/src/routes/module.rs::ModuleResponse`：原先把主键写成
 * `module_id`（后端**全仓没有这个键**，主键叫 `id`，名字叫 `module_name`），并漏掉了
 * 版本 / 优先级 / 时间戳 / 执行统计等 10 个真实字段。
 */
export interface AdminModuleInfo {
    id: number;
    module_name: string;
    module_type: string;
    version: string;
    description: string | null;
    is_enabled: boolean;
    priority: number;
    config: DynamicConfig | null;
    created_ts: number;
    updated_ts: number;
    last_executed_ts: number | null;
    execution_count: number;
    error_count: number;
    last_error: string | null;
}

/**
 * `GET /_synapse/admin/v1/modules` 的响应。
 *
 * 后端 `get_all_modules` 的游标键是 `next_batch`（不是 `next_token`），且**不返回** `total`。
 * 注意 `GET /modules/type/{module_type}` 返回的是**裸数组** `AdminModuleInfo[]`。
 */
export interface AdminModulePage {
    modules: AdminModuleInfo[];
    next_batch?: string | null;
}

/**
 * 模块执行日志条目。
 *
 * 2026-10-07 对照后端 `synapse-storage/src/module.rs::ModuleExecutionLog`：
 * 原声明（`log_id`/`module_id`/`level`/`message`/`ts`）**五个键后端一个都没有**，
 * 真实键是 `id`/`module_name`/`module_type`/`event_id`/`room_id`/`execution_time_ms`/
 * `is_success`/`error_message`/`metadata`/`executed_ts`。
 *
 * ⚠️ `GET /_synapse/admin/v1/modules/logs/{module_name}` 返回的是**裸数组**
 * （`module_service::get_execution_logs` → `Vec<ModuleExecutionLog>` → `Ok(Json(logs))`），
 * 不存在 `{logs, total, next_token}` 包装对象 —— `AdminModuleLogPage` 已删除。
 */
export interface AdminModuleLog {
    id: number;
    module_name: string;
    module_type: string;
    event_id: string | null;
    room_id: string | null;
    execution_time_ms: number | null;
    is_success: boolean;
    error_message: string | null;
    metadata: DynamicConfig | null;
    executed_ts: number;
}

/**
 * 账户有效期条目。
 *
 * 2026-10-07 对照后端 `routes/module.rs::AccountValidityResponse`：补上原先漏掉的
 * `last_check_at` / `renewal_token` / `created_ts` / `updated_ts` 四个真实字段。
 */
export interface AdminAccountValidityInfo {
    user_id: string;
    expiration_ts: number | null;
    last_check_at: number | null;
    renewal_token: string | null;
    is_valid: boolean;
    created_ts: number;
    updated_ts: number;
}

// ===== Auth/presence/media callback types =====

/**
 * 密码认证提供方。
 *
 * 2026-10-07 对照后端 `routes/module.rs::PasswordAuthProviderResponse`：
 * 原先只有 3 个字段，`id` / `is_enabled` / `priority` / `created_ts` / `updated_ts` 全缺。
 */
export interface AdminPasswordAuthProvider {
    id: number;
    provider_name: string;
    provider_type: string;
    config: DynamicConfig | null;
    is_enabled: boolean;
    priority: number;
    created_ts: number;
    updated_ts: number;
}

// `AdminPasswordAuthProviderPage` 已删除：`GET /_synapse/admin/v1/password_auth_providers`
// 返回的是**裸数组** `PasswordAuthProviderResponse[]`（后端 `Ok(Json(responses))`），
// 不存在 `{providers, total}` 包装对象。

export interface AdminPresenceRoute {
    route_name: string;
    route_type: string;
    config?: DynamicConfig;
}

export interface AdminPresenceRoutePage {
    routes: AdminPresenceRoute[];
    total?: number;
}

/**
 * 媒体回调**任务**记录。
 *
 * 2026-10-07 对照后端 `routes/module.rs::MediaCallbackResponse`：原先把它当成"回调注册项"
 * （`callback_name` / `url` / `config`），而后端返回的是**一次回调调用的执行记录**
 * （`media_id` / `user_id` / `status` / `result` / `completed_ts`）。
 * 两个"列表"端点返回的是**裸数组**，不存在 `{callbacks, total}` 包装对象。
 */
export interface AdminMediaCallback {
    id: number;
    callback_type: string;
    media_id: string;
    user_id: string;
    status: string;
    result: unknown;
    created_ts: number;
    completed_ts: number | null;
    is_enabled: boolean;
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

/**
 * 账户数据回调配置项。
 *
 * 2026-10-07 对照后端 `routes/module.rs::AccountDataCallbackResponse`：
 * 补 `id` / `is_enabled` / `data_types` / `created_ts`；删掉后端从不返回的 `callback_type`。
 * 列表端点返回的是**裸数组**，不存在 `{callbacks, total}` 包装对象。
 */
export interface AdminAccountDataCallback {
    id: number;
    callback_name: string;
    is_enabled: boolean;
    data_types: string[] | null;
    config: DynamicConfig | null;
    created_ts: number;
}

// ===== Invite / Jitsi types =====

/**
 * `GET /_synapse/admin/v1/invite/allowlist` 的响应。
 *
 * 2026-10-07 对照后端 `server.rs::get_invite_allowlist_admin`：
 * `{allowlist, limit, offset, total_count}` —— 列表键是**端点专属**的 `allowlist`；
 * 原先与 blocklist 共用一个 `{user_ids}` 类型，`user_ids` 后端从不返回。
 */
export interface AdminInviteAllowlist {
    allowlist: string[];
    limit: number;
    offset: number;
    total_count: number;
}

/**
 * `GET /_synapse/admin/v1/invite/blocklist` 的响应。
 *
 * 与 allowlist 同构，只有列表键不同（`blocklist`）。
 */
export interface AdminInviteBlocklist {
    blocklist: string[];
    limit: number;
    offset: number;
    total_count: number;
}

/**
 * `GET /_synapse/admin/v1/jitsi/config` 的响应。
 *
 * 2026-10-07 对照后端 `server.rs::get_jitsi_config`：该处理器返回固定字面量
 * `{domain: null, app_id: null, jwt_enabled: false, jwt_asap_enabled: false,
 * jwt_auth_type: "none", server_name: <本服务器名>}` —— 原先声明的 `{config}` 是空的
 * 占位形状，六个真实字段一个都没有。
 */
export interface AdminJitsiConfig {
    domain: string | null;
    app_id: string | null;
    jwt_enabled: boolean;
    jwt_asap_enabled: boolean;
    jwt_auth_type: string;
    server_name: string;
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

/**
 * `POST /_synapse/admin/v1/modules/check_third_party_rule` 的响应。
 *
 * 2026-10-07 对照后端 `synapse-services/src/module_service.rs::ThirdPartyRuleOutput`：
 * 缺 `modified_content`（规则可以改写事件内容，字段名就是它）。
 *
 * 注意与 `GET /modules/third_party_rule/{eventId}` 的 {@link ThirdPartyRuleResult} 不是一回事 ——
 * 后者是"历史结果行"，字段多得多。
 */
export interface ThirdPartyRuleCheckResult {
    /** 序列化名是 `allowed`（Rust 侧字段叫 `is_allowed`） */
    allowed?: boolean;
    reason?: string;
    /** 被规则改写后的内容；未改写时为 `null` */
    modified_content?: DynamicConfig | null;
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
