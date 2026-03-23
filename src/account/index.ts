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

import { MatrixClient } from "../client";
import { Method } from "../http-api/index";
import { type EmptyObject } from "../@types/common";
import { type LoginRequest, type LoginResponse, type ILoginFlowsResponse, SSOAction, type LoginTokenPostResponse } from "../@types/auth";
import { type AuthDict } from "../interactive-auth";
import { type IdServerUnbindResult } from "../@types/partials";
import { ClientPrefix } from "../http-api/prefix";
import * as utils from "../utils";
import { IGuestAccessOpts } from "../@types/requests";

type Body = Record<string, any>;
type UIARequest<T> = T & {
    auth?: AuthDict;
};

const SSO_ACTION_PARAM = {
    stable: "action",
    unstable: "_action",
};

export class AccountManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get the session ID
     */
    public getSessionId(): string {
        return (this.client as any).sessionId;
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
        (this.client as any).isGuestAccount = guest;
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
        return this.client.http.request(Method.Get, "/login");
    }

    /**
     * Login with a specific login type
     * @deprecated Use loginRequest and create a new MatrixClient
     */
    public login(loginType: LoginRequest["type"], data: Omit<LoginRequest, "type">): Promise<LoginResponse> {
        return this.loginRequest({
            ...data,
            type: loginType,
        }).then((response) => {
            if (response.access_token && response.user_id) {
                this.client.http.opts.accessToken = response.access_token;
                this.client.credentials = {
                    userId: response.user_id,
                };
            }
            return response;
        });
    }

    /**
     * Login with password
     * @deprecated Use loginRequest
     */
    public loginWithPassword(user: string, password: string): Promise<LoginResponse> {
        return this.login("m.login.password", {
            user: user,
            password: password,
        });
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
     * Login with token
     * @deprecated Use loginRequest
     */
    public loginWithToken(token: string): Promise<LoginResponse> {
        return this.login("m.login.token", {
            token: token,
        });
    }

    /**
     * Send a login request
     */
    public async loginRequest(data: LoginRequest): Promise<LoginResponse> {
        return await this.client.http.authedRequest<LoginResponse>(Method.Post, "/login", undefined, data);
    }

    /**
     * Logout
     */
    public async logout(stopClient = false): Promise<EmptyObject> {
        if (stopClient) {
            this.client.stopClient();
            this.client.http.abort();
        }

        return this.client.http.authedRequest(Method.Post, "/logout");
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

        return this.client.http.authedRequest(Method.Post, "/account/deactivate", undefined, body);
    }

    /**
     * Request login token
     */
    public async requestLoginToken(auth?: AuthDict): Promise<LoginTokenPostResponse> {
        const body: UIARequest<unknown> = { auth };
        return this.client.http.authedRequest<LoginTokenPostResponse>(
            Method.Post,
            "/login/get_token",
            undefined,
            body,
            { prefix: ClientPrefix.V1 },
        );
    }

    /**
     * Get fallback auth URL
     */
    public getFallbackAuthUrl(loginType: string, authSessionId: string): string {
        const path = utils.encodeUri("/auth/$loginType/fallback/web", {
            $loginType: loginType,
        });
        const params = { authSessionId };
        return this.client.http.getUrl(path, params).href;
    }

    /**
     * Set guest access
     */
    public async setGuestAccess(roomId: string, opts: IGuestAccessOpts): Promise<void> {
        const path = utils.encodeUri("/rooms/$roomId/guest_access", {
            $roomId: roomId,
        });
        await this.client.http.authedRequest(Method.Put, path, undefined, opts);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getAccountManager(): AccountManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getAccountManager = function (): AccountManager {
        return new AccountManager(this);
    };
}

export default extendMatrixClient;
