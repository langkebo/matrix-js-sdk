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
 * Account Manager - 账户与认证管理
 *
 * 提供登录、登出、Token 管理等功能
 */

import { BaseManager } from "../managers/base-manager";
import { MatrixClient } from "../client";
import { Method } from "../http-api/index";
import { type EmptyObject } from "../@types/common";
import {
    type LoginRequest,
    type LoginResponse,
    type ILoginFlowsResponse,
    SSOAction,
    type LoginTokenPostResponse,
} from "../@types/auth";
import { type AuthDict } from "../interactive-auth";
import { type IdServerUnbindResult } from "../@types/partials";
import { ClientPrefix, VendorPrefix } from "../http-api/prefix";
import * as utils from "../utils";
import { IGuestAccessOpts } from "../@types/requests";
import type { IContent } from "../models/event";
import type { AuthPathPattern } from "../auth/__generated__/route-table";
import { normalizeExpiresInMs } from "../auth/normalize-expires";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

type StripAuthPrefix<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;

function ap<P extends StripAuthPrefix<AuthPathPattern>>(path: P): P {
    return path;
}

type Body = IContent;
type UIARequest<T> = T & {
    auth?: AuthDict;
};

const SSO_ACTION_PARAM = {
    stable: "action",
    unstable: "org.matrix.msc3824.action",
};

export interface MyRoomEntry {
    room_id: string;
    name?: string;
}

export interface MyRoomsResponse {
    rooms: MyRoomEntry[];
    total: number;
}

export interface EventsResponse {
    chunk: IContent[];
    start?: string;
    end?: string;
}

export interface EventsRequestOptions {
    from?: string;
    to?: string;
    dir?: "f" | "b";
    limit?: number;
    timeout?: number;
}

export class AccountManager extends BaseManager {
    /**
     * Get the session ID
     */
    public getSessionId(): string {
        return this.client.getSessionId();
    }

    /**
     * Check if the current user is a guest
     */
    public isGuest(): boolean {
        return this.client.isGuest();
    }

    /**
     * Set whether the current user is a guest
     */
    public setGuest(guest: boolean): void {
        this.client.setGuest(guest);
    }

    /**
     * Get the access token
     */
    public getAccessToken(): string | null {
        return this.client.http.opts.accessToken ?? null;
    }

    /**
     * Set the access token
     */
    public setAccessToken(token: string): void {
        this.client.http.opts.accessToken = token;
    }

    /**
     * Get login flows supported by the server
     */
    public loginFlows(): Promise<ILoginFlowsResponse> {
        return this.withRetry(async () => {
            return await this.request<ILoginFlowsResponse>({
                method: Method.Get,
                path: ap("/login"),
                authenticated: false,
            });
        }, "loginFlows");
    }

    /**
     * Get CAS login URL
     */
    public getCasLoginUrl(redirectUrl: string): string {
        return this.getSsoLoginUrl(redirectUrl, "cas");
    }

    /**
     * Get SSO login URL
     */
    public getSsoLoginUrl(redirectUrl: string, loginType = "sso", idpId?: string, action?: SSOAction): string {
        let url = "/login/" + loginType + "/redirect";
        if (idpId) {
            url += "/" + idpId;
        }

        const params = {
            redirectUrl,
            [SSO_ACTION_PARAM.stable!]: action,
            [SSO_ACTION_PARAM.unstable!]: action,
        };

        return this.client.http.getUrl(url, params).href;
    }

    /**
     * Send a login request
     */
    public async loginRequest(data: LoginRequest): Promise<LoginResponse> {
        return await this.withRetry(async () => {
            const response = await this.request<LoginResponse & { expires_in?: number }>({
                method: Method.Post,
                path: ap("/login"),
                body: data,
                authenticated: false,
            });
            // ISSUE-05: 后端返回 expires_in（秒），在响应边界归一化为 expires_in_ms（毫秒）
            return normalizeExpiresInMs(response);
        }, "loginRequest");
    }

    /**
     * Login with credentials. Sends a login request and updates the client's
     * access token and user ID.
     *
     * @param type - The login type (e.g. "m.login.password")
     * @param params - Login parameters (user, password, token, etc.)
     * @returns The login response containing access_token, user_id, device_id
     * @example
     * ```typescript
     * const response = await accountManager.login("m.login.password", {
     *     user: "@alice:example.com",
     *     password: "secret",
     * });
     * ```
     */
    public async login(type: LoginRequest["type"], params: Omit<LoginRequest, "type">): Promise<LoginResponse> {
        const response = await this.loginRequest({ type, ...params });
        this.client.http.opts.accessToken = response.access_token;
        this.client.credentials.userId = response.user_id;
        return response;
    }

    /**
     * Logout
     */
    public async logout(stopClient = false): Promise<EmptyObject> {
        if (stopClient) {
            this.client.stopClient();
            this.client.http.abort();
        }

        return this.withRetry(async () => {
            return await this.request<EmptyObject>({
                method: Method.Post,
                path: ap("/logout"),
            });
        }, "logout");
    }

    /**
     * Logout from all devices
     */
    public async logoutAll(stopClient = false): Promise<EmptyObject> {
        if (stopClient) {
            this.client.stopClient();
            this.client.http.abort();
        }

        return this.withRetry(async () => {
            return await this.request<EmptyObject>({
                method: Method.Post,
                path: ap("/logout/all"),
            });
        }, "logoutAll");
    }

    /**
     * Submit email verification token for registration
     */
    public async submitEmailToken(sid: string, clientSecret: string, token: string): Promise<{ success: boolean }> {
        return this.withRetry(async () => {
            return await this.request<{ success: boolean }>({
                method: Method.Post,
                path: ap("/register/email/submitToken"),
                body: {
                    sid,
                    client_secret: clientSecret,
                    token,
                },
                authenticated: false,
            });
        }, "submitEmailToken");
    }

    /**
     * Deactivate account
     */
    public deactivateAccount(
        auth?: AuthDict,
        erase?: boolean,
    ): Promise<{ id_server_unbind_result: IdServerUnbindResult }> {
        const body: Body = {};
        if (auth) {
            body.auth = auth;
        }
        if (erase !== undefined) {
            body.erase = erase;
        }

        return this.withRetry(async () => {
            return await this.request<{ id_server_unbind_result: IdServerUnbindResult }>({
                method: Method.Post,
                path: ap("/account/deactivate"),
                body,
            });
        }, "deactivateAccount");
    }

    /**
     * Request login token
     */
    public async requestLoginToken(auth?: AuthDict): Promise<LoginTokenPostResponse> {
        const body: UIARequest<unknown> = { auth };
        return this.withRetry(async () => {
            return await this.request<LoginTokenPostResponse>({
                method: Method.Post,
                path: "/login/get_token",
                body,
                prefix: ClientPrefix.V1,
            });
        }, "requestLoginToken");
    }

    /**
     * Get fallback auth URL
     */
    public getFallbackAuthUrl(loginType: string, authSessionId: string): string {
        const path = utils.encodeUri("/auth/$loginType/fallback/web", {
            $loginType: loginType,
        });
        const params = { session: authSessionId };
        return this.client.http.getUrl(path, params).href;
    }

    /**
     * Get my rooms
     * GET /_matrix/vendor/v1/my_rooms
     */
    public async getMyRooms(): Promise<MyRoomsResponse> {
        return this.withRetry(async () => {
            return await this.request<MyRoomsResponse>({
                method: Method.Get,
                path: "/my_rooms",
                prefix: VendorPrefix,
            });
        }, "getMyRooms");
    }

    /**
     * Get global events
     * GET /_matrix/client/v3/events
     */
    public async getEvents(options?: EventsRequestOptions): Promise<EventsResponse> {
        return this.withRetry(async () => {
            return await this.request<EventsResponse>({
                method: Method.Get,
                path: "/events",
                queryParams: options as Record<string, string | number | boolean | string[]>,
                prefix: ClientPrefix.V3,
            });
        }, "getEvents");
    }

    /**
     * Poll event updates using the legacy events stream with long-poll timeout.
     * GET /_matrix/client/v3/events?from=...&timeout=...
     *
     * @param from - Pagination token from a previous response
     * @param timeout - Long-poll timeout in milliseconds (default: 30000)
     * @returns Event stream chunk with start/end tokens
     */
    public async getEventStream(from?: string, timeout: number = 30000): Promise<EventsResponse> {
        return this.withRetry(async () => {
            const queryParams: Record<string, string | number> = { timeout };
            if (from) queryParams.from = from;
            return await this.request<EventsResponse>({
                method: Method.Get,
                path: "/events",
                queryParams,
                prefix: ClientPrefix.V3,
            });
        }, "getEventStream");
    }

    /**
     * Set guest access
     */
    public async setGuestAccess(roomId: string, opts: IGuestAccessOpts): Promise<void> {
        const path = utils.encodeUri("/rooms/$roomId/guest_access", {
            $roomId: roomId,
        });
        await this.withRetry(async () => {
            await this.request({
                method: Method.Put,
                path,
                body: opts,
            });
        }, "setGuestAccess");
    }
}

// Declare prototype extension

export function extendMatrixClient(): void {
    MatrixClient.prototype.getAccountManager = function (): AccountManager {
        registerManagerClass("account", AccountManager);
        return getOrCreateManager(this, "account", () => new AccountManager(this));
    };
}
