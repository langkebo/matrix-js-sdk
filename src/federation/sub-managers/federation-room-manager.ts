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
 * Federation Room Sub-Manager - 联邦房间子管理器
 *
 * 提供联邦房间层级、事件、状态、成员、媒体等查询功能。
 */

import { Method } from "../../http-api/method";
import { MatrixClient } from "../../client";
import { BaseManager, type ManagerOpts, type RequestSpec } from "../../managers/base-manager";
import { ValidationError } from "../../errors";

export enum FederationRoomEvent {
    FederationError = "FederationError",
}

interface FederationRoomEventMap {
    [FederationRoomEvent.FederationError]: (error: Error) => void;
}

export class FederationRoomManager extends BaseManager<FederationRoomEvent, FederationRoomEventMap> {
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
     * 通过联邦获取房间层级
     * @param roomId - 房间 ID
     */
    async getHierarchy(roomId: string): Promise<unknown> {
        if (!roomId) {
            throw new ValidationError("Room ID is required");
        }
        return this.request<unknown>({
            method: Method.Get,
            path: `/_matrix/federation/v1/hierarchy/${encodeURIComponent(roomId)}`,
            prefix: "",
        });
    }

    /**
     * 通过联邦获取房间事件
     * @param roomId - 房间 ID
     * @param eventId - 事件 ID
     */
    async getRoomEvent(roomId: string, eventId: string): Promise<unknown> {
        if (!roomId) {
            throw new ValidationError("Room ID is required");
        }
        if (!eventId) {
            throw new ValidationError("Event ID is required");
        }
        return this.request<unknown>({
            method: Method.Get,
            path: `/_matrix/federation/v1/room/${encodeURIComponent(roomId)}/${encodeURIComponent(eventId)}`,
            prefix: "",
        });
    }

    /**
     * 通过联邦下载远端媒体
     * @param serverName - 远端 server name
     * @param mediaId - 媒体 ID
     */
    async downloadMedia(serverName: string, mediaId: string): Promise<unknown> {
        if (!serverName) {
            throw new ValidationError("Server name is required");
        }
        if (!mediaId) {
            throw new ValidationError("Media ID is required");
        }
        return this.request<unknown>({
            method: Method.Get,
            path: `/_matrix/federation/v1/media/download/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`,
            prefix: "",
        });
    }

    /**
     * 通过联邦获取远端媒体缩略图
     * @param serverName - 远端 server name
     * @param mediaId - 媒体 ID
     */
    async getMediaThumbnail(serverName: string, mediaId: string): Promise<unknown> {
        if (!serverName) {
            throw new ValidationError("Server name is required");
        }
        if (!mediaId) {
            throw new ValidationError("Media ID is required");
        }
        return this.request<unknown>({
            method: Method.Get,
            path: `/_matrix/federation/v1/media/thumbnail/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`,
            prefix: "",
        });
    }

    /**
     * 获取事件授权链
     *
     * 对应 GET /_synapse/federation/v1/event_auth
     *
     * @param roomId - 房间 ID (e.g., "!room:example.com")
     * @param eventId - 事件 ID (e.g., "$event:example.com")
     * @returns 事件授权链
     *
     * @example
     * ```typescript
     * const authChain = await manager.getEventAuth("!room:example.com", "$event:example.com");
     * ```
     *
     * @throws {ValidationError} If room ID or event ID is empty
     * @throws {Error} If the request fails
     */
    async getEventAuth(roomId: string, eventId: string): Promise<unknown> {
        if (!roomId) {
            throw new ValidationError("Room ID is required");
        }
        if (!eventId) {
            throw new ValidationError("Event ID is required");
        }
        try {
            return await this.request<unknown>({
                method: Method.Get,
                path: "/_synapse/federation/v1/event_auth",
                queryParams: { room_id: roomId, event_id: eventId },
                prefix: "",
            });
        } catch (e) {
            const error = this.normalizeError(e, "getEventAuth");
            this.emit(FederationRoomEvent.FederationError, error);
            throw error;
        }
    }

    /**
     * 获取房间加入规则
     *
     * 对应 GET /_synapse/federation/v1/get_joining_rules/{room_id}
     *
     * @param roomId - 房间 ID (e.g., "!room:example.com")
     * @returns 房间加入规则
     *
     * @example
     * ```typescript
     * const rules = await manager.getJoiningRules("!room:example.com");
     * ```
     *
     * @throws {ValidationError} If room ID is empty
     * @throws {Error} If the request fails
     */
    async getJoiningRules(roomId: string): Promise<unknown> {
        if (!roomId) {
            throw new ValidationError("Room ID is required");
        }
        try {
            return await this.request<unknown>({
                method: Method.Get,
                path: `/_synapse/federation/v1/get_joining_rules/${encodeURIComponent(roomId)}`,
                prefix: "",
            });
        } catch (e) {
            const error = this.normalizeError(e, "getJoiningRules");
            this.emit(FederationRoomEvent.FederationError, error);
            throw error;
        }
    }

    /**
     * 获取房间联邦授权
     *
     * 对应 GET /_synapse/federation/v1/room_auth/{room_id}
     *
     * @param roomId - 房间 ID (e.g., "!room:example.com")
     * @returns 房间联邦授权信息
     *
     * @example
     * ```typescript
     * const auth = await manager.getRoomAuth("!room:example.com");
     * ```
     *
     * @throws {ValidationError} If room ID is empty
     * @throws {Error} If the request fails
     */
    async getRoomAuth(roomId: string): Promise<unknown> {
        if (!roomId) {
            throw new ValidationError("Room ID is required");
        }
        try {
            return await this.request<unknown>({
                method: Method.Get,
                path: `/_synapse/federation/v1/room_auth/${encodeURIComponent(roomId)}`,
                prefix: "",
            });
        } catch (e) {
            const error = this.normalizeError(e, "getRoomAuth");
            this.emit(FederationRoomEvent.FederationError, error);
            throw error;
        }
    }

    /**
     * 通过联邦获取房间状态
     *
     * 对应 GET /_matrix/federation/v1/state/{room_id}
     *
     * @param roomId - 房间 ID (e.g., "!room:example.com")
     * @returns 房间状态
     *
     * @example
     * ```typescript
     * const state = await manager.getState("!room:example.com");
     * ```
     *
     * @throws {ValidationError} If room ID is empty
     * @throws {Error} If the request fails
     */
    async getState(roomId: string): Promise<unknown> {
        if (!roomId) {
            throw new ValidationError("Room ID is required");
        }
        try {
            return await this.request<unknown>({
                method: Method.Get,
                path: `/_matrix/federation/v1/state/${encodeURIComponent(roomId)}`,
                prefix: "",
            });
        } catch (e) {
            const error = this.normalizeError(e, "getState");
            this.emit(FederationRoomEvent.FederationError, error);
            throw error;
        }
    }

    /**
     * 通过联邦获取房间状态 ID 列表
     *
     * 对应 GET /_matrix/federation/v1/state_ids/{room_id}
     *
     * @param roomId - 房间 ID (e.g., "!room:example.com")
     * @returns 房间状态 ID 列表
     *
     * @example
     * ```typescript
     * const stateIds = await manager.getStateIds("!room:example.com");
     * ```
     *
     * @throws {ValidationError} If room ID is empty
     * @throws {Error} If the request fails
     */
    async getStateIds(roomId: string): Promise<unknown> {
        if (!roomId) {
            throw new ValidationError("Room ID is required");
        }
        try {
            return await this.request<unknown>({
                method: Method.Get,
                path: `/_matrix/federation/v1/state_ids/${encodeURIComponent(roomId)}`,
                prefix: "",
            });
        } catch (e) {
            const error = this.normalizeError(e, "getStateIds");
            this.emit(FederationRoomEvent.FederationError, error);
            throw error;
        }
    }

    /**
     * 通过联邦获取房间成员列表
     *
     * 对应 GET /_matrix/federation/v1/members/{room_id}
     *
     * @param roomId - 房间 ID (e.g., "!room:example.com")
     * @returns 成员列表
     *
     * @example
     * ```typescript
     * const members = await manager.getMembers("!room:example.com");
     * ```
     *
     * @throws {ValidationError} If room ID is empty
     * @throws {Error} If the request fails
     */
    async getMembers(roomId: string): Promise<unknown> {
        if (!roomId) {
            throw new ValidationError("Room ID is required");
        }
        try {
            return await this.request<unknown>({
                method: Method.Get,
                path: `/_matrix/federation/v1/members/${encodeURIComponent(roomId)}`,
                prefix: "",
            });
        } catch (e) {
            const error = this.normalizeError(e, "getMembers");
            this.emit(FederationRoomEvent.FederationError, error);
            throw error;
        }
    }

    /**
     * 通过联邦获取房间已加入成员列表
     *
     * 对应 GET /_matrix/federation/v1/members/{room_id}/joined
     *
     * @param roomId - 房间 ID (e.g., "!room:example.com")
     * @returns 已加入成员列表
     *
     * @example
     * ```typescript
     * const joinedMembers = await manager.getJoinedMembers("!room:example.com");
     * ```
     *
     * @throws {ValidationError} If room ID is empty
     * @throws {Error} If the request fails
     */
    async getJoinedMembers(roomId: string): Promise<unknown> {
        if (!roomId) {
            throw new ValidationError("Room ID is required");
        }
        try {
            return await this.request<unknown>({
                method: Method.Get,
                path: `/_matrix/federation/v1/members/${encodeURIComponent(roomId)}/joined`,
                prefix: "",
            });
        } catch (e) {
            const error = this.normalizeError(e, "getJoinedMembers");
            this.emit(FederationRoomEvent.FederationError, error);
            throw error;
        }
    }

    /**
     * 通过联邦获取事件
     *
     * 对应 GET /_matrix/federation/v1/event/{event_id}
     *
     * @param eventId - 事件 ID (e.g., "$event:example.com")
     * @returns 事件数据
     *
     * @example
     * ```typescript
     * const event = await manager.getEvent("$event:example.com");
     * ```
     *
     * @throws {ValidationError} If event ID is empty
     * @throws {Error} If the request fails
     */
    async getEvent(eventId: string): Promise<unknown> {
        if (!eventId) {
            throw new ValidationError("Event ID is required");
        }
        try {
            return await this.request<unknown>({
                method: Method.Get,
                path: `/_matrix/federation/v1/event/${encodeURIComponent(eventId)}`,
                prefix: "",
            });
        } catch (e) {
            const error = this.normalizeError(e, "getEvent");
            this.emit(FederationRoomEvent.FederationError, error);
            throw error;
        }
    }

    /**
     * 通过联邦回填房间历史
     *
     * 对应 GET /_matrix/federation/v1/backfill/{room_id}
     *
     * @param roomId - 房间 ID (e.g., "!room:example.com")
     * @param opts - 可选参数
     * @param opts.limit - 最大事件数量
     * @param opts.from - 起始事件 ID
     * @returns 回填结果
     *
     * @example
     * ```typescript
     * const result = await manager.backfillRoom("!room:example.com", { limit: 10 });
     * ```
     *
     * @throws {ValidationError} If room ID is empty
     * @throws {Error} If the request fails
     */
    async backfillRoom(roomId: string, opts?: { limit?: number; from?: string }): Promise<unknown> {
        if (!roomId) {
            throw new ValidationError("Room ID is required");
        }
        try {
            const params: Record<string, string | number> = {};
            if (opts?.limit !== undefined) params.limit = opts.limit;
            if (opts?.from !== undefined) params.from = opts.from;

            const queryKeys = Object.keys(params);
            return await this.request<unknown>({
                method: Method.Get,
                path: `/_matrix/federation/v1/backfill/${encodeURIComponent(roomId)}`,
                queryParams: queryKeys.length > 0 ? params : undefined,
                prefix: "",
            });
        } catch (e) {
            const error = this.normalizeError(e, "backfillRoom");
            this.emit(FederationRoomEvent.FederationError, error);
            throw error;
        }
    }
}
