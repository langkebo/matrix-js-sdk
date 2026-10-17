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

    /**
     * 通过邮箱请求密码重置验证令牌。
     *
     * @param email - 接收重置邮件的邮箱地址
     * @param clientSecret - 客户端密钥，用于后续校验
     * @param sendAttempt - 发送尝试次数，用于节流
     * @param nextLink - 邮件中回跳链接，可选
     * @returns 包含 sid 等信息的请求令牌响应
     *
     * @example
     * ```typescript
     * const response = await client.getPasswordResetManager().requestPasswordEmailToken(
     *     "alice@example.org",
     *     "secret",
     *     1,
     * );
     * ```
     */
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

    /**
     * 通过手机号请求密码重置验证令牌。
     *
     * @param phoneCountry - 国家代码（例如 `44`）
     * @param phoneNumber - 手机号
     * @param clientSecret - 客户端密钥，用于后续校验
     * @param sendAttempt - 发送尝试次数，用于节流
     * @param nextLink - 短信中回跳链接
     * @returns 包含 sid 等信息的请求令牌响应
     *
     * @example
     * ```typescript
     * const response = await client.getPasswordResetManager().requestPasswordMsisdnToken(
     *     "44",
     *     "7700900000",
     *     "secret",
     *     1,
     *     "https://example.org/reset",
     * );
     * ```
     */
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

    /**
     * 使用交互式认证设置新密码。
     *
     * @param authDict - 交互式认证数据
     * @param newPassword - 新密码
     * @param logoutDevices - 是否同时登出其它设备，可选
     * @returns 空对象
     *
     * @example
     * ```typescript
     * await client.getPasswordResetManager().setPassword(
     *     { type: "m.login.password", identifier: { type: "m.id.user", user: "alice" }, password: "old" },
     *     "new-password",
     * );
     * ```
     */
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
