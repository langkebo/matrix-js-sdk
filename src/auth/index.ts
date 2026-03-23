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
 * 提供认证相关功能
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/index";

export class AuthManager {
    constructor(private client: MatrixClient) {}

    /**
     * Check if authenticated
     */
    public isAuthenticated(): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).isAuthenticated();
    }

    /**
     * Get auth login type
     */
    public getAuthLoginType(): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).authLoginType;
    }

    /**
     * Set auth payload
     */
    public setAuthPayload(payload: any): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).authPayload = payload;
    }

    /**
     * Get fallback text
     */
    public getFallbackRetryText(): string {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).fallbackGetLoginRetryText || "";
    }

    /**
     * Set fallback text
     */
    public setFallbackRetryText(text: string): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).fallbackGetLoginRetryText = text;
    }

    /**
     * Get supported login flows
     */
    public async getSupportedLoginFlows(): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(
            Method.Get,
            "/login"
        );
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
}

// Declare prototype extension
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
