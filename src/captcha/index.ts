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
 * Captcha Manager - 验证码管理
 *
 * 提供验证码发送、验证、状态查询以及管理清理功能
 * 对应后端: /_matrix/client/{r0,v3}/register/captcha/* 与 /_synapse/admin/v1/captcha/cleanup
 */

import { MatrixClient } from "../client";
import type { IContent } from "../models/event";
import { Method } from "../http-api";
import { AdminPrefix, ClientPrefix } from "../http-api/prefix";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import type { CaptchaPath } from "./__generated__/route-table";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import type { PathAssert, StripAdminV1, StripV3 } from "../http-api/strip-prefix";

type CaptchaClientPath = StripV3<CaptchaPath>;
export type CaptchaApiVersion = "v3";

function cp<const P extends string>(path: P & PathAssert<P, CaptchaClientPath>): P {
    return path;
}

function ap<const P extends string>(path: P & PathAssert<P, StripAdminV1<CaptchaPath>>): P {
    return path;
}

function captchaPrefix(_version: CaptchaApiVersion = "v3"): ClientPrefix.V3 {
    return ClientPrefix.V3;
}

export interface CaptchaSendResponse {
    captcha_id: string;
    expires_in: number;
    captcha_type: string;
}

export interface CaptchaVerifyResponse {
    verified: boolean;
}

export interface CaptchaStatusResponse {
    captcha_id: string;
    captcha_type: string;
    target: string;
    status: string;
    attempt_count: number;
    max_attempts: number;
    expires_at: number;
    created_at: number;
}

export interface CaptchaCleanupResponse {
    cleaned_count: number;
    message: string;
}

export interface CaptchaManagerEvents {
    captchaSent: { captchaId: string; captchaType: string; expires_in: number };
    captchaVerified: { captchaId: string };
    captchaExpired: { captchaId: string };
}

interface CaptchaManagerEventMap {
    captchaSent: (data: CaptchaManagerEvents["captchaSent"]) => void;
    captchaVerified: (data: CaptchaManagerEvents["captchaVerified"]) => void;
    captchaExpired: (data: CaptchaManagerEvents["captchaExpired"]) => void;
}

export class CaptchaManager extends BaseManager<keyof CaptchaManagerEvents, CaptchaManagerEventMap> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * 发送验证码。
     *
     * @param captchaType - 验证码类型
     * @param target - 目标（如邮箱或手机号）
     * @param templateName - 可选模板名
     * @param version - API 版本，默认 v3
     * @returns 验证码发送结果（captcha_id / expires_in / captcha_type）
     * @throws {SdkError} 请求失败时
     *
     * @example
     * ```typescript
     * const result = await client.getCaptchaManager().sendCaptcha("email", "alice@example.org");
     * ```
     */
    public async sendCaptcha(
        captchaType: string,
        target: string,
        templateName?: string,
        version?: CaptchaApiVersion,
    ): Promise<CaptchaSendResponse> {
        try {
            const body: IContent = {
                captcha_type: captchaType,
                target,
            };
            if (templateName) {
                body.template_name = templateName;
            }

            const response = await this.withRetry(async () => {
                return await this.request<CaptchaSendResponse>({
                    method: Method.Post,
                    path: cp("/register/captcha/send"),
                    body: body,
                    prefix: captchaPrefix(version),
                    authenticated: false,
                });
            }, "sendCaptcha");

            this.emit("captchaSent", {
                captchaId: response.captcha_id,
                captchaType: response.captcha_type,
                expires_in: response.expires_in,
            });

            return response;
        } catch (error) {
            throw this.normalizeError(error, "sendCaptcha");
        }
    }

    /**
     * 校验验证码。
     *
     * @param captchaId - 验证码 ID
     * @param code - 用户提交的验证码
     * @param version - API 版本，默认 v3
     * @returns 校验结果（verified）
     * @throws {SdkError} 请求失败时
     *
     * @example
     * ```typescript
     * const { verified } = await client.getCaptchaManager().verifyCaptcha("captcha-id", "123456");
     * ```
     */
    public async verifyCaptcha(
        captchaId: string,
        code: string,
        version?: CaptchaApiVersion,
    ): Promise<CaptchaVerifyResponse> {
        try {
            const response = await this.withRetry(async () => {
                return await this.request<CaptchaVerifyResponse>({
                    method: Method.Post,
                    path: cp("/register/captcha/verify"),
                    body: { captcha_id: captchaId, code },
                    prefix: captchaPrefix(version),
                    authenticated: false,
                });
            }, "verifyCaptcha");

            if (response.verified) {
                this.emit("captchaVerified", { captchaId });
            }

            return response;
        } catch (error) {
            throw this.normalizeError(error, "verifyCaptcha");
        }
    }

    /**
     * 查询验证码状态。
     *
     * @param captchaId - 验证码 ID
     * @param version - API 版本，默认 v3
     * @returns 验证码状态详情
     * @throws {SdkError} 请求失败时
     *
     * @example
     * ```typescript
     * const status = await client.getCaptchaManager().getCaptchaStatus("captcha-id");
     * ```
     */
    public async getCaptchaStatus(captchaId: string, version?: CaptchaApiVersion): Promise<CaptchaStatusResponse> {
        try {
            return await this.withRetry(async () => {
                return await this.request<CaptchaStatusResponse>({
                    method: Method.Get,
                    path: cp("/register/captcha/status"),
                    queryParams: { captcha_id: captchaId },
                    prefix: captchaPrefix(version),
                    authenticated: false,
                });
            }, "getCaptchaStatus");
        } catch (error) {
            throw this.normalizeError(error, "getCaptchaStatus");
        }
    }

    /**
     * 通过管理员 POST 路由清理过期验证码。
     *
     * POST /_synapse/admin/v1/captcha/cleanup
     *
     * @returns 清理结果（cleaned_count / message）
     * @throws {SdkError} 请求失败时
     *
     * @example
     * ```typescript
     * const result = await client.getCaptchaManager().cleanupExpiredCaptchas();
     * ```
     */
    public async cleanupExpiredCaptchas(): Promise<CaptchaCleanupResponse> {
        try {
            return await this.withRetry(async () => {
                return await this.request<CaptchaCleanupResponse>({
                    method: Method.Post,
                    path: ap("/captcha/cleanup"),
                    prefix: AdminPrefix.V1,
                });
            }, "cleanupExpiredCaptchas");
        } catch (error) {
            throw this.normalizeError(error, "cleanupExpiredCaptchas");
        }
    }

    /**
     * Delete expired captchas via the client-side DELETE route.
     * DELETE /_matrix/client/v3/register/captcha/clean
     *
     * Unlike `cleanupExpiredCaptchas()` which uses the admin POST route,
     * this method uses the client-facing DELETE endpoint.
     *
     * @returns 清理结果（cleaned_count / message）
     * @throws {SdkError} 请求失败时
     *
     * @example
     * ```typescript
     * const result = await client.getCaptchaManager().deleteExpiredCaptchas();
     * ```
     */
    public async deleteExpiredCaptchas(): Promise<CaptchaCleanupResponse> {
        try {
            return await this.withRetry(async () => {
                return await this.request<CaptchaCleanupResponse>({
                    method: Method.Delete,
                    path: "/register/captcha/clean",
                    prefix: ClientPrefix.V3,
                });
            }, "deleteExpiredCaptchas");
        } catch (error) {
            throw this.normalizeError(error, "deleteExpiredCaptchas");
        }
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getCaptchaManager = function (): CaptchaManager {
        registerManagerClass("captcha", CaptchaManager);
        return getOrCreateManager(this, "captcha", () => new CaptchaManager(this));
    };
}
