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

import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { MatrixError } from "../http-api/errors";
import { MatrixClient } from "../client";
import { getOrCreateManager, registerManagerClass } from "../client-infra/manager-registry";
import { NotFoundError } from "../errors";
import { buildPaginationParams } from "../common/pagination";
import type { IContent } from "../models/event";
import type { ModulePathPattern } from "./__generated__/route-table";

type StripAdminV1<P extends string> = P extends `/_synapse/admin/v1${infer Rest}` ? Rest : never;

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
    AccountValidityChecked = "AccountValidityChecked",
    AccountValidityRenewed = "AccountValidityRenewed",
    ModuleError = "ModuleError",
}

export interface ModuleInfo {
    name: string;
    type: string;
    enabled: boolean;
    config?: IContent;
    version?: string;
    description?: string;
}

export interface CreateModuleRequest {
    name: string;
    type: string;
    config?: IContent;
    enabled?: boolean;
    [key: string]: unknown;
}

export interface ModuleListResponse {
    modules: ModuleInfo[];
    total: number;
}

export interface SpamCheckRequest {
    event_id: string;
    user_id: string;
    content: IContent;
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
    content?: IContent;
}

export interface ThirdPartyRuleResponse {
    allowed: boolean;
    reason?: string;
}

export interface CallbackInfo {
    id: string;
    module_name: string;
    callback_type: string;
    config?: IContent;
    enabled: boolean;
}

export interface PasswordAuthProviderInfo {
    id: string;
    name: string;
    type: string;
    enabled: boolean;
    config?: IContent;
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
    [ModuleEvent.ModuleConfigUpdated]: (moduleName: string, config: IContent) => void;
    [ModuleEvent.ModuleEnabled]: (moduleName: string) => void;
    [ModuleEvent.ModuleDisabled]: (moduleName: string) => void;
    [ModuleEvent.ModuleLogsReceived]: (logs: ModuleLogResponse) => void;
    [ModuleEvent.SpamCheckCompleted]: (result: SpamCheckResponse) => void;
    [ModuleEvent.ThirdPartyRuleChecked]: (result: ThirdPartyRuleResponse) => void;
    [ModuleEvent.AccountDataCallbackRegistered]: (callback: CallbackInfo) => void;
    [ModuleEvent.MediaCallbackRegistered]: (callback: CallbackInfo) => void;
    [ModuleEvent.PasswordAuthProviderRegistered]: (provider: PasswordAuthProviderInfo) => void;
    [ModuleEvent.AccountValidityChecked]: (info: AccountValidityInfo) => void;
    [ModuleEvent.AccountValidityRenewed]: (userId: string) => void;
    [ModuleEvent.ModuleError]: (error: Error) => void;
}

export class ModuleManager extends BaseManager<ModuleEvent, ModuleManagerEventMap> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    protected async adminRequest<T>(
        method: Method,
        path: string,
        queryParams?: Record<string, string | string[]>,
        body?: object,
        label?: string,
    ): Promise<T> {
        try {
            return await super.adminRequest<T>(method, path, queryParams, body, label);
        } catch (error) {
            const err = error instanceof MatrixError ? error : new Error(String(error));
            this.emit(ModuleEvent.ModuleError, err);
            throw error;
        }
    }

    // ==================== 模块管理 ====================

    async listModules(options?: { limit?: number; from?: string }): Promise<ModuleListResponse> {
        const query = buildPaginationParams(options?.limit, options?.from);
        const result = await this.adminRequest<ModuleListResponse>(Method.Get, mp("/modules"), query);
        this.emit(ModuleEvent.ModulesListed, result);
        return result;
    }

    async listModulesByType(moduleType: string): Promise<ModuleInfo[]> {
        const result = await this.adminRequest<{ modules: ModuleInfo[] }>(
            Method.Get,
            mp(`/modules/type/${encodeURIComponent(moduleType)}`),
        );
        return result.modules;
    }

    async getModule(moduleName: string): Promise<ModuleInfo> {
        try {
            return await this.adminRequest<ModuleInfo>(Method.Get, mp(`/modules/${encodeURIComponent(moduleName)}`));
        } catch (error) {
            if (error instanceof MatrixError && error.errcode === "M_NOT_FOUND") {
                throw new NotFoundError(`Module '${moduleName}' not found`);
            }
            throw error;
        }
    }

    async createModule(moduleConfig: CreateModuleRequest): Promise<ModuleInfo> {
        const result = await this.adminRequest<ModuleInfo>(Method.Post, mp("/modules"), undefined, moduleConfig);
        this.emit(ModuleEvent.ModuleCreated, result);
        return result;
    }

    async deleteModule(moduleName: string): Promise<void> {
        await this.adminRequest<void>(Method.Delete, mp(`/modules/${encodeURIComponent(moduleName)}`));
        this.emit(ModuleEvent.ModuleDeleted, moduleName);
    }

    async updateModuleConfig(moduleName: string, config: IContent): Promise<ModuleInfo> {
        const result = await this.adminRequest<ModuleInfo>(
            Method.Put,
            mp(`/modules/${encodeURIComponent(moduleName)}/config`),
            undefined,
            { config },
        );
        this.emit(ModuleEvent.ModuleConfigUpdated, moduleName, config);
        return result;
    }

    async setModuleEnabled(moduleName: string, enabled: boolean): Promise<void> {
        await this.adminRequest<void>(Method.Post, mp(`/modules/${encodeURIComponent(moduleName)}/enable`), undefined, {
            is_enabled: enabled,
        });
        if (enabled) {
            this.emit(ModuleEvent.ModuleEnabled, moduleName);
        } else {
            this.emit(ModuleEvent.ModuleDisabled, moduleName);
        }
    }

    async getModuleLogs(moduleName: string, options?: { limit?: number; from?: string }): Promise<ModuleLogResponse> {
        const query = buildPaginationParams(options?.limit, options?.from);
        // SDK-BL-001: backend route is /modules/logs/{module_name} (logs segment comes first)
        const result = await this.adminRequest<ModuleLogResponse>(
            Method.Get,
            mp(`/modules/logs/${encodeURIComponent(moduleName)}`),
            query,
        );
        this.emit(ModuleEvent.ModuleLogsReceived, result);
        return result;
    }

    // ==================== Spam 检查 ====================

    async checkSpam(payload: SpamCheckRequest): Promise<SpamCheckResponse> {
        const result = await this.adminRequest<SpamCheckResponse>(
            Method.Post,
            mp("/modules/check_spam"),
            undefined,
            payload,
        );
        this.emit(ModuleEvent.SpamCheckCompleted, result);
        return result;
    }

    async getSpamCheckResult(eventId: string): Promise<SpamCheckResponse> {
        return await this.adminRequest<SpamCheckResponse>(
            Method.Get,
            mp(`/modules/spam_check/${encodeURIComponent(eventId)}`),
        );
    }

    async getSpamCheckBySender(
        sender: string,
        options?: { limit?: number; from?: string },
    ): Promise<SpamCheckResponse[]> {
        const query = buildPaginationParams(options?.limit, options?.from);
        const result = await this.adminRequest<{ checks: SpamCheckResponse[] }>(
            Method.Get,
            mp(`/modules/spam_check/sender/${encodeURIComponent(sender)}`),
            query,
        );
        return result.checks;
    }

    // ==================== 第三方规则 ====================

    async checkThirdPartyRule(payload: ThirdPartyRuleRequest): Promise<ThirdPartyRuleResponse> {
        const result = await this.adminRequest<ThirdPartyRuleResponse>(
            Method.Post,
            mp("/modules/check_third_party_rule"),
            undefined,
            payload,
        );
        this.emit(ModuleEvent.ThirdPartyRuleChecked, result);
        return result;
    }

    async getThirdPartyRuleResult(eventId: string): Promise<ThirdPartyRuleResponse> {
        return await this.adminRequest<ThirdPartyRuleResponse>(
            Method.Get,
            mp(`/modules/third_party_rule/${encodeURIComponent(eventId)}`),
        );
    }

    // ==================== 回调管理 ====================

    async getAccountDataCallbacks(): Promise<CallbackInfo[]> {
        const result = await this.adminRequest<{ callbacks: CallbackInfo[] }>(
            Method.Get,
            mp("/account_data_callbacks"),
        );
        return result.callbacks;
    }

    async registerAccountDataCallback(callback: { module_name: string; callback_type: string }): Promise<CallbackInfo> {
        const result = await this.adminRequest<CallbackInfo>(
            Method.Post,
            mp("/account_data_callbacks"),
            undefined,
            callback,
        );
        this.emit(ModuleEvent.AccountDataCallbackRegistered, result);
        return result;
    }

    async getMediaCallbacks(): Promise<CallbackInfo[]> {
        const result = await this.adminRequest<{ callbacks: CallbackInfo[] }>(Method.Get, mp("/media_callbacks"));
        return result.callbacks;
    }

    async registerMediaCallback(callback: { module_name: string; callback_type: string }): Promise<CallbackInfo> {
        const result = await this.adminRequest<CallbackInfo>(Method.Post, mp("/media_callbacks"), undefined, callback);
        this.emit(ModuleEvent.MediaCallbackRegistered, result);
        return result;
    }

    async getMediaCallbacksByType(callbackType: string): Promise<CallbackInfo[]> {
        const result = await this.adminRequest<{ callbacks: CallbackInfo[] }>(
            Method.Get,
            mp(`/media_callbacks/${encodeURIComponent(callbackType)}`),
        );
        return result.callbacks;
    }

    // ==================== 密码认证提供商 ====================

    async getPasswordAuthProviders(): Promise<PasswordAuthProviderInfo[]> {
        const result = await this.adminRequest<{ providers: PasswordAuthProviderInfo[] }>(
            Method.Get,
            mp("/password_auth_providers"),
        );
        return result.providers;
    }

    async registerPasswordAuthProvider(provider: {
        name: string;
        type: string;
        config?: IContent;
    }): Promise<PasswordAuthProviderInfo> {
        const result = await this.adminRequest<PasswordAuthProviderInfo>(
            Method.Post,
            mp("/password_auth_providers"),
            undefined,
            provider as object,
        );
        this.emit(ModuleEvent.PasswordAuthProviderRegistered, result);
        return result;
    }

    // ==================== 账户有效性 ====================

    /**
     * 创建/检查账户有效性记录。
     *
     * SDK-BL-002: 后端 `create_account_validity` 处理器要求 body 含必填字段
     * `user_id` 与 `expiration_ts`，此前 SDK 未传 body 导致 400 Bad Request。
     *
     * @param userId       目标用户 ID
     * @param expirationTs 过期时间戳（毫秒）
     */
    async checkAccountValidity(userId: string, expirationTs: number): Promise<void> {
        this.requireNonEmptyString(userId, "userId");
        this.requirePositiveInteger(expirationTs, "expirationTs");
        await this.adminRequest<void>(Method.Post, mp("/account_validity"), undefined, {
            user_id: userId,
            expiration_ts: expirationTs,
        });
    }

    async getAccountValidity(userId: string): Promise<AccountValidityInfo> {
        const result = await this.adminRequest<AccountValidityInfo>(
            Method.Get,
            mp(`/account_validity/${encodeURIComponent(userId)}`),
        );
        this.emit(ModuleEvent.AccountValidityChecked, result);
        return result;
    }

    /**
     * 续期账户有效性。
     *
     * SDK-BL-003: 后端 `renew_account` 处理器要求 body 含必填字段
     * `renewal_token` 与 `new_expiration_ts`，此前 SDK 仅传路径参数导致 400 Bad Request。
     *
     * @param userId           目标用户 ID
     * @param renewalToken     续期令牌
     * @param newExpirationTs 新过期时间戳（毫秒）
     */
    async renewAccountValidity(userId: string, renewalToken: string, newExpirationTs: number): Promise<void> {
        this.requireNonEmptyString(userId, "userId");
        this.requireNonEmptyString(renewalToken, "renewalToken");
        this.requirePositiveInteger(newExpirationTs, "newExpirationTs");
        await this.adminRequest<void>(
            Method.Post,
            mp(`/account_validity/${encodeURIComponent(userId)}/renew`),
            undefined,
            {
                renewal_token: renewalToken,
                new_expiration_ts: newExpirationTs,
            },
        );
        this.emit(ModuleEvent.AccountValidityRenewed, userId);
    }
}

/**
 * 声明 MatrixClient 上的模块管理器访问器
 */

/**
 * 将 ModuleManager 注册为客户端实例上的惰性单例
 */
MatrixClient.prototype.getModuleManager = function (): ModuleManager {
    registerManagerClass("module", ModuleManager);
    return getOrCreateManager(this, "module", () => new ModuleManager(this));
};
