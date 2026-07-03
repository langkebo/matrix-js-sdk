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
 * Password Reset Manager - 密码重置管理
 *
 * 提供密码重置相关功能
 */

import { MatrixClient } from "../client";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { Method } from "../http-api/method";
import type { EmptyObject } from "../@types/common";
import type { IRequestTokenResponse, IRequestMsisdnTokenResponse } from "../client-api-types";
import type { AuthDict } from "../interactive-auth";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import { buildEmailTokenRequestParams, buildMsisdnTokenRequestParams, requestTokenFromEndpoint } from "../client-auth";

export type PasswordResetManagerEvents = Record<
    "password_reset_token_requested" | "password_changed",
    ((data: { type: "email" | "msisdn" }) => void) | (() => void)
>;

export class PasswordResetManager extends BaseManager<keyof PasswordResetManagerEvents, PasswordResetManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public async requestPasswordEmailToken(
        email: string,
        clientSecret: string,
        sendAttempt: number,
        nextLink?: string,
    ): Promise<IRequestTokenResponse> {
        const result = await this.withRetry(
            async () =>
                requestTokenFromEndpoint<IRequestTokenResponse>(
                    "/account/password/email/requestToken",
                    buildEmailTokenRequestParams(email, clientSecret, sendAttempt, nextLink),
                    this.client.http.request.bind(this.client.http),
                ),
            "requestPasswordEmailToken",
        );
        this.emit("password_reset_token_requested", { type: "email" });
        return result;
    }

    public async requestPasswordMsisdnToken(
        phoneCountry: string,
        phoneNumber: string,
        clientSecret: string,
        sendAttempt: number,
        nextLink: string,
    ): Promise<IRequestMsisdnTokenResponse> {
        const result = await this.withRetry(
            async () =>
                requestTokenFromEndpoint<IRequestMsisdnTokenResponse>(
                    "/account/password/msisdn/requestToken",
                    buildMsisdnTokenRequestParams(phoneCountry, phoneNumber, clientSecret, sendAttempt, nextLink),
                    this.client.http.request.bind(this.client.http),
                ),
            "requestPasswordMsisdnToken",
        );
        this.emit("password_reset_token_requested", { type: "msisdn" });
        return result;
    }

    public async setPassword(authDict: AuthDict, newPassword: string, logoutDevices?: boolean): Promise<EmptyObject> {
        const result = await this.withRetry(
            async () =>
                this.request<EmptyObject>({
                    method: Method.Post,
                    path: "/account/password",
                    body: {
                        auth: authDict,
                        new_password: newPassword,
                        logout_devices: logoutDevices,
                    },
                }),
            "setPassword",
        );
        this.emit("password_changed");
        return result;
    }
}

export function extendMatrixClient(): void {
    if (MatrixClient.prototype.hasOwnProperty("getPasswordResetManager")) return;

    MatrixClient.prototype.getPasswordResetManager = function (this: MatrixClient): PasswordResetManager {
        registerManagerClass("passwordReset", PasswordResetManager);
        return getOrCreateManager(this, "passwordReset", () => new PasswordResetManager(this));
    };
}

export default extendMatrixClient;
