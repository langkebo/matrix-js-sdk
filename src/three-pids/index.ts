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

    public async getThreePids(): Promise<{ threepids: IThreepid[] }> {
        return this.withRetry(
            async () => this.request<{ threepids: IThreepid[] }>({
                method: Method.Get,
                path: "/account/3pid",
            }),
            "getThreePids",
        );
    }

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

export default extendMatrixClient;
