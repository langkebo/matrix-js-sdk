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
import { ClientPrefix } from "../../http-api/prefix";
import { NotFoundError, ValidationError } from "../../errors";
import { AdminBaseManager, type AdminErrorCallback, type ManagerOpts } from "../admin-base-manager";
import { AdminValidators } from "../validators";
import { buildPaginationParams, buildQueryParams } from "../utils";
import { toPaginatedResult } from "../../common/pagination";
import type {
    RoomInfo,
    RoomStateEvent,
    RoomMessage,
    RoomMessagePage,
    RoomStats,
    RoomStatsOverview,
    AdminRoomMember,
    AdminRoomMemberPage,
    SpaceInfo,
    SpacePage,
    SpaceRoomsResponse,
    SpaceUsersResponse,
    PaginatedResponse,
    AdminRoomVersionResponse,
    AdminRoomBlockStatus,
    AdminEventContext,
    AdminRoomForwardExtremities,
    AdminTokenSync,
    AdminRoomEventSearchPage,
    AdminRoomSearchPage,
    AdminRoomListings,
    AdminRoomRedactPayload,
    AdminRoomRedactResult,
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

        return toPaginatedResult<RoomInfo>(response as unknown as Record<string, unknown>, "rooms");
    }

    async searchRooms(options?: Record<string, string | number | boolean | undefined>): Promise<AdminRoomSearchPage> {
        const query: Record<string, string> = {};
        if (options) {
            for (const [k, v] of Object.entries(options)) {
                if (v !== undefined && v !== null) query[k] = String(v);
            }
        }
        return await this.adminRequest(Method.Get, "/rooms/search", query);
    }

    async searchRoomsPost(payload: RoomSearchPayload): Promise<AdminRoomSearchPage> {
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
     * @param blockOrOptions.block - 是否阻止未来的加入
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
     * 获取房间成员
     *
     * 对应 `GET /_synapse/admin/v1/rooms/{room_id}/members`。后端返回
     * `{members: [{user_id, displayname, avatar_url, membership}], total, next_batch}`。
     *
     * ⚠️ 此前声明/返回的是 `AdminAccountDetails[]`（账号对象的字段集），与真实成员条目完全不同；
     * 且 `total` / `next_batch` 被静默丢弃。
     *
     * @param roomId - 房间 ID
     * @param options - 可选分页参数
     * @example
     * ```typescript
     * const page = await adminManager.getRoomMembers("!room:example.org", { limit: 100 });
     * console.log(`${page.members.length}/${page.total}`, page.next_batch);
     * ```
     */
    async getRoomMembers(roomId: string, options?: { from?: string; limit?: number }): Promise<AdminRoomMemberPage> {
        AdminValidators.validateRoomId(roomId);
        const queryParams = buildPaginationParams(options?.limit, options?.from);
        const response = await this.adminRequest<{
            members?: AdminRoomMember[];
            total?: number;
            next_batch?: string | null;
        }>(Method.Get, `/rooms/${encodeURIComponent(roomId)}/members`, queryParams);
        const members = response.members ?? [];
        return { members, total: response.total ?? members.length, next_batch: response.next_batch ?? null };
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
     * 后端返回 `{chunk, start, end, next_batch}`；此前实现丢弃了 `next_batch`
     * （`null` 表示末页）。
     *
     * @param roomId - 房间 ID
     * @param optionsOrFrom.from - 分页起点（后端按 `from` 数字解析，解析失败即视为首页）
     * @param limit - 数量限制
     * @returns 消息列表 + 三个游标字段
     * @example
     * ```typescript
     * const page = await adminManager.getRoomMessages("!room:example.org", { limit: 50, dir: "b" });
     * console.log(page.chunk.length, page.next_batch);
     * ```
     */
    async getRoomMessages(
        roomId: string,
        optionsOrFrom?: string | { from?: string; limit?: number; dir?: "b" | "f" | string },
        limit?: number,
    ): Promise<RoomMessagePage> {
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
            next_batch?: string | null;
            messages?: RoomMessage[];
        }>(Method.Get, `/rooms/${encodeURIComponent(roomId)}/messages`, queryParams);
        return {
            chunk: response.chunk ?? response.messages ?? [],
            start: response.start ?? "0",
            end: response.end ?? "",
            next_batch: response.next_batch ?? null,
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

    /**
     * 批量撤回房间内的事件（管理端，按时间范围过滤）。
     *
     * 对应后端 `POST /_matrix/client/v3/admin/room/{room_id}/redact`（模块 `admin::room`），
     * 语义与 Element Synapse 的同名管理端点一致：撤回 `origin_server_ts` 落在
     * `(after_ts, before_ts)` 区间内的事件，单次上限 `limit` 条。
     *
     * 与 {@link deleteRoomMessage} 的分工：后者按单个 `event_id` 精确删除，
     * 本方法按时间范围批量撤回。
     *
     * 注意：该端点的前缀是 **C-S v3** 命名空间下的 `admin/` 子路径，
     * 不是 `/_synapse/admin/v1`，所以必须显式传 `prefix`，不能走 `this.adminRequest`
     * （它把前缀写死为 `AdminPrefix.V1`）。
     *
     * @param roomId - 房间 ID
     * @param payload - 时间范围 / 条数 / 原因过滤条件，全部可选
     * @returns 实际被撤回的事件条数
     * @example
     * ```typescript
     * const { redacted } = await client
     *     .getAdminManager()
     *     .rooms.redactRoomEvents("!room:example.org", { before_ts: Date.now(), limit: 500 });
     * ```
     */
    async redactRoomEvents(roomId: string, payload: AdminRoomRedactPayload = {}): Promise<AdminRoomRedactResult> {
        AdminValidators.validateRoomId(roomId);
        // 后端同样校验 1..10000 并返回 400；在客户端先拦一道，错误信息更直白，
        // 也避免把明显非法的批次打到服务端。
        if (
            payload.limit !== undefined &&
            (!Number.isInteger(payload.limit) || payload.limit < 1 || payload.limit > 10_000)
        ) {
            throw new ValidationError("limit must be an integer between 1 and 10000");
        }
        return await this.request<AdminRoomRedactResult>({
            method: Method.Post,
            path: `/admin/room/${encodeURIComponent(roomId)}/redact`,
            prefix: ClientPrefix.V3,
            body: payload,
            label: "redactRoomEvents",
        });
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

    /**
     * 获取房间的前向极点数
     *
     * ⚠️ 对应 `GET /_synapse/admin/v1/rooms/{room_id}/forward_extremities`，
     * 后端返回 `{room_id, forward_extremities: <整数>}` —— **不是极点的对象数组**。
     * 原先声明成 `AdminForwardExtremity[]` 与真实响应毫无关系。
     * @example
     * ```typescript
     * const { forward_extremities } = await adminManager.getRoomForwardExtremities("!room:example.org");
     * console.log(`前向极点数: ${forward_extremities}`);
     * ```
     */
    async getRoomForwardExtremities(roomId: string): Promise<AdminRoomForwardExtremities> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest(Method.Get, `/rooms/${encodeURIComponent(roomId)}/forward_extremities`);
    }

    async getRoomTokenSync(roomId: string): Promise<AdminTokenSync> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest(Method.Get, `/rooms/${encodeURIComponent(roomId)}/token_sync`);
    }

    async searchRoomEvents(roomId: string, payload: RoomEventSearchPayload): Promise<AdminRoomEventSearchPage> {
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
     * 获取房间统计**总览**
     *
     * ⚠️ 对应 `GET /_synapse/admin/v1/room_stats`，后端返回的是**单个概览对象**
     * `{total_rooms, encrypted_rooms, public_rooms, total_messages, total_members,
     * active_rooms, average_messages_per_room}` —— **不是房间数组**，
     * 而且该端点**不读 `from` / `limit`**（参数仅为与旧签名兼容而保留）。
     * 原先实现按 `response.rooms` 取值，运行时恒得到空数组。
     *
     * @param from - 已废弃：后端不读该参数
     * @param limit - 已废弃：后端不读该参数
     * @returns 全局房间统计概览
     * @example
     * ```typescript
     * const overview = await adminManager.getRoomStats();
     * console.log(`房间总数 ${overview.total_rooms}，其中公开 ${overview.public_rooms}`);
     * ```
     */
    async getRoomStats(from?: string, limit?: number): Promise<RoomStatsOverview> {
        const queryParams = buildPaginationParams(limit, from);
        return await this.adminRequest<RoomStatsOverview>(Method.Get, "/room_stats", queryParams);
    }

    /** 获取单个房间的统计信息（`GET /room_stats/{room_id}`） */
    async getRoomStatsByRoom(roomId: string): Promise<RoomStats> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest<RoomStats>(Method.Get, `/room_stats/${encodeURIComponent(roomId)}`);
    }

    /**
     * 强制把用户加入房间
     *
     * ⚠️ 该路径（`POST /rooms/{room_id}/join`）在后端**不存在**，调用必得 404；
     * 对应的真实端点是 `PUT /rooms/{room_id}/members/{user_id}`
     * （见 {@link addRoomMember}）。此差异已登记在
     * `scripts/quality/path-contract-waivers.json`（`semantic-mismatch`），
     * 保留方法是为了不破坏既有调用方的编译，**新代码请用 `addRoomMember`**。
     * @example
     * ```typescript
     * // 注意：该路径后端未注册（见方法注释），请优先使用 addRoomMember
     * await adminManager.addRoomMember("!room:example.org", "@alice:example.org");
     * ```
     */
    async joinRoom(roomId: string, userId: string): Promise<void> {
        await this.adminRequest(Method.Post, `/rooms/${encodeURIComponent(roomId)}/join`, {}, { user_id: userId });
    }

    /**
     * 列出事件举报
     *
     * 后端返回 `{reports, total}`；翻页游标是**请求侧**的 `since_ts` / `since_id`，
     * 响应里没有 `next_token`。⚠️ 本方法传的 `from` 后端**不读**（静默忽略）。
     * @example
     * ```typescript
     * const page = await adminManager.listReports({ limit: 50 });
     * console.log(`共 ${page.total} 条举报`);
     * ```
     */
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

    /**
     * 列出全部 Space
     *
     * 后端返回 `{spaces, total}` —— **没有分页游标**，`from` / `limit` 后端不读。
     * @example
     * ```typescript
     * const page = await adminManager.listSpaces();
     * console.log(page.spaces.map((s) => s.space_id));
     * ```
     */
    async listSpaces(from?: string, limit?: number): Promise<SpacePage> {
        const query = buildPaginationParams(limit, from);
        return await this.adminRequest(Method.Get, "/spaces", query);
    }

    async deleteSpace(spaceId: string): Promise<void> {
        AdminValidators.validateRoomId(spaceId);
        await this.adminRequest(Method.Delete, `/spaces/${encodeURIComponent(spaceId)}`);
    }

    /**
     * 列出 Space 的子房间
     *
     * ⚠️ 后端返回 `{rooms: string[], total}` —— `rooms` 是 **room id 字符串数组**，
     * 不是对象数组；也没有分页游标。
     * @example
     * ```typescript
     * const { rooms, total } = await adminManager.getSpaceRooms("!space:example.org");
     * console.log(total, rooms);
     * ```
     */
    async getSpaceRooms(spaceId: string, from?: string, limit?: number): Promise<SpaceRoomsResponse> {
        AdminValidators.validateRoomId(spaceId);
        const query = buildPaginationParams(limit, from);
        return await this.adminRequest(Method.Get, `/spaces/${encodeURIComponent(spaceId)}/rooms`, query);
    }

    async getSpaceStats(spaceId: string): Promise<SpaceStats> {
        AdminValidators.validateRoomId(spaceId);
        return await this.adminRequest(Method.Get, `/spaces/${encodeURIComponent(spaceId)}/stats`);
    }

    /**
     * 列出 Space 的成员
     *
     * ⚠️ 后端返回 `{users: string[], total}` —— `users` 是 **user id 字符串数组**，
     * 不是对象数组；也没有分页游标。
     * @example
     * ```typescript
     * const { users, total } = await adminManager.getSpaceUsers("!space:example.org");
     * console.log(total, users);
     * ```
     */
    async getSpaceUsers(spaceId: string, from?: string, limit?: number): Promise<SpaceUsersResponse> {
        AdminValidators.validateRoomId(spaceId);
        const query = buildPaginationParams(limit, from);
        return await this.adminRequest(Method.Get, `/spaces/${encodeURIComponent(spaceId)}/users`, query);
    }
}
