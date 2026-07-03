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
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export interface CredentialsInfo {
    userId: string | null;
    deviceId: string | null;
    baseUrl: string;
    identityServer?: string;
}

export interface CredentialsManagerEvents {
    credentials_changed: { userId: string | null };
    logged_in: { userId: string };
    logged_out: void;
}

export class CredentialsManager extends BaseManager<keyof CredentialsManagerEvents, CredentialsManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public getUserId(): string | null {
        return this.client.credentials.userId || null;
    }

    public getDeviceId(): string | null {
        return this.client.deviceId;
    }

    public getAccessToken(): string | null {
        return this.client.getAccessToken();
    }

    public getBaseUrl(): string {
        return this.client.baseUrl;
    }

    public getHomeserverName(): string {
        const baseUrl = this.client.baseUrl;
        if (!baseUrl) return "";
        try {
            const url = new URL(baseUrl);
            return url.hostname;
        } catch {
            return baseUrl.replace(/^https?:\/\//, "").split(":")[0];
        }
    }

    public getIdentityServer(): string | undefined {
        return this.client.getIdentityServerManager().getIdentityServerUrl();
    }

    public isLoggedIn(): boolean {
        return !!this.client.credentials.userId;
    }

    public getCredentialsInfo(): CredentialsInfo {
        return {
            userId: this.getUserId(),
            deviceId: this.getDeviceId(),
            baseUrl: this.getBaseUrl(),
            identityServer: this.getIdentityServer(),
        };
    }
}


export function extendMatrixClient(): void {
    MatrixClient.prototype.getCredentialsManager = function (): CredentialsManager {
        registerManagerClass("credentials", CredentialsManager);
    return getOrCreateManager(this, "credentials", () => new CredentialsManager(this));
    };
}

export default extendMatrixClient;
