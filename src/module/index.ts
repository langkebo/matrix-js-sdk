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

/**
 * Module Manager - 模块系统管理
 *
 * 提供服务器端模块管理功能，包括：
 * - 模块列表与详情查询
 * - 模块安装、配置、启用/禁用
 * - Spam 检查与第三方规则
 * - 回调管理（账户数据、媒体、限速、在线状态）
 * - 密码认证提供商管理
 *
 * 对接后端 API: /_synapse/admin/v1/modules/*
 *                 /_synapse/admin/v1/account_data_callbacks
 *                 /_synapse/admin/v1/password_auth_providers
 *                 ...
 */

import { BaseManager } from "../managers/base-manager";
import { Method } from "../http-api/method";
const ADMIN_PREFIX = "/_synapse/admin";
import { MatrixError } from "../http-api/errors";
import { MatrixClient } from "../client";
import { getOrCreateManager } from "../client-infra/manager-registry";
import { NotFoundError } from "../errors";
import { buildPaginationParams } from "../admin/utils";
import type { QueryDict } from "../utils";
import type { ModulePathPattern } from "./__generated__/route-table";

type StripAdminPath<P extends string> =
    P extends `/_synapse/admin${infer Rest}` ? Rest : P;
type StripAdminV1<P extends string> =
    P extends `/_synapse/admin/v1${infer Rest}` ? `/v1${Rest}` : never;

/**
 * 模块路径类型安全包装函数，确保只使用 Ledger 注册的有效路径
 */
function mp<P extends StripAdminV1<ModulePathPattern>>(path: P): P {
    return path;
}

export enum ModuleEvent {
    ModulesListed = "ModulesListed",
    ModuleCreated = "ModuleCreated",
    ModuleDeleted = "ModuleDeleted",
    ModuleConfigUpdated = "ModuleConfigUpdated",
    ModuleEnabled = "ModuleEnabled",
    ModuleDisabled = "ModuleDisabled",
    ModuleLogsReceived = "ModuleLogsReceived",
    SpamCheckCompleted = "SpamCheckCompleted",
    ThirdPartyRuleChecked = "ThirdPartyRuleChecked",
    AccountDataCallbackRegistered = "AccountDataCallbackRegistered",
    MediaCallbackRegistered = "MediaCallbackRegistered",
    PasswordAuthProviderRegistered = "PasswordAuthProviderRegistered",
    PresenceRouteRegistered = "PresenceRouteRegistered",
    RateLimitCallbackRegistered = "RateLimitCallbackRegistered",
    AccountValidityChecked = "AccountValidityChecked",
    AccountValidityRenewed = "AccountValidityRenewed",
    ModuleError = "ModuleError",
}

export interface ModuleInfo {
    name: string;
    type: string;
    enabled: boolean;
    config?: Record<string, unknown>;
    version?: string;
    description?: string;
}

export interface ModuleListResponse {
    modules: ModuleInfo[];
    total: number;
}

export interface SpamCheckRequest {
    event_id: string;
    user_id: string;
    content: Record<string, unknown>;
    room_id?: string;
}

export interface SpamCheckResponse {
    is_spam: boolean;
    reason?: string;
    score?: number;
}

export interface ThirdPartyRuleRequest {
    rule_type: string;
    event_id: string;
    user_id: string;
    content?: Record<string, unknown>;
}

export interface ThirdPartyRuleResponse {
    allowed: boolean;
    reason?: string;
}

export interface CallbackInfo {
    id: string;
    module_name: string;
    callback_type: string;
    config?: Record<string, unknown>;
    enabled: boolean;
}

export interface PasswordAuthProviderInfo {
    id: string;
    name: string;
    type: string;
    enabled: boolean;
    config?: Record<string, unknown>;
}

export interface PresenceRouteInfo {
    id: string;
    module_name: string;
    route_type: string;
    enabled: boolean;
}

export interface RateLimitCallbackInfo {
    id: string;
    module_name: string;
    enabled: boolean;
    config?: Record<string, unknown>;
}

export interface AccountValidityInfo {
    user_id: string;
    valid: boolean;
    expires_at?: number;
    reason?: string;
}

export interface ModuleLogEntry {
    timestamp: number;
    level: string;
    message: string;
    module_name: string;
}

export interface ModuleLogResponse {
    logs: ModuleLogEntry[];
    total: number;
}

interface ModuleManagerEventMap {
    [ModuleEvent.ModulesListed]: (modules: ModuleListResponse) => void;
    [ModuleEvent.ModuleCreated]: (module: ModuleInfo) => void;
    [ModuleEvent.ModuleDeleted]: (moduleName: string) => void;
    [ModuleEvent.ModuleConfigUpdated]: (moduleName: string, config: Record<string, unknown>) => void;
    [ModuleEvent.ModuleEnabled]: (moduleName: string) => void;
    [ModuleEvent.ModuleDisabled]: (moduleName: string) => void;
    [ModuleEvent.ModuleLogsReceived]: (logs: ModuleLogResponse) => void;
    [ModuleEvent.SpamCheckCompleted]: (result: SpamCheckResponse) => void;
    [ModuleEvent.ThirdPartyRuleChecked]: (result: ThirdPartyRuleResponse) => void;
    [ModuleEvent.AccountDataCallbackRegistered]: (callback: CallbackInfo) => void;
    [ModuleEvent.MediaCallbackRegistered]: (callback: CallbackInfo) => void;
    [ModuleEvent.PasswordAuthProviderRegistered]: (provider: PasswordAuthProviderInfo) => void;
    [ModuleEvent.PresenceRouteRegistered]: (route: PresenceRouteInfo) => void;
    [ModuleEvent.RateLimitCallbackRegistered]: (callback: RateLimitCallbackInfo) => void;
    [ModuleEvent.AccountValidityChecked]: (info: AccountValidityInfo) => void;
    [ModuleEvent.AccountValidityRenewed]: (userId: string) => void;
    [ModuleEvent.ModuleError]: (error: Error) => void;
}

export class ModuleManager extends BaseManager<ModuleEvent, ModuleManagerEventMap> {
    constructor(client: MatrixClient) {
        super(client);
    }

    private async adminRequest<T>(
        method: Method,
        path: string,
        queryParams?: QueryDict,
        body?: Record<string, unknown>,
    ): Promise<T> {
        try {
            const response = await this.client.http.authedRequest<T>(
                method,
                path,
                queryParams,
                body as any,
                { prefix: ADMIN_PREFIX },
            );
            return response;
        } catch (error) {
            const err = error instanceof MatrixError ? error : new Error(String(error));
            this.emit(ModuleEvent.ModuleError, err);
            throw error;
        }
    }

    // ==================== 模块管理 ====================

    async listModules(options?: { limit?: number; from?: string }): Promise<ModuleListResponse> {
        const query = buildPaginationParams(options?.from, options?.limit);
        const result = await this.adminRequest<ModuleListResponse>(Method.Get, mp("/v1/modules"), query);
        this.emit(ModuleEvent.ModulesListed, result);
        return result;
    }

    async listModulesByType(moduleType: string): Promise<ModuleInfo[]> {
        const result = await this.adminRequest<{ modules: ModuleInfo[] }>(
            Method.Get,
            mp(`/v1/modules/type/${encodeURIComponent(moduleType)}`),
        );
        return result.modules;
    }

    async getModule(moduleName: string): Promise<ModuleInfo> {
        try {
            return await this.adminRequest<ModuleInfo>(
                Method.Get,
                mp(`/v1/modules/${encodeURIComponent(moduleName)}`),
            );
        } catch (error) {
            if (error instanceof MatrixError && error.errcode === "M_NOT_FOUND") {
                throw new NotFoundError(`Module '${moduleName}' not found`);
            }
            throw error;
        }
    }

    async createModule(moduleConfig: Record<string, unknown>): Promise<ModuleInfo> {
        const result = await this.adminRequest<ModuleInfo>(
            Method.Post,
            mp("/v1/modules"),
            undefined,
            moduleConfig,
        );
        this.emit(ModuleEvent.ModuleCreated, result);
        return result;
    }

    async deleteModule(moduleName: string): Promise<void> {
        await this.adminRequest<void>(
            Method.Delete,
            mp(`/v1/modules/${encodeURIComponent(moduleName)}`),
        );
        this.emit(ModuleEvent.ModuleDeleted, moduleName);
    }

    async updateModuleConfig(moduleName: string, config: Record<string, unknown>): Promise<ModuleInfo> {
        const result = await this.adminRequest<ModuleInfo>(
            Method.Put,
            mp(`/v1/modules/${encodeURIComponent(moduleName)}/config`),
            undefined,
            { config },
        );
        this.emit(ModuleEvent.ModuleConfigUpdated, moduleName, config);
        return result;
    }

    async setModuleEnabled(moduleName: string, enabled: boolean): Promise<void> {
        await this.adminRequest<void>(
            Method.Post,
            mp(`/v1/modules/${encodeURIComponent(moduleName)}/enable`),
            undefined,
            { is_enabled: enabled },
        );
        if (enabled) {
            this.emit(ModuleEvent.ModuleEnabled, moduleName);
        } else {
            this.emit(ModuleEvent.ModuleDisabled, moduleName);
        }
    }

    async getModuleLogs(
        moduleName: string,
        options?: { limit?: number; from?: string },
    ): Promise<ModuleLogResponse> {
        const query = buildPaginationParams(options?.from, options?.limit);
        const result = await this.adminRequest<ModuleLogResponse>(
            Method.Get,
            mp(`/v1/modules/${encodeURIComponent(moduleName)}/logs`),
            query,
        );
        this.emit(ModuleEvent.ModuleLogsReceived, result);
        return result;
    }

    // ==================== Spam 检查 ====================

    async checkSpam(payload: SpamCheckRequest): Promise<SpamCheckResponse> {
        const result = await this.adminRequest<SpamCheckResponse>(
            Method.Post,
            mp("/v1/modules/check_spam"),
            undefined,
            payload as unknown as Record<string, unknown>,
        );
        this.emit(ModuleEvent.SpamCheckCompleted, result);
        return result;
    }

    async getSpamCheckResult(eventId: string): Promise<SpamCheckResponse> {
        return await this.adminRequest<SpamCheckResponse>(
            Method.Get,
            mp(`/v1/modules/spam_check/${encodeURIComponent(eventId)}`),
        );
    }

    async getSpamCheckBySender(
        sender: string,
        options?: { limit?: number; from?: string },
    ): Promise<SpamCheckResponse[]> {
        const query = buildPaginationParams(options?.from, options?.limit);
        const result = await this.adminRequest<{ checks: SpamCheckResponse[] }>(
            Method.Get,
            mp(`/v1/modules/spam_check/sender/${encodeURIComponent(sender)}`),
            query,
        );
        return result.checks;
    }

    // ==================== 第三方规则 ====================

    async checkThirdPartyRule(payload: ThirdPartyRuleRequest): Promise<ThirdPartyRuleResponse> {
        const result = await this.adminRequest<ThirdPartyRuleResponse>(
            Method.Post,
            mp("/v1/modules/check_third_party_rule"),
            undefined,
            payload as unknown as Record<string, unknown>,
        );
        this.emit(ModuleEvent.ThirdPartyRuleChecked, result);
        return result;
    }

    async getThirdPartyRuleResult(eventId: string): Promise<ThirdPartyRuleResponse> {
        return await this.adminRequest<ThirdPartyRuleResponse>(
            Method.Get,
            mp(`/v1/modules/third_party_rule/${encodeURIComponent(eventId)}`),
        );
    }

    // ==================== 回调管理 ====================

    async getAccountDataCallbacks(): Promise<CallbackInfo[]> {
        const result = await this.adminRequest<{ callbacks: CallbackInfo[] }>(
            Method.Get,
            mp("/v1/account_data_callbacks"),
        );
        return result.callbacks;
    }

    async registerAccountDataCallback(callback: {
        module_name: string;
        callback_type: string;
    }): Promise<CallbackInfo> {
        const result = await this.adminRequest<CallbackInfo>(
            Method.Post,
            mp("/v1/account_data_callbacks"),
            undefined,
            callback as unknown as Record<string, unknown>,
        );
        this.emit(ModuleEvent.AccountDataCallbackRegistered, result);
        return result;
    }

    async getMediaCallbacks(): Promise<CallbackInfo[]> {
        const result = await this.adminRequest<{ callbacks: CallbackInfo[] }>(
            Method.Get,
            mp("/v1/media_callbacks"),
        );
        return result.callbacks;
    }

    async registerMediaCallback(callback: {
        module_name: string;
        callback_type: string;
    }): Promise<CallbackInfo> {
        const result = await this.adminRequest<CallbackInfo>(
            Method.Post,
            mp("/v1/media_callbacks"),
            undefined,
            callback as unknown as Record<string, unknown>,
        );
        this.emit(ModuleEvent.MediaCallbackRegistered, result);
        return result;
    }

    async getMediaCallbacksByType(callbackType: string): Promise<CallbackInfo[]> {
        const result = await this.adminRequest<{ callbacks: CallbackInfo[] }>(
            Method.Get,
            mp(`/v1/media_callbacks/${encodeURIComponent(callbackType)}`),
        );
        return result.callbacks;
    }

    async getRateLimitCallbacks(): Promise<RateLimitCallbackInfo[]> {
        const result = await this.adminRequest<{ callbacks: RateLimitCallbackInfo[] }>(
            Method.Get,
            mp("/v1/rate_limit_callbacks"),
        );
        return result.callbacks;
    }

    async registerRateLimitCallback(callback: {
        module_name: string;
    }): Promise<RateLimitCallbackInfo> {
        const result = await this.adminRequest<RateLimitCallbackInfo>(
            Method.Post,
            mp("/v1/rate_limit_callbacks"),
            undefined,
            callback as unknown as Record<string, unknown>,
        );
        this.emit(ModuleEvent.RateLimitCallbackRegistered, result);
        return result;
    }

    // ==================== 密码认证提供商 ====================

    async getPasswordAuthProviders(): Promise<PasswordAuthProviderInfo[]> {
        const result = await this.adminRequest<{ providers: PasswordAuthProviderInfo[] }>(
            Method.Get,
            mp("/v1/password_auth_providers"),
        );
        return result.providers;
    }

    async registerPasswordAuthProvider(provider: {
        name: string;
        type: string;
        config?: Record<string, unknown>;
    }): Promise<PasswordAuthProviderInfo> {
        const result = await this.adminRequest<PasswordAuthProviderInfo>(
            Method.Post,
            mp("/v1/password_auth_providers"),
            undefined,
            provider as unknown as Record<string, unknown>,
        );
        this.emit(ModuleEvent.PasswordAuthProviderRegistered, result);
        return result;
    }

    // ==================== 在线状态路由 ====================

    async getPresenceRoutes(): Promise<PresenceRouteInfo[]> {
        const result = await this.adminRequest<{ routes: PresenceRouteInfo[] }>(
            Method.Get,
            mp("/v1/presence_routes"),
        );
        return result.routes;
    }

    async registerPresenceRoute(route: {
        module_name: string;
        route_type: string;
    }): Promise<PresenceRouteInfo> {
        const result = await this.adminRequest<PresenceRouteInfo>(
            Method.Post,
            mp("/v1/presence_routes"),
            undefined,
            route as unknown as Record<string, unknown>,
        );
        this.emit(ModuleEvent.PresenceRouteRegistered, result);
        return result;
    }

    // ==================== 账户有效性 ====================

    async checkAccountValidity(): Promise<void> {
        await this.adminRequest<void>(Method.Post, mp("/v1/account_validity"));
    }

    async getAccountValidity(userId: string): Promise<AccountValidityInfo> {
        const result = await this.adminRequest<AccountValidityInfo>(
            Method.Get,
            mp(`/v1/account_validity/${encodeURIComponent(userId)}`),
        );
        this.emit(ModuleEvent.AccountValidityChecked, result);
        return result;
    }

    async renewAccountValidity(userId: string): Promise<void> {
        await this.adminRequest<void>(
            Method.Post,
            mp(`/v1/account_validity/${encodeURIComponent(userId)}/renew`),
        );
        this.emit(ModuleEvent.AccountValidityRenewed, userId);
    }
}

/**
 * 声明 MatrixClient 上的模块管理器访问器
 */
declare module "../client.ts" {
    interface MatrixClient {
        getModuleManager(): ModuleManager;
    }
}

/**
 * 将 ModuleManager 注册为客户端实例上的惰性单例
 */
MatrixClient.prototype.getModuleManager = function (): ModuleManager {
    return getOrCreateManager(this, "module", () => new ModuleManager(this));
};