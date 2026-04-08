/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You May obtain a copy of the License at

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
 * 对应后端: captcha_service
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api";

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

export class CaptchaManager {
    constructor(private client: MatrixClient) {}

    public async getCaptchaInfo(): Promise<CaptchaInfo | null> {
        const flows = await (this.client as unknown as {
            getLoginFlows: () => Promise<ILoginFlowsResponse>;
        }).getLoginFlows();
        
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
            session: response.session
        };
    }

    public async isCaptchaRequired(): Promise<boolean> {
        try {
            const flows = await (this.client as unknown as {
                getLoginFlows: () => Promise<ILoginFlowsResponse>;
            }).getLoginFlows();
            return flows.flows?.some((flow) => flow.type === "m.login.captcha") ?? false;
        } catch {
            return false;
        }
    }

    public async verifyCaptcha(session: string, captchaResponse: string): Promise<ICaptchaVerifyResponse> {
        return this.client.http.authedRequest<ICaptchaVerifyResponse>(
            Method.Post,
            "/captcha/_/login",
            undefined,
            {
                session,
                captcha_response: captchaResponse
            }
        );
    }

    public getCaptchaImageUrl(captchaInfo: CaptchaInfo): string {
        return captchaInfo.public_url;
    }

    public getCaptchaSessionId(captchaInfo: CaptchaInfo): string {
        return captchaInfo.session;
    }
}

// Declare prototype extension
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
