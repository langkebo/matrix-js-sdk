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
 * 对应后端: captcha_service
 */

import { MatrixClient } from "../client";

export interface CaptchaInfo {
    public_url: string;
    session: string;
}

/**
 * 验证码管理器
 * 对应后端服务: captcha_service
 */
export class CaptchaManager {
    constructor(private client: MatrixClient) {}

    /**
     * 获取验证码信息
     * 用于登录时获取验证码挑战
     */
    public async getCaptchaInfo(): Promise<CaptchaInfo | null> {
        // 检查是否需要验证码
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const flows = await (this.client as any).getLoginFlows();
        
        const captchaFlow = flows.flows?.find((flow: any) => flow.type === "m.login.captcha");
        
        if (!captchaFlow) {
            return null;
        }
        
        // 触发验证码流程
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const response = await (this.client as any).http.authedRequest(
            undefined,
            "GET",
            "/captcha/_/login"
        );
        
        return {
            public_url: response.public_url,
            session: response.session
        };
    }

    /**
     * 检查登录是否需要验证码
     */
    public async isCaptchaRequired(): Promise<boolean> {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const flows = await (this.client as any).getLoginFlows();
            return flows.flows?.some((flow: any) => flow.type === "m.login.captcha") ?? false;
        } catch {
            return false;
        }
    }

    /**
     * 验证验证码
     * 用于完成需要验证码的登录流程
     */
    public async verifyCaptcha(session: string, captchaResponse: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(
            undefined,
            "POST",
            "/captcha/_/login",
            {},
            {
                session,
                captcha_response: captchaResponse
            }
        );
    }

    /**
     * 获取验证码图片URL
     */
    public getCaptchaImageUrl(captchaInfo: CaptchaInfo): string {
        return captchaInfo.public_url;
    }

    /**
     * 获取验证码session ID
     */
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
