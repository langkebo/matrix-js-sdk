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
    AdminModuleLogPage,
    AdminAccountValidityInfo,
    AdminPasswordAuthProvider,
    AdminPasswordAuthProviderPage,
    AdminPresenceRoute,
    AdminPresenceRoutePage,
    AdminMediaCallback,
    AdminMediaCallbackPage,
    AdminRateLimitCallback,
    AdminRateLimitCallbackPage,
    AdminAccountDataCallback,
    AdminAccountDataCallbackPage,
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

    async getFeatureFlags(): Promise<FeatureFlagPage> {
        return await this.adminRequest<FeatureFlagPage>(Method.Get, apu("/feature_flags"));
    }

    async getFeatureFlag(flagKey: string): Promise<FeatureFlag> {
        if (!flagKey) {
            throw new ValidationError("Flag key is required");
        }
        return await this.adminRequest<FeatureFlag>(Method.Get, apu(`/feature_flags/${encodeURIComponent(flagKey)}`));
    }

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
            target_scope: string;
            rollout_percent: number;
            expires_at: number | null;
            reason: string;
            targets: FeatureFlagTarget[];
        } = {
            target_scope: targetScope,
            rollout_percent: rolloutPercent,
            expires_at: expiresAt,
            reason: reason,
            targets: targets,
        };
        return await this.adminRequest<FeatureFlag>(
            Method.Put,
            apu(`/feature_flags/${encodeURIComponent(flagKey)}`),
            undefined,
            body,
        );
    }

    async deleteFeatureFlag(flagKey: string): Promise<void> {
        if (!flagKey) {
            throw new ValidationError("Flag key is required");
        }
        await this.adminRequest(Method.Delete, apu(`/feature_flags/${encodeURIComponent(flagKey)}`));
    }

    async listFeatureFlags(options?: Record<string, string | number | undefined>): Promise<FeatureFlagPage> {
        const query: Record<string, string> = {};
        if (options) {
            for (const [k, v] of Object.entries(options)) {
                if (v !== undefined && v !== null) query[k] = String(v);
            }
        }
        return await this.adminRequest(Method.Get, "/feature-flags", query);
    }

    async updateFeatureFlag(flagId: string, payload: FeatureFlagUpdatePayload): Promise<FeatureFlag> {
        return await this.adminRequest(Method.Patch, `/feature-flags/${encodeURIComponent(flagId)}`, {}, payload);
    }

    // ===== Modules =====

    async listModules(options?: { limit?: number; from?: string }): Promise<AdminModulePage> {
        const query: Record<string, string> = {};
        if (options?.limit !== undefined) query.limit = String(options.limit);
        if (options?.from !== undefined) query.from = String(options.from);
        return await this.adminRequest(Method.Get, "/modules", query);
    }

    async listModulesByType(moduleType: string): Promise<AdminModulePage> {
        return await this.adminRequest(Method.Get, `/modules/type/${encodeURIComponent(moduleType)}`);
    }

    async updateModuleConfig(moduleId: string, config: DynamicConfig): Promise<AdminModuleInfo> {
        return await this.adminRequest(Method.Put, `/modules/${encodeURIComponent(moduleId)}/config`, {}, { config });
    }

    async setModuleEnabled(moduleId: string, isEnabled: boolean): Promise<AdminModuleInfo> {
        return await this.adminRequest(
            Method.Post,
            `/modules/${encodeURIComponent(moduleId)}/enable`,
            {},
            { is_enabled: isEnabled },
        );
    }

    async getModuleLogs(moduleId: string, options?: { limit?: number; from?: number }): Promise<AdminModuleLogPage> {
        const query: Record<string, string> = {};
        if (options?.limit !== undefined) query.limit = String(options.limit);
        if (options?.from !== undefined) query.from = String(options.from);
        // 后端注册的是 `GET /modules/logs/{module_name}`（`logs` 在**前**、
        // module 名在后），旧实现写成 `/modules/{id}/logs` 把两段顺序写反了。
        return await this.adminRequest(Method.Get, `/modules/logs/${encodeURIComponent(moduleId)}`, query);
    }

    async checkModuleThirdPartyRule(payload: ThirdPartyRuleCheckPayload): Promise<ThirdPartyRuleCheckResult> {
        return await this.adminRequest(Method.Post, "/modules/check_third_party_rule", {}, payload);
    }

    async getModuleSpamCheckResult(eventId: string): Promise<SpamCheckResult> {
        return await this.adminRequest(Method.Get, `/modules/spam_check/${encodeURIComponent(eventId)}`);
    }

    async listModuleSpamChecksBySender(sender: string, options?: { limit?: number }): Promise<SpamCheckResult[]> {
        const query: Record<string, string> = {};
        if (options?.limit !== undefined) query.limit = String(options.limit);
        return await this.adminRequest(Method.Get, `/modules/spam_check/sender/${encodeURIComponent(sender)}`, query);
    }

    async getModuleThirdPartyRuleResults(eventId: string): Promise<ThirdPartyRuleResult[]> {
        return await this.adminRequest(Method.Get, `/modules/third_party_rule/${encodeURIComponent(eventId)}`);
    }

    // ===== Reports =====

    async listReports(options?: { from?: string; limit?: number }): Promise<AdminReportPage> {
        const query = buildPaginationParams(options?.limit, options?.from);
        return await this.adminRequest(Method.Get, "/reports", query);
    }

    async getReport(reportId: string): Promise<AdminReport> {
        if (!reportId) throw new ValidationError("Report ID is required");
        return await this.adminRequest(Method.Get, `/reports/${encodeURIComponent(reportId)}`);
    }

    async deleteReport(reportId: string): Promise<void> {
        if (!reportId) throw new ValidationError("Report ID is required");
        await this.adminRequest(Method.Delete, `/reports/${encodeURIComponent(reportId)}`);
    }

    // ===== Audit =====

    async listAuditEvents(options?: Record<string, string | number | undefined>): Promise<AuditEventPage> {
        const query: Record<string, string> = {};
        if (options) {
            for (const [k, v] of Object.entries(options)) {
                if (v !== undefined && v !== null) query[k] = String(v);
            }
        }
        return await this.adminRequest(Method.Get, "/audit/events", query);
    }

    async getAuditEvent(eventId: string): Promise<AuditEvent> {
        if (!eventId) throw new ValidationError("Event ID is required");
        return await this.adminRequest(Method.Get, `/audit/events/${encodeURIComponent(eventId)}`);
    }

    async createAuditEvent(payload: AuditEventCreateRequest): Promise<AuditEvent> {
        return await this.adminRequest(Method.Post, "/audit/events", {}, payload);
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
            "/registration_tokens",
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
        return await this.adminRequest<RegistrationToken>(Method.Post, "/registration_tokens", undefined, body);
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
        await this.adminRequest(Method.Delete, `/registration_tokens/${encodeURIComponent(token)}`);
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
            `/registration_tokens/${encodeURIComponent(token)}`,
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
            `/registration_tokens/${encodeURIComponent(token)}`,
        );
    }

    // ===== Account Validity =====

    async createAccountValidity(payload: AccountValidityRequest): Promise<AdminAccountValidityInfo> {
        return await this.adminRequest(Method.Post, "/account_validity", {}, payload);
    }

    async getAccountValidity(userId: string): Promise<AdminAccountValidityInfo> {
        return await this.adminRequest(Method.Get, `/account_validity/${encodeURIComponent(userId)}`);
    }

    async renewAccountValidity(
        userId: string,
        payload: AccountValidityRenewRequest,
    ): Promise<AdminAccountValidityInfo> {
        return await this.adminRequest(
            Method.Post,
            `/account_validity/${encodeURIComponent(userId)}/renew`,
            {},
            payload,
        );
    }

    // ===== Password Auth Providers =====

    async listPasswordAuthProviders(): Promise<AdminPasswordAuthProviderPage> {
        return await this.adminRequest(Method.Get, "/password_auth_providers");
    }

    async createPasswordAuthProvider(payload: DynamicConfig): Promise<AdminPasswordAuthProvider> {
        return await this.adminRequest(Method.Post, "/password_auth_providers", {}, payload);
    }

    // ===== Presence Routes =====

    async listPresenceRoutes(): Promise<AdminPresenceRoutePage> {
        return await this.adminRequest(Method.Get, "/presence_routes");
    }

    async createPresenceRoute(payload: DynamicConfig): Promise<AdminPresenceRoute> {
        return await this.adminRequest(Method.Post, "/presence_routes", {}, payload);
    }

    // ===== Media Callbacks =====

    async listMediaCallbacks(): Promise<AdminMediaCallbackPage> {
        return await this.adminRequest(Method.Get, "/media_callbacks");
    }

    async listMediaCallbacksByType(callbackType: string): Promise<AdminMediaCallbackPage> {
        return await this.adminRequest(Method.Get, `/media_callbacks/${encodeURIComponent(callbackType)}`);
    }

    async createMediaCallback(payload: DynamicConfig): Promise<AdminMediaCallback> {
        return await this.adminRequest(Method.Post, "/media_callbacks", {}, payload);
    }

    // ===== Rate Limit Callbacks =====

    async listRateLimitCallbacks(): Promise<AdminRateLimitCallbackPage> {
        return await this.adminRequest(Method.Get, "/rate_limit_callbacks");
    }

    async createRateLimitCallback(payload: DynamicConfig): Promise<AdminRateLimitCallback> {
        return await this.adminRequest(Method.Post, "/rate_limit_callbacks", {}, payload);
    }

    // ===== Account Data Callbacks =====

    async listAccountDataCallbacks(): Promise<AdminAccountDataCallbackPage> {
        return await this.adminRequest(Method.Get, "/account_data_callbacks");
    }

    async createAccountDataCallback(payload: DynamicConfig): Promise<AdminAccountDataCallback> {
        return await this.adminRequest(Method.Post, "/account_data_callbacks", {}, payload);
    }

    // ===== Invite Lists =====

    async getInviteAllowlist(): Promise<AdminInviteAllowlist> {
        return await this.adminRequest(Method.Get, "/invite/allowlist");
    }

    async getInviteBlocklist(): Promise<AdminInviteBlocklist> {
        return await this.adminRequest(Method.Get, "/invite/blocklist");
    }

    /**
     * 添加用户到邀请黑名单
     *
     * @param userId - 被添加用户的 Matrix ID
     * @param reason - 添加原因（可选）
     */
    async addToInviteBlocklist(userId: string, reason?: string): Promise<void> {
        if (!userId) throw new ValidationError("User ID is required");
        const body: Record<string, unknown> /* Dynamic: invite blocklist body varies by endpoint */ = {
            user_id: userId,
        };
        if (reason) body.reason = reason;
        await this.adminRequest(Method.Post, `/invite/blocklist/${encodeURIComponent(userId)}`, {}, body);
    }

    /**
     * 从邀请黑名单移除用户
     *
     * @param userId - 被移除用户的 Matrix ID
     */
    async removeFromInviteBlocklist(userId: string): Promise<void> {
        if (!userId) throw new ValidationError("User ID is required");
        await this.adminRequest(Method.Delete, `/invite/blocklist/${encodeURIComponent(userId)}`);
    }

    /**
     * 添加用户到邀请白名单
     *
     * @param userId - 被添加用户的 Matrix ID
     */
    async addToInviteAllowlist(userId: string): Promise<void> {
        if (!userId) throw new ValidationError("User ID is required");
        await this.adminRequest(
            Method.Post,
            `/invite/allowlist/${encodeURIComponent(userId)}`,
            {},
            { user_id: userId },
        );
    }

    /**
     * 从邀请白名单移除用户
     *
     * @param userId - 被移除用户的 Matrix ID
     */
    async removeFromInviteAllowlist(userId: string): Promise<void> {
        if (!userId) throw new ValidationError("User ID is required");
        await this.adminRequest(Method.Delete, `/invite/allowlist/${encodeURIComponent(userId)}`);
    }

    // ===== Jitsi =====

    async getJitsiConfig(): Promise<AdminJitsiConfig> {
        return await this.adminRequest(Method.Get, "/jitsi/config");
    }

    // ===== Telemetry =====

    async acknowledgeTelemetryAlert(alertId: string): Promise<void> {
        if (!alertId) throw new ValidationError("Alert ID is required");
        await this.adminRequest(Method.Post, `/telemetry/alerts/${encodeURIComponent(alertId)}/ack`);
    }
}
