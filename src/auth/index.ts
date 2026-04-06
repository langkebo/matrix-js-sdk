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
 * Auth Manager - 认证管理
 * 
 * 提供认证相关功能，包括：
 * - 登录流程管理
 * - 注册流程管理
 * - 登录流程缓存
 * - 统一错误处理
 * - 性能监控
 * 
 * 后端实现: synapse-rust/src/web/routes/auth_compat.rs
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/index";
import { logger } from "../logger";
import { type ILoginFlowsResponse } from "../@types/auth";
import { BaseManager } from "../managers/base-manager";
import { LRUCache } from "../utils/lru-cache";
import { MatrixError } from "../http-api/errors";
import { AuthError, ApiError, RetryableError } from "../errors";

export interface RegisterFlow {
    stages?: string[];
    type?: string;
}

export interface RegisterFlowsResponse {
    flows: RegisterFlow[];
    params: Record<string, unknown>;
    session?: string;
}

export enum AuthEvent {
    LoginFlowUpdated = "LoginFlowUpdated",
    RegisterFlowUpdated = "RegisterFlowUpdated",
    Error = "Error",
}

interface AuthEventMap {
    [AuthEvent.LoginFlowUpdated]: (flows: ILoginFlowsResponse) => void;
    [AuthEvent.RegisterFlowUpdated]: (flows: RegisterFlowsResponse) => void;
    [AuthEvent.Error]: (error: Error) => void;
}

// Extend MatrixClient interface to include auth-related properties
interface MatrixClientWithAuth extends MatrixClient {
    isAuthenticated?(): boolean;
    authLoginType?: string;
    authPayload?: unknown;
    fallbackGetLoginRetryText?: string;
}

export class AuthManager extends BaseManager<AuthEvent, AuthEventMap> {
    private loginFlowCache: LRUCache<ILoginFlowsResponse>;
    private registerFlowCache: LRUCache<RegisterFlowsResponse>;

    constructor(client: MatrixClient) {
        super(client);

        this.loginFlowCache = new LRUCache<ILoginFlowsResponse>(10, 10 * 60 * 1000);
        this.registerFlowCache = new LRUCache<RegisterFlowsResponse>(10, 10 * 60 * 1000);
    }

    /**
     * Check if authenticated
     */
    public isAuthenticated(): boolean {
        const clientWithAuth = this.client as MatrixClientWithAuth;
        return clientWithAuth.isAuthenticated?.() ?? false;
    }

    /**
     * Get auth login type
     */
    public getAuthLoginType(): string | undefined {
        const clientWithAuth = this.client as MatrixClientWithAuth;
        return clientWithAuth.authLoginType;
    }

    /**
     * Set auth payload
     */
    public setAuthPayload(payload: unknown): void {
        const clientWithAuth = this.client as MatrixClientWithAuth;
        clientWithAuth.authPayload = payload;
    }

    /**
     * Get fallback text
     */
    public getFallbackRetryText(): string {
        const clientWithAuth = this.client as MatrixClientWithAuth;
        return clientWithAuth.fallbackGetLoginRetryText || "";
    }

    /**
     * Set fallback text
     */
    public setFallbackRetryText(text: string): void {
        const clientWithAuth = this.client as MatrixClientWithAuth;
        clientWithAuth.fallbackGetLoginRetryText = text;
    }

    /**
     * Get supported login flows
     * 
     * 后端实现: synapse-rust/src/web/routes/auth_compat.rs:252-259
     */
    public async getSupportedLoginFlows(forceRefresh = false): Promise<ILoginFlowsResponse> {
        if (!forceRefresh) {
            const cached = this.loginFlowCache.get("login_flows");
            if (cached) {
                return cached;
            }
        }

        try {
            const flows = await this.withRetry(async () => {
                return await this.client.http.authedRequest<ILoginFlowsResponse>(
                    Method.Get,
                    "/login",
                    undefined,
                    undefined,
                    { prefix: undefined }
                );
            });

            if (flows) {
                this.loginFlowCache.set("login_flows", flows);
                this.emit(AuthEvent.LoginFlowUpdated, flows);
            }
            return flows;
        } catch (error) {
            throw this.normalizeError(error, "getSupportedLoginFlows");
        }
    }

    /**
     * Get supported registration flows
     * 
     * 后端实现: synapse-rust/src/web/routes/auth_compat.rs:261-269
     */
    public async getRegisterFlows(forceRefresh = false): Promise<RegisterFlowsResponse> {
        if (!forceRefresh) {
            const cached = this.registerFlowCache.get("register_flows");
            if (cached) {
                return cached;
            }
        }

        try {
            const flows = await this.withRetry(async () => {
                return await this.client.http.authedRequest<RegisterFlowsResponse>(
                    Method.Get,
                    "/register",
                    undefined,
                    undefined,
                    { prefix: undefined }
                );
            });

            if (flows) {
                this.registerFlowCache.set("register_flows", flows);
                this.emit(AuthEvent.RegisterFlowUpdated, flows);
            }
            return flows;
        } catch (error) {
            throw this.normalizeError(error, "getRegisterFlows");
        }
    }

    /**
     * Check if a specific login flow is supported
     */
    public async hasLoginFlow(flowType: string): Promise<boolean> {
        const flows = await this.getSupportedLoginFlows();
        return flows.flows?.some((flow: any) => flow.type === flowType) ?? false;
    }

    /**
     * Check if password login is supported
     */
    public async hasPasswordLogin(): Promise<boolean> {
        return this.hasLoginFlow("m.login.password");
    }

    /**
     * Check if SSO login is supported
     */
    public async hasSSOLogin(): Promise<boolean> {
        const flows = await this.getSupportedLoginFlows();
        return flows.flows?.some((flow: any) => 
            flow.type === "m.login.sso" || flow.type === "m.login.cas"
        ) ?? false;
    }

    /**
     * Clear cache
     */
    public clearCache(): void {
        this.loginFlowCache.clear();
        this.registerFlowCache.clear();
    }

    /**
     * Get cache statistics
     */
    public getCacheStats(): {
        loginFlows: { size: number; hits: number; misses: number; hitRate: number };
        registerFlows: { size: number; hits: number; misses: number; hitRate: number };
    } {
        return {
            loginFlows: this.loginFlowCache.getStats(),
            registerFlows: this.registerFlowCache.getStats(),
        };
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getAuthManager(): AuthManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getAuthManager = function (): AuthManager {
        return new AuthManager(this);
    };
}

export default extendMatrixClient;
