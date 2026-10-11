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
 * ThreePids Manager - 三方身份管理
 *
 * 提供三方身份（邮箱、手机号）的绑定、解绑、查询功能
 */

import { MatrixClient } from "../client";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { Method } from "../http-api/method";
import type { IThreepid } from "../@types/three-pids";
import type { IdServerUnbindResult } from "../@types/partials";
import type { EmptyObject } from "../@types/common";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export type ThreePidsManagerEvents = Record<
    "threepid_bound" | "threepid_unbound" | "threepid_deleted",
    (data: { medium: string; address: string }) => void
>;

export class ThreePidsManager extends BaseManager<keyof ThreePidsManagerEvents, ThreePidsManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * 获取当前账户已绑定的三方标识列表（`GET /account/3pid`）。
     *
     * @returns 包含 threepids 数组的响应
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getThreePidsManager();
     * const { threepids } = await mgr.getThreePids();
     * ```
     */
    public async getThreePids(): Promise<{ threepids: IThreepid[] }> {
        return this.withRetry(
            async () =>
                this.request<{ threepids: IThreepid[] }>({
                    method: Method.Get,
                    path: "/account/3pid",
                }),
            "getThreePids",
        );
    }

    /**
     * 向当前账户添加三方标识（`POST /account/3pid/add`，不含身份服务器绑定）。
     *
     * @param clientSecret - 客户端密钥
     * @param sid - 三方标识验证会话 ID
     * @returns 空对象
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getThreePidsManager();
     * await mgr.addThreePidOnly("client-secret", "sid-value");
     * ```
     */
    public async addThreePidOnly(clientSecret: string, sid: string): Promise<EmptyObject> {
        return this.withRetry(
            async () =>
                this.request<EmptyObject>({
                    method: Method.Post,
                    path: "/account/3pid/add",
                    body: {
                        client_secret: clientSecret,
                        sid,
                    },
                }),
            "addThreePidOnly",
        );
    }

    /**
     * 将三方标识绑定到身份服务器（`POST /account/3pid/bind`），成功后触发 `threepid_bound` 事件。
     *
     * @param clientSecret - 客户端密钥
     * @param sid - 三方标识验证会话 ID
     * @param idServer - 身份服务器地址
     * @param idAccessToken - 身份服务器访问令牌；不需要时传 null
     * @returns 空对象
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getThreePidsManager();
     * await mgr.bindThreePid("client-secret", "sid-value", "https://id.example.org", null);
     * ```
     */
    public async bindThreePid(
        clientSecret: string,
        sid: string,
        idServer: string,
        idAccessToken: string | null,
    ): Promise<EmptyObject> {
        const result = await this.withRetry(
            async () =>
                this.request<EmptyObject>({
                    method: Method.Post,
                    path: "/account/3pid/bind",
                    body: {
                        client_secret: clientSecret,
                        sid,
                        id_server: idServer,
                        id_access_token: idAccessToken,
                    },
                }),
            "bindThreePid",
        );
        this.emit("threepid_bound", { medium: "email", address: "" });
        return result;
    }

    /**
     * 从身份服务器解绑三方标识（`POST /account/3pid/unbind`），成功后触发 `threepid_unbound` 事件。
     *
     * @param medium - 三方标识类型（如 `email`、`msisdn`）
     * @param address - 三方标识地址
     * @param idServer - 身份服务器地址（可选）
     * @returns 含 `id_server_unbind_result` 的响应
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getThreePidsManager();
     * const res = await mgr.unbindThreePid("email", "alice@example.org");
     * ```
     */
    public async unbindThreePid(
        medium: string,
        address: string,
        idServer?: string,
    ): Promise<{ id_server_unbind_result: IdServerUnbindResult }> {
        const result = await this.withRetry(
            async () =>
                this.request<{ id_server_unbind_result: IdServerUnbindResult }>({
                    method: Method.Post,
                    path: "/account/3pid/unbind",
                    body: {
                        medium,
                        address,
                        id_server: idServer,
                    },
                }),
            "unbindThreePid",
        );
        this.emit("threepid_unbound", { medium, address });
        return result;
    }

    /**
     * 删除三方标识（`POST /account/3pid/delete`），成功后触发 `threepid_deleted` 事件。
     *
     * @param medium - 三方标识类型（如 `email`、`msisdn`）
     * @param address - 三方标识地址
     * @param idServer - 身份服务器地址（可选）
     * @returns 含 `id_server_unbind_result` 的响应
     *
     * @example
     * ```typescript
     * const client = createClient({ baseUrl, accessToken });
     * const mgr = client.getThreePidsManager();
     * const res = await mgr.deleteThreePid("email", "alice@example.org");
     * ```
     */
    public async deleteThreePid(
        medium: string,
        address: string,
        idServer?: string,
    ): Promise<{ id_server_unbind_result: IdServerUnbindResult }> {
        const result = await this.withRetry(
            async () =>
                this.request<{ id_server_unbind_result: IdServerUnbindResult }>({
                    method: Method.Post,
                    path: "/account/3pid/delete",
                    body: {
                        medium,
                        address,
                        id_server: idServer,
                    },
                }),
            "deleteThreePid",
        );
        this.emit("threepid_deleted", { medium, address });
        return result;
    }
}

export function extendMatrixClient(): void {
    if (MatrixClient.prototype.hasOwnProperty("getThreePidsManager")) return;

    MatrixClient.prototype.getThreePidsManager = function (this: MatrixClient): ThreePidsManager {
        registerManagerClass("threepids", ThreePidsManager);
        return getOrCreateManager(this, "threepids", () => new ThreePidsManager(this));
    };
}
