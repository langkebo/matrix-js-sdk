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
 * SAML Authentication Manager - SAML认证管理
 *
 * 提供SAML认证登录、回调处理、登出、元数据查询功能
 * 对应后端: /_matrix/client/r0/login/sso/redirect/saml, /login/saml/callback, /saml/metadata 等
 */

import { logger } from "../logger";
import { TypedEventEmitter } from "../models/typed-event-emitter.ts";
import { Method } from "../http-api/method.ts";
import { AdminPrefix, ClientPrefix } from "../http-api/prefix.ts";
import { MatrixClient } from "../client";
import type { SamlPathPattern } from "./__generated__/route-table.ts";

type StripClientR0<P extends string> = P extends `/_matrix/client/r0${infer Rest}` ? Rest : never;
type StripAdminV1<P extends string> = P extends `/_synapse/admin/v1${infer Rest}` ? Rest : never;

function rp<P extends StripClientR0<SamlPathPattern>>(path: P): P {
    return path;
}

function ap<P extends StripAdminV1<SamlPathPattern>>(path: P): P {
    return path;
}

export enum SamlEvent {
    LoginInitiated = "LoginInitiated",
    LoginCompleted = "LoginCompleted",
    LoginFailed = "LoginFailed",
    LogoutCompleted = "LogoutCompleted",
    SamlError = "SamlError",
}

export interface SamlLoginResponse {
    redirect_url: string;
}

export interface SamlCallbackResponse {
    user_id: string;
    access_token: string;
    device_id: string;
    expires_in: number;
    refresh_token?: string;
}

export interface SamlLogoutResponse {
    redirect_url?: string;
    message?: string;
}

export interface SamlAdminLogoutRequest {
    user_id: string;
}

export interface SamlMetadataResponse {
    entity_id: string;
    sso_url: string;
    slo_url?: string;
    certificate?: string;
}

export interface SamlUserMapping {
    name_id: string;
    user_id: string;
    displayname?: string;
    email?: string;
    attributes?: Record<string, string[]>;
}

export interface SamlAttributeMapping {
    uid?: string;
    displayname?: string;
    email?: string;
}

export interface SamlServiceProviderConfig {
    sp_entity_id: string;
    sp_acs_url: string;
    sp_slo_url?: string;
    sp_name_id_format?: string;
}

export interface SamlIdentityProviderConfig {
    idp_entity_id: string;
    idp_sso_url: string;
    idp_slo_url?: string;
    idp_x509cert: string;
    idp_x509cert_new?: string;
}

export interface SamlConfig {
    sp: SamlServiceProviderConfig;
    idp: SamlIdentityProviderConfig;
    attribute_mapping?: SamlAttributeMapping;
    allow_unsolicited?: boolean;
    want_assertions_signed?: boolean;
    want_response_signed?: boolean;
}

interface SamlAuthManagerEventMap {
    [SamlEvent.LoginInitiated]: (redirectUrl: string) => void;
    [SamlEvent.LoginCompleted]: (userId: string, response: SamlCallbackResponse) => void;
    [SamlEvent.LoginFailed]: (error: Error) => void;
    [SamlEvent.LogoutCompleted]: () => void;
    [SamlEvent.SamlError]: (error: Error) => void;
}

export class SamlAuthManager extends TypedEventEmitter<SamlEvent, SamlAuthManagerEventMap> {
    private client: MatrixClient;
    private config: SamlConfig | null = null;
    private userMappings: Map<string, SamlUserMapping> = new Map();

    constructor(client: MatrixClient) {
        super();
        this.client = client;
    }

    async initiateLogin(redirectUrl?: string): Promise<SamlLoginResponse> {
        try {
            const response = await this.client.http.request<SamlLoginResponse>(
                Method.Post,
                rp("/login/sso/redirect/saml"),
                redirectUrl ? { redirect_url: redirectUrl } : undefined,
                undefined,
                { prefix: ClientPrefix.R0 },
            );

            this.emit(SamlEvent.LoginInitiated, response.redirect_url);

            return response;
        } catch (error) {
            this.emit(SamlEvent.SamlError, error as Error);
            throw error;
        }
    }

    async handleCallback(samlResponse: string, relayState?: string): Promise<SamlCallbackResponse> {
        try {
            const response = await this.client.http.request<SamlCallbackResponse>(
                Method.Post,
                rp("/login/saml/callback"),
                undefined,
                {
                    saml_response: samlResponse,
                    relay_state: relayState,
                },
                { prefix: ClientPrefix.R0 },
            );

            this.emit(SamlEvent.LoginCompleted, response.user_id, response);

            return response;
        } catch (error) {
            this.emit(SamlEvent.LoginFailed, error as Error);
            throw error;
        }
    }

    async logout(): Promise<SamlLogoutResponse> {
        try {
            const response = await this.client.http.request<SamlLogoutResponse>(
                Method.Get,
                rp("/logout/saml"),
                undefined,
                undefined,
                { prefix: ClientPrefix.R0 },
            );

            this.emit(SamlEvent.LogoutCompleted);

            return response;
        } catch (error) {
            this.emit(SamlEvent.SamlError, error as Error);
            throw error;
        }
    }

    async handleLogoutCallback(samlResponse: string): Promise<void> {
        try {
            await this.client.http.request(
                Method.Get,
                rp("/logout/saml/callback"),
                { saml_response: samlResponse },
                undefined,
                { prefix: ClientPrefix.R0 },
            );
        } catch (error) {
            this.emit(SamlEvent.SamlError, error as Error);
            throw error;
        }
    }

    async getIdpMetadata(): Promise<SamlMetadataResponse> {
        try {
            return await this.client.http.request<SamlMetadataResponse>(
                Method.Get,
                rp("/saml/metadata"),
                undefined,
                undefined,
                { prefix: ClientPrefix.R0 },
            );
        } catch (error) {
            this.emit(SamlEvent.SamlError, error as Error);
            throw error;
        }
    }

    async getSpMetadata(): Promise<string> {
        try {
            const response = await this.client.http.request<string>(
                Method.Get,
                rp("/saml/sp_metadata"),
                undefined,
                undefined,
                { prefix: ClientPrefix.R0 },
            );

            return typeof response === "string" ? response : JSON.stringify(response);
        } catch (error) {
            this.emit(SamlEvent.SamlError, error as Error);
            throw error;
        }
    }

    async getConfig(): Promise<SamlConfig | null> {
        if (this.config) {
            return this.config;
        }

        try {
            const response = await this.client.http.authedRequest(Method.Get, ap("/saml/config"), undefined, undefined, {
                prefix: AdminPrefix.V1,
            });

            this.config = response as SamlConfig;
            return this.config;
        } catch (e) {
            logger.warn("SamlAuthManager.getConfig failed:", e);
            return null;
        }
    }

    async updateConfig(config: Partial<SamlConfig>): Promise<void> {
        try {
            await this.client.http.authedRequest(Method.Put, ap("/saml/config"), undefined, config, {
                prefix: AdminPrefix.V1,
            });

            this.config = { ...this.config, ...config } as SamlConfig;
        } catch (error) {
            this.emit(SamlEvent.SamlError, error as Error);
            throw error;
        }
    }

    async getUserMapping(nameId: string): Promise<SamlUserMapping | null> {
        if (this.userMappings.has(nameId)) {
            return this.userMappings.get(nameId) || null;
        }

        try {
            const response = await this.client.http.authedRequest(
                Method.Get,
                ap(`/saml/mapping/${encodeURIComponent(nameId)}` as StripAdminV1<SamlPathPattern>),
                undefined,
                undefined,
                { prefix: AdminPrefix.V1 },
            );

            const mapping = response as SamlUserMapping;
            this.userMappings.set(nameId, mapping);

            return mapping;
        } catch (e) {
            logger.warn("SamlAuthManager.getUserMapping failed:", e);
            return null;
        }
    }

    async getUserMappings(): Promise<SamlUserMapping[]> {
        try {
            const response = await this.client.http.authedRequest<{ mappings?: SamlUserMapping[] }>(
                Method.Get,
                ap("/saml/mappings"),
                undefined,
                undefined,
                { prefix: AdminPrefix.V1 },
            );

            const mappings = response.mappings || [];
            this.userMappings.clear();
            mappings.forEach((m) => this.userMappings.set(m.name_id, m));

            return mappings;
        } catch (e) {
            logger.warn("SamlAuthManager.getUserMappings failed:", e);
            return Array.from(this.userMappings.values());
        }
    }

    async updateUserMapping(nameId: string, mapping: Partial<SamlUserMapping>): Promise<void> {
        try {
            await this.client.http.authedRequest(
                Method.Put,
                ap(`/saml/mapping/${encodeURIComponent(nameId)}` as StripAdminV1<SamlPathPattern>),
                undefined,
                mapping,
                { prefix: AdminPrefix.V1 },
            );

            const existing = this.userMappings.get(nameId);
            const updated = { ...existing, ...mapping, name_id: nameId } as SamlUserMapping;
            this.userMappings.set(nameId, updated);
        } catch (error) {
            this.emit(SamlEvent.SamlError, error as Error);
            throw error;
        }
    }

    async removeUserMapping(nameId: string): Promise<void> {
        try {
            await this.client.http.authedRequest(
                Method.Delete,
                ap(`/saml/mapping/${encodeURIComponent(nameId)}` as StripAdminV1<SamlPathPattern>),
                undefined,
                undefined,
                { prefix: AdminPrefix.V1 },
            );

            this.userMappings.delete(nameId);
        } catch (error) {
            this.emit(SamlEvent.SamlError, error as Error);
            throw error;
        }
    }

    getCachedMapping(nameId: string): SamlUserMapping | null {
        return this.userMappings.get(nameId) || null;
    }

    async refreshMetadata(): Promise<void> {
        try {
            await this.client.http.authedRequest(Method.Post, ap("/saml/metadata/refresh"), undefined, undefined, {
                prefix: AdminPrefix.V1,
            });
            this.config = null;
        } catch (error) {
            this.emit(SamlEvent.SamlError, error as Error);
            throw error;
        }
    }

    async adminLogout(request: SamlAdminLogoutRequest): Promise<void> {
        try {
            await this.client.http.authedRequest(Method.Post, ap("/saml/logout"), undefined, request, {
                prefix: AdminPrefix.V1,
            });
        } catch (error) {
            this.emit(SamlEvent.SamlError, error as Error);
            throw error;
        }
    }

    getCachedMappings(): SamlUserMapping[] {
        return Array.from(this.userMappings.values());
    }

    clearCache(): void {
        this.userMappings.clear();
        this.config = null;
    }

    async start(): Promise<void> {
        try {
            await this.getConfig();
            await this.getUserMappings();
        } catch (e) {
            logger.warn("SamlAuthManager.start failed:", e);
        }
    }

    stop(): void {
        this.userMappings.clear();
        this.config = null;
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getSamlAuthManager(): SamlAuthManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getSamlAuthManager = function (): SamlAuthManager {
        return new SamlAuthManager(this);
    };
}

export default extendMatrixClient;
