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
 * Federation Query Sub-Manager - 联邦查询子管理器
 *
 * 提供联邦用户资料查询、房间别名查询、目的地查询等功能。
 */

import { Method } from "../../http-api/method";
import { MatrixClient } from "../../client";
import { BaseManager, type ManagerOpts, type RequestSpec } from "../../managers/base-manager";
import { ValidationError } from "../../errors";
import type { IUserProfile } from "../../user-directory/index";

export enum FederationQueryEvent {
    FederationError = "FederationError",
}

interface FederationQueryEventMap {
    [FederationQueryEvent.FederationError]: (error: Error) => void;
}

export class FederationQueryManager extends BaseManager<FederationQueryEvent, FederationQueryEventMap> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * Federation 端点（`/_matrix/federation/v1/*`、`/_synapse/federation/v1/*`）
     * 是 server-to-server 接口，不需要用户 access token。
     *
     * 当 `prefix === ""` 时自动走 `client.http.request`（不带 token）；
     * admin 端点（`prefix === AdminPrefix.V1`）仍走默认的 `authedRequest`。
     */
    protected async request<T>(spec: RequestSpec): Promise<T> {
        if (spec.prefix === "") {
            return super.request<T>({ ...spec, authenticated: false });
        }
        return super.request<T>(spec);
    }

    /**
     * 通过联邦查询用户资料
     * @param userId - 用户 ID
     */
    async queryProfile(userId: string): Promise<IUserProfile> {
        if (!userId) {
            throw new ValidationError("User ID is required");
        }
        return this.request<IUserProfile>({
            method: Method.Get,
            path: `/_matrix/federation/v1/query/profile/${encodeURIComponent(userId)}`,
            prefix: "",
        });
    }

    /**
     * 通过联邦查询房间别名
     * @param roomAlias - 房间别名
     */
    async queryDirectory(roomAlias: string): Promise<{ room_id: string; servers: string[] }> {
        if (!roomAlias) {
            throw new ValidationError("Room alias is required");
        }
        return this.request<{ room_id: string; servers: string[] }>({
            method: Method.Get,
            path: `/_matrix/federation/v1/query/directory`,
            queryParams: { room_alias: roomAlias },
            prefix: "",
        });
    }

    /**
     * 通过联邦查询目的地
     * @param destination - 目标 server name
     */
    async queryDestination(destination: string): Promise<unknown> {
        if (!destination) {
            throw new ValidationError("Destination is required");
        }
        return this.request<unknown>({
            method: Method.Get,
            path: "/_matrix/federation/v1/query/destination",
            queryParams: { destination },
            prefix: "",
        });
    }

    /**
     * 查询联邦授权
     *
     * 对应 GET /_synapse/federation/v1/query/auth
     *
     * @returns 联邦授权信息
     *
     * @example
     * ```typescript
     * const auth = await manager.queryAuth();
     * ```
     *
     * @throws {Error} If the request fails
     */
    async queryAuth(): Promise<unknown> {
        try {
            return await this.request<unknown>({
                method: Method.Get,
                path: "/_synapse/federation/v1/query/auth",
                prefix: "",
            });
        } catch (e) {
            const error = this.normalizeError(e, "queryAuth");
            this.emit(FederationQueryEvent.FederationError, error);
            throw error;
        }
    }

    /**
     * 获取联邦发现信息
     */
    async getFederationInfo(): Promise<unknown> {
        return this.request<unknown>({
            method: Method.Get,
            path: "/_matrix/federation/v1",
            prefix: "",
        });
    }

    async getPublicRoomsOnServer(
        serverName: string,
        limit?: number,
        since?: string,
    ): Promise<{ chunk: unknown[]; next_batch?: string; prev_batch?: string }> {
        if (!serverName) {
            throw new ValidationError("Server name is required");
        }

        try {
            const params: { limit?: number; since?: string; server_name: string } = {
                server_name: serverName,
            };
            if (limit !== undefined) params.limit = limit;
            if (since !== undefined) params.since = since;

            const response = await this.request<{
                chunk?: unknown[];
                next_batch?: string;
                prev_batch?: string;
            }>({
                method: Method.Get,
                path: `/_matrix/federation/v1/publicRooms`,
                queryParams: params,
                prefix: "",
            });

            const result: { chunk: unknown[]; next_batch?: string; prev_batch?: string } = {
                chunk: response.chunk || [],
            };
            if (response.next_batch) result.next_batch = response.next_batch;
            if (response.prev_batch) result.prev_batch = response.prev_batch;

            return result;
        } catch (e) {
            const error = this.normalizeError(e, "getPublicRoomsOnServer");
            this.emit(FederationQueryEvent.FederationError, error);
            throw error;
        }
    }
}
