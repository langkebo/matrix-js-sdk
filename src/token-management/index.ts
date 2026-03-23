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
 * Token Manager - Token管理
 * 
 * 提供各种Token管理功能
 */

import { MatrixClient } from "../client";

export class TokenManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get access token
     */
    public getAccessToken(): string | undefined {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getAccessToken();
    }

    /**
     * Get device ID
     */
    public getDeviceId(): string | null {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).deviceId;
    }

    /**
     * Get user ID
     */
    public getUserId(): string | undefined {
        return this.client.credentials.userId ?? undefined;
    }

    /**
     * Get homeserver URL
     */
    public getHomeserverUrl(): string {
        return this.client.baseUrl;
    }

    /**
     * Get identity server URL
     */
    public getIdentityServerUrl(): string | undefined {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).idBaseUrl;
    }

    /**
     * Get session ID
     */
    public getSessionId(): string | undefined {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).sessionId;
    }

    /**
     * Check if has access token
     */
    public hasAccessToken(): boolean {
        return !!this.getAccessToken();
    }

    /**
     * Check if has device ID
     */
    public hasDeviceId(): boolean {
        return !!this.getDeviceId();
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getTokenManager(): TokenManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getTokenManager = function (): TokenManager {
        return new TokenManager(this);
    };
}

export default extendMatrixClient;
