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
import { BaseManager } from "../managers/base-manager";
import { LRUCache } from "../utils/lru-cache";
import { getOrCreateManager } from "../client-infra/manager-registry";

export interface RoomKeyRequest {
    request_id: string;
    room_id: string;
    session_id: string;
    device_id: string;
    state: "pending" | "approved" | "rejected";
    created_ts: number;
    updated_ts: number;
}

export interface RoomKeyRequestsResponse {
    requests: RoomKeyRequest[];
}

export interface CreateRoomKeyRequest {
    room_id: string;
    session_id: string;
    device_id?: string;
}
export class RoomKeysManager extends BaseManager {
    private requestsCache: LRUCache<RoomKeyRequest[]>;

    constructor(client: MatrixClient) {
        super(client);
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
    async getRoomKeyRequests(forceRefresh = false): Promise<RoomKeyRequestsResponse> {
        if (!forceRefresh) {
            const cached = this.requestsCache.get("__requests__");
            if (cached) {
                return { requests: cached };
            }
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<RoomKeyRequestsResponse>(
                    Method.Get,
                    "/room_keys/request",
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
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
     */
    async createRoomKeyRequest(request: CreateRoomKeyRequest): Promise<void> {
        try {
            await this.withRetry(async () => {
                return await this.client.http.authedRequest(Method.Post, "/room_keys/request", undefined, request, {
                    prefix: ClientPrefix.V3,
                });
            }, "createRoomKeyRequest");

            this.requestsCache.delete("__requests__");
        } catch (error) {
            throw this.normalizeError(error, "createRoomKeyRequest");
        }
    }

    clearCache(): void {
        this.requestsCache.clear();
    }

    getCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
        return this.requestsCache.getStats();
    }

}

declare module "../client.ts" {
    interface MatrixClient {
        getRoomKeysManager(): RoomKeysManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomKeysManager = function (): RoomKeysManager {
        return getOrCreateManager(this, "roomKeys", () => new RoomKeysManager(this));
    };
}

export default extendMatrixClient;
