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

import { BaseManager, type ManagerOpts } from "../managers/base-manager";
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
import { ClientPrefix } from "../http-api/prefix";
import * as utils from "../utils";
import { IGuestAccessOpts } from "../@types/requests";
import type { IContent } from "../models/event";
import type { AuthPathPattern } from "../auth/__generated__/route-table";
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

export class AccountManager extends BaseManager {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

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
            return await this.request<LoginResponse>({
                method: Method.Post,
                path: ap("/login"),
                body: data,
                authenticated: false,
            });
        }, "loginRequest");
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
