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
 * 提供验证码相关功能
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api";
import { BaseManager } from "../managers/base-manager";

export interface CaptchaInfo {
    public_url: string;
    session: string;
}

export interface ILoginFlow {
    type: string;
    [key: string]: unknown;
}

export interface ILoginFlowsResponse {
    flows: ILoginFlow[];
}

export interface ICaptchaVerifyResponse {
    success: boolean;
    session: string;
}

export interface CaptchaManagerEvents {
    captcha_required: { session: string };
    captcha_verified: { session: string };
}

export class CaptchaManager extends BaseManager<keyof CaptchaManagerEvents, CaptchaManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public async getCaptchaInfo(): Promise<CaptchaInfo | null> {
        return this.withRetry(async () => {
            const flows = await (
                this.client as unknown as {
                    getLoginFlows: () => Promise<ILoginFlowsResponse>;
                }
            ).getLoginFlows();

            const captchaFlow = flows.flows?.find((flow) => flow.type === "m.login.captcha");

            if (!captchaFlow) {
                return null;
            }

            const response = await this.client.http.authedRequest<{
                public_url: string;
                session: string;
            }>(Method.Get, "/captcha/_/login");

            return {
                public_url: response.public_url,
                session: response.session,
            };
        }, "getCaptchaInfo");
    }

    public async isCaptchaRequired(): Promise<boolean> {
        try {
            const flows = await (
                this.client as unknown as {
                    getLoginFlows: () => Promise<ILoginFlowsResponse>;
                }
            ).getLoginFlows();
            return flows.flows?.some((flow) => flow.type === "m.login.captcha") ?? false;
        } catch {
            return false;
        }
    }

    public async verifyCaptcha(session: string, captchaResponse: string): Promise<ICaptchaVerifyResponse> {
        return this.withRetry(
            () =>
                this.client.http.authedRequest<ICaptchaVerifyResponse>(Method.Post, "/captcha/_/login", undefined, {
                    session,
                    captcha_response: captchaResponse,
                }),
            "verifyCaptcha",
        );
    }

    public getCaptchaImageUrl(captchaInfo: CaptchaInfo): string {
        return captchaInfo.public_url;
    }

    public getCaptchaSessionId(captchaInfo: CaptchaInfo): string {
        return captchaInfo.session;
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
