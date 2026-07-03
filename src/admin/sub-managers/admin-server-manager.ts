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
import { AdminBaseManager, type AdminErrorCallback, type ManagerOpts } from "../admin-base-manager";
import { buildPaginationParams } from "../utils";
import type {
    ServerStats,
    ServerStatus,
    ServerHealth,
    ServerInfo,
    AdminCleanupResponse,
    ServerNotice,
    SystemNotificationInfo,
    SystemNotificationPage,
    AdminPurgeHistoryResult,
    AdminShutdownRoomResult,
    AdminBackupPage,
    AdminExperimentalFeatures,
    AdminRegisterResult,
    AdminServerConfig,
    AdminInfoResponse,
    DynamicConfig,
    AdminRegisterRequest,
    PurgeHistoryRequest,
    ShutdownRoomRequest,
    CleanupRoomsRequest,
    RestartServerPayload,
    RestartServerResponse,
    PurgeRoomResponse,
} from "../types";
import { MatrixClient } from "../../client";

export enum AdminServerEvent {
    ServerStatsUpdated = "ServerStatsUpdated",
}

export interface AdminServerEventMap {
    [AdminServerEvent.ServerStatsUpdated]: (stats: ServerStats) => void;
}

export class AdminServerManager extends AdminBaseManager<AdminServerEvent, AdminServerEventMap> {
    private serverStats: ServerStats | null = null;

    constructor(client: MatrixClient, onError?: AdminErrorCallback, opts?: ManagerOpts) {
        super(client, onError, opts);
    }

    /**
     * 获取服务器统计信息
     *
     * @returns 服务器统计信息
     */
    async getServerStats(): Promise<ServerStats> {
        let stats: ServerStats;
        try {
            stats = await this.adminRequest<ServerStats>(Method.Get, "/statistics");
        } catch (e) {
            const err = e as MatrixError;
            if ((e instanceof NotFoundError) || (err instanceof MatrixError && err.httpStatus === 404)) {
                stats = await this.adminRequest<ServerStats>(Method.Get, "/server_stats");
            } else {
                throw e;
            }
        }
        this.serverStats = stats;
        this.emit(AdminServerEvent.ServerStatsUpdated, stats);
        return stats;
    }

    /**
     * 获取缓存的服务器统计信息
     *
     * @returns 缓存的服务器统计信息，如果不存在则为 null
     */
    getServerStatsCached(): ServerStats | null {
        return this.serverStats;
    }

    /**
     * 获取服务器状态
     *
     * @returns 服务器状态
     */
    async getServerStatus(): Promise<ServerStatus> {
        return await this.adminRequest<ServerStatus>(Method.Get, "/status");
    }

    /**
     * 获取服务器健康检查
     *
     * @returns 服务器健康检查结果
     */
    async getServerHealth(): Promise<ServerHealth> {
        try {
            return await this.adminRequest<ServerHealth>(Method.Get, "/health");
        } catch (e) {
            const err = e as MatrixError;
            if ((e instanceof NotFoundError) || (err instanceof MatrixError && err.httpStatus === 404)) {
                return await this.adminRequest<ServerHealth>(Method.Get, "/server_health");
            }
            throw e;
        }
    }

    /**
     * 获取服务器信息
     *
     * @returns 服务器信息
     */
    async getServerInfo(): Promise<ServerInfo> {
        try {
            return await this.adminRequest<ServerInfo>(Method.Get, "/info");
        } catch (e) {
            const err = e as MatrixError;
            if ((e instanceof NotFoundError) || (err instanceof MatrixError && err.httpStatus === 404)) {
                return await this.adminRequest<ServerInfo>(Method.Get, "/server_info");
            }
            throw e;
        }
    }

    /**
     * 清理数据库
     *
     * @param options - 清理选项
     * @returns 清理结果
     */
    async cleanupDatabase(options?: {
        room_id?: string;
        min_depth?: number;
        max_depth?: number;
        min_ts?: number;
        max_ts?: number;
        limit?: number;
        delete_local_media?: boolean;
        delete_remote_media?: boolean;
        delete_old_events?: boolean;
        delete_old_rooms?: boolean;
        delete_old_users?: boolean;
    }): Promise<AdminCleanupResponse> {
        return await this.adminRequest<AdminCleanupResponse>(Method.Post, "/cleanup", undefined, options || {});
    }

    /**
     * 获取服务器通知列表
     *
     * @param fromOrLimit - 分页起点或数量限制
     * @param limit - 数量限制
     * @returns 服务器通知列表
     */
    async getServerNotices(
        fromOrLimit?: string | number,
        limit?: number,
    ): Promise<{ notices: ServerNotice[]; next_token?: string }> {
        let from: string | undefined;
        let localLimit: number | undefined = limit;
        if (typeof fromOrLimit === "number") {
            localLimit = fromOrLimit;
        } else {
            from = fromOrLimit;
        }
        const queryParams = buildPaginationParams(from, localLimit);
        const response = await this.adminRequest<{ notices: ServerNotice[]; next_token?: string }>(
            Method.Get,
            "/server_notices",
            queryParams,
        );
        return { notices: response.notices || [], next_token: response.next_token };
    }

    /**
     * 发送服务器通知
     *
     * @param arg1 - 通知内容或用户 ID
     * @param arg2 - 通知类型或通知内容对象
     * @param arg3 - 目标用户列表
     */
    async sendServerNotice(
        arg1: string,
        arg2?: string | { msgtype: string; body: string; [k: string]: unknown },
        arg3?: string[],
    ): Promise<{ event_id?: string }> {
        if (typeof arg2 === "object" && arg2 !== null) {
            const body = {
                user_id: arg1,
                content: arg2,
            };
            return await this.adminRequest<{ event_id?: string }>(Method.Post, "/send_server_notice", {}, body);
        }
        const body: { content: string; type?: string; target_users?: string[] } = { content: arg1 };
        if (typeof arg2 === "string") {
            body.type = arg2;
        }
        if (arg3) {
            body.target_users = arg3;
        }
        return await this.adminRequest<{ event_id?: string }>(Method.Post, "/server_notices", {}, body);
    }

    /**
     * 删除服务器通知
     *
     * @param notificationId - 通知 ID
     */
    async deleteServerNotice(notificationId: string): Promise<void> {
        if (!notificationId) {
            throw new ValidationError("Notification ID is required");
        }
        await this.adminRequest(Method.Delete, `/server_notices/${encodeURIComponent(notificationId)}`);
    }

    /**
     * 获取服务器通知详情
     *
     * @param noticeId - 通知 ID
     * @returns 服务器通知详情
     */
    async getServerNotice(noticeId: string): Promise<ServerNotice> {
        if (!noticeId) throw new ValidationError("Notice ID is required");
        return await this.adminRequest(Method.Get, `/server_notices/${encodeURIComponent(noticeId)}`);
    }

    /**
     * 获取系统通知列表
     *
     * @param from - 分页起点
     * @param limit - 数量限制
     * @returns 系统通知分页结果
     */
    async listNotifications(from?: string, limit?: number): Promise<SystemNotificationPage> {
        const queryParams = buildPaginationParams(from, limit);
        const response = await this.adminRequest<SystemNotificationPage>(Method.Get, "/notifications", queryParams);
        return {
            notifications: response.notifications || [],
            next_token: response.next_token,
        };
    }

    /**
     * 创建系统通知
     *
     * @param payload - 通知内容
     * @returns 创建的通知信息
     */
    async createNotification(payload: DynamicConfig): Promise<SystemNotificationInfo> {
        return await this.adminRequest<SystemNotificationInfo>(Method.Post, "/notifications", {}, payload);
    }

    /**
     * 获取活跃的系统通知列表
     *
     * @returns 活跃的系统通知列表
     */
    async listActiveNotifications(): Promise<SystemNotificationInfo[]> {
        const response = await this.adminRequest<{ notifications?: SystemNotificationInfo[] }>(
            Method.Get,
            "/notifications/active",
        );
        return response.notifications || [];
    }

    /**
     * 获取系统通知详情
     *
     * @param notificationId - 通知 ID
     * @returns 通知详情
     */
    async getNotification(notificationId: string): Promise<SystemNotificationInfo> {
        if (!notificationId) throw new ValidationError("Notification ID is required");
        return await this.adminRequest<SystemNotificationInfo>(
            Method.Get,
            `/notifications/${encodeURIComponent(notificationId)}`,
        );
    }

    /**
     * 更新系统通知
     *
     * @param notificationId - 通知 ID
     * @param payload - 更新内容
     * @returns 更新后的通知信息
     */
    async updateNotification(notificationId: string, payload: DynamicConfig): Promise<SystemNotificationInfo> {
        if (!notificationId) throw new ValidationError("Notification ID is required");
        return await this.adminRequest<SystemNotificationInfo>(
            Method.Put,
            `/notifications/${encodeURIComponent(notificationId)}`,
            {},
            payload,
        );
    }

    /**
     * 停用系统通知
     *
     * @param notificationId - 通知 ID
     */
    async deactivateNotification(notificationId: string): Promise<void> {
        if (!notificationId) throw new ValidationError("Notification ID is required");
        await this.adminRequest(Method.Put, `/notifications/${encodeURIComponent(notificationId)}/deactivate`, {}, undefined);
    }

    /**
     * 删除系统通知
     *
     * @param notificationId - 通知 ID
     */
    async deleteNotification(notificationId: string): Promise<void> {
        if (!notificationId) throw new ValidationError("Notification ID is required");
        await this.adminRequest(Method.Delete, `/notifications/${encodeURIComponent(notificationId)}`, {}, undefined);
    }

    /**
     * 获取服务器配置
     *
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 服务器配置
     */
    async getServerConfig(throwOnError = true): Promise<AdminServerConfig> {
        try {
            return await this.adminRequest(Method.Get, "/config");
        } catch (e) {
            const err = e as MatrixError;
            if ((e instanceof NotFoundError) || (err instanceof MatrixError && err.httpStatus === 404)) {
                try {
                    return await this.adminRequest(Method.Get, "/server_config");
                } catch (fallbackErr) {
                    if (!throwOnError) return {} as AdminServerConfig;
                    throw fallbackErr;
                }
            }
            if (!throwOnError) return {} as AdminServerConfig;
            throw e;
        }
    }

    /**
     * 获取管理员信息
     *
     * @returns 管理员信息
     */
    async getAdminInfo(): Promise<AdminInfoResponse> {
        return await this.adminRequest(Method.Get, "/info");
    }

    /**
     * 获取服务器版本
     *
     * @param throwOnError - 是否抛出错误（默认 true）
     * @returns 服务器版本信息
     */
    async getServerVersion(throwOnError = true): Promise<{ server_version: string; python_version: string }> {
        try {
            return await this.adminRequest(Method.Get, "/server_version");
        } catch (e) {
            if (!throwOnError) return { server_version: "unknown", python_version: "unknown" };
            throw e;
        }
    }

    /**
     * 获取注册 nonce
     *
     * @returns nonce 字符串
     */
    async getRegisterNonce(): Promise<{ nonce: string }> {
        return await this.adminRequest(Method.Get, "/register/nonce");
    }

    /**
     * 注册管理员
     *
     * @param payload - 注册信息
     * @returns 注册结果
     */
    async registerAdmin(payload: AdminRegisterRequest): Promise<AdminRegisterResult> {
        return await this.adminRequest(Method.Post, "/register", {}, payload);
    }

    /**
     * 重启服务器
     *
     * @param payload - 重启选项
     * @returns 重启结果
     */
    async restartServer(payload?: RestartServerPayload): Promise<RestartServerResponse> {
        return await this.adminRequest(Method.Post, "/restart", {}, payload ?? {});
    }

    /**
     * 获取备份列表
     *
     * @param options - 查询选项
     * @param options.limit - 返回数量限制（1-500）
     * @param options.offset - 偏移量（>=0）
     * @returns 备份分页结果
     *
     * @throws {ValidationError} 如果 limit 或 offset 参数无效
     */
    async listBackups(options?: { limit?: number; offset?: number }): Promise<AdminBackupPage> {
        if (options?.limit !== undefined) {
            if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 500) {
                throw new ValidationError("limit must be an integer between 1 and 500");
            }
        }
        if (options?.offset !== undefined) {
            if (!Number.isInteger(options.offset) || options.offset < 0) {
                throw new ValidationError("offset must be a non-negative integer");
            }
        }
        const query: Record<string, string> = {};
        if (options?.limit !== undefined) query.limit = String(options.limit);
        if (options?.offset !== undefined) query.offset = String(options.offset);
        return await this.adminRequest(Method.Get, "/backups", query);
    }

    /**
     * 获取实验性功能列表
     *
     * @returns 实验性功能信息
     */
    async getExperimentalFeatures(): Promise<AdminExperimentalFeatures> {
        return await this.adminRequest(Method.Get, "/experimental_features");
    }

    /**
     * 清除房间
     *
     * @param payload - 清除选项
     * @returns 清除结果
     */
    async purgeRoom(payload: { room_id: string }): Promise<PurgeRoomResponse> {
        return await this.adminRequest(Method.Post, "/purge_room", {}, payload);
    }

    /**
     * 清除历史消息
     *
     * @param payload - 清除选项
     * @returns 清除结果
     */
    async purgeHistory(payload: PurgeHistoryRequest): Promise<AdminPurgeHistoryResult> {
        return await this.adminRequest(Method.Post, "/purge_history", {}, payload);
    }

    /**
     * 关闭房间
     *
     * @param payload - 关闭选项
     * @returns 关闭结果
     */
    async shutdownRoom(payload: ShutdownRoomRequest): Promise<AdminShutdownRoomResult> {
        return await this.adminRequest(Method.Post, "/shutdown_room", {}, payload);
    }

    /**
     * 清理所有数据
     *
     * @returns 清理结果
     */
    async cleanupAll(): Promise<AdminCleanupResponse> {
        return await this.adminRequest(Method.Post, "/cleanup/all", {}, undefined);
    }

    /**
     * 清理令牌
     *
     * @returns 清理结果
     */
    async cleanupTokens(): Promise<AdminCleanupResponse> {
        return await this.adminRequest(Method.Post, "/cleanup/tokens", {}, undefined);
    }

    /**
     * 清理房间
     *
     * @param payload - 清理选项
     * @returns 清理结果
     */
    async cleanupRooms(payload?: CleanupRoomsRequest): Promise<AdminCleanupResponse> {
        try {
            return await this.adminRequest(Method.Post, "/rooms/cleanup", {}, payload ?? {});
        } catch (e) {
            const err = e as MatrixError;
            if ((e instanceof NotFoundError) || (err instanceof MatrixError && err.httpStatus === 404)) {
                return await this.adminRequest(Method.Post, "/cleanup/rooms", {}, payload ?? {});
            }
            throw e;
        }
    }
}
