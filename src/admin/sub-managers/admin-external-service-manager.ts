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
 * Admin External Service Manager - 外部服务管理（Admin 子 Manager）
 *
 * 与后端 `synapse-rust/src/web/routes/external_service.rs` 字段对齐：
 * - 后端使用 `{ as_id, service_type, service_id, display_name, is_enabled, is_healthy, created_ts }`
 * - 与 `ExternalServiceManager`（`{ id, type, url, enabled }`）的旧字段格式不同，
 *   本子 Manager 直接使用后端字段格式，避免双向转换损失。
 *
 * 对应端点（均位于 `/_synapse/admin/v1` 前缀下）：
 * - GET    /external_services                列出外部服务（可选 service_type 过滤）
 * - POST   /external_services                注册外部服务
 * - PUT    /external_services/{asId}         更新外部服务
 * - DELETE /external_services/{asId}         删除外部服务
 * - GET    /external_services/health         获取所有服务健康状态
 * - GET    /external_services/{asId}/health  获取单个服务健康状态
 * - POST   /external_services/{asId}/health/check  触发健康检查
 */

import { Method } from "../../http-api/method";
import { AdminBaseManager, type AdminErrorCallback, type ManagerOpts } from "../admin-base-manager";
import { MatrixClient } from "../../client";

/**
 * 后端外部服务对象（字段与 `external_service.rs` 对齐）。
 */
export interface BackendExternalService {
    as_id: string;
    service_type: string;
    service_id: string;
    display_name: string;
    is_enabled: boolean;
    is_healthy: boolean;
    created_ts: number;
}

/**
 * 后端外部服务健康状态（字段与 `external_service.rs` 对齐）。
 */
export interface BackendExternalServiceHealth {
    service_id: string;
    service_type: string;
    is_healthy: boolean;
    last_check_ts: number | null;
    last_success_ts: number | null;
    last_error: string | null;
    consecutive_failures: number;
}

/**
 * 注册外部服务的请求载荷。
 */
export interface RegisterExternalServicePayload {
    service_type: string;
    service_id: string;
    display_name: string;
    webhook_url?: string;
    api_key?: string;
    config?: Record<string, unknown>;
}

/**
 * 更新外部服务的请求载荷（所有字段可选）。
 */
export interface UpdateExternalServicePayload {
    webhook_url?: string;
    api_key?: string;
    config?: Record<string, unknown>;
    is_enabled?: boolean;
}

/**
 * 健康检查触发结果。
 */
export interface HealthCheckResult {
    as_id: string;
    is_healthy: boolean;
}

/**
 * Admin External Service Manager
 *
 * 提供外部服务的 CRUD 与健康检查功能，使用后端字段格式。
 */
export class AdminExternalServiceManager extends AdminBaseManager {
    constructor(client: MatrixClient, onError?: AdminErrorCallback, opts?: ManagerOpts) {
        super(client, onError, opts);
    }

    /**
     * 列出外部服务。
     *
     * @param serviceType - 可选服务类型过滤；传 "all" 或省略则不过滤
     * @returns 外部服务列表
     */
    async listServices(serviceType?: string): Promise<BackendExternalService[]> {
        const queryParams =
            serviceType && serviceType !== "all" ? { service_type: serviceType } : undefined;
        const result = await this.adminRequest<BackendExternalService[]>(
            Method.Get,
            "/external_services",
            queryParams,
        );
        return result ?? [];
    }

    /**
     * 注册外部服务。
     *
     * @param payload - 服务注册信息
     * @returns 创建后的外部服务对象
     */
    async registerService(payload: RegisterExternalServicePayload): Promise<BackendExternalService> {
        return await this.adminRequest<BackendExternalService>(
            Method.Post,
            "/external_services",
            undefined,
            payload,
        );
    }

    /**
     * 更新外部服务。
     *
     * @param asId - 外部服务的 as_id
     * @param payload - 更新字段
     * @returns 更新后的外部服务对象
     */
    async updateService(
        asId: string,
        payload: UpdateExternalServicePayload,
    ): Promise<BackendExternalService> {
        return await this.adminRequest<BackendExternalService>(
            Method.Put,
            `/external_services/${encodeURIComponent(asId)}`,
            undefined,
            payload,
        );
    }

    /**
     * 删除外部服务。
     *
     * @param asId - 外部服务的 as_id
     */
    async deleteService(asId: string): Promise<void> {
        await this.adminRequest(Method.Delete, `/external_services/${encodeURIComponent(asId)}`);
    }

    /**
     * 获取所有外部服务的健康状态。
     *
     * @returns 健康状态列表
     */
    async getAllHealth(): Promise<BackendExternalServiceHealth[]> {
        const result = await this.adminRequest<BackendExternalServiceHealth[]>(
            Method.Get,
            "/external_services/health",
        );
        return result ?? [];
    }

    /**
     * 获取指定外部服务的健康状态。
     *
     * @param asId - 外部服务的 as_id
     * @returns 健康状态；若服务不存在返回 null
     */
    async getServiceHealth(asId: string): Promise<BackendExternalServiceHealth | null> {
        try {
            return await this.adminRequest<BackendExternalServiceHealth>(
                Method.Get,
                `/external_services/${encodeURIComponent(asId)}/health`,
            );
        } catch (e) {
            const status = (e as { httpStatus?: number }).httpStatus;
            if (status === 404) return null;
            throw e;
        }
    }

    /**
     * 触发指定外部服务的健康检查。
     *
     * @param asId - 外部服务的 as_id
     * @returns 健康检查结果
     */
    async checkServiceHealth(asId: string): Promise<HealthCheckResult> {
        return await this.adminRequest<HealthCheckResult>(
            Method.Post,
            `/external_services/${encodeURIComponent(asId)}/health/check`,
        );
    }
}
