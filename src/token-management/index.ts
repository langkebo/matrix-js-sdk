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
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export interface TokenInfo {
    accessToken: string | undefined;
    deviceId: string | null;
    userId: string | undefined;
    homeserverUrl: string;
    identityServerUrl: string | undefined;
    sessionId: string | undefined;
}

export interface TokenManagerEvents {
    token_refreshed: void;
    token_expired: void;
    session_created: { sessionId: string };
}

export class TokenManager extends BaseManager<keyof TokenManagerEvents, TokenManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public getAccessToken(): string | undefined {
        return this.client.getAccessToken() ?? undefined;
    }

    public getDeviceId(): string | null {
        return this.client.deviceId;
    }

    public getUserId(): string | undefined {
        return this.client.credentials.userId ?? undefined;
    }

    public getHomeserverUrl(): string {
        return this.client.baseUrl;
    }

    public getIdentityServerUrl(): string | undefined {
        return this.client.idBaseUrl;
    }

    public getSessionId(): string | undefined {
        return this.client.getSessionId();
    }

    public hasAccessToken(): boolean {
        return !!this.getAccessToken();
    }

    public hasDeviceId(): boolean {
        return !!this.getDeviceId();
    }

    public getTokenInfo(): TokenInfo {
        return {
            accessToken: this.getAccessToken(),
            deviceId: this.getDeviceId(),
            userId: this.getUserId(),
            homeserverUrl: this.getHomeserverUrl(),
            identityServerUrl: this.getIdentityServerUrl(),
            sessionId: this.getSessionId(),
        };
    }
}


export function extendMatrixClient(): void {
    MatrixClient.prototype.getTokenManager = function (): TokenManager {
        registerManagerClass("tokenManagement", TokenManager);
    return getOrCreateManager(this, "tokenManagement", () => new TokenManager(this));
    };
}

export default extendMatrixClient;
