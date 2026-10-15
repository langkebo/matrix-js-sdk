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

import { Method } from "../../http-api/method";
import { ValidationError } from "../../errors";
import { UnsupportedAdminInviteEndpointError } from "../../errors";
import { AdminBaseManager, apu, type AdminErrorCallback, type ManagerOpts } from "../admin-base-manager";
import { AdminValidators } from "../validators";
import { buildPaginationParams } from "../utils";
import type {
    RetentionPolicy,
    RoomRetentionPolicy,
    RetentionRunResult,
    RetentionStatus,
    FeatureFlagTarget,
    FeatureFlag,
    FeatureFlagPage,
    RegistrationToken,
    RegistrationTokenPage,
    RegistrationTokenRequest,
    AuditEvent,
    AuditEventPage,
    AdminModuleInfo,
    AdminModulePage,
    AdminModuleLog,
    AdminAccountValidityInfo,
    AdminPasswordAuthProvider,
    AdminMediaCallback,
    AdminAccountDataCallback,
    AdminInviteAllowlist,
    AdminInviteBlocklist,
    AdminJitsiConfig,
    AdminReport,
    AdminReportPage,
    DynamicConfig,
    FeatureFlagUpdatePayload,
    AuditEventCreateRequest,
    AccountValidityRequest,
    AccountValidityRenewRequest,
    CreatePasswordAuthProviderRequest,
    CreateMediaCallbackRequest,
    CreateAccountDataCallbackRequest,
    ThirdPartyRuleCheckPayload,
    ThirdPartyRuleCheckResult,
    SpamCheckResult,
    ThirdPartyRuleResult,
} from "../types";
import type { MatrixClient } from "../../client";

export class AdminConfigManager extends AdminBaseManager {
    constructor(client: MatrixClient, onError?: AdminErrorCallback, opts?: ManagerOpts) {
        super(client, onError, opts);
    }

    // ===== Retention Policy =====

    /**
     * 获取服务器保留策略。
     *
     * @example
     * ```typescript
     * const policy = await adminManager.getRetentionPolicy();
     * console.log(policy.max_lifetime, policy.is_expire_on_clients);
     * ```
     */
    async getRetentionPolicy(): Promise<RetentionPolicy> {
        return await this.adminRequest<RetentionPolicy>(Method.Get, apu("/retention/policy"));
    }

    /**
     * 设置服务器保留策略。
     *
     * ⚠️ 线上字段名是 `is_expire_on_clients`；后端 `RetentionPolicyRequest` 带
     * `#[serde(deny_unknown_fields)]`，发送 `expire_on_clients` 会被直接 400。
     *
     * @example
     * ```typescript
     * const policy = await adminManager.setRetentionPolicy({
     *     max_lifetime: 86_400_000,
     *     is_expire_on_clients: true,
     * });
     * ```
     */
    async setRetentionPolicy(policy: {
        max_lifetime?: number | null;
        min_lifetime?: number | null;
        is_expire_on_clients?: boolean;
    }): Promise<RetentionPolicy> {
        return await this.adminRequest<RetentionPolicy>(Method.Post, apu("/retention/policy"), undefined, policy);
    }

    /**
     * 获取指定房间的保留策略。
     *
     * @example
     * ```typescript
     * const policy = await adminManager.getRoomRetentionPolicy("!room:example.org");
     * console.log(policy.room_id, policy.min_lifetime);
     * ```
     */
    async getRoomRetentionPolicy(roomId: string): Promise<RoomRetentionPolicy> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest<RoomRetentionPolicy>(
            Method.Get,
            apu(`/retention/policy/${encodeURIComponent(roomId)}`),
        );
    }

    /**
     * 设置指定房间的保留策略。
     *
     * ⚠️ 同 {@link setRetentionPolicy}，字段名是 `is_expire_on_clients`。
     *
     * @example
     * ```typescript
     * const policy = await adminManager.setRoomRetentionPolicy("!room:example.org", {
     *     min_lifetime: 3_600_000,
     * });
     * ```
     */
    async setRoomRetentionPolicy(
        roomId: string,
        policy: {
            max_lifetime?: number | null;
            min_lifetime?: number | null;
            is_expire_on_clients?: boolean;
        },
    ): Promise<RoomRetentionPolicy> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest<RoomRetentionPolicy>(
            Method.Post,
            apu(`/retention/policy/${encodeURIComponent(roomId)}`),
            undefined,
            policy,
        );
    }

    /**
     * 触发一次保留期清理。
     *
     * ⚠️ 请求体 `RunRetentionRequest` 只有 `room_id`（且带 `deny_unknown_fields`）——
     * 原先支持的 `{ scope }` 参数会被后端**直接 400**，已移除；
     * 响应里的 `scope`（值恒为 `"all_rooms"`）是只读字段。
     *
     * @example
     * ```typescript
     * await adminManager.runRetention();                    // 全库
     * await adminManager.runRetention({ room_id: "!r:x" }); // 单房间
     * ```
     */
    async runRetention(options?: { room_id?: string }): Promise<RetentionRunResult> {
        return await this.adminRequest<RetentionRunResult>(
            Method.Post,
            apu("/retention/run"),
            undefined,
            options || {},
        );
    }

    /**
     * 获取保留期清理状态汇总。
     *
     * @example
     * ```typescript
     * const status = await adminManager.getRetentionStatus();
     * console.log(status.server_policy_enabled, status.last_run?.expired_events_deleted);
     * ```
     */
    async getRetentionStatus(): Promise<RetentionStatus> {
        return await this.adminRequest<RetentionStatus>(Method.Get, apu("/retention/status"));
    }

    // ===== Feature Flags =====

    /**
     * 列出 feature flag。
     *
     * ⚠️ 2026-10-08 修路径：后端注册的是 `/_synapse/admin/v1/feature-flags`（**连字符**，
     * `feature_flags.rs` 路由表），下划线形态 `feature_flags` 在 derived route table 里
     * 只作为**模块名**出现 —— 旧实现发 `GET /_synapse/admin/v1/feature_flags` 永远 404。
     *
     * @example
     * ```typescript
     * const page = await adminManager.getFeatureFlags();
     * console.log(page.flags.length, page.next_batch);
     * ```
     */
    async getFeatureFlags(): Promise<FeatureFlagPage> {
        return await this.adminRequest<FeatureFlagPage>(Method.Get, apu("/feature-flags"));
    }

    /**
     * 获取单个 feature flag。
     *
     * @param flagKey - flag 键
     * @returns feature flag 详情
     * @throws {ValidationError} `flagKey` 为空时（不会发出请求）
     * @example
     * ```typescript
     * const flag = await client.getAdminManager().config.getFeatureFlag("beta.ui");
     * console.log(flag.status);
     * ```
     */
    async getFeatureFlag(flagKey: string): Promise<FeatureFlag> {
        if (!flagKey) {
            throw new ValidationError("Flag key is required");
        }
        return await this.adminRequest<FeatureFlag>(Method.Get, apu(`/feature-flags/${encodeURIComponent(flagKey)}`));
    }

    /**
     * 创建 feature flag。
     *
     * ⚠️ 2026-10-08 修正三处，旧实现**必然 404**：
     * 1. 方法必须是 `POST`（后端 `create_feature_flag` 挂在 `POST /feature-flags` 上；
     *    `/{flag_key}` 上只有 `GET` 与 `PATCH`，没有 `PUT`）；
     * 2. 路径是**连字符** `/feature-flags`，不是 `/feature_flags`；
     * 3. `flag_key` 在**请求体**里（`CreateFeatureFlagRequest.flag_key`），不在路径上。
     *
     * 想改已存在的 flag 请用 {@link updateFeatureFlag}（`PATCH /feature-flags/{flag_key}`）。
     *
     * @param flagKey - flag 键（写进请求体的 `flag_key`）
     * @param targetScope - 作用域（必填）
     * @param rolloutPercent - 灰度百分比（必填）
     * @param expiresAt - 过期时间（毫秒；`null` 表示永不过期）
     * @param reason - 变更原因（必填）
     * @param targets - 定向目标列表
     * @throws {ValidationError} `flagKey` 为空时（不会发出请求）
     * @example
     * ```typescript
     * const flag = await adminManager.setFeatureFlag("beta.ui", "global", 10, null, "canary", []);
     * console.log(flag.flag_key, flag.status);
     * ```
     */
    async setFeatureFlag(
        flagKey: string,
        targetScope: string,
        rolloutPercent: number,
        expiresAt: number | null,
        reason: string,
        targets: FeatureFlagTarget[],
    ): Promise<FeatureFlag> {
        if (!flagKey) {
            throw new ValidationError("Flag key is required");
        }
        const body: {
            flag_key: string;
            target_scope: string;
            rollout_percent: number;
            expires_at: number | null;
            reason: string;
            targets: FeatureFlagTarget[];
        } = {
            flag_key: flagKey,
            target_scope: targetScope,
            rollout_percent: rolloutPercent,
            expires_at: expiresAt,
            reason: reason,
            targets: targets,
        };
        return await this.adminRequest<FeatureFlag>(Method.Post, apu("/feature-flags"), undefined, body);
    }

    /**
     * 删除 feature flag。
     *
     * ⚠️ **后端没有这个端点**：`synapse-web/src/routes/feature_flags.rs` 只注册
     * `POST|GET /_synapse/admin/v1/feature-flags` 与
     * `GET|PATCH /_synapse/admin/v1/feature-flags/{flag_key}` —— **没有 DELETE**。
     * 因此本方法在真实后端上**必然 404**，属超前封装；已在
     * `scripts/quality/path-contract-waivers.json` 登记（`backend-missing`，带期限）。
     *
     * 想停用一个 flag 请用 {@link updateFeatureFlag}（`PATCH`，`status = "disabled"`）——
     * 语义是"停用但保留审计记录"，与删除不同。
     *
     * 2026-10-08 同时修掉路径拼写：原来写成 `/feature_flags/…`（**下划线**），
     * 后端只有连字符形态；即使后端将来补上 DELETE，下划线路径也依然打不中。
     *
     * @param flagKey - flag 键
     * @throws {ValidationError} `flagKey` 为空时（不会发出请求）
     * @example
     * ```typescript
     * // 后端未实现 ⇒ 会 404；停用请改用：
     * await adminManager.updateFeatureFlag("beta.ui", { status: "disabled", reason: "rollback" });
     * ```
     */
    async deleteFeatureFlag(flagKey: string): Promise<void> {
        if (!flagKey) {
            throw new ValidationError("Flag key is required");
        }
        await this.adminRequest(Method.Delete, apu(`/feature-flags/${encodeURIComponent(flagKey)}`));
    }

    /**
     * 列出 feature flag（支持任意查询参数）。
     *
     * @param options - 附加查询参数（如 `limit` / `from`）
     * @returns feature flag 分页结果
     * @example
     * ```typescript
     * const page = await client.getAdminManager().config.listFeatureFlags({ limit: 50 });
     * console.log(page.flags.length, page.next_batch);
     * ```
     */
    async listFeatureFlags(options?: Record<string, string | number | undefined>): Promise<FeatureFlagPage> {
        const query: Record<string, string> = {};
        if (options) {
            for (const [k, v] of Object.entries(options)) {
                if (v !== undefined && v !== null) query[k] = String(v);
            }
        }
        return await this.adminRequest(Method.Get, apu("/feature-flags"), query);
    }

    /**
     * 更新 feature flag（`PATCH /feature-flags/{flag_key}`）。
     *
     * @param flagId - flag 键
     * @param payload - 待更新字段（如 `status` / `rollout_percent`）
     * @returns 更新后的 feature flag
     * @example
     * ```typescript
     * const flag = await client.getAdminManager().config.updateFeatureFlag("beta.ui", {
     *     status: "disabled",
     *     reason: "rollback",
     * });
     * console.log(flag.status);
     * ```
     */
    async updateFeatureFlag(flagId: string, payload: FeatureFlagUpdatePayload): Promise<FeatureFlag> {
        return await this.adminRequest(Method.Patch, apu(`/feature-flags/${encodeURIComponent(flagId)}`), {}, payload);
    }

    // ===== Modules =====

    /**
     * 列出已注册模块（分页）。
     *
     * @param options - 可选分页参数
     * @param options.limit - 每页条数
     * @param options.from - 游标
     * @returns 模块分页结果
     * @example
     * ```typescript
     * const page = await client.getAdminManager().config.listModules({ limit: 50 });
     * console.log(page.modules.length);
     * ```
     */
    async listModules(options?: { limit?: number; from?: string }): Promise<AdminModulePage> {
        const query: Record<string, string> = {};
        if (options?.limit !== undefined) query.limit = String(options.limit);
        if (options?.from !== undefined) query.from = String(options.from);
        return await this.adminRequest(Method.Get, apu("/modules"), query);
    }

    /**
     * 按类型列出模块。
     *
     * ⚠️ 后端 `module.rs::get_modules_by_type` 返回的是**裸数组**（`Vec<ModuleResponse>`），
     * 不是 `{modules, next_batch}` 包装对象 —— 旧类型声明为 `AdminModulePage` 会让调用方
     * 在 `result.modules.map(...)` 上直接抛 `TypeError`。
     *
     * @example
     * ```typescript
     * const modules = await adminManager.listModulesByType("spam_checker");
     * console.log(modules.map((m) => m.module_name));
     * ```
     */
    async listModulesByType(moduleType: string): Promise<AdminModuleInfo[]> {
        return await this.adminRequest(Method.Get, apu(`/modules/type/${encodeURIComponent(moduleType)}`));
    }

    /**
     * 更新指定模块的配置。
     *
     * @param moduleId - 模块 ID
     * @param config - 新的模块配置
     * @returns 更新后的模块信息
     * @example
     * ```typescript
     * const info = await client.getAdminManager().config.updateModuleConfig("spam_checker", { enabled: true });
     * console.log(info.module_name);
     * ```
     */
    async updateModuleConfig(moduleId: string, config: DynamicConfig): Promise<AdminModuleInfo> {
        return await this.adminRequest(
            Method.Put,
            apu(`/modules/${encodeURIComponent(moduleId)}/config`),
            {},
            { config },
        );
    }

    /**
     * 启用或停用指定模块。
     *
     * @param moduleId - 模块 ID
     * @param isEnabled - `true` 启用，`false` 停用
     * @returns 更新后的模块信息
     * @example
     * ```typescript
     * const info = await client.getAdminManager().config.setModuleEnabled("spam_checker", false);
     * console.log(info.module_name);
     * ```
     */
    async setModuleEnabled(moduleId: string, isEnabled: boolean): Promise<AdminModuleInfo> {
        return await this.adminRequest(
            Method.Post,
            apu(`/modules/${encodeURIComponent(moduleId)}/enable`),
            {},
            { is_enabled: isEnabled },
        );
    }

    /**
     * 取模块执行日志。
     *
     * ⚠️ 后端 `module_service::get_execution_logs` 返回 `Vec<ModuleExecutionLog>`，
     * 处理器直接 `Ok(Json(logs))` —— 响应是**裸数组**，不是 `{logs, total, next_token}`。
     *
     * @param moduleId - 模块名（后端注册的是 `GET /modules/logs/{module_name}`）
     * @param options - 分页参数
     *
     * @example
     * ```typescript
     * const logs = await adminManager.getModuleLogs("spam_checker", { limit: 50 });
     * console.log(logs.filter((l) => !l.is_success).length);
     * ```
     */
    async getModuleLogs(moduleId: string, options?: { limit?: number; from?: number }): Promise<AdminModuleLog[]> {
        const query: Record<string, string> = {};
        if (options?.limit !== undefined) query.limit = String(options.limit);
        if (options?.from !== undefined) query.from = String(options.from);
        // 后端注册的是 `GET /modules/logs/{module_name}`（`logs` 在**前**、
        // module 名在后），旧实现写成 `/modules/{id}/logs` 把两段顺序写反了。
        return await this.adminRequest(Method.Get, apu(`/modules/logs/${encodeURIComponent(moduleId)}`), query);
    }

    /**
     * 校验事件是否符合第三方规则。
     *
     * @param payload - 校验载荷
     * @returns 第三方规则校验结果
     * @example
     * ```typescript
     * const result = await client.getAdminManager().config.checkModuleThirdPartyRule({
     *     event_id: "$abc",
     *     room_id: "!room:example.org",
     *     sender: "@alice:example.org",
     *     event_type: "m.room.message",
     *     content: {},
     *     state_events: [],
     * });
     * console.log(result);
     * ```
     */
    async checkModuleThirdPartyRule(payload: ThirdPartyRuleCheckPayload): Promise<ThirdPartyRuleCheckResult> {
        return await this.adminRequest(Method.Post, apu("/modules/check_third_party_rule"), {}, payload);
    }

    /**
     * 获取指定事件的垃圾检查结果。
     *
     * @param eventId - 事件 ID
     * @returns 垃圾检查结果
     * @example
     * ```typescript
     * const result = await client.getAdminManager().config.getModuleSpamCheckResult("$abc");
     * console.log(result);
     * ```
     */
    async getModuleSpamCheckResult(eventId: string): Promise<SpamCheckResult> {
        return await this.adminRequest(Method.Get, apu(`/modules/spam_check/${encodeURIComponent(eventId)}`));
    }

    /**
     * 按发送者列出垃圾检查结果。
     *
     * @param sender - 发送者 Matrix ID
     * @param options - 可选分页参数
     * @param options.limit - 返回条数上限
     * @returns 垃圾检查结果列表
     * @example
     * ```typescript
     * const results = await client.getAdminManager().config.listModuleSpamChecksBySender("@spam:example.org", {
     *     limit: 20,
     * });
     * console.log(results.length);
     * ```
     */
    async listModuleSpamChecksBySender(sender: string, options?: { limit?: number }): Promise<SpamCheckResult[]> {
        const query: Record<string, string> = {};
        if (options?.limit !== undefined) query.limit = String(options.limit);
        return await this.adminRequest(
            Method.Get,
            apu(`/modules/spam_check/sender/${encodeURIComponent(sender)}`),
            query,
        );
    }

    /**
     * 获取指定事件的第三方规则校验结果。
     *
     * @param eventId - 事件 ID
     * @returns 第三方规则校验结果列表
     * @example
     * ```typescript
     * const results = await client.getAdminManager().config.getModuleThirdPartyRuleResults("$abc");
     * console.log(results.length);
     * ```
     */
    async getModuleThirdPartyRuleResults(eventId: string): Promise<ThirdPartyRuleResult[]> {
        return await this.adminRequest(Method.Get, apu(`/modules/third_party_rule/${encodeURIComponent(eventId)}`));
    }

    // ===== Reports =====

    /**
     * 列出举报（分页）。
     *
     * @param options - 可选分页参数
     * @param options.from - 游标
     * @param options.limit - 每页条数
     * @returns 举报分页结果
     * @example
     * ```typescript
     * const page = await client.getAdminManager().config.listReports({ limit: 50 });
     * console.log(page.reports.length);
     * ```
     */
    async listReports(options?: { from?: string; limit?: number }): Promise<AdminReportPage> {
        const query = buildPaginationParams(options?.limit, options?.from);
        return await this.adminRequest(Method.Get, apu("/reports"), query);
    }

    /**
     * 获取单个举报详情。
     *
     * @param reportId - 举报 ID
     * @returns 举报详情
     * @throws {ValidationError} `reportId` 为空时（不会发出请求）
     * @example
     * ```typescript
     * const report = await client.getAdminManager().config.getReport("42");
     * console.log(report.id);
     * ```
     */
    async getReport(reportId: string): Promise<AdminReport> {
        if (!reportId) throw new ValidationError("Report ID is required");
        return await this.adminRequest(Method.Get, apu(`/reports/${encodeURIComponent(reportId)}`));
    }

    /**
     * 删除举报。
     *
     * @param reportId - 举报 ID
     * @throws {ValidationError} `reportId` 为空时（不会发出请求）
     * @example
     * ```typescript
     * await client.getAdminManager().config.deleteReport("42");
     * ```
     */
    async deleteReport(reportId: string): Promise<void> {
        if (!reportId) throw new ValidationError("Report ID is required");
        await this.adminRequest(Method.Delete, apu(`/reports/${encodeURIComponent(reportId)}`));
    }

    // ===== Audit =====

    /**
     * 列出审计事件（分页）。
     *
     * @param options - 附加查询参数（如 `limit` / `from`）
     * @returns 审计事件分页结果
     * @example
     * ```typescript
     * const page = await client.getAdminManager().config.listAuditEvents({ limit: 50 });
     * console.log(page.events.length);
     * ```
     */
    async listAuditEvents(options?: Record<string, string | number | undefined>): Promise<AuditEventPage> {
        const query: Record<string, string> = {};
        if (options) {
            for (const [k, v] of Object.entries(options)) {
                if (v !== undefined && v !== null) query[k] = String(v);
            }
        }
        return await this.adminRequest(Method.Get, apu("/audit/events"), query);
    }

    /**
     * 获取单个审计事件。
     *
     * @param eventId - 事件 ID
     * @returns 审计事件详情
     * @throws {ValidationError} `eventId` 为空时（不会发出请求）
     * @example
     * ```typescript
     * const event = await client.getAdminManager().config.getAuditEvent("$abc");
     * console.log(event);
     * ```
     */
    async getAuditEvent(eventId: string): Promise<AuditEvent> {
        if (!eventId) throw new ValidationError("Event ID is required");
        return await this.adminRequest(Method.Get, apu(`/audit/events/${encodeURIComponent(eventId)}`));
    }

    /**
     * 创建审计事件。
     *
     * @param payload - 审计事件载荷
     * @returns 创建后的审计事件
     * @example
     * ```typescript
     * const event = await client.getAdminManager().config.createAuditEvent({
     *     actor_id: "@admin:example.org",
     *     action: "user_login",
     *     resource_type: "user",
     *     resource_id: "@alice:example.org",
     *     result: "success",
     *     request_id: "req-1",
     * });
     * console.log(event);
     * ```
     */
    async createAuditEvent(payload: AuditEventCreateRequest): Promise<AuditEvent> {
        return await this.adminRequest(Method.Post, apu("/audit/events"), {}, payload);
    }

    // ===== Registration Tokens =====

    /**
     * 列出注册令牌（分页）。
     *
     * 后端 `GET /_synapse/admin/v1/registration_tokens` 返回
     * `{registration_tokens, next_batch}` —— 旧实现只返回数组，把游标丢掉了。
     *
     * @param options - 可选分页参数
     * @param options.limit - 每页条数
     * @param options.from - 游标（上一页返回的 `next_batch`）
     *
     * @example
     * ```typescript
     * const page = await adminManager.getRegistrationTokens({ limit: 50 });
     * console.log(page.registration_tokens.length, page.next_batch);
     * ```
     */
    async getRegistrationTokens(options?: { limit?: number; from?: string }): Promise<RegistrationTokenPage> {
        const query = buildPaginationParams(options?.limit, options?.from);
        const response = await this.adminRequest<RegistrationTokenPage>(
            Method.Get,
            apu("/registration_tokens"),
            Object.keys(query).length > 0 ? query : undefined,
        );
        return {
            registration_tokens: response.registration_tokens || [],
            next_batch: response.next_batch ?? null,
        };
    }

    /**
     * 创建注册令牌。
     *
     * ⚠️ 过期字段名是 **`expiry_time`**（不是 `expiry_ts`）。后端 `CreateTokenRequest`
     * 带 `#[serde(deny_unknown_fields)]`，发送 `expiry_ts` 会被**直接 400**。
     *
     * @param tokenOrPayload - 令牌字符串，或完整载荷（含可选 `length`）
     * @param usesAllowed - 可注册次数（省略 = 不限）
     * @param expiryTime - 过期时间（毫秒时间戳）
     *
     * @example
     * ```typescript
     * const token = await adminManager.createRegistrationToken("my-token", 10, Date.now() + 86_400_000);
     * console.log(token.token, token.expiry_time);
     * ```
     */
    async createRegistrationToken(
        tokenOrPayload:
            | string
            | { token?: string; uses_allowed?: number | null; expiry_time?: number | null; length?: number },
        usesAllowed?: number,
        expiryTime?: number,
    ): Promise<RegistrationToken> {
        const body: RegistrationTokenRequest =
            typeof tokenOrPayload === "string"
                ? { token: tokenOrPayload, uses_allowed: usesAllowed, expiry_time: expiryTime }
                : { ...tokenOrPayload };
        return await this.adminRequest<RegistrationToken>(Method.Post, apu("/registration_tokens"), undefined, body);
    }

    /**
     * 删除注册令牌。
     *
     * @param token - 令牌字符串
     *
     * @example
     * ```typescript
     * await adminManager.deleteRegistrationToken("my-token");
     * ```
     *
     * @throws {ValidationError} 如果 token 为空
     */
    async deleteRegistrationToken(token: string): Promise<void> {
        if (!token) {
            throw new ValidationError("Token is required");
        }
        await this.adminRequest(Method.Delete, apu(`/registration_tokens/${encodeURIComponent(token)}`));
    }

    /**
     * 更新注册令牌。
     *
     * 后端只注册 `POST /registration_tokens/{token}`（以及 DELETE/GET）。
     * 旧实现在 404 时回退到 `PUT` 同一路径，而后端从未注册 PUT —— 死分支，已移除。
     *
     * ⚠️ 字段名是 `expiry_time`（`UpdateTokenRequest` 同样带 `deny_unknown_fields`）。
     * 后端会返回更新后的令牌对象（旧实现声明 `void`，把返回值丢了）。
     *
     * @param token - 令牌字符串
     * @param payload - 待更新字段
     *
     * @example
     * ```typescript
     * const updated = await adminManager.updateRegistrationToken("my-token", { uses_allowed: 20 });
     * console.log(updated.completed, updated.uses_allowed);
     * ```
     *
     * @throws {ValidationError} 如果 token 为空
     */
    async updateRegistrationToken(
        token: string,
        payload: { uses_allowed?: number | null; expiry_time?: number | null },
    ): Promise<RegistrationToken> {
        if (!token) throw new ValidationError("Token is required");
        return await this.adminRequest<RegistrationToken>(
            Method.Post,
            apu(`/registration_tokens/${encodeURIComponent(token)}`),
            undefined,
            payload,
        );
    }

    /**
     * 获取单个注册令牌。
     *
     * @param token - 令牌字符串
     *
     * @example
     * ```typescript
     * const token = await adminManager.getRegistrationToken("my-token");
     * console.log(token.completed, token.uses_allowed);
     * ```
     *
     * @throws {ValidationError} 如果 token 为空
     */
    async getRegistrationToken(token: string): Promise<RegistrationToken> {
        if (!token) throw new ValidationError("Token is required");
        return await this.adminRequest<RegistrationToken>(
            Method.Get,
            apu(`/registration_tokens/${encodeURIComponent(token)}`),
        );
    }

    // ===== Account Validity =====

    /**
     * 为用户创建账户有效期。
     *
     * @param payload - 账户有效期载荷
     * @returns 账户有效期信息
     * @example
     * ```typescript
     * const info = await client.getAdminManager().config.createAccountValidity({
     *     user_id: "@alice:example.org",
     *     expiration_ts: Date.now() + 86_400_000,
     * });
     * console.log(info);
     * ```
     */
    async createAccountValidity(payload: AccountValidityRequest): Promise<AdminAccountValidityInfo> {
        return await this.adminRequest(Method.Post, apu("/account_validity"), {}, payload);
    }

    /**
     * 获取用户的账户有效期。
     *
     * @param userId - 用户 Matrix ID
     * @returns 账户有效期信息
     * @example
     * ```typescript
     * const info = await client.getAdminManager().config.getAccountValidity("@alice:example.org");
     * console.log(info);
     * ```
     */
    async getAccountValidity(userId: string): Promise<AdminAccountValidityInfo> {
        return await this.adminRequest(Method.Get, apu(`/account_validity/${encodeURIComponent(userId)}`));
    }

    /**
     * 续期用户的账户有效期。
     *
     * @param userId - 用户 Matrix ID
     * @param payload - 续期载荷
     * @returns 续期后的账户有效期信息
     * @example
     * ```typescript
     * const info = await client.getAdminManager().config.renewAccountValidity("@alice:example.org", {
     *     renewal_token: "token-1",
     *     new_expiration_ts: Date.now() + 86_400_000,
     * });
     * console.log(info);
     * ```
     */
    async renewAccountValidity(
        userId: string,
        payload: AccountValidityRenewRequest,
    ): Promise<AdminAccountValidityInfo> {
        return await this.adminRequest(
            Method.Post,
            apu(`/account_validity/${encodeURIComponent(userId)}/renew`),
            {},
            payload,
        );
    }

    // ===== Password Auth Providers =====

    /**
     * 列出密码认证提供方（后端返回**裸数组**，无 `{providers, total}` 包装）。
     *
     * @example
     * ```typescript
     * const providers = await adminManager.listPasswordAuthProviders();
     * console.log(providers.map((p) => p.provider_name));
     * ```
     */
    async listPasswordAuthProviders(): Promise<AdminPasswordAuthProvider[]> {
        return await this.adminRequest(Method.Get, apu("/password_auth_providers"));
    }

    /**
     * 创建密码认证提供方。
     *
     * 请求体是后端 `module.rs::CreatePasswordAuthProviderBody`（`deny_unknown_fields`）：
     * `provider_name` / `provider_type` / `config` 必填。旧签名用的是 `DynamicConfig`
     * （= `Record<string, unknown>`），等于放弃类型检查。
     *
     * @param payload - 提供方定义
     * @example
     * ```typescript
     * const p = await adminManager.createPasswordAuthProvider({
     *     provider_name: "ldap", provider_type: "ldap", config: { uri: "ldap://x" },
     * });
     * ```
     */
    async createPasswordAuthProvider(payload: CreatePasswordAuthProviderRequest): Promise<AdminPasswordAuthProvider> {
        return await this.adminRequest(Method.Post, apu("/password_auth_providers"), {}, payload);
    }

    // ===== Media Callbacks =====

    /**
     * 列出媒体回调**任务记录**（后端返回**裸数组**，无 `{callbacks, total}` 包装）。
     *
     * @example
     * ```typescript
     * const jobs = await adminManager.listMediaCallbacks();
     * console.log(jobs.map((j) => j.status));
     * ```
     */
    async listMediaCallbacks(): Promise<AdminMediaCallback[]> {
        return await this.adminRequest(Method.Get, apu("/media_callbacks"));
    }

    /**
     * 按 `callback_type` 过滤媒体回调任务记录（后端同样返回**裸数组**）。
     *
     * @example
     * ```typescript
     * const jobs = await adminManager.listMediaCallbacksByType("on_upload");
     * console.log(jobs.length);
     * ```
     */
    async listMediaCallbacksByType(callbackType: string): Promise<AdminMediaCallback[]> {
        return await this.adminRequest(Method.Get, apu(`/media_callbacks/${encodeURIComponent(callbackType)}`));
    }

    /**
     * 注册媒体回调（请求体是后端 `module.rs::CreateMediaCallbackBody`，`deny_unknown_fields`）。
     *
     * `callback_name` / `callback_type` / `url` 必填；旧签名用 `DynamicConfig` 无法表达这一点。
     *
     * @param payload - 回调注册定义
     * @example
     * ```typescript
     * await adminManager.createMediaCallback({
     *     callback_name: "scan", callback_type: "on_upload", url: "https://x/hook",
     * });
     * ```
     */
    async createMediaCallback(payload: CreateMediaCallbackRequest): Promise<AdminMediaCallback> {
        return await this.adminRequest(Method.Post, apu("/media_callbacks"), {}, payload);
    }

    // ===== Account Data Callbacks =====

    /**
     * 列出账户数据回调配置（后端返回**裸数组**，无 `{callbacks, total}` 包装）。
     *
     * @example
     * ```typescript
     * const hooks = await adminManager.listAccountDataCallbacks();
     * console.log(hooks.filter((h) => h.is_enabled).length);
     * ```
     */
    async listAccountDataCallbacks(): Promise<AdminAccountDataCallback[]> {
        return await this.adminRequest(Method.Get, apu("/account_data_callbacks"));
    }

    /**
     * 注册账户数据回调（`module.rs::CreateAccountDataCallbackBody`，`deny_unknown_fields`）。
     *
     * ⚠️ 后端**没有** `callback_type`：传了会 400；按类型过滤请用 `data_types`。
     *
     * @param payload - 回调注册定义
     * @example
     * ```typescript
     * await adminManager.createAccountDataCallback({
     *     callback_name: "mirror", config: {}, data_types: ["m.push_rules"],
     * });
     * ```
     */
    async createAccountDataCallback(payload: CreateAccountDataCallbackRequest): Promise<AdminAccountDataCallback> {
        return await this.adminRequest(Method.Post, apu("/account_data_callbacks"), {}, payload);
    }

    // ===== Invite Lists =====

    /**
     * 获取邀请白名单。
     *
     * @returns 邀请白名单
     * @example
     * ```typescript
     * const allowlist = await client.getAdminManager().config.getInviteAllowlist();
     * console.log(allowlist);
     * ```
     */
    async getInviteAllowlist(): Promise<AdminInviteAllowlist> {
        return await this.adminRequest(Method.Get, apu("/invite/allowlist"));
    }

    /**
     * 获取邀请黑名单。
     *
     * @returns 邀请黑名单
     * @example
     * ```typescript
     * const blocklist = await client.getAdminManager().config.getInviteBlocklist();
     * console.log(blocklist);
     * ```
     */
    async getInviteBlocklist(): Promise<AdminInviteBlocklist> {
        return await this.adminRequest(Method.Get, apu("/invite/blocklist"));
    }

    /**
     * ⚠️ **后端不支持该方法**（2026-10-15 起改为抛错，不再发出必然 404 的请求）。
     *
     * 后端只提供**全局名单整体设置**：`POST /_synapse/admin/v1/invite/blocklist`（或 `…/allowlist`），
     * body 为 `{ user_ids: [...] }`（`InviteListWriteBody`），**没有 per-user 增删端点** ⇒ 本方法的
     * 路径（`…/blocklist/{user_id}`）在后端不存在、恒 404，故改为**发起请求前**抛错。
     *
     * 正确做法（读—改—写）：先 `getInviteBlocklist()` 读全量（**注意后端分页返回，需自行翻页读全**），
     * 本地增删后用 `POST /invite/blocklist` + `{ user_ids }` 整体写回。
     *
     * @param userId - 被添加用户的 Matrix ID（仍校验，`ValidationError` 先于本错误抛出）
     * @param reason - **已无效**：后端整体设置端点不接收 per-user reason
     * @throws {ValidationError} `userId` 为空时（不会发出请求）
     * @throws {UnsupportedAdminInviteEndpointError} 总是抛出（后端无 per-user 端点）
     * @example
     * ```typescript
     * // ✗ 会抛错：后端无 POST …/invite/blocklist/{user_id}
     * await client.getAdminManager().config.addToInviteBlocklist("@spam:example.org");
     * ```
     */
    async addToInviteBlocklist(userId: string, reason?: string): Promise<void> {
        if (!userId) throw new ValidationError("User ID is required");
        throw new UnsupportedAdminInviteEndpointError(
            `后端无 per-user 邀请黑名单端点（原路径 POST /invite/blocklist/{user_id} 恒 404）。` +
                `请用「读 → 改 → 写」：getInviteBlocklist() → 本地增删 → POST /invite/blocklist { user_ids }.` +
                (reason === undefined ? "" : "（reason 参数已无效：后端整体设置端点不接收 per-user reason）"),
            "addToInviteBlocklist",
        );
    }

    /**
     * 从邀请黑名单移除用户
     *
     * @param userId - 被移除用户的 Matrix ID
     * @throws {ValidationError} `userId` 为空时（不会发出请求）
     * @example
     * ```typescript
     * await client.getAdminManager().config.removeFromInviteBlocklist("@spam:example.org");
     * ```
     */
    async removeFromInviteBlocklist(userId: string): Promise<void> {
        if (!userId) throw new ValidationError("User ID is required");
        throw new UnsupportedAdminInviteEndpointError(
            `后端无 per-user 邀请黑名单端点（原路径 DELETE /invite/blocklist/{user_id} 恒 404）。` +
                `请用「读 → 改 → 写」：getInviteBlocklist() → 本地移除 → POST /invite/blocklist { user_ids }.`,
            "removeFromInviteBlocklist",
        );
    }

    /**
     * 添加用户到邀请白名单
     *
     * @param userId - 被添加用户的 Matrix ID
     * @throws {ValidationError} `userId` 为空时（不会发出请求）
     * @example
     * ```typescript
     * await client.getAdminManager().config.addToInviteAllowlist("@alice:example.org");
     * ```
     */
    async addToInviteAllowlist(userId: string): Promise<void> {
        if (!userId) throw new ValidationError("User ID is required");
        throw new UnsupportedAdminInviteEndpointError(
            `后端无 per-user 邀请白名单端点（原路径 POST /invite/allowlist/{user_id} 恒 404）。` +
                `请用「读 → 改 → 写」：getInviteAllowlist() → 本地增删 → POST /invite/allowlist { user_ids }.`,
            "addToInviteAllowlist",
        );
    }

    /**
     * 从邀请白名单移除用户
     *
     * @param userId - 被移除用户的 Matrix ID
     * @throws {ValidationError} `userId` 为空时（不会发出请求）
     * @example
     * ```typescript
     * await client.getAdminManager().config.removeFromInviteAllowlist("@alice:example.org");
     * ```
     */
    async removeFromInviteAllowlist(userId: string): Promise<void> {
        if (!userId) throw new ValidationError("User ID is required");
        throw new UnsupportedAdminInviteEndpointError(
            `后端无 per-user 邀请白名单端点（原路径 DELETE /invite/allowlist/{user_id} 恒 404）。` +
                `请用「读 → 改 → 写」：getInviteAllowlist() → 本地移除 → POST /invite/allowlist { user_ids }.`,
            "removeFromInviteAllowlist",
        );
    }

    // ===== Jitsi =====

    /**
     * 获取 Jitsi 会议配置。
     *
     * @returns Jitsi 配置
     * @example
     * ```typescript
     * const config = await client.getAdminManager().config.getJitsiConfig();
     * console.log(config);
     * ```
     */
    async getJitsiConfig(): Promise<AdminJitsiConfig> {
        return await this.adminRequest(Method.Get, apu("/jitsi/config"));
    }

    // ===== Telemetry =====

    /**
     * 确认（ack）一条遥测告警。
     *
     * @param alertId - 告警 ID
     * @throws {ValidationError} `alertId` 为空时（不会发出请求）
     * @example
     * ```typescript
     * await client.getAdminManager().config.acknowledgeTelemetryAlert("alert-42");
     * ```
     */
    async acknowledgeTelemetryAlert(alertId: string): Promise<void> {
        if (!alertId) throw new ValidationError("Alert ID is required");
        await this.adminRequest(Method.Post, apu(`/telemetry/alerts/${encodeURIComponent(alertId)}/ack`));
    }
}
