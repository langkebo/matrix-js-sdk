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
import { MatrixError } from "../../http-api/errors";
import { NotFoundError, ValidationError } from "../../errors";
import { AdminBaseManager, apu, type AdminErrorCallback, type ManagerOpts } from "../admin-base-manager";
import { buildPaginationParams } from "../utils";
import type {
    FederationBlacklistEntry,
    FederationBlacklistPage,
    FederationDestination,
    AdminFederationDestinationDetail,
    FederationAdmissionResult,
    PendingFederationList,
    PendingFederationServer,
    AdminFederationCache,
    AdminFederationDestinationRooms,
    FederationResolveResponse,
    FederationRewriteResponse,
} from "../types";
import type { MatrixClient } from "../../client";

export class AdminFederationManager extends AdminBaseManager {
    constructor(client: MatrixClient, onError?: AdminErrorCallback, opts?: ManagerOpts) {
        super(client, onError, opts);
    }

    /**
     * 获取联邦黑名单列表
     *
     * 对应 `GET /_synapse/admin/v1/federation/blacklist`，后端返回
     * `{blacklist, total, next_batch}`（游标键是 `next_batch`，`total` 是本页条数）。
     *
     * @param options - 可选分页参数
     * @returns 黑名单页（含游标）
     *
     * @example
     * ```typescript
     * const page = await client.getAdminManager().federation.getFederationBlacklist({ limit: 50 });
     * console.log(page.blacklist.length);
     * ```
     */
    async getFederationBlacklist(options?: { from?: string; limit?: number }): Promise<FederationBlacklistPage> {
        const queryParams = buildPaginationParams(options?.limit, options?.from);
        const response = await this.adminRequest<{
            blacklist?: FederationBlacklistEntry[];
            total?: number;
            next_batch?: string | null;
        }>(Method.Get, "/federation/blacklist", queryParams);
        const blacklist = response.blacklist ?? [];
        return { blacklist, total: response.total ?? blacklist.length, next_batch: response.next_batch ?? null };
    }

    /**
     * 添加到联邦黑名单
     *
     * @param serverName - 服务器名称
     * @param reason - 原因
     *
     * @throws {ValidationError} 如果 serverName 为空
     *
     * @example
     * ```typescript
     * await client.getAdminManager().federation.addFederationBlacklistEntry("evil.example.org", "spam");
     * ```
     */
    async addFederationBlacklistEntry(serverName: string, reason?: string): Promise<void> {
        if (!serverName) {
            throw new ValidationError("Server name is required");
        }
        // 后端注册的是 `POST /_synapse/admin/v1/federation/blacklist/{server_name}`
        // （synapse-web/src/routes/admin/federation.rs），server_name 走**路径参数**、
        // 没有请求体（handler 只有 `Path(server_name)`，无 `Json` 提取器）。
        // 旧实现打裸 `/federation/blacklist` 且把 server_name 放在 body 里 → 必 404。
        // 后端 handler 只有 `Path(server_name)`、没有 body 提取器，故这里附带的 body 会被
        // 忽略（`reason` 保留在签名中以兼容调用方与将来扩展）。
        await this.adminRequest(
            Method.Post,
            `/federation/blacklist/${encodeURIComponent(serverName)}`,
            undefined,
            reason ? { reason } : undefined,
        );
    }

    /**
     * 从联邦黑名单移除
     *
     * @param serverName - 服务器名称
     *
     * @throws {ValidationError} 如果 serverName 为空
     *
     * @example
     * ```typescript
     * await client.getAdminManager().federation.removeFederationBlacklistEntry("evil.example.org");
     * ```
     */
    async removeFederationBlacklistEntry(serverName: string): Promise<void> {
        if (!serverName) {
            throw new ValidationError("Server name is required");
        }
        await this.adminRequest(Method.Delete, `/federation/blacklist/${encodeURIComponent(serverName)}`);
    }

    /**
     * 获取联邦目的地列表
     *
     * @returns 联邦目的地列表
     *
     * @example
     * ```typescript
     * const destinations = await client.getAdminManager().federation.getFederationDestinations();
     * console.log(destinations.length);
     * ```
     */
    async getFederationDestinations(): Promise<FederationDestination[]> {
        const response = await this.adminRequest<{ destinations: FederationDestination[] }>(
            Method.Get,
            "/federation/destinations",
        );
        return response.destinations || [];
    }

    /**
     * 获取联邦目的地详情
     *
     * @param serverName - 服务器名称
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 目的地详情或 null
     *
     * @throws {Error} 当 throwOnError 为 true 且请求失败时，原样抛出底层错误
     *
     * @example
     * ```typescript
     * const detail = await client.getAdminManager().federation.getFederationDestination("matrix.org");
     * console.log(detail?.failure_count);
     * ```
     */
    async getFederationDestination(
        serverName: string,
        throwOnError = true,
    ): Promise<AdminFederationDestinationDetail | null> {
        try {
            return await this.adminRequest<AdminFederationDestinationDetail>(
                Method.Get,
                `/federation/destinations/${encodeURIComponent(serverName)}`,
            );
            // @swallow-error { owner: "admin", expires: "2026-12-31" }
        } catch (e) {
            const err = e as MatrixError;
            if (!throwOnError && (e instanceof NotFoundError || (err instanceof MatrixError && err.httpStatus === 404)))
                return null;
            throw e;
        }
    }

    /**
     * 断开联邦连接
     *
     * @param serverName - 服务器名称
     *
     * @example
     * ```typescript
     * await client.getAdminManager().federation.disconnectFederation("matrix.org");
     * ```
     */
    async disconnectFederation(serverName: string): Promise<void> {
        await this.adminRequest(
            Method.Post,
            `/federation/destinations/${encodeURIComponent(serverName)}/reset_connection`,
            {},
            undefined,
        );
    }

    /**
     * 重置联邦连接（委托给 disconnectFederation）
     *
     * @param serverName - 服务器名称
     *
     * @example
     * ```typescript
     * await client.getAdminManager().federation.resetFederationConnection("matrix.org");
     * ```
     */
    async resetFederationConnection(serverName: string): Promise<void> {
        await this.disconnectFederation(serverName);
    }

    /**
     * 重置联邦目的地（**直接**打 `POST …/destinations/{server}/reset_connection`）。
     *
     * ⚠️ 修复（2026-10-15）：此前实现先尝试 `/reset`、仅在 404 时回退到 `/reset_connection`。
     * 后端**从未注册过** `/reset`（`synapse-web/src/routes/admin/federation.rs:23-37` 只有
     * `{destination}/reset_connection`）⇒ 每次调用都会先发出一个必然 404 的请求，再打真正
     * 的端点（与 delayed_events 曾经的 action-in-PATH 试探同型）。现改为单请求。
     *
     * @param serverName - 服务器名称
     *
     * @throws {ValidationError} 如果 serverName 为空
     *
     * @example
     * ```typescript
     * await client.getAdminManager().federation.resetFederationDestination("matrix.org");
     * ```
     */
    async resetFederationDestination(serverName: string): Promise<void> {
        if (!serverName) throw new ValidationError("Server name is required");
        await this.adminRequest(
            Method.Post,
            `/federation/destinations/${encodeURIComponent(serverName)}/reset_connection`,
            {},
            undefined,
        );
    }

    /**
     * 获取联邦目的地的房间列表
     *
     * @param serverName - 服务器名称
     * @param options - 分页选项
     * @returns 房间列表
     *
     * @example
     * ```typescript
     * const rooms = await client.getAdminManager().federation.getFederationDestinationRooms("matrix.org", { limit: 20 });
     * console.log(rooms.total);
     * ```
     */
    async getFederationDestinationRooms(
        serverName: string,
        options?: { from?: number; limit?: number },
    ): Promise<AdminFederationDestinationRooms> {
        const query: Record<string, string> = {};
        if (options?.from !== undefined) query.from = String(options.from);
        if (options?.limit !== undefined) query.limit = String(options.limit);
        return await this.adminRequest(
            Method.Get,
            `/federation/destinations/${encodeURIComponent(serverName)}/rooms`,
            query,
        );
    }

    /**
     * 删除联邦目的地
     *
     * @param serverName - 服务器名称
     *
     * @example
     * ```typescript
     * await client.getAdminManager().federation.deleteFederationDestination("matrix.org");
     * ```
     */
    async deleteFederationDestination(serverName: string): Promise<void> {
        await this.adminRequest(
            Method.Delete,
            `/federation/destinations/${encodeURIComponent(serverName)}`,
            {},
            undefined,
        );
    }

    /**
     * 获取联邦缓存信息
     *
     * 对应 `GET /_synapse/admin/v1/federation/cache`，后端返回 `{cache, total}`。
     * ⚠️ 列表键是 `cache`（不是 `entries`）。
     *
     * @example
     * ```typescript
     * const cache = await client.getAdminManager().federation.getFederationCache();
     * console.log(cache.total);
     * ```
     */
    async getFederationCache(): Promise<AdminFederationCache> {
        return await this.adminRequest(Method.Get, apu("/federation/cache"));
    }

    /**
     * 清除联邦缓存
     * 对接: POST /_synapse/admin/v1/federation/cache/clear
     *
     * @example
     * ```typescript
     * await client.getAdminManager().federation.clearFederationCache();
     * ```
     */
    async clearFederationCache(): Promise<void> {
        await this.adminRequest(Method.Post, apu("/federation/cache/clear"));
    }

    /**
     * 删除联邦缓存中的指定条目
     * 对接: DELETE /_synapse/admin/v1/federation/cache/{key}
     *
     * @param key - 缓存条目的键
     *
     * @throws {ValidationError} 如果 key 为空
     *
     * @example
     * ```typescript
     * await client.getAdminManager().federation.deleteFederationCacheEntry("my-cache-key");
     * ```
     */
    async deleteFederationCacheEntry(key: string): Promise<void> {
        if (!key) {
            throw new ValidationError("Cache key is required");
        }
        await this.adminRequest(Method.Delete, apu(`/federation/cache/${encodeURIComponent(key)}`));
    }

    /**
     * 获取待处理联邦服务器列表（审批队列）
     *
     * 对应 `GET /_synapse/admin/v1/federation/pending`，后端返回 `{servers, total, limit, next_batch}`。
     *
     * ⚠️ 旧实现读的是 `admissions` / `pending` 两个**后端从不返回**的键 ⇒ 恒返回 `[]`
     * （与 {@link getPendingFederationServers} 打同一端点、但取错键）。
     *
     * @example
     * ```typescript
     * const servers = await client.getAdminManager().federation.getFederationAdmissionList();
     * console.log(servers.length);
     * ```
     */
    async getFederationAdmissionList(): Promise<PendingFederationServer[]> {
        const response = await this.adminRequest<{ servers?: PendingFederationServer[] }>(
            Method.Get,
            "/federation/pending",
        );
        return response.servers ?? [];
    }

    /**
     * 获取待处理联邦服务器列表
     *
     * @param from - 分页起点
     * @param limit - 数量限制
     * @returns 待处理联邦服务器列表
     *
     * @example
     * ```typescript
     * const page = await client.getAdminManager().federation.getPendingFederationServers(undefined, 50);
     * console.log(page.servers.length, page.next_batch);
     * ```
     */
    async getPendingFederationServers(from?: string, limit?: number): Promise<PendingFederationList> {
        // `/federation/pending_servers` 回退分支已删除：后端只注册 `/federation/pending`。
        const queryParams = buildPaginationParams(limit, from);
        return await this.adminRequest<PendingFederationList>(Method.Get, "/federation/pending", queryParams);
    }

    /**
     * 解析联邦服务器
     *
     * @param serverName - 服务器名称
     * @returns 解析结果
     *
     * @example
     * ```typescript
     * const res = await client.getAdminManager().federation.resolveFederation("matrix.org");
     * console.log(res.resolved);
     * ```
     */
    async resolveFederation(serverName: string): Promise<FederationResolveResponse> {
        return await this.adminRequest(Method.Post, "/federation/resolve", {}, { server_name: serverName });
    }

    /**
     * 重写联邦服务器
     *
     * @param from - 源服务器名称
     * @param to - 目标服务器名称
     * @returns 重写结果
     *
     * @throws {ValidationError} 如果 from 或 to 为空
     *
     * @example
     * ```typescript
     * const res = await client.getAdminManager().federation.rewriteFederation("old.example.org", "new.example.org");
     * console.log(res);
     * ```
     */
    async rewriteFederation(from: string, to: string): Promise<FederationRewriteResponse> {
        if (!from || !to) throw new ValidationError("from and to are required");
        return await this.adminRequest(Method.Post, "/federation/rewrite", {}, { from, to });
    }

    /**
     * 确认联邦准入
     *
     * 对应 `POST /_synapse/admin/v1/federation/confirm`。后端 `ConfirmRequest`
     * 带 `#[serde(deny_unknown_fields)]`，字段是 **`{server_name, accept}`**。
     *
     * ⚠️ 旧签名收 `{server_name?, action?, reason?}` —— `accept` 缺失 + `action`/`reason`
     * 是未知字段 ⇒ 该请求**必然 400**（`deny_unknown_fields` 连多余字段都不放过）。
     *
     * @param serverName - 待确认的服务器名
     * @param accept - `true` 接受、`false` 拒绝
     * @returns 准入结果
     *
     * @throws {ValidationError} 如果 serverName 为空
     *
     * @example
     * ```typescript
     * const res = await client.getAdminManager().federation.confirmFederation("remote.example.org", true);
     * console.log(res.status);
     * ```
     */
    async confirmFederation(serverName: string, accept: boolean): Promise<FederationAdmissionResult> {
        if (!serverName) throw new ValidationError("serverName is required");
        return await this.adminRequest(Method.Post, "/federation/confirm", {}, { server_name: serverName, accept });
    }

    /**
     * 添加到联邦黑名单（按服务器名称路径）
     *
     * @param serverName - 服务器名称
     * @param reason - 原因
     *
     * @throws {ValidationError} 如果 serverName 为空
     *
     * @example
     * ```typescript
     * await client.getAdminManager().federation.addToFederationBlacklist("evil.example.org", "spam");
     * ```
     */
    async addToFederationBlacklist(serverName: string, reason?: string): Promise<void> {
        if (!serverName) throw new ValidationError("Server name is required");
        await this.adminRequest(
            Method.Post,
            `/federation/blacklist/${encodeURIComponent(serverName)}`,
            {},
            reason ? { reason } : undefined,
        );
    }

    /**
     * 从联邦黑名单移除（委托给 removeFederationBlacklistEntry）
     *
     * @param serverName - 服务器名称
     *
     * @example
     * ```typescript
     * await client.getAdminManager().federation.removeFromFederationBlacklist("evil.example.org");
     * ```
     */
    async removeFromFederationBlacklist(serverName: string): Promise<void> {
        await this.removeFederationBlacklistEntry(serverName);
    }
}
