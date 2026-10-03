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
 * Admin Cleanup Manager - 数据库清理管理
 *
 * 对应后端 `synapse-web/src/routes/admin/cleanup.rs`：
 * - POST /_synapse/admin/v1/cleanup/all       - 全局清理
 * - POST /_synapse/admin/v1/cleanup/rooms     - 房间清理
 * - POST /_synapse/admin/v1/cleanup/tokens    - 令牌清理
 *
 * 这些端点接受 JSON 请求体，包含可选的 `min_age_ms` 参数。
 */

import { Method } from "../../http-api/method";
import { AdminBaseManager, type AdminErrorCallback, type ManagerOpts } from "../admin-base-manager";
import { MatrixClient } from "../../client";

/**
 * 全局清理请求载荷
 */
export interface CleanupAllRequest {
    /** 最小年龄（毫秒），可选 */
    min_age_ms?: number;
}

/**
 * 全局清理响应
 */
export interface CleanupAllResponse {
    /** 房间清理结果 */
    rooms: {
        rooms_deleted: number;
        events_deleted: number;
    };
    /** 令牌清理结果 */
    tokens: {
        access_tokens_deleted: number;
        refresh_tokens_deleted: number;
        registration_tokens_deleted: number;
        email_tokens_deleted: number;
    };
}

/**
 * 房间清理请求载荷
 */
export interface CleanupRoomsRequest {
    /** 最小年龄（毫秒），可选 */
    min_age_ms?: number;
}

/**
 * 房间清理响应
 */
export interface CleanupRoomsResponse {
    /** 删除的房间数量 */
    rooms: number;
}

/**
 * 令牌清理响应
 */
export interface CleanupTokensResponse {
    /** 删除的 access token 数量 */
    access_tokens_deleted: number;
    /** 删除的 refresh token 数量 */
    refresh_tokens_deleted: number;
}

/**
 * Admin Cleanup Manager
 *
 * 提供数据库清理功能，包括全局清理、房间清理和令牌清理。
 */
export class AdminCleanupManager extends AdminBaseManager {
    constructor(client: MatrixClient, onError?: AdminErrorCallback, opts?: ManagerOpts) {
        super(client, onError, opts);
    }

    /**
     * 执行全局清理
     *
     * 清理过期的房间数据和令牌。
     *
     * @see {@link https://spec.matrix.org/v1.2/admin-api/#delete_cleanupall | Matrix 规范: 删除清理}
     *
     * @example
     * ```typescript
     * const result = await adminManager.cleanup.all({ min_age_ms: 86400000 });
     * console.log(result.tokens.access_tokens_deleted, 'access tokens deleted');
     * ```
     */
    async all(payload?: CleanupAllRequest): Promise<CleanupAllResponse> {
        return await this.adminRequest<CleanupAllResponse>(
            Method.Post,
            "/cleanup/all",
            undefined,
            payload,
            "cleanup.all",
        );
    }

    /**
     * 执行房间清理
     *
     * 清理指定条件的房间数据。
     *
     * @see {@link https://spec.matrix.org/v1.2/admin-api/#delete_cleanuprooms | Matrix 规范: 删除房间清理}
     *
     * @example
     * ```typescript
     * const result = await adminManager.cleanup.rooms({ min_age_ms: 604800000 });
     * console.log(result.rooms, 'rooms cleaned');
     * ```
     */
    async rooms(payload?: CleanupRoomsRequest): Promise<CleanupRoomsResponse> {
        return await this.adminRequest<CleanupRoomsResponse>(
            Method.Post,
            "/cleanup/rooms",
            undefined,
            payload,
            "cleanup.rooms",
        );
    }

    /**
     * 执行令牌清理
     *
     * 清理过期的 access token 和 refresh token。
     *
     * @example
     * ```typescript
     * const result = await adminManager.cleanup.tokens();
     * console.log(result.access_tokens_deleted, 'access tokens deleted');
     * ```
     */
    async tokens(): Promise<CleanupTokensResponse> {
        return await this.adminRequest<CleanupTokensResponse>(
            Method.Post,
            "/cleanup/tokens",
            undefined,
            undefined,
            "cleanup.tokens",
        );
    }
}
