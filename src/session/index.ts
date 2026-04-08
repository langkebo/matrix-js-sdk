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
 * Session Manager - 会话管理
 * 
 * 提供登录、登出、会话管理等功能
 */

import { MatrixClient } from "../client";
import { type EmptyObject } from "../@types/common";

export class SessionManager {
    constructor(private client: MatrixClient) {}

    /**
     * Logout
     */
    public async logout(stopClient = false): Promise<EmptyObject> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).logout(stopClient);
    }

    /**
     * Deactivate account
     */
    public async deactivateAccount(): Promise<EmptyObject> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).deactivateAccount();
    }

    /**
     * Get access token
     */
    public getAccessToken(): string | undefined {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getAccessToken();
    }

    /**
     * Check if logged in
     */
    public isLoggedIn(): boolean {
        return !!this.client.credentials.userId && !!this.getAccessToken();
    }

    /**
     * Get session ID
     */
    public getSessionId(): string | null {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).sessionId || null;
    }

    /**
     * Who am I
     */
    public async whoami(): Promise<unknown> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).whoami();
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getSessionManager(): SessionManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getSessionManager = function (): SessionManager {
        return new SessionManager(this);
    };
}

export default extendMatrixClient;
