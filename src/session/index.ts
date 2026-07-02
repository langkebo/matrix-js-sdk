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

import { BaseManager } from "../managers/base-manager";
import { MatrixClient } from "../client";
import { type EmptyObject } from "../@types/common";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export class SessionManager extends BaseManager {
    constructor(client: MatrixClient) {
        super(client);
    }

    /**
     * Logout
     */
    public async logout(stopClient = false): Promise<EmptyObject> {
        return this.client.logout(stopClient);
    }

    /**
     * Deactivate account
     */
    public async deactivateAccount(): Promise<{ id_server_unbind_result: string }> {
        return this.client.deactivateAccount();
    }

    /**
     * Get access token
     */
    public getAccessToken(): string | null {
        return this.client.getAccessToken();
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
        return this.client.getSessionId() || null;
    }

    /**
     * Who am I
     */
    public async whoami(): Promise<unknown> {
        return this.client.whoami();
    }
}

// Declare prototype extension

export function extendMatrixClient(): void {
    MatrixClient.prototype.getSessionManager = function (): SessionManager {
        registerManagerClass("session", SessionManager);
    return getOrCreateManager(this, "session", () => new SessionManager(this));
    };
}

export default extendMatrixClient;
