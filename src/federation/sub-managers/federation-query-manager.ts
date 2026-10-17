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
     * 通过联邦查询用户资料（server-to-server 接口，无需 access token）。
     *
     * @param userId - 用户 ID（如 `@user:example.com`）。
     * @returns 用户资料。
     *
     * @example
     * ```typescript
     * const profile = await client.getFederationManager().query.queryProfile("@user:example.com");
     * console.log(profile.display_name);
     * ```
     *
     * @throws {ValidationError} 当 userId 为空时抛出。
     * @throws {Error} 当联邦请求失败时抛出。
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
     * 通过联邦查询房间别名的解析结果（server-to-server 接口，无需 access token）。
     *
     * @param roomAlias - 房间别名（如 `#room:example.com`）。
     * @returns 房间 ID 及参与该房间的服务器列表。
     *
     * @example
     * ```typescript
     * const { room_id, servers } = await client.getFederationManager().query.queryDirectory("#room:example.com");
     * console.log(room_id, servers);
     * ```
     *
     * @throws {ValidationError} 当 roomAlias 为空时抛出。
     * @throws {Error} 当联邦请求失败时抛出。
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
     * 通过联邦查询目标服务器的连接信息（server-to-server 接口，无需 access token）。
     *
     * @param destination - 目标服务器名（如 `example.com`）。
     * @returns 目标服务器的联邦连接信息。
     *
     * @example
     * ```typescript
     * const info = await client.getFederationManager().query.queryDestination("example.com");
     * ```
     *
     * @throws {ValidationError} 当 destination 为空时抛出。
     * @throws {Error} 当联邦请求失败时抛出。
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
     * 获取联邦发现信息（对应 GET /_matrix/federation/v1）。
     *
     * @returns 联邦服务发现信息。
     *
     * @example
     * ```typescript
     * const info = await client.getFederationManager().query.getFederationInfo();
     * ```
     */
    async getFederationInfo(): Promise<unknown> {
        return this.request<unknown>({
            method: Method.Get,
            path: "/_matrix/federation/v1",
            prefix: "",
        });
    }

    /**
     * 通过联邦查询指定服务器上的公开房间列表（server-to-server 接口，无需 access token）。
     *
     * @param serverName - 目标服务器名（如 `example.com`）。
     * @param limit - 单页返回的最大房间数，可选。
     * @param since - 分页游标，传入上一页返回的 `next_batch` 以获取下一页，可选。
     * @returns 公开房间分页结果，`chunk` 为房间列表，`next_batch` / `prev_batch` 为分页游标。
     *
     * @example
     * ```typescript
     * const page = await client.getFederationManager().query.getPublicRoomsOnServer("example.com", 20);
     * console.log(page.chunk.length, page.next_batch);
     * ```
     *
     * @throws {ValidationError} 当 serverName 为空时抛出。
     * @throws {Error} 当联邦请求失败时抛出。
     */
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
