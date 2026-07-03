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
import { AdminValidators } from "../validators";
import { buildPaginationParams, buildQueryParams } from "../utils";
import type {
    RoomInfo,
    RoomStateEvent,
    RoomMessage,
    RoomStats,
    SpaceInfo,
    SpacePage,
    SpaceUser,
    SpaceRoom,
    PaginatedResponse,
    AdminAccountDetails,
    AdminRoomVersionResponse,
    AdminRoomBlockStatus,
    AdminEventContext,
    AdminForwardExtremity,
    AdminTokenSync,
    AdminRoomSearchResult,
    AdminRoomListings,
    AdminReport,
    AdminReportPage,
    AdminPurgeHistoryResult,
    RoomSearchPayload,
    RoomDeletePayload,
    PurgeHistoryPayload,
    AdminReasonPayload,
    AdminBanKickPayload,
    AdminMakeRoomAdminPayload,
    RoomEventSearchPayload,
    SpaceStats,
} from "../types";
import type { MatrixClient } from "../../client";

export enum AdminRoomEvent {
    RoomDeleted = "RoomDeleted",
    RoomBlocked = "RoomBlocked",
}

export interface AdminRoomEventMap {
    [AdminRoomEvent.RoomDeleted]: (roomId: string) => void;
    [AdminRoomEvent.RoomBlocked]: (roomId: string, blocked: boolean) => void;
}

export class AdminRoomManager extends AdminBaseManager<AdminRoomEvent, AdminRoomEventMap> {
    constructor(client: MatrixClient, onError?: AdminErrorCallback, opts?: ManagerOpts) {
        super(client, onError, opts);
    }

    /**
     * 获取房间列表（支持分页）
     *
    /**
     * 获取房间列表（统一分页格式）
     *
     * @param options - 查询选项
     * @param options.from - 分页起点 token
     * @param options.limit - 返回房间数量限制
     * @param options.search - 房间名称或别名搜索关键词
     * @param options.order_by - 排序字段 (e.g., "name", "joined_members")
     * @param options.sort_order - 排序顺序 ("asc" 或 "desc")
     * @returns 统一格式的分页响应
     */
    async getRoomsPaginated(options?: {
        from?: string;
        limit?: number;
        search?: string;
        order_by?: string;
        sort_order?: "asc" | "desc";
    }): Promise<PaginatedResponse<RoomInfo>> {
        if (options?.limit !== undefined) {
            AdminValidators.validateLimit(options.limit);
        }

        const queryParams = buildPaginationParams(options?.limit, options?.from);
        if (options?.search) {
            queryParams.search = options.search;
            queryParams.search_term = options.search;
        }
        if (options?.order_by) {
            queryParams.order_by = options.order_by;
        }
        if (options?.sort_order) {
            queryParams.sort_order = options.sort_order;
        }

        const response = await this.adminRequest<{
            rooms: RoomInfo[];
            next_token?: string;
            total?: number;
        }>(Method.Get, "/rooms", buildQueryParams(queryParams));

        return {
            items: response.rooms || [],
            nextToken: response.next_token,
            total: response.total,
        };
    }

    async searchRooms(options?: Record<string, string | number | boolean | undefined>): Promise<AdminRoomSearchResult> {
        const query: Record<string, string> = {};
        if (options) {
            for (const [k, v] of Object.entries(options)) {
                if (v !== undefined && v !== null) query[k] = String(v);
            }
        }
        return await this.adminRequest(Method.Get, "/rooms/search", query);
    }

    async searchRoomsPost(payload: RoomSearchPayload): Promise<AdminRoomSearchResult> {
        return await this.adminRequest(Method.Post, "/rooms/search", {}, payload);
    }

    /**
     * 获取房间详情
     *
     * @param roomId - 房间 ID
     * @returns 房间详情
     */
    async getRoom(roomId: string, throwOnError = true): Promise<RoomInfo | null> {
        AdminValidators.validateRoomId(roomId);
        try {
            return await this.adminRequest<RoomInfo>(Method.Get, `/rooms/${encodeURIComponent(roomId)}`);
            // @swallow-error { owner: "admin", expires: "2026-12-31" }
        } catch (e) {
            const err = e as MatrixError;
            if (
                !throwOnError &&
                (e instanceof NotFoundError || (err instanceof MatrixError && err.httpStatus === 404))
            ) {
                return null;
            }
            throw e;
        }
    }

    /**
     * 删除房间
     *
     * @param roomId - 房间 ID
     * @param block - 是否阻止未来的加入
     * @param purge - 是否从数据库中清除房间
     * @param reason - 删除原因
     */
    async deleteRoom(
        roomId: string,
        blockOrOptions: boolean | { block?: boolean; purge?: boolean; force_purge?: boolean; reason?: string } = false,
        purge = false,
        reason?: string,
    ): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        let body: { block?: boolean; purge?: boolean; force_purge?: boolean; reason?: string } | undefined;
        if (typeof blockOrOptions === "object") {
            body = { ...blockOrOptions };
        } else {
            body = { block: blockOrOptions, purge };
            if (reason) {
                body.reason = reason;
            }
        }
        await this.adminRequest(Method.Delete, `/rooms/${encodeURIComponent(roomId)}`, {}, body);
        this.emit(AdminRoomEvent.RoomDeleted, roomId);
    }

    async deleteRoomAdmin(roomId: string, payload?: RoomDeletePayload): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        await this.adminRequest(Method.Post, `/rooms/${encodeURIComponent(roomId)}/delete`, {}, payload ?? {});
    }

    async purgeRoomHistory(roomId: string, payload?: PurgeHistoryPayload): Promise<AdminPurgeHistoryResult> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest(
            Method.Post,
            `/rooms/${encodeURIComponent(roomId)}/purge_history`,
            {},
            payload ?? {},
        );
    }

    /**
     * 封锁/解封房间
     *
     * @param roomId - 房间 ID
     * @param block - 是否封锁房间
     * @param reason - 原因
     */
    async blockRoom(roomId: string, block: boolean, reason?: string): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        const body: { block: boolean; reason?: string } = { block };
        if (reason) {
            body.reason = reason;
        }
        await this.adminRequest(Method.Post, `/rooms/${encodeURIComponent(roomId)}/block`, undefined, body);
        this.emit(AdminRoomEvent.RoomBlocked, roomId, block);
    }

    async unblockRoom(roomId: string, payload?: AdminReasonPayload): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        await this.adminRequest(Method.Post, `/rooms/${encodeURIComponent(roomId)}/unblock`, {}, payload ?? {});
    }

    /**
     * 获取房间成员列表
     *
     * @param roomId - 房间 ID
     * @returns 房间成员列表
     */
    async getRoomMembers(roomId: string): Promise<AdminAccountDetails[]> {
        AdminValidators.validateRoomId(roomId);
        const response = await this.adminRequest<{ members: AdminAccountDetails[] }>(
            Method.Get,
            `/rooms/${encodeURIComponent(roomId)}/members`,
        );
        return response.members || [];
    }

    async addRoomMember(roomId: string, userId: string, payload?: AdminReasonPayload): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        AdminValidators.validateUserId(userId);
        await this.adminRequest(
            Method.Put,
            `/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(userId)}`,
            {},
            payload ?? {},
        );
    }

    async removeRoomMember(roomId: string, userId: string): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        AdminValidators.validateUserId(userId);
        await this.adminRequest(
            Method.Delete,
            `/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(userId)}`,
            {},
            undefined,
        );
    }

    async banRoomMember(roomId: string, userId: string, payload?: AdminReasonPayload): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        AdminValidators.validateUserId(userId);
        await this.adminRequest(
            Method.Post,
            `/rooms/${encodeURIComponent(roomId)}/ban/${encodeURIComponent(userId)}`,
            {},
            payload ?? {},
        );
    }

    async kickRoomMember(roomId: string, userId: string, payload?: AdminReasonPayload): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        AdminValidators.validateUserId(userId);
        await this.adminRequest(
            Method.Post,
            `/rooms/${encodeURIComponent(roomId)}/kick/${encodeURIComponent(userId)}`,
            {},
            payload ?? {},
        );
    }

    async unbanRoomMember(roomId: string, userId: string, payload?: AdminReasonPayload): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        AdminValidators.validateUserId(userId);
        await this.adminRequest(
            Method.Post,
            `/rooms/${encodeURIComponent(roomId)}/unban/${encodeURIComponent(userId)}`,
            {},
            payload ?? {},
        );
    }

    async banRoom(roomId: string, payload: AdminBanKickPayload): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        await this.adminRequest(Method.Post, `/rooms/${encodeURIComponent(roomId)}/ban`, {}, payload);
    }

    async kickRoom(roomId: string, payload: AdminBanKickPayload): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        await this.adminRequest(Method.Post, `/rooms/${encodeURIComponent(roomId)}/kick`, {}, payload);
    }

    async makeRoomAdmin(roomId: string, payload: AdminMakeRoomAdminPayload): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        try {
            await this.adminRequest(Method.Put, `/rooms/${encodeURIComponent(roomId)}/make_admin`, {}, payload);
        } catch (e) {
            const err = e as MatrixError;
            if (e instanceof NotFoundError || (err instanceof MatrixError && err.httpStatus === 404)) {
                await this.adminRequest(Method.Post, `/rooms/${encodeURIComponent(roomId)}/make_admin`, {}, payload);
                return;
            }
            throw e;
        }
    }

    /**
     * 获取房间状态事件
     *
     * @param roomId - 房间 ID
     * @returns 房间状态事件列表
     */
    async getRoomState(roomId: string): Promise<{ state: RoomStateEvent[] }> {
        AdminValidators.validateRoomId(roomId);
        const response = await this.adminRequest<{ state: RoomStateEvent[] }>(
            Method.Get,
            `/rooms/${encodeURIComponent(roomId)}/state`,
        );
        return { state: response.state || [] };
    }

    /**
     * 获取房间消息
     *
     * @param roomId - 房间 ID
     * @param from - 分页起点
     * @param limit - 数量限制
     * @returns 房间消息列表
     */
    async getRoomMessages(
        roomId: string,
        optionsOrFrom?: string | { from?: string; limit?: number; dir?: "b" | "f" | string },
        limit?: number,
    ): Promise<{ chunk: RoomMessage[]; start?: string; end?: string }> {
        AdminValidators.validateRoomId(roomId);
        const queryParams: Record<string, string> = {};
        if (typeof optionsOrFrom === "string") {
            Object.assign(queryParams, buildPaginationParams(limit, optionsOrFrom));
        } else if (optionsOrFrom) {
            Object.assign(queryParams, buildPaginationParams(optionsOrFrom.limit, optionsOrFrom.from));
            if (optionsOrFrom.dir !== undefined) {
                queryParams.dir = String(optionsOrFrom.dir);
            }
        }
        const response = await this.adminRequest<{
            chunk?: RoomMessage[];
            start?: string;
            end?: string;
            messages?: RoomMessage[];
        }>(Method.Get, `/rooms/${encodeURIComponent(roomId)}/messages`, queryParams);
        return {
            chunk: response.chunk || response.messages || [],
            start: response.start,
            end: response.end,
        };
    }

    /**
     * 删除房间消息
     *
     * @param roomId - 房间 ID
     * @param eventId - 事件 ID
     * @param reason - 删除原因
     */
    async deleteRoomMessage(roomId: string, eventId: string, reason?: string): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        if (!eventId) {
            throw new ValidationError("Event ID is required");
        }
        const body: { reason?: string } = {};
        if (reason) {
            body.reason = reason;
        }
        await this.adminRequest(
            Method.Delete,
            `/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(eventId)}`,
            undefined,
            body,
        );
    }

    async getRoomAliases(roomId: string): Promise<{ aliases: string[] }> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest(Method.Get, `/rooms/${encodeURIComponent(roomId)}/aliases`);
    }

    async getRoomVersion(roomId: string): Promise<AdminRoomVersionResponse> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest(Method.Get, `/rooms/${encodeURIComponent(roomId)}/version`);
    }

    async getRoomBlockStatus(roomId: string): Promise<AdminRoomBlockStatus> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest(Method.Get, `/rooms/${encodeURIComponent(roomId)}/block`);
    }

    async getRoomEventContext(roomId: string, eventId: string): Promise<AdminEventContext> {
        AdminValidators.validateRoomId(roomId);
        if (!eventId) throw new ValidationError("Event ID is required");
        return await this.adminRequest(
            Method.Get,
            `/rooms/${encodeURIComponent(roomId)}/event_context/${encodeURIComponent(eventId)}`,
        );
    }

    async getRoomForwardExtremities(roomId: string): Promise<AdminForwardExtremity[]> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest(Method.Get, `/rooms/${encodeURIComponent(roomId)}/forward_extremities`);
    }

    async getRoomTokenSync(roomId: string): Promise<AdminTokenSync> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest(Method.Get, `/rooms/${encodeURIComponent(roomId)}/token_sync`);
    }

    async searchRoomEvents(roomId: string, payload: RoomEventSearchPayload): Promise<AdminRoomSearchResult> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest(Method.Post, `/rooms/${encodeURIComponent(roomId)}/search`, {}, payload);
    }

    async getRoomListings(roomId: string): Promise<AdminRoomListings> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest(Method.Get, `/rooms/${encodeURIComponent(roomId)}/listings`);
    }

    async setRoomPublicListing(roomId: string): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        await this.adminRequest(Method.Put, `/rooms/${encodeURIComponent(roomId)}/listings/public`, {}, undefined);
    }

    async deleteRoomPublicListing(roomId: string): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        await this.adminRequest(Method.Delete, `/rooms/${encodeURIComponent(roomId)}/listings/public`, {}, undefined);
    }

    /**
     * 获取房间统计信息
     *
     * @param from - 分页起点
     * @param limit - 数量限制
     * @returns 房间统计信息列表
     */
    async getRoomStats(from?: string, limit?: number): Promise<RoomStats[]> {
        const queryParams = buildPaginationParams(limit, from);
        const response = await this.adminRequest<{ rooms: RoomStats[] }>(Method.Get, "/room_stats", queryParams);
        return response.rooms || [];
    }

    async getRoomStatsByRoom(roomId: string): Promise<RoomStats> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest<RoomStats>(Method.Get, `/room_stats/${encodeURIComponent(roomId)}`);
    }

    async joinRoom(roomId: string, userId: string): Promise<void> {
        await this.adminRequest(Method.Post, `/rooms/${encodeURIComponent(roomId)}/join`, {}, { user_id: userId });
    }

    async listReports(options?: { from?: string; limit?: number }): Promise<AdminReportPage> {
        const query = buildPaginationParams(options?.limit, options?.from);
        return await this.adminRequest(Method.Get, "/reports", query);
    }

    async getReport(reportId: string): Promise<AdminReport> {
        if (!reportId) throw new ValidationError("Report ID is required");
        return await this.adminRequest(Method.Get, `/reports/${encodeURIComponent(reportId)}`);
    }

    async deleteReport(reportId: string): Promise<void> {
        if (!reportId) throw new ValidationError("Report ID is required");
        await this.adminRequest(Method.Delete, `/reports/${encodeURIComponent(reportId)}`);
    }

    async listRoomReports(roomId: string, options?: { from?: string; limit?: number }): Promise<AdminReportPage> {
        AdminValidators.validateRoomId(roomId);
        const query = buildPaginationParams(options?.limit, options?.from);
        return await this.adminRequest(Method.Get, `/rooms/${encodeURIComponent(roomId)}/reports`, query);
    }

    async getRoomReport(roomId: string, reportId: string): Promise<AdminReport> {
        AdminValidators.validateRoomId(roomId);
        if (!reportId) throw new ValidationError("Report ID is required");
        return await this.adminRequest(
            Method.Get,
            `/rooms/${encodeURIComponent(roomId)}/reports/${encodeURIComponent(reportId)}`,
        );
    }

    async getSpace(spaceId: string): Promise<SpaceInfo> {
        AdminValidators.validateRoomId(spaceId);
        return await this.adminRequest(Method.Get, `/spaces/${encodeURIComponent(spaceId)}`);
    }

    async listSpaces(from?: string, limit?: number): Promise<SpacePage> {
        const query = buildPaginationParams(limit, from);
        return await this.adminRequest(Method.Get, "/spaces", query);
    }

    async deleteSpace(spaceId: string): Promise<void> {
        AdminValidators.validateRoomId(spaceId);
        await this.adminRequest(Method.Delete, `/spaces/${encodeURIComponent(spaceId)}`);
    }

    async getSpaceRooms(
        spaceId: string,
        from?: string,
        limit?: number,
    ): Promise<{ rooms: SpaceRoom[]; next_batch?: string }> {
        AdminValidators.validateRoomId(spaceId);
        const query = buildPaginationParams(limit, from);
        return await this.adminRequest(Method.Get, `/spaces/${encodeURIComponent(spaceId)}/rooms`, query);
    }

    async getSpaceStats(spaceId: string): Promise<SpaceStats> {
        AdminValidators.validateRoomId(spaceId);
        return await this.adminRequest(Method.Get, `/spaces/${encodeURIComponent(spaceId)}/stats`);
    }

    async getSpaceUsers(
        spaceId: string,
        from?: string,
        limit?: number,
    ): Promise<{ users: SpaceUser[]; next_batch?: string }> {
        AdminValidators.validateRoomId(spaceId);
        const query = buildPaginationParams(limit, from);
        return await this.adminRequest(Method.Get, `/spaces/${encodeURIComponent(spaceId)}/users`, query);
    }
}
