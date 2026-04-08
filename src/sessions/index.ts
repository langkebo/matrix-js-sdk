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
 * Sessions Manager - 会话管理
 * 
 * 提供会话管理相关功能
 */

import { MatrixClient } from "../client";

export interface ISessionInfo {
    deviceId: string;
    userId: string;
    accessToken: string;
    refreshToken?: string;
    lastActiveTs?: number;
    isActive?: boolean;
}

export interface ISessionDetail {
    device_id: string;
    display_name?: string;
    last_seen_ip?: string;
    last_seen_ts?: number;
    user_id: string;
}

export class SessionsManager {
    constructor(private client: MatrixClient) {}

    public getActiveSessions(): ISessionInfo[] {
        return (this.client as unknown as {
            getActiveSessions: () => ISessionInfo[];
        }).getActiveSessions();
    }

    public getSessionInfo(): ISessionInfo | null {
        return (this.client as unknown as {
            getSessionInfo: () => ISessionInfo | null;
        }).getSessionInfo();
    }

    public async refreshSession(): Promise<ISessionInfo> {
        return (this.client as unknown as {
            refreshSession: () => Promise<ISessionInfo>;
        }).refreshSession();
    }

    public async revokeSession(deviceId: string): Promise<void> {
        return (this.client as unknown as {
            revokeSession: (deviceId: string) => Promise<void>;
        }).revokeSession(deviceId);
    }

    public getLastActiveSession(): ISessionDetail | null {
        return (this.client as unknown as {
            getLastActiveSession: () => ISessionDetail | null;
        }).getLastActiveSession();
    }

    public setLastActiveSession(sessionId: string): void {
        (this.client as unknown as {
            setLastActiveSession: (sessionId: string) => void;
        }).setLastActiveSession(sessionId);
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
