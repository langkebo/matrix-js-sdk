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
 * 提供验证码发送、验证、状态查询功能
 * 对应后端: /_matrix/client/r0/register/captcha/*
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api";
import { ClientPrefix } from "../http-api/prefix";
import { BaseManager } from "../managers/base-manager";

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

export interface CaptchaManagerEvents {
    captcha_sent: { captchaId: string; captchaType: string; expires_in: number };
    captcha_verified: { captchaId: string };
    captcha_expired: { captchaId: string };
}

interface CaptchaManagerEventMap {
    captcha_sent: (data: CaptchaManagerEvents["captcha_sent"]) => void;
    captcha_verified: (data: CaptchaManagerEvents["captcha_verified"]) => void;
    captcha_expired: (data: CaptchaManagerEvents["captcha_expired"]) => void;
}

export class CaptchaManager extends BaseManager<keyof CaptchaManagerEvents, CaptchaManagerEventMap> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public async sendCaptcha(
        captchaType: string,
        target: string,
        templateName?: string,
    ): Promise<CaptchaSendResponse> {
        try {
            const body: Record<string, unknown> = {
                captcha_type: captchaType,
                target,
            };
            if (templateName) {
                body.template_name = templateName;
            }

            const response = await this.client.http.authedRequest<CaptchaSendResponse>(
                Method.Post,
                "/register/captcha/send",
                undefined,
                body,
                { prefix: ClientPrefix.R0 },
            );

            this.emit("captcha_sent", {
                captchaId: response.captcha_id,
                captchaType: response.captcha_type,
                expires_in: response.expires_in,
            });

            return response;
        } catch (error) {
            throw this.normalizeError(error, "sendCaptcha");
        }
    }

    public async verifyCaptcha(captchaId: string, code: string): Promise<CaptchaVerifyResponse> {
        try {
            const response = await this.client.http.authedRequest<CaptchaVerifyResponse>(
                Method.Post,
                "/register/captcha/verify",
                undefined,
                { captcha_id: captchaId, code },
                { prefix: ClientPrefix.R0 },
            );

            if (response.verified) {
                this.emit("captcha_verified", { captchaId });
            }

            return response;
        } catch (error) {
            throw this.normalizeError(error, "verifyCaptcha");
        }
    }

    public async getCaptchaStatus(captchaId: string): Promise<CaptchaStatusResponse> {
        try {
            return await this.client.http.authedRequest<CaptchaStatusResponse>(
                Method.Get,
                "/register/captcha/status",
                { captcha_id: captchaId },
                undefined,
                { prefix: ClientPrefix.R0 },
            );
        } catch (error) {
            throw this.normalizeError(error, "getCaptchaStatus");
        }
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getCaptchaManager(): CaptchaManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getCaptchaManager = function (): CaptchaManager {
        return new CaptchaManager(this);
    };
}

export default extendMatrixClient;
