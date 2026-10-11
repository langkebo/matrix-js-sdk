/**
 * Feature Flag Manager - 功能开关管理
 *
 * 提供功能开关的创建、更新、获取及列表查询功能（Admin API）。
 * 对应后端: synapse-rust/src/web/routes/feature_flags.rs
 *
 * 遵循 D7 契约驱动开发标准，100% 覆盖后端端点并保持类型对齐。
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/method";
import { AdminPrefix } from "../http-api/prefix";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export interface FeatureFlag {
    key: string;
    target_scope: string;
    status: string;
    description?: string;
    created_ts: number;
    updated_ts: number;
}

export interface CreateFeatureFlagRequest {
    key: string;
    target_scope: string;
    status: string;
    description?: string;
}

export interface UpdateFeatureFlagRequest {
    status?: string;
    description?: string;
}

export interface FeatureFlagListQuery {
    target_scope?: string;
    status?: string;
    limit?: number;
    offset?: number;
    [key: string]: string | number | boolean | string[] | undefined;
}

export interface FeatureFlagListResponse {
    flags: FeatureFlag[];
    total: number;
}

/**
 * FeatureFlagManager 处理功能开关的后台管理。
 */
export class FeatureFlagManager extends BaseManager {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * 创建功能开关
     * 对应 POST /_synapse/admin/v1/feature-flags
     *
     * @param body - 功能开关创建请求体
     * @returns 创建后的功能开关
     * @throws 请求失败时抛出归一化后的错误
     * @example
     * ```typescript
     * const flag = await client.getFeatureFlagManager().createFlag({
     *     key: "new_feature",
     *     target_scope: "global",
     *     status: "enabled",
     *     description: "试用新功能",
     * });
     * console.log(flag.key, flag.status);
     * ```
     */
    async createFlag(body: CreateFeatureFlagRequest): Promise<FeatureFlag> {
        try {
            return await this.withRetry(async () => {
                return await this.request<FeatureFlag>({
                    method: Method.Post,
                    path: "/feature-flags",
                    body: body,
                    prefix: AdminPrefix.V1,
                });
            }, "createFlag");
        } catch (error) {
            throw this.normalizeError(error, "createFlag");
        }
    }

    /**
     * 更新功能开关
     * 对应 PATCH /_synapse/admin/v1/feature-flags/{flag_key}
     *
     * @param key - 功能开关的键
     * @param body - 需要更新的字段
     * @returns 更新后的功能开关
     * @throws 请求失败时抛出归一化后的错误
     * @example
     * ```typescript
     * const flag = await client.getFeatureFlagManager().updateFlag("new_feature", {
     *     status: "disabled",
     * });
     * console.log(flag.status);
     * ```
     */
    async updateFlag(key: string, body: UpdateFeatureFlagRequest): Promise<FeatureFlag> {
        try {
            return await this.withRetry(async () => {
                return await this.request<FeatureFlag>({
                    method: Method.Patch,
                    path: `/feature-flags/${encodeURIComponent(key)}`,
                    body: body,
                    prefix: AdminPrefix.V1,
                });
            }, "updateFlag");
        } catch (error) {
            throw this.normalizeError(error, "updateFlag");
        }
    }

    /**
     * 获取功能开关详情
     * 对应 GET /_synapse/admin/v1/feature-flags/{flag_key}
     *
     * @param key - 功能开关的键
     * @returns 功能开关详情
     * @throws 请求失败时抛出归一化后的错误
     * @example
     * ```typescript
     * const flag = await client.getFeatureFlagManager().getFlag("new_feature");
     * console.log(flag.target_scope);
     * ```
     */
    async getFlag(key: string): Promise<FeatureFlag> {
        try {
            return await this.withRetry(async () => {
                return await this.request<FeatureFlag>({
                    method: Method.Get,
                    path: `/feature-flags/${encodeURIComponent(key)}`,
                    prefix: AdminPrefix.V1,
                });
            }, "getFlag");
        } catch (error) {
            throw this.normalizeError(error, "getFlag");
        }
    }

    /**
     * 获取功能开关列表
     * 对应 GET /_synapse/admin/v1/feature-flags
     *
     * @param query - 可选的过滤与分页条件
     * @returns 功能开关列表与总数
     * @throws 请求失败时抛出归一化后的错误
     * @example
     * ```typescript
     * const { flags, total } = await client.getFeatureFlagManager().listFlags({ limit: 20 });
     * console.log(total, flags.length);
     * ```
     */
    async listFlags(query?: FeatureFlagListQuery): Promise<FeatureFlagListResponse> {
        try {
            return await this.withRetry(async () => {
                return await this.request<FeatureFlagListResponse>({
                    method: Method.Get,
                    path: "/feature-flags",
                    queryParams: query,
                    prefix: AdminPrefix.V1,
                });
            }, "listFlags");
        } catch (error) {
            throw this.normalizeError(error, "listFlags");
        }
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getFeatureFlagManager = function (): FeatureFlagManager {
        registerManagerClass("featureFlags", FeatureFlagManager);
        return getOrCreateManager(this, "featureFlags", () => new FeatureFlagManager(this));
    };
}
