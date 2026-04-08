/*
Copyright 2024 The Matrix.org Foundation C.I.C.
*/

/** OIDC Manager */
export interface IOidcDiscovery { issuer: string; authorization_endpoint: string; token_endpoint: string }
export interface IOidcUserInfo { sub: string; name?: string; picture?: string; email?: string }
export interface IOidcTokenResponse { access_token: string; refresh_token?: string; id_token?: string; token_type: string; expires_in: number }
export interface IOidcAuthorizationRequest { client_id: string; redirect_uri: string; response_type: string; scope: string }
export interface IOidcClientRegistration { client_id: string; client_secret?: string }

import { type MatrixClient } from "../client";

export class OidcManager {
    private client: MatrixClient;
    private currentProvider: string | null = null;
    constructor(client: MatrixClient) { this.client = client; }
    async discover(provider: string): Promise<IOidcDiscovery | null> { return null; }
    async registerClient(issuer: string, redirectUris: string[]): Promise<IOidcClientRegistration | null> { return null; }
    async getUserInfo(accessToken: string): Promise<IOidcUserInfo | null> { return null; }
    async refreshToken(refreshToken: string): Promise<IOidcTokenResponse | null> { return null; }
    start(): void {}
    stop(): void {}
}
