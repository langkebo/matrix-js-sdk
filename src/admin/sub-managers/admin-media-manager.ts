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

import { Method } from "../../http-api/method";
import { ValidationError } from "../../errors";
import { AdminBaseManager, type AdminErrorCallback, type ManagerOpts } from "../admin-base-manager";
import { buildPaginationParams } from "../utils";
import type {
    MediaInfo,
    MediaProtectionResponse,
    MediaUnprotectionResponse,
    MediaPage,
    MediaQuotaResponse,
    MediaQuarantineChange,
    MediaQuarantineChangesResponse,
    UserMediaList,
} from "../types";
import { MatrixClient } from "../../client";

export class AdminMediaManager extends AdminBaseManager {
    constructor(client: MatrixClient, onError?: AdminErrorCallback, opts?: ManagerOpts) {
        super(client, onError, opts);
    }

    /**
     * 获取媒体列表
     *
     * 对应 `GET /_synapse/admin/v1/media`。后端返回 `{media, total, next_batch}`：
     * 分页游标键是 **`next_batch`**（`null` 表示末页），而 `total` 是**本页条数**。
     *
     * @param fromOrLimit - 分页起点 (string) 或数量限制 (number)
     * @param limitOrFrom - 数量限制 (number) 或分页起点 (string)
     * @returns 媒体列表（含 `next_batch` 游标）
     */
    async getMedia(fromOrLimit?: string | number, limitOrFrom?: number | string): Promise<MediaPage> {
        let from: string | undefined;
        let limit: number | undefined;
        if (typeof fromOrLimit === "number") {
            limit = fromOrLimit;
            if (typeof limitOrFrom === "string") {
                from = limitOrFrom;
            }
        } else {
            from = fromOrLimit;
            if (typeof limitOrFrom === "number") {
                limit = limitOrFrom;
            }
        }
        const queryParams = buildPaginationParams(limit, from);
        const response = await this.adminRequest<{ media?: MediaInfo[]; total?: number; next_batch?: string | null }>(
            Method.Get,
            "/media",
            queryParams,
        );
        const media = response.media ?? [];
        return { media, total: response.total ?? media.length, next_batch: response.next_batch ?? null };
    }

    /**
     * 获取媒体详情
     *
     * @param mediaId - 媒体 ID
     * @returns 媒体详情
     */
    async getMediaInfo(mediaId: string): Promise<MediaInfo> {
        if (!mediaId) {
            throw new ValidationError("Media ID is required");
        }
        return await this.adminRequest<MediaInfo>(Method.Get, `/media/${encodeURIComponent(mediaId)}`);
    }

    /**
     * 删除媒体
     *
     * @param mediaId - 媒体 ID
     */
    async deleteMedia(mediaId: string): Promise<void> {
        if (!mediaId) {
            throw new ValidationError("Media ID is required");
        }
        await this.adminRequest(Method.Delete, `/media/${encodeURIComponent(mediaId)}`);
    }

    /**
     * 获取媒体配额
     *
     * @returns 媒体配额信息
     */
    async getMediaQuota(): Promise<MediaQuotaResponse> {
        return await this.adminRequest(Method.Get, "/media/quota");
    }

    /**
     * 隔离媒体
     *
     * 对应 `POST /_synapse/admin/v1/media/quarantine/{server_name}/{media_id}`。
     *
     * **路径形状（重要）**：本后端（synapse-rust `admin/media.rs`）只注册**带 `server_name` 段**的形态。
     * 上游 Synapse 早期废弃的 `POST /media/{media_id}/quarantine` **本后端未注册**——已用
     * `docs/api-contract/generated/route-manifest.all.json`（1159 条、漂移 0）逐条核验，
     * `POST /media/{media_id}/quarantine` 会得到 404。故本方法必须同时给出 `serverName` 与 `mediaId`。
     *
     * @param serverName - 媒体所属服务器名（本地媒体用 `client.getDomain()`）
     * @param mediaId - 媒体 ID
     */
    async quarantineMedia(serverName: string, mediaId: string): Promise<void> {
        if (!serverName) {
            throw new ValidationError("Server name is required");
        }
        if (!mediaId) {
            throw new ValidationError("Media ID is required");
        }
        await this.adminRequest(
            Method.Post,
            `/media/quarantine/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`,
        );
    }

    /**
     * 取消隔离媒体
     *
     * 对应 `POST /_synapse/admin/v1/media/unquarantine/{server_name}/{media_id}`。
     *
     * 路径形状说明同 {@link quarantineMedia}：后端只注册带 `server_name` 段的形态，
     * 上游废弃的 `POST /media/{media_id}/unquarantine` 在本后端**未注册**。
     *
     * @param serverName - 媒体所属服务器名（本地媒体用 `client.getDomain()`）
     * @param mediaId - 媒体 ID
     */
    async unquarantineMedia(serverName: string, mediaId: string): Promise<void> {
        if (!serverName) {
            throw new ValidationError("Server name is required");
        }
        if (!mediaId) {
            throw new ValidationError("Media ID is required");
        }
        await this.adminRequest(
            Method.Post,
            `/media/unquarantine/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`,
        );
    }

    /**
     * 保护媒体，阻止其被自动隔离
     *
     * 对应 `POST /_synapse/admin/v1/media/protect/{server_name}/{media_id}`
     * （后端 `admin/media.rs::protect_media`）。
     *
     * @param serverName - 媒体所属服务器名（本地媒体用 `client.getDomain()`）
     * @param mediaId - 媒体 ID
     * @throws {ValidationError} `serverName` 或 `mediaId` 为空时
     * @example
     * ```typescript
     * await client.getAdminManager().protectMedia(client.getDomain()!, "abc123");
     * ```
     */
    async protectMedia(serverName: string, mediaId: string): Promise<MediaProtectionResponse> {
        if (!serverName) {
            throw new ValidationError("Server name is required");
        }
        if (!mediaId) {
            throw new ValidationError("Media ID is required");
        }
        return await this.adminRequest<MediaProtectionResponse>(
            Method.Post,
            `/media/protect/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`,
        );
    }

    /**
     * 按 `media_id` 保护媒体（上游形态，无 `server_name` 段）
     *
     * 对应 `POST /_synapse/admin/v1/media/protect/{media_id}`
     * （后端 `admin/media.rs::protect_media_by_id`，内部用本服务器名补全 `server_name`）。
     *
     * @param mediaId - 媒体 ID
     * @throws {ValidationError} `mediaId` 为空时
     * @example
     * ```typescript
     * await client.getAdminManager().protectMediaById("abc123");
     * ```
     */
    async protectMediaById(mediaId: string): Promise<MediaProtectionResponse> {
        if (!mediaId) {
            throw new ValidationError("Media ID is required");
        }
        return await this.adminRequest<MediaProtectionResponse>(
            Method.Post,
            `/media/protect/${encodeURIComponent(mediaId)}`,
        );
    }

    /**
     * 取消媒体保护
     *
     * 对应 `POST /_synapse/admin/v1/media/unprotect/{media_id}`
     * （后端 `admin/media.rs::unprotect_media_by_id`）。
     * ⚠️ 后端**只注册按 `media_id`** 的形态，没有 `unprotect/{server_name}/{media_id}` 变体。
     *
     * @param mediaId - 媒体 ID
     * @throws {ValidationError} `mediaId` 为空时
     * @example
     * ```typescript
     * await client.getAdminManager().unprotectMedia("abc123");
     * ```
     */
    async unprotectMedia(mediaId: string): Promise<MediaUnprotectionResponse> {
        if (!mediaId) {
            throw new ValidationError("Media ID is required");
        }
        return await this.adminRequest<MediaUnprotectionResponse>(
            Method.Post,
            `/media/unprotect/${encodeURIComponent(mediaId)}`,
        );
    }

    /**
     * 清除媒体缓存
     *
     * 对应 `POST /_synapse/admin/v1/purge_media_cache`。
     *
     * ⚠️ **`before_ts` 是 query 参数，不是请求体字段**：后端处理器用
     * `axum::extract::Query` 读它（`admin/media.rs::purge_media_cache`），
     * 读不到时默认 `0`。此前实现把它放在 JSON body 里 ⇒ 参数从未到达服务端，
     * 调用退化成 `before_ts = 0`（即「清理早于 epoch 的媒体」＝**什么都不删**）。
     *
     * @param beforeTs - 清除此时间戳（毫秒）之前访问过的媒体（必须为正整数）
     * @returns 删除的媒体数量
     */
    async purgeMediaCache(beforeTs?: number): Promise<{ deleted: number }> {
        if (beforeTs !== undefined) {
            if (!Number.isInteger(beforeTs) || beforeTs <= 0) {
                throw new ValidationError("beforeTs must be a positive integer");
            }
        }
        const queryParams = beforeTs !== undefined ? { before_ts: String(beforeTs) } : undefined;
        const result = await this.adminRequest<{ deleted?: number }>(Method.Post, "/purge_media_cache", queryParams);
        return { deleted: result.deleted ?? 0 };
    }

    /**
     * 获取媒体隔离变更历史
     *
     * 调用 `GET /_synapse/admin/v1/quarantine_media/{media_id}/changes` 端点，
     * 返回指定媒体的隔离（quarantine / unquarantine）变更记录列表。
     *
     * 后端返回 `{changes, total}`；每个变更条目是
     * `{stream_id, media_id, server_name, change_type, changed_by, created_ts}`。
     * ⚠️ 响应顶层**没有** `media_id`（`mediaId` 由请求路径决定），也**没有**游标
     * （后端只接受 `since` / `limit`，`changes` 之后需自行用最后一条的 `stream_id` 作 `since`）。
     *
     * @param mediaId - 媒体 ID
     * @param options - 可选分页参数
     * @param options.from - 当作 `since` 传给后端的起点 stream_id
     * @param options.limit - 返回条数上限
     * @returns 媒体隔离变更历史
     *
     * @example
     * ```typescript
     * const history = await adminManager.media.getMediaQuarantineChanges("abc123", {
     *     limit: 50,
     * });
     * console.log(history.changes);
     * ```
     *
     * @throws {ValidationError} 如果 mediaId 为空
     */
    async getMediaQuarantineChanges(
        mediaId: string,
        options?: { from?: string; limit?: number },
    ): Promise<MediaQuarantineChangesResponse> {
        if (!mediaId) {
            throw new ValidationError("Media ID is required");
        }
        const queryParams = buildPaginationParams(options?.limit, options?.from);
        const response = await this.adminRequest<{ changes?: MediaQuarantineChange[]; total?: number }>(
            Method.Get,
            `/quarantine_media/${encodeURIComponent(mediaId)}/changes`,
            queryParams,
        );
        const changes = response.changes ?? [];
        return { changes, total: response.total ?? changes.length };
    }

    /**
     * 获取用户上传的所有媒体
     *
     * 调用 `GET /_synapse/admin/v1/users/{user_id}/media` 端点，
     * 返回指定用户上传的全部媒体列表。
     *
     * ⚠️ 后端处理器（`admin/media.rs::get_user_media`）**不读 `limit` / `from`，也不返回游标**，
     * 只返回 `{media, total}`。参数保留是为了与上游 Synapse 的签名对齐，但当前后端会忽略它们。
     *
     * @param userId - 用户 MXC ID（如 `@user:example.org`）
     * @param options - 可选分页参数（当前后端忽略）
     * @param options.from - 分页起点 token（后端忽略）
     * @param options.limit - 返回条数上限（后端忽略）
     * @returns 用户媒体列表
     *
     * @example
     * ```typescript
     * const result = await adminManager.media.getUserMedia("@alice:example.org", { limit: 100 });
     * console.log(result.media);
     * ```
     *
     * @throws {ValidationError} 如果 userId 为空
     */
    async getUserMedia(userId: string, options?: { from?: string; limit?: number }): Promise<UserMediaList> {
        if (!userId) {
            throw new ValidationError("User ID is required");
        }
        const queryParams = buildPaginationParams(options?.limit, options?.from);
        const response = await this.adminRequest<{ media?: MediaInfo[]; total?: number }>(
            Method.Get,
            `/users/${encodeURIComponent(userId)}/media`,
            queryParams,
        );
        const media = response.media ?? [];
        return { media, total: response.total ?? media.length };
    }

    /**
     * 删除用户上传的所有媒体
     *
     * 调用 `DELETE /_synapse/admin/v1/users/{user_id}/media` 端点，
     * 删除指定用户上传的全部本地媒体。
     *
     * @param userId - 用户 MXC ID（如 `@user:example.org`）
     * @returns 删除的媒体数量
     *
     * @example
     * ```typescript
     * const result = await adminManager.media.deleteUserMedia("@bob:example.org");
     * console.log(`deleted ${result.deleted} media items`);
     * ```
     *
     * @throws {ValidationError} 如果 userId 为空
     */
    async deleteUserMedia(userId: string): Promise<{ deleted: number }> {
        if (!userId) {
            throw new ValidationError("User ID is required");
        }
        const result = await this.adminRequest<{ deleted?: number }>(
            Method.Delete,
            `/users/${encodeURIComponent(userId)}/media`,
        );
        return { deleted: result?.deleted ?? 0 };
    }
}
