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
 * Sessions Manager - 会话管理
 * 
 * 提供会话管理相关功能
 */

import { MatrixClient } from "../client";

export class SessionsManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get active sessions
     */
    public getActiveSessions(): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getActiveSessions();
    }

    /**
     * Get session info
     */
    public getSessionInfo(): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getSessionInfo();
    }

    /**
     * Refresh session
     */
    public async refreshSession(): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).refreshSession();
    }

    /**
     * Revoke session
     */
    public async revokeSession(deviceId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).revokeSession(deviceId);
    }

    /**
     * Get last active session
     */
    public getLastActiveSession(): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getLastActiveSession();
    }

    /**
     * Set last active session
     */
    public setLastActiveSession(sessionId: string): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).setLastActiveSession(sessionId);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getSessionsManager(): SessionsManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getSessionsManager = function (): SessionsManager {
        return new SessionsManager(this);
    };
}

export default extendMatrixClient;
