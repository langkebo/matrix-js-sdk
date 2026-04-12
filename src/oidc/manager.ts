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

/** OIDC Manager */

import { MatrixClient } from "../client";
import { BaseManager } from "../managers/base-manager";

export interface IOidcDiscovery {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
}

export interface IOidcUserInfo {
    sub: string;
    name?: string;
    picture?: string;
    email?: string;
}

export interface IOidcTokenResponse {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    token_type: string;
    expires_in: number;
}

export interface IOidcAuthorizationRequest {
    client_id: string;
    redirect_uri: string;
    response_type: string;
    scope: string;
}

export interface IOidcClientRegistration {
    client_id: string;
    client_secret?: string;
}

export interface OidcManagerEvents {
    oidc_discovered: { issuer: string };
    oidc_token_refreshed: { expires_in: number };
    oidc_error: { error: Error };
}

export class OidcManager extends BaseManager<keyof OidcManagerEvents, OidcManagerEvents> {
    private currentProvider: string | null = null;

    constructor(client: MatrixClient) {
        super(client);
    }

    async discover(provider: string): Promise<IOidcDiscovery | null> {
        return this.withRetry(
            () =>
                (
                    this.client as unknown as {
                        discoverOidc: (provider: string) => Promise<IOidcDiscovery | null>;
                    }
                ).discoverOidc(provider),
            "discover",
        );
    }

    async registerClient(issuer: string, redirectUris: string[]): Promise<IOidcClientRegistration | null> {
        return this.withRetry(
            () =>
                (
                    this.client as unknown as {
                        registerOidcClient: (
                            issuer: string,
                            redirectUris: string[],
                        ) => Promise<IOidcClientRegistration | null>;
                    }
                ).registerOidcClient(issuer, redirectUris),
            "registerClient",
        );
    }

    async getUserInfo(accessToken: string): Promise<IOidcUserInfo | null> {
        return this.withRetry(
            () =>
                (
                    this.client as unknown as {
                        getOidcUserInfo: (accessToken: string) => Promise<IOidcUserInfo | null>;
                    }
                ).getOidcUserInfo(accessToken),
            "getUserInfo",
        );
    }

    async refreshToken(refreshToken: string): Promise<IOidcTokenResponse | null> {
        return this.withRetry(
            () =>
                (
                    this.client as unknown as {
                        refreshOidcToken: (refreshToken: string) => Promise<IOidcTokenResponse | null>;
                    }
                ).refreshOidcToken(refreshToken),
            "refreshToken",
        );
    }

    start(): void {}

    stop(): void {}
}

declare module "../client.ts" {
    interface MatrixClient {
        getOidcManager(): OidcManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getOidcManager = function (): OidcManager {
        return new OidcManager(this);
    };
}

export default extendMatrixClient;
