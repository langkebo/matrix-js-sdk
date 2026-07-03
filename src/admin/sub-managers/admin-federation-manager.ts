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
    FederationDestination,
    AdminFederationDestinationDetail,
    FederationAdmissionResult,
    PendingFederationList,
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
     * @returns 联邦黑名单列表
     */
    async getFederationBlacklist(): Promise<FederationBlacklistEntry[]> {
        const response = await this.adminRequest<{ blacklist: FederationBlacklistEntry[] }>(
            Method.Get,
            "/federation/blacklist",
        );
        return response.blacklist || [];
    }

    /**
     * 添加到联邦黑名单
     *
     * @param serverName - 服务器名称
     * @param reason - 原因
     */
    async addFederationBlacklistEntry(serverName: string, reason?: string): Promise<void> {
        if (!serverName) {
            throw new ValidationError("Server name is required");
        }
        const body: { server_name: string; reason?: string } = { server_name: serverName };
        if (reason) {
            body.reason = reason;
        }
        await this.adminRequest(Method.Post, "/federation/blacklist", undefined, body);
    }

    /**
     * 从联邦黑名单移除
     *
     * @param serverName - 服务器名称
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
     */
    async resetFederationConnection(serverName: string): Promise<void> {
        await this.disconnectFederation(serverName);
    }

    /**
     * 重置联邦目的地（尝试 /reset，404 时回退到 /reset_connection）
     *
     * @param serverName - 服务器名称
     */
    async resetFederationDestination(serverName: string): Promise<void> {
        if (!serverName) throw new ValidationError("Server name is required");
        try {
            await this.adminRequest(
                Method.Post,
                `/federation/destinations/${encodeURIComponent(serverName)}/reset`,
                {},
                undefined,
            );
        } catch (e) {
            const err = e as MatrixError;
            if (e instanceof NotFoundError || (err instanceof MatrixError && err.httpStatus === 404)) {
                await this.adminRequest(
                    Method.Post,
                    `/federation/destinations/${encodeURIComponent(serverName)}/reset_connection`,
                    {},
                    undefined,
                );
                return;
            }
            throw e;
        }
    }

    /**
     * 获取联邦目的地的房间列表
     *
     * @param serverName - 服务器名称
     * @param options - 分页选项
     * @returns 房间列表
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
     * 对接: GET /_synapse/admin/v1/federation/cache
     */
    async getFederationCache(): Promise<AdminFederationCache> {
        return await this.adminRequest(Method.Get, apu("/federation/cache"));
    }

    /**
     * 清除联邦缓存
     * 对接: POST /_synapse/admin/v1/federation/cache/clear
     */
    async clearFederationCache(): Promise<void> {
        await this.adminRequest(Method.Post, apu("/federation/cache/clear"));
    }

    /**
     * 删除联邦缓存中的指定条目
     * 对接: DELETE /_synapse/admin/v1/federation/cache/{key}
     *
     * @param key - 缓存条目的键
     */
    async deleteFederationCacheEntry(key: string): Promise<void> {
        if (!key) {
            throw new ValidationError("Cache key is required");
        }
        await this.adminRequest(Method.Delete, apu(`/federation/cache/${encodeURIComponent(key)}`));
    }

    /**
     * 获取联邦准入列表
     *
     * @returns 联邦准入列表
     */
    async getFederationAdmissionList(): Promise<FederationAdmissionResult[]> {
        try {
            const response = await this.adminRequest<{
                admissions?: FederationAdmissionResult[];
                pending?: FederationAdmissionResult[];
            }>(Method.Get, "/federation/pending");
            return response.admissions || response.pending || [];
        } catch (e) {
            const err = e as MatrixError;
            if (e instanceof NotFoundError || (err instanceof MatrixError && err.httpStatus === 404)) {
                const fallback = await this.adminRequest<{ admissions?: FederationAdmissionResult[] }>(
                    Method.Get,
                    "/federation/admissions",
                );
                return fallback.admissions || [];
            }
            throw e;
        }
    }

    /**
     * 获取待处理联邦服务器列表
     *
     * @param from - 分页起点
     * @param limit - 数量限制
     * @returns 待处理联邦服务器列表
     */
    async getPendingFederationServers(from?: string, limit?: number): Promise<PendingFederationList> {
        const queryParams = buildPaginationParams(limit, from);
        try {
            return await this.adminRequest<PendingFederationList>(Method.Get, "/federation/pending", queryParams);
        } catch (e) {
            const err = e as MatrixError;
            if (e instanceof NotFoundError || (err instanceof MatrixError && err.httpStatus === 404)) {
                return await this.adminRequest<PendingFederationList>(
                    Method.Get,
                    "/federation/pending_servers",
                    queryParams,
                );
            }
            throw e;
        }
    }

    /**
     * 解析联邦服务器
     *
     * @param serverName - 服务器名称
     * @returns 解析结果
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
     */
    async rewriteFederation(from: string, to: string): Promise<FederationRewriteResponse> {
        if (!from || !to) throw new ValidationError("from and to are required");
        return await this.adminRequest(Method.Post, "/federation/rewrite", {}, { from, to });
    }

    /**
     * 确认联邦
     *
     * @param payload - 确认载荷
     * @returns 确认结果
     */
    async confirmFederation(payload: {
        server_name?: string;
        action?: string;
        reason?: string;
    }): Promise<FederationAdmissionResult> {
        return await this.adminRequest(Method.Post, "/federation/confirm", {}, payload);
    }

    /**
     * 添加到联邦黑名单（按服务器名称路径）
     *
     * @param serverName - 服务器名称
     * @param reason - 原因
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
     */
    async removeFromFederationBlacklist(serverName: string): Promise<void> {
        await this.removeFederationBlacklistEntry(serverName);
    }
}
