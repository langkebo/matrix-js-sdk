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
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

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

export interface SessionsManagerEvents {
    session_created: { deviceId: string };
    session_revoked: { deviceId: string };
    session_refreshed: { deviceId: string };
}

export class SessionsManager extends BaseManager<keyof SessionsManagerEvents, SessionsManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public getActiveSessions(): ISessionInfo[] {
        return this.client.getActiveSessions();
    }

    public getSessionInfo(): ISessionInfo | null {
        return this.client.getSessionInfo();
    }

    public async refreshSession(): Promise<ISessionInfo> {
        return this.withRetry(() => this.client.refreshSession(), "refreshSession");
    }

    public async revokeSession(deviceId: string): Promise<void> {
        return this.withRetry(() => this.client.revokeSession(deviceId), "revokeSession");
    }

    public getLastActiveSession(): ISessionDetail | null {
        return this.client.getLastActiveSession();
    }

    public setLastActiveSession(sessionId: string): void {
        this.client.setLastActiveSession(sessionId);
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getSessionsManager = function (): SessionsManager {
        registerManagerClass("sessions", SessionsManager);
        return getOrCreateManager(this, "sessions", () => new SessionsManager(this));
    };
}
