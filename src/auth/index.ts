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
 * - 客户端数据验证
 *
 * 后端实现: synapse-rust/src/web/routes/auth_compat.rs
 * 契约文档: docs/api-contract/auth-enhanced.md
 *
 * 数据约束:
 * - username 最大长度: 255 字符
 * - password 最大长度: 128 字符
 * - device_id 长度: 16 字符（服务器生成）
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/index";
import { ClientPrefix } from "../http-api/prefix";
import { type ILoginFlowsResponse } from "../@types/auth";
import { type RegisterRequest, type RegisterResponse } from "../@types/registration";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { LRUCache } from "../utils/lru-cache";
import { ValidationError } from "../errors";
import type { AuthPathPattern } from "./__generated__/route-table";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import { buildEmailTokenRequestParams, buildMsisdnTokenRequestParams, requestTokenFromEndpoint } from "../client-auth";
import type { IRequestTokenResponse, IRequestMsisdnTokenResponse } from "../client-api-types";
import type { IRefreshTokenResponse } from "../@types/auth";

type StripAuthPrefix<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;

function ap<P extends StripAuthPrefix<AuthPathPattern>>(path: P): P {
    return path;
}

// 数据约束常量
const USERNAME_MAX_LENGTH = 255;
const PASSWORD_MAX_LENGTH = 128;
const DEVICE_ID_LENGTH = 16;

export interface RegisterFlow {
    stages?: string[];
    type?: string;
}

export interface IAuthParams {
    type?: string;
    session?: string;
    [key: string]: unknown;
}

export interface CaptchaResponse {
    public_key: string;
    challenge?: string;
    html?: string;
}

export interface WhoamiResponse {
    user_id: string;
    device_id?: string;
    is_guest?: boolean;
}

export interface SamlRedirectResponse {
    location: string;
}

export interface VersionsResponse {
    versions: string[];
    unstable_features?: Record<string, boolean>;
}

export interface RegisterFlowsResponse {
    flows: RegisterFlow[];
    params: IAuthParams;
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

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);

        this.loginFlowCache = new LRUCache<ILoginFlowsResponse>(10, 10 * 60 * 1000);
        this.registerFlowCache = new LRUCache<RegisterFlowsResponse>(10, 10 * 60 * 1000);
    }

    /**
     * 验证用户名长度
     * @throws {ValidationError} 当用户名过长时
     */
    private validateUsername(username: string): void {
        if (username.length > USERNAME_MAX_LENGTH) {
            throw new ValidationError(`Username too long (max ${USERNAME_MAX_LENGTH} characters)`);
        }
    }

    /**
     * 验证密码长度
     * @throws {ValidationError} 当密码过长时
     */
    private validatePassword(password: string): void {
        if (password.length > PASSWORD_MAX_LENGTH) {
            throw new ValidationError(`Password too long (max ${PASSWORD_MAX_LENGTH} characters)`);
        }
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
     * @param forceRefresh - 是否强制刷新缓存（默认 false）
     * @returns 支持的登录流程列表
     *
     * @example
     * ```typescript
     * // 获取支持的登录流程
     * const flows = await authManager.getSupportedLoginFlows();
     * console.log("Supported flows:", flows.flows);
     *
     * // 检查是否支持密码登录
     * const hasPassword = flows.flows?.some(f => f.type === "m.login.password");
     * if (hasPassword) {
     *     console.log("Password login is supported");
     * }
     *
     * // 强制刷新缓存
     * const freshFlows = await authManager.getSupportedLoginFlows(true);
     * ```
     *
     * @throws {ApiError} 如果 API 调用失败
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

        const flows = await this.withRetry(async () => {
            return await this.request<ILoginFlowsResponse>({
                method: Method.Get,
                path: ap("/login"),
                authenticated: false,
            });
        });

        if (flows) {
            this.loginFlowCache.set("login_flows", flows);
            this.emit(AuthEvent.LoginFlowUpdated, flows);
        }
        return flows;
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

        const flows = await this.withRetry(async () => {
            return await this.request<RegisterFlowsResponse>({
                method: Method.Get,
                path: ap("/register"),
                authenticated: false,
            });
        });

        if (flows) {
            this.registerFlowCache.set("register_flows", flows);
            this.emit(AuthEvent.RegisterFlowUpdated, flows);
        }
        return flows;
    }

    /**
     * Check if a specific login flow is supported
     *
     * @param flowType - 登录流程类型（如 "m.login.password", "m.login.sso"）
     * @returns 是否支持该登录流程
     *
     * @example
     * ```typescript
     * // 检查是否支持密码登录
     * const hasPassword = await authManager.hasLoginFlow("m.login.password");
     * if (hasPassword) {
     *     console.log("Password login is available");
     * }
     *
     * // 检查是否支持 SSO
     * const hasSSO = await authManager.hasLoginFlow("m.login.sso");
     * ```
     *
     * @throws {ApiError} 如果获取登录流程失败
     */
    public async hasLoginFlow(flowType: string): Promise<boolean> {
        const flows = await this.getSupportedLoginFlows();
        return flows.flows?.some((flow: { type?: string }) => flow.type === flowType) ?? false;
    }

    /**
     * 检查是否支持密码登录
     *
     * @returns 是否支持密码登录
     *
     * @example
     * ```typescript
     * if (await authManager.hasPasswordLogin()) {
     *     // 显示密码登录表单
     *     showPasswordLoginForm();
     * }
     * ```
     */
    public async hasPasswordLogin(): Promise<boolean> {
        return this.hasLoginFlow("m.login.password");
    }

    /**
     * 检查是否支持 SSO 登录
     *
     * @returns 是否支持 SSO 或 CAS 登录
     *
     * @example
     * ```typescript
     * if (await authManager.hasSSOLogin()) {
     *     // 显示 SSO 登录按钮
     *     showSSOLoginButton();
     * }
     * ```
     */
    public async hasSSOLogin(): Promise<boolean> {
        const flows = await this.getSupportedLoginFlows();
        return (
            flows.flows?.some(
                (flow: { type?: string }) => flow.type === "m.login.sso" || flow.type === "m.login.cas",
            ) ?? false
        );
    }

    /**
     * Register a user
     *
     * @param username - The desired username (max 255 characters)
     * @param password - The desired password (max 128 characters, min 8 characters)
     * @param sessionId - The session ID from a previous registration attempt
     * @param auth - The auth dictionary
     * @param _bindThreepids - Map of third party IDs to bind
     * @param guestAccessToken - The guest access token to upgrade
     * @param inhibitLogin - Whether to inhibit login
     * @returns Promise which resolves to a RegisterResponse object
     *
     * @example
     * ```typescript
     * // 基本注册
     * const response = await authManager.register(
     *     "alice",
     *     "securePassword123",
     *     null,
     *     { type: "m.login.dummy" }
     * );
     * console.log("Registered:", response.user_id);
     *
     * // 注册前验证输入
     * const usernameCheck = AuthManager.validateUsernameFormat("alice");
     * if (!usernameCheck.valid) {
     *     console.error(usernameCheck.error);
     *     return;
     * }
     *
     * const passwordCheck = AuthManager.validatePasswordFormat("securePassword123");
     * if (!passwordCheck.valid) {
     *     console.error(passwordCheck.error);
     *     return;
     * }
     *
     * // 继续注册流程（带 session）
     * const response = await authManager.register(
     *     "alice",
     *     "securePassword123",
     *     "session_abc123",
     *     { type: "m.login.email.identity", session: "session_abc123" }
     * );
     * ```
     *
     * @throws {ValidationError} 当用户名或密码超过长度限制时
     * @throws {ApiError} 当注册失败时
     *   - M_USER_IN_USE (409): 用户名已被占用
     *   - M_INVALID_USERNAME (400): 用户名不符合规范
     *   - M_WEAK_PASSWORD (400): 密码不满足策略
     *
     * **安全提示**:
     * - 密码最少 8 个字符
     * - 建议使用强密码（包含大小写字母、数字、特殊字符）
     * - 不要在客户端存储明文密码
     * - 使用 HTTPS 传输
     *
     * 后端实现: synapse-rust/src/web/routes/auth_compat.rs:11-65
     */
    public async register(
        username: string,
        password: string,
        sessionId: string | null,
        auth: { session?: string; type: string },
        _bindThreepids?: { email?: boolean; msisdn?: boolean },
        guestAccessToken?: string,
        inhibitLogin?: boolean,
    ): Promise<RegisterResponse> {
        // 客户端验证
        this.validateUsername(username);
        this.validatePassword(password);

        if (sessionId) {
            auth.session = sessionId;
        }

        const params: RegisterRequest = {
            auth: auth,
            refresh_token: true,
        };
        if (username !== undefined && username !== null) {
            params.username = username;
        }
        if (password !== undefined && password !== null) {
            params.password = password;
        }
        if (guestAccessToken !== undefined && guestAccessToken !== null) {
            params.guest_access_token = guestAccessToken;
        }
        if (inhibitLogin !== undefined && inhibitLogin !== null) {
            params.inhibit_login = inhibitLogin;
        }

        return this.withRetry(
            async () =>
                this.request<RegisterResponse>({
                    method: Method.Post,
                    path: ap("/register"),
                    body: params,
                    prefix: ClientPrefix.V3,
                    authenticated: false,
                }),
            "register",
        );
    }

    /**
     * Register a guest account
     *
     * @param body - JSON HTTP body to provide
     * @returns Promise which resolves to RegisterResponse
     */
    public async registerGuest(body?: RegisterRequest): Promise<RegisterResponse> {
        return this.withRetry(
            async () =>
                this.request<RegisterResponse>({
                    method: Method.Post,
                    path: ap("/register"),
                    body: body || {},
                    prefix: ClientPrefix.V3,
                    authenticated: false,
                }),
            "registerGuest",
        );
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

    /**
     * 获取数据约束常量
     */
    public static getConstraints(): {
        USERNAME_MAX_LENGTH: number;
        PASSWORD_MAX_LENGTH: number;
        DEVICE_ID_LENGTH: number;
    } {
        return {
            USERNAME_MAX_LENGTH,
            PASSWORD_MAX_LENGTH,
            DEVICE_ID_LENGTH,
        };
    }

    /**
     * 验证用户名格式（客户端验证）
     * @param username - 用户名
     * @returns 验证结果和错误消息
     */
    public static validateUsernameFormat(username: string): { valid: boolean; error?: string } {
        if (!username || username.length === 0) {
            return { valid: false, error: "Username is required" };
        }
        if (username.length > USERNAME_MAX_LENGTH) {
            return { valid: false, error: `Username too long (max ${USERNAME_MAX_LENGTH} characters)` };
        }
        // 基本格式检查（Matrix ID 规范）
        if (!/^[a-z0-9._=\-/]+$/.test(username)) {
            return { valid: false, error: "Username contains invalid characters" };
        }
        return { valid: true };
    }

    /**
     * 验证密码格式（客户端验证）
     * @param password - 密码
     * @returns 验证结果和错误消息
     */
    public static validatePasswordFormat(password: string): { valid: boolean; error?: string } {
        if (!password || password.length === 0) {
            return { valid: false, error: "Password is required" };
        }
        if (password.length > PASSWORD_MAX_LENGTH) {
            return { valid: false, error: `Password too long (max ${PASSWORD_MAX_LENGTH} characters)` };
        }
        // 基本强度检查（可根据需要调整）
        if (password.length < 8) {
            return { valid: false, error: "Password too short (min 8 characters)" };
        }
        return { valid: true };
    }

    /**
     * Get captcha challenge for registration
     * GET /_matrix/client/v3/register/captcha
     */
    public async getCaptcha(): Promise<CaptchaResponse> {
        return this.withRetry(async () => {
            return await this.request<CaptchaResponse>({
                method: Method.Get,
                path: "/register/captcha",
                prefix: ClientPrefix.V3,
                authenticated: false,
            });
        }, "getCaptcha");
    }

    /**
     * Get current user info
     * GET /_matrix/client/v3/account/whoami
     */
    public async whoami(): Promise<WhoamiResponse> {
        return this.withRetry(async () => {
            return await this.request<WhoamiResponse>({
                method: Method.Get,
                path: "/account/whoami",
                prefix: ClientPrefix.V3,
            });
        }, "whoami");
    }

    /**
     * Logout current session
     * POST /_matrix/client/v3/logout
     */
    public async logout(): Promise<void> {
        return this.withRetry(async () => {
            await this.request({
                method: Method.Post,
                path: "/logout",
                prefix: ClientPrefix.V3,
            });
        }, "logout");
    }

    /**
     * Get SAML redirect URL
     * GET /_matrix/client/v3/login/sso/redirect/{idp_id}
     */
    public async getSamlRedirect(idpId: string): Promise<SamlRedirectResponse> {
        return this.withRetry(async () => {
            return await this.request<SamlRedirectResponse>({
                method: Method.Get,
                path: "/login/sso/redirect/saml",
                queryParams: { idp_id: idpId },
                prefix: ClientPrefix.V3,
            });
        }, "getSamlRedirect");
    }

    /**
     * Get server versions
     * GET /_matrix/client/versions
     */
    public async getVersions(): Promise<VersionsResponse> {
        return this.withRetry(async () => {
            return await this.request<VersionsResponse>({
                method: Method.Get,
                path: "/versions",
                prefix: "",
                authenticated: false,
            });
        }, "getVersions");
    }

    /**
     * Requests an email verification token for the purposes of registration.
     */
    public requestRegisterEmailToken(
        email: string,
        clientSecret: string,
        sendAttempt: number,
        nextLink?: string,
    ): Promise<IRequestTokenResponse> {
        return requestTokenFromEndpoint(
            "/register/email/requestToken",
            buildEmailTokenRequestParams(email, clientSecret, sendAttempt, nextLink),
            this.client.http.request.bind(this.client.http),
        );
    }

    /**
     * Requests a text message verification token for the purposes of registration.
     */
    public requestRegisterMsisdnToken(
        phoneCountry: string,
        phoneNumber: string,
        clientSecret: string,
        sendAttempt: number,
        nextLink?: string,
    ): Promise<IRequestMsisdnTokenResponse> {
        return requestTokenFromEndpoint(
            "/register/msisdn/requestToken",
            buildMsisdnTokenRequestParams(phoneCountry, phoneNumber, clientSecret, sendAttempt, nextLink),
            this.client.http.request.bind(this.client.http),
        );
    }

    /**
     * Requests an email verification token for the purposes of adding a
     * third party identifier to an account.
     */
    public requestAdd3pidEmailToken(
        email: string,
        clientSecret: string,
        sendAttempt: number,
        nextLink?: string,
    ): Promise<IRequestTokenResponse> {
        return requestTokenFromEndpoint(
            "/account/3pid/email/requestToken",
            buildEmailTokenRequestParams(email, clientSecret, sendAttempt, nextLink),
            this.client.http.request.bind(this.client.http),
        );
    }

    /**
     * Requests a text message verification token for the purposes of adding a
     * third party identifier to an account.
     */
    public requestAdd3pidMsisdnToken(
        phoneCountry: string,
        phoneNumber: string,
        clientSecret: string,
        sendAttempt: number,
        nextLink?: string,
    ): Promise<IRequestMsisdnTokenResponse> {
        return requestTokenFromEndpoint(
            "/account/3pid/msisdn/requestToken",
            buildMsisdnTokenRequestParams(phoneCountry, phoneNumber, clientSecret, sendAttempt, nextLink),
            this.client.http.request.bind(this.client.http),
        );
    }

    /**
     * Check whether a username is available prior to registration.
     * @param username - The username to check the availability of.
     * @returns Promise which resolves to boolean of whether the username is available.
     */
    public async isUsernameAvailable(username: string): Promise<boolean> {
        try {
            const response = await this.request<{ available: true }>({
                method: Method.Get,
                path: "/register/available",
                queryParams: { username },
            });
            return response.available;
            // @swallow-error { owner: "refactor-bot", expires: "2026-12-31" }
        } catch (error) {
            const response = error as { errcode?: string };
            if (response.errcode === "M_USER_IN_USE") {
                return false;
            }
            throw error;
        }
    }

    /**
     * Make a registration request.
     * @param data - parameters for registration request
     * @param kind - type of user to register. may be "guest"
     * @returns Promise which resolves to the /register response
     */
    public registerRequest(data: RegisterRequest, kind?: string): Promise<RegisterResponse> {
        const params: { kind?: string } = {};
        if (kind) {
            params.kind = kind;
        }
        return this.request({
            method: Method.Post,
            path: "/register",
            queryParams: params,
            body: data,
            authenticated: false,
        });
    }

    /**
     * Refreshes an access token using a provided refresh token.
     * @param refreshToken - The refresh token.
     * @returns Promise which resolves to the new token.
     */
    public async refreshToken(refreshToken: string): Promise<IRefreshTokenResponse> {
        const performRefreshRequestWithPrefix = (prefix: ClientPrefix): Promise<IRefreshTokenResponse> =>
            this.request({
                method: Method.Post,
                path: "/refresh",
                body: { refresh_token: refreshToken },
                prefix,
            });

        try {
            return await performRefreshRequestWithPrefix(ClientPrefix.V3);
        } catch (e) {
            const error = e as { errcode?: string };
            if (error.errcode === "M_UNRECOGNIZED") {
                return performRefreshRequestWithPrefix(ClientPrefix.V1);
            }
            throw e;
        }
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getAuthManager = function (): AuthManager {
        registerManagerClass("auth", AuthManager);
        return getOrCreateManager(this, "auth", () => new AuthManager(this));
    };
}
