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
 * Room Keys Manager - 房间密钥请求管理
 *
 * 提供房间密钥请求相关功能
 * 对应后端: synapse-rust/src/web/routes/e2ee_routes.rs
 *
 * 后端端点:
 * - GET/POST /room_keys/request
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { LRUCache } from "../utils/lru-cache";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import { ValidationError } from "../errors";

export interface RoomKeyRequest {
    request_id: string;
    room_id: string;
    session_id: string;
    device_id: string;
    /** 后端 `devices.rs:397-402` 的取值：pending / cancelled / fulfilled */
    status: "pending" | "cancelled" | "fulfilled";
    algorithm?: string;
    action?: string;
    created_ts: number;
    is_fulfilled?: boolean;
    fulfilled_by_device?: string;
    fulfilled_ts?: number;
}

export interface RoomKeyRequestsResponse {
    requests: RoomKeyRequest[];
    /** 分页游标（后端满页时返回） */
    next_batch?: string;
}

/**
 * 创建房间密钥请求的请求体（对齐后端 `CreateRoomKeyRequestBody`，2026-10-09 实测）。
 *
 * ⚠️ 后端 `algorithm` / `room_id` / `session_id` **三个都是必填**（无 `#[serde(default)]`），
 * 缺 `algorithm` 会直接 400。旧版本这里没有 `algorithm` ⇒ 该链路必然失败。
 */
export interface CreateRoomKeyRequest {
    /** 加密算法（如 `m.megolm.v1.aes-sha2`）。后端必填。 */
    algorithm: string;
    room_id: string;
    session_id: string;
    /**
     * 目标设备 ID。
     *
     * 注意：后端 `CreateRoomKeyRequestBody` **没有**这个字段（多传不会 400，因为该结构
     * 未开 `deny_unknown_fields`，但服务端也不会读它）。保留仅为兼容既有调用方。
     */
    device_id?: string;
}
export class RoomKeysManager extends BaseManager {
    private requestsCache: LRUCache<RoomKeyRequest[]>;

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
        this.requestsCache = new LRUCache<RoomKeyRequest[]>({
            maxSize: 50,
            ttl: 5 * 60 * 1000,
            name: "index.ts-roomkeyrequest",
        });
    }

    /**
     * 获取房间密钥请求列表
     * GET /_matrix/client/v3/room_keys/request
     */
    async getRoomKeyRequests(
        forceRefresh = false,
        options: { limit?: number; from?: string; status?: string; room_id?: string; session_id?: string } = {},
    ): Promise<RoomKeyRequestsResponse> {
        if (!forceRefresh) {
            const cached = this.requestsCache.get("__requests__");
            if (cached) {
                return { requests: cached };
            }
        }

        try {
            const response = await this.withRetry(async () => {
                const params: Record<string, string> = {};
                if (options.limit !== undefined) params.limit = String(options.limit);
                if (options.from) params.from = options.from;
                if (options.status) params.status = options.status;
                if (options.room_id) params.room_id = options.room_id;
                if (options.session_id) params.session_id = options.session_id;
                return await this.request<RoomKeyRequestsResponse>({
                    method: Method.Get,
                    path: "/room_keys/request",
                    queryParams: Object.keys(params).length > 0 ? params : undefined,
                    prefix: ClientPrefix.V3,
                });
            }, "getRoomKeyRequests");

            if (response.requests) {
                this.requestsCache.set("__requests__", response.requests);
            }

            return response;
        } catch (error) {
            throw this.normalizeError(error, "getRoomKeyRequests");
        }
    }

    /**
     * 创建房间密钥请求
     * POST /_matrix/client/v3/room_keys/request
     *
     * 后端 `CreateRoomKeyRequestBody` 的 `algorithm` / `room_id` / `session_id` 均必填，
     * 缺失会直接 400 ⇒ 此处**本地先校验**，把 400 提前成可读的 `ValidationError`。
     */
    async createRoomKeyRequest(request: CreateRoomKeyRequest): Promise<void> {
        if (!request?.algorithm) {
            throw new ValidationError("algorithm is required (backend rejects the request without it)");
        }
        if (!request.room_id) {
            throw new ValidationError("room_id is required");
        }
        if (!request.session_id) {
            throw new ValidationError("session_id is required");
        }
        try {
            await this.withRetry(async () => {
                return await this.request({
                    method: Method.Post,
                    path: "/room_keys/request",
                    body: request,
                    prefix: ClientPrefix.V3,
                });
            }, "createRoomKeyRequest");

            this.requestsCache.delete("__requests__");
        } catch (error) {
            throw this.normalizeError(error, "createRoomKeyRequest");
        }
    }

    /**
     * 删除房间密钥请求
     * DELETE /_matrix/client/v3/room_keys/request/{request_id}
     *
     * @param requestId - 要删除的请求 ID
     * @throws {ValidationError} 如果 requestId 为空
     */
    async deleteRoomKeyRequest(requestId: string): Promise<void> {
        if (!requestId || requestId.trim().length === 0) {
            throw new ValidationError("requestId is required");
        }

        try {
            await this.withRetry(async () => {
                return await this.request({
                    method: Method.Delete,
                    path: `/room_keys/request/${encodeURIComponent(requestId)}`,
                    prefix: ClientPrefix.V3,
                });
            }, "deleteRoomKeyRequest");

            this.requestsCache.delete("__requests__");
        } catch (error) {
            throw this.normalizeError(error, "deleteRoomKeyRequest");
        }
    }

    clearCache(): void {
        this.requestsCache.clear();
    }

    getCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
        return this.requestsCache.getStats();
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomKeysManager = function (): RoomKeysManager {
        registerManagerClass("roomKeys", RoomKeysManager);
        return getOrCreateManager(this, "roomKeys", () => new RoomKeysManager(this));
    };
}
