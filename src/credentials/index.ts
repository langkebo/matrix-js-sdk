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
 * Credentials Manager - 凭证管理
 * 
 * 提供用户凭证相关功能
 */

import { MatrixClient } from "../client";

export class CredentialsManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get user id
     */
    public getUserId(): string | null {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).credentials?.userId || null;
    }

    /**
     * Get device id
     */
    public getDeviceId(): string | null {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).deviceId;
    }

    /**
     * Get access token
     */
    public getAccessToken(): string | undefined {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getAccessToken();
    }

    /**
     * Get base url
     */
    public getBaseUrl(): string {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).baseUrl;
    }

    /**
     * Get homeserver name
     */
    public getHomeserverName(): string {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const baseUrl = (this.client as any).baseUrl;
        if (!baseUrl) return "";
        // Extract hostname from URL like "http://localhost:8008"
        try {
            const url = new URL(baseUrl);
            return url.hostname;
        } catch {
            return baseUrl.replace(/^https?:\/\//, "").split(":")[0];
        }
    }

    /**
     * Get identity server
     */
    public getIdentityServer(): string | undefined {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const url = (this.client as any).getIdentityServerUrl?.();
        return url;
    }

    /**
     * Is logged in
     */
    public isLoggedIn(): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return !!((this.client as any).credentials?.userId);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getCredentialsManager(): CredentialsManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getCredentialsManager = function (): CredentialsManager {
        return new CredentialsManager(this);
    };
}

export default extendMatrixClient;
