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
import type { CaptchaPathPattern } from "./__generated__/route-table";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

type StripClientV3<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;
type StripClientR0<P extends string> = P extends `/_matrix/client/r0${infer Rest}` ? Rest : never;
type StripAdminV1<P extends string> = P extends `/_synapse/admin/v1${infer Rest}` ? Rest : never;
type CaptchaClientPath = StripClientV3<CaptchaPathPattern> | StripClientR0<CaptchaPathPattern>;
export type CaptchaApiVersion = "r0" | "v3";

function cp<P extends CaptchaClientPath>(path: P): P {
    return path;
}

function ap<P extends StripAdminV1<CaptchaPathPattern>>(path: P): P {
    return path;
}

function captchaPrefix(version: CaptchaApiVersion = "v3"): ClientPrefix.R0 | ClientPrefix.V3 {
    return version === "r0" ? ClientPrefix.R0 : ClientPrefix.V3;
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
