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
import { AdminBaseManager, apu, type AdminErrorCallback, type ManagerOpts } from "../admin-base-manager";
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
    RoomBackfillResponse,
    CascadeRedactResponse,
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
     * @example
     * ```typescript
     * const page = await client.getAdminManager().rooms.getRoomsPaginated({ limit: 50, search: "test" });
     * console.log(page.items.length, page.next);
     * ```
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
        }>(Method.Get, apu("/rooms"), buildQueryParams(queryParams));

        return toPaginatedResult<RoomInfo>(response as unknown as Record<string, unknown>, "rooms");
    }

    /**
     * 全库搜索房间（GET 变体）。
     *
     * 对应 `GET /_synapse/admin/v1/rooms/search`，后端返回
     * `{results, count, total, limit, next_batch}`。
     *
     * @param options - 查询参数（如 `search_term`、`limit`、`order_by`）
     * @returns 房间搜索结果分页
     * @example
     * ```typescript
     * const page = await client.getAdminManager().rooms.searchRooms({ search_term: "general", limit: 20 });
     * console.log(page.results.length, page.total);
     * ```
     */
    async searchRooms(options?: Record<string, string | number | boolean | undefined>): Promise<AdminRoomSearchPage> {
        const query: Record<string, string> = {};
        if (options) {
            for (const [k, v] of Object.entries(options)) {
                if (v !== undefined && v !== null) query[k] = String(v);
            }
        }
        return await this.adminRequest(Method.Get, apu("/rooms/search"), query);
    }

    /**
     * 全库搜索房间（POST 变体）。
     *
     * 对应 `POST /_synapse/admin/v1/rooms/search`，请求体字段见 {@link RoomSearchPayload}。
     *
     * @param payload - 搜索条件
     * @returns 房间搜索结果分页
     * @example
     * ```typescript
     * const page = await client.getAdminManager().rooms.searchRoomsPost({ search_term: "general", limit: 20 });
     * console.log(page.results.length, page.total);
     * ```
     */
    async searchRoomsPost(payload: RoomSearchPayload): Promise<AdminRoomSearchPage> {
        return await this.adminRequest(Method.Post, apu("/rooms/search"), {}, payload);
    }

    /**
     * 获取房间详情
     *
     * @param roomId - 房间 ID
     * @param throwOnError - 为 `false` 时，房间不存在（404）返回 `null` 而不抛错
     * @returns 房间详情；`throwOnError` 为 `false` 且房间不存在时为 `null`
     * @throws {Error} 房间不存在且 `throwOnError` 为 `true`，或请求失败时
     * @example
     * ```typescript
     * const room = await client.getAdminManager().rooms.getRoom("!room:example.org");
     * console.log(room?.name, room?.member_count);
     * ```
     */
    async getRoom(roomId: string, throwOnError = true): Promise<RoomInfo | null> {
        AdminValidators.validateRoomId(roomId);
        try {
            return await this.adminRequest<RoomInfo>(Method.Get, apu(`/rooms/${encodeURIComponent(roomId)}`));
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
     * 删除房间（`DELETE /_synapse/admin/v1/rooms/{room_id}`）。
     *
     * ⚠️ 2026-10-08 对照后端 `admin/room/mod.rs::delete_room`：该处理器**只收 `Path(room_id)`，
     * 连 `Json` 提取器都没有** ⇒ 这里传的整个 body（`block` / `purge` / `force_purge` / `reason`）
     * 会被**静默丢弃**，`purge: true` **不会**清除历史。要真 purge 请另外调
     * {@link purgeRoomHistory}（`POST /rooms/{room_id}/purge_history`）。
     *
     * 注：`POST /_synapse/admin/v1/rooms/{room_id}/delete` 与 `DELETE` 是同**一个**处理器，
     * 所以 {@link deleteRoomAdmin} 的 body 同样无效。参数保留是为了不破坏公开 API
     * （删参数属产品决策，已登记在 `admin-response-contract-ledger.json` 的 deviations）。
     *
     * @param roomId - 房间 ID
     * @param blockOrOptions.block - 后端忽略
     * @param purge - 后端忽略（不会 purge）
     * @param reason - 后端忽略
     * @example
     * ```typescript
     * await adminManager.deleteRoom("!spam:example.com");
     * // 需要真正清除历史时：
     * await adminManager.purgeRoomHistory("!spam:example.com", { purge_up_to_ts: Date.now() });
     * ```
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
        await this.adminRequest(Method.Delete, apu(`/rooms/${encodeURIComponent(roomId)}`), {}, body);
        this.emit(AdminRoomEvent.RoomDeleted, roomId);
    }

    /**
     * 删除房间（`payload` 被后端忽略）。
     *
     * ⚠️ 2026-10-09 修正：此前打 `POST /_synapse/admin/v1/rooms/{room_id}/delete`
     * （自称 "v1 兼容端点"），但后端 ledger 里**从来没有**这个路径 ⇒ 每次调用必然 404。
     * 后端注册的是 RESTful 的 `DELETE /_synapse/admin/v1/rooms/{room_id}`（与
     * {@link deleteRoom} 同一个处理器 `delete_room`，无 `Json` 提取器）
     * ⇒ `payload` 里的 `purge` / `force_purge` / `block` / `reason` 一律被忽略。
     *
     * @param roomId - 房间 ID
     * @param payload - 后端忽略（仅为不破坏公开 API 而保留）
     * @example
     * ```typescript
     * await client.getAdminManager().rooms.deleteRoomAdmin("!room:example.org", { purge: true });
     * ```
     */
    async deleteRoomAdmin(roomId: string, payload?: RoomDeletePayload): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        await this.adminRequest(Method.Delete, apu(`/rooms/${encodeURIComponent(roomId)}`), {}, payload ?? {});
    }

    /**
     * 清除房间历史事件。
     *
     * 对应 `POST /_synapse/admin/v1/rooms/{room_id}/purge_history`，后端返回
     * `{success, deleted_events, dry_run}`。
     *
     * @param roomId - 房间 ID
     * @param payload - 清除范围（`purge_up_to_ts`）与 `dry_run` 开关，可选
     * @returns 清除结果（含删除事件数与是否 dry-run）
     * @example
     * ```typescript
     * const result = await client.getAdminManager().rooms.purgeRoomHistory("!room:example.org", { purge_up_to_ts: Date.now() });
     * console.log(result.deleted_events, result.dry_run);
     * ```
     */
    async purgeRoomHistory(roomId: string, payload?: PurgeHistoryPayload): Promise<AdminPurgeHistoryResult> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest(
            Method.Post,
            apu(`/rooms/${encodeURIComponent(roomId)}/purge_history`),
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
     * @example
     * ```typescript
     * await client.getAdminManager().rooms.blockRoom("!room:example.org", true, "spam");
     * ```
     */
    async blockRoom(roomId: string, block: boolean, reason?: string): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        const body: { block: boolean; reason?: string } = { block };
        if (reason) {
            body.reason = reason;
        }
        await this.adminRequest(Method.Post, apu(`/rooms/${encodeURIComponent(roomId)}/block`), undefined, body);
        this.emit(AdminRoomEvent.RoomBlocked, roomId, block);
    }

    /**
     * 解封房间。
     *
     * 对应 `POST /_synapse/admin/v1/rooms/{room_id}/unblock`。
     *
     * @param roomId - 房间 ID
     * @param payload - 解封原因，可选
     * @example
     * ```typescript
     * await client.getAdminManager().rooms.unblockRoom("!room:example.org", { reason: "误封已复核" });
     * ```
     */
    async unblockRoom(roomId: string, payload?: AdminReasonPayload): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        await this.adminRequest(Method.Post, apu(`/rooms/${encodeURIComponent(roomId)}/unblock`), {}, payload ?? {});
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
        }>(Method.Get, apu(`/rooms/${encodeURIComponent(roomId)}/members`), queryParams);
        const members = response.members ?? [];
        return { members, total: response.total ?? members.length, next_batch: response.next_batch ?? null };
    }

    /**
     * 强制把用户加入房间。
     *
     * 对应 `PUT /_synapse/admin/v1/rooms/{room_id}/members/{user_id}`。
     *
     * @param roomId - 房间 ID
     * @param userId - 用户 ID
     * @param payload - 加入原因，可选
     * @example
     * ```typescript
     * await client.getAdminManager().rooms.addRoomMember("!room:example.org", "@alice:example.org");
     * ```
     */
    async addRoomMember(roomId: string, userId: string, payload?: AdminReasonPayload): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        AdminValidators.validateUserId(userId);
        await this.adminRequest(
            Method.Put,
            apu(`/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(userId)}`),
            {},
            payload ?? {},
        );
    }

    /**
     * 把用户移出房间。
     *
     * 对应 `DELETE /_synapse/admin/v1/rooms/{room_id}/members/{user_id}`。
     *
     * @param roomId - 房间 ID
     * @param userId - 用户 ID
     * @example
     * ```typescript
     * await client.getAdminManager().rooms.removeRoomMember("!room:example.org", "@alice:example.org");
     * ```
     */
    async removeRoomMember(roomId: string, userId: string): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        AdminValidators.validateUserId(userId);
        await this.adminRequest(
            Method.Delete,
            apu(`/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(userId)}`),
            {},
            undefined,
        );
    }

    /**
     * 禁止成员进入房间。
     *
     * 对应 `POST /_synapse/admin/v1/rooms/{room_id}/ban/{user_id}`。
     *
     * @param roomId - 房间 ID
     * @param userId - 用户 ID
     * @param payload - 封禁原因，可选
     * @example
     * ```typescript
     * await client.getAdminManager().rooms.banRoomMember("!room:example.org", "@spammer:example.org", { reason: "spam" });
     * ```
     */
    async banRoomMember(roomId: string, userId: string, payload?: AdminReasonPayload): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        AdminValidators.validateUserId(userId);
        await this.adminRequest(
            Method.Post,
            apu(`/rooms/${encodeURIComponent(roomId)}/ban/${encodeURIComponent(userId)}`),
            {},
            payload ?? {},
        );
    }

    /**
     * 将成员踢出房间。
     *
     * 对应 `POST /_synapse/admin/v1/rooms/{room_id}/kick/{user_id}`。
     *
     * @param roomId - 房间 ID
     * @param userId - 用户 ID
     * @param payload - 踢出原因，可选
     * @example
     * ```typescript
     * await client.getAdminManager().rooms.kickRoomMember("!room:example.org", "@alice:example.org", { reason: "flooding" });
     * ```
     */
    async kickRoomMember(roomId: string, userId: string, payload?: AdminReasonPayload): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        AdminValidators.validateUserId(userId);
        await this.adminRequest(
            Method.Post,
            apu(`/rooms/${encodeURIComponent(roomId)}/kick/${encodeURIComponent(userId)}`),
            {},
            payload ?? {},
        );
    }

    /**
     * 解除对成员的封禁。
     *
     * 对应 `POST /_synapse/admin/v1/rooms/{room_id}/unban/{user_id}`。
     *
     * @param roomId - 房间 ID
     * @param userId - 用户 ID
     * @param payload - 解封原因，可选
     * @example
     * ```typescript
     * await client.getAdminManager().rooms.unbanRoomMember("!room:example.org", "@alice:example.org");
     * ```
     */
    async unbanRoomMember(roomId: string, userId: string, payload?: AdminReasonPayload): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        AdminValidators.validateUserId(userId);
        await this.adminRequest(
            Method.Post,
            apu(`/rooms/${encodeURIComponent(roomId)}/unban/${encodeURIComponent(userId)}`),
            {},
            payload ?? {},
        );
    }

    /**
     * 在房间内封禁用户。
     *
     * 对应 `POST /_synapse/admin/v1/rooms/{room_id}/ban`，`user_id` 必填
     * （见 {@link AdminBanKickPayload}）。
     *
     * @param roomId - 房间 ID
     * @param payload - 目标用户与原因
     * @example
     * ```typescript
     * await client.getAdminManager().rooms.banRoom("!room:example.org", { user_id: "@spammer:example.org", reason: "spam" });
     * ```
     */
    async banRoom(roomId: string, payload: AdminBanKickPayload): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        await this.adminRequest(Method.Post, apu(`/rooms/${encodeURIComponent(roomId)}/ban`), {}, payload);
    }

    /**
     * 在房间内踢出用户。
     *
     * 对应 `POST /_synapse/admin/v1/rooms/{room_id}/kick`，`user_id` 必填
     * （见 {@link AdminBanKickPayload}）。
     *
     * @param roomId - 房间 ID
     * @param payload - 目标用户与原因
     * @example
     * ```typescript
     * await client.getAdminManager().rooms.kickRoom("!room:example.org", { user_id: "@alice:example.org", reason: "flooding" });
     * ```
     */
    async kickRoom(roomId: string, payload: AdminBanKickPayload): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        await this.adminRequest(Method.Post, apu(`/rooms/${encodeURIComponent(roomId)}/kick`), {}, payload);
    }

    /**
     * 将用户提升为房间管理员。
     *
     * 对应 `PUT /_synapse/admin/v1/rooms/{room_id}/make_admin`；若后端返回 404，
     * 则回退到 `POST` 变体。
     *
     * @param roomId - 房间 ID
     * @param payload - 目标用户（`user_id` 必填，见 {@link AdminMakeRoomAdminPayload}）
     * @throws {Error} `PUT` 失败且不属于可回退的 404 时，向上抛出原错误
     * @example
     * ```typescript
     * await client.getAdminManager().rooms.makeRoomAdmin("!room:example.org", { user_id: "@alice:example.org" });
     * ```
     */
    async makeRoomAdmin(roomId: string, payload: AdminMakeRoomAdminPayload): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        try {
            await this.adminRequest(Method.Put, apu(`/rooms/${encodeURIComponent(roomId)}/make_admin`), {}, payload);
        } catch (e) {
            const err = e as MatrixError;
            if (e instanceof NotFoundError || (err instanceof MatrixError && err.httpStatus === 404)) {
                await this.adminRequest(
                    Method.Post,
                    apu(`/rooms/${encodeURIComponent(roomId)}/make_admin`),
                    {},
                    payload,
                );
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
     * @example
     * ```typescript
     * const { state } = await client.getAdminManager().rooms.getRoomState("!room:example.org");
     * console.log(state.length);
     * ```
     */
    async getRoomState(roomId: string): Promise<{ state: RoomStateEvent[] }> {
        AdminValidators.validateRoomId(roomId);
        const response = await this.adminRequest<{ state: RoomStateEvent[] }>(
            Method.Get,
            apu(`/rooms/${encodeURIComponent(roomId)}/state`),
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
        }>(Method.Get, apu(`/rooms/${encodeURIComponent(roomId)}/messages`), queryParams);
        return {
            chunk: response.chunk ?? response.messages ?? [],
            start: response.start ?? "0",
            end: response.end ?? "",
            next_batch: response.next_batch ?? null,
        };
    }

    /**
     * 批量撤回房间内的事件（管理端，按时间范围过滤）。
     *
     * 对应后端 `POST /_matrix/client/v3/admin/room/{room_id}/redact`（模块 `admin::room`），
     * 语义与 Element Synapse 的同名管理端点一致：撤回 `origin_server_ts` 落在
     * `(after_ts, before_ts)` 区间内的事件，单次上限 `limit` 条。
     *
     * （注：原 `deleteRoomMessage` 已于 2026-10-15 删除——后端无 `DELETE …/rooms/{room_id}/messages/{event_id}`
     * 端点，该方法恒 404。且**后端已确认不计划新增该端点**（上游 Synapse 亦无）：Matrix 语义下撤下消息内容的
     * 正确做法是 **redact**（保留事件与因果链），故这不是待补的缺口。
     * 需要按单条根事件连带撤回其后代请用 `cascadeRedactEvent`；按时间范围批量撤回用本方法。）
     * 本方法按时间范围批量撤回。
     *
     * 注意：该端点的前缀是 **C-S v3** 命名空间下的 `admin/` 子路径，
     * 不是 `/_synapse/admin/v1`，所以必须显式传 `prefix`，不能走 `this.adminRequest`
     * （它把前缀写死为 `AdminPrefix.V1`）。
     *
     * @param roomId - 房间 ID
     * @param payload - 时间范围 / 条数 / 原因过滤条件，全部可选
     * @returns 实际被撤回的事件条数
     * @throws {ValidationError} `limit` 不是 1..10000 的整数时
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

    /**
     * 获取房间的全部别名。
     *
     * 对应 `GET /_synapse/admin/v1/rooms/{room_id}/aliases`。
     *
     * @param roomId - 房间 ID
     * @returns 房间别名列表
     * @example
     * ```typescript
     * const { aliases } = await client.getAdminManager().rooms.getRoomAliases("!room:example.org");
     * console.log(aliases);
     * ```
     */
    async getRoomAliases(roomId: string): Promise<{ aliases: string[] }> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest(Method.Get, apu(`/rooms/${encodeURIComponent(roomId)}/aliases`));
    }

    /**
     * 获取房间版本。
     *
     * 对应 `GET /_synapse/admin/v1/rooms/{room_id}/version`。
     *
     * @param roomId - 房间 ID
     * @returns 房间版本信息
     * @example
     * ```typescript
     * const { room_version } = await client.getAdminManager().rooms.getRoomVersion("!room:example.org");
     * console.log(room_version);
     * ```
     */
    async getRoomVersion(roomId: string): Promise<AdminRoomVersionResponse> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest(Method.Get, apu(`/rooms/${encodeURIComponent(roomId)}/version`));
    }

    /**
     * 获取房间封锁状态。
     *
     * 对应 `GET /_synapse/admin/v1/rooms/{room_id}/block`。
     *
     * @param roomId - 房间 ID
     * @returns 封锁状态（未封锁时只返回 `block: false`）
     * @example
     * ```typescript
     * const status = await client.getAdminManager().rooms.getRoomBlockStatus("!room:example.org");
     * console.log(status.block, status.blocked_at);
     * ```
     */
    async getRoomBlockStatus(roomId: string): Promise<AdminRoomBlockStatus> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest(Method.Get, apu(`/rooms/${encodeURIComponent(roomId)}/block`));
    }

    /**
     * 获取指定事件的前后文。
     *
     * 对应 `GET /_synapse/admin/v1/rooms/{room_id}/event_context/{event_id}`，
     * 后端返回 `{event, events_before, events_after, state}`。
     *
     * @param roomId - 房间 ID
     * @param eventId - 事件 ID
     * @returns 目标事件及其前后文
     * @throws {ValidationError} `eventId` 为空时
     * @example
     * ```typescript
     * const ctx = await client.getAdminManager().rooms.getRoomEventContext("!room:example.org", "$event:example.org");
     * console.log(ctx.event.event_id, ctx.events_after.length);
     * ```
     */
    async getRoomEventContext(roomId: string, eventId: string): Promise<AdminEventContext> {
        AdminValidators.validateRoomId(roomId);
        if (!eventId) throw new ValidationError("Event ID is required");
        return await this.adminRequest(
            Method.Get,
            apu(`/rooms/${encodeURIComponent(roomId)}/event_context/${encodeURIComponent(eventId)}`),
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
        return await this.adminRequest(Method.Get, apu(`/rooms/${encodeURIComponent(roomId)}/forward_extremities`));
    }

    /**
     * 获取房间的 token 同步信息。
     *
     * 对应 `GET /_synapse/admin/v1/rooms/{room_id}/token_sync`，后端返回分页的
     * token 列表与汇总统计。
     *
     * @param roomId - 房间 ID
     * @returns token 同步结果
     * @example
     * ```typescript
     * const sync = await client.getAdminManager().rooms.getRoomTokenSync("!room:example.org");
     * console.log(sync.total, sync.summary.active_token_count);
     * ```
     */
    async getRoomTokenSync(roomId: string): Promise<AdminTokenSync> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest(Method.Get, apu(`/rooms/${encodeURIComponent(roomId)}/token_sync`));
    }

    /**
     * 搜索房间内的消息事件。
     *
     * 对应 `POST /_synapse/admin/v1/rooms/{room_id}/search`，`search_term` 必填
     * （见 {@link RoomEventSearchPayload}）。
     *
     * @param roomId - 房间 ID
     * @param payload - 搜索条件（`search_term` 必填）
     * @returns 命中的事件列表
     * @example
     * ```typescript
     * const page = await client.getAdminManager().rooms.searchRoomEvents("!room:example.org", { search_term: "hello" });
     * console.log(page.count, page.results.length);
     * ```
     */
    async searchRoomEvents(roomId: string, payload: RoomEventSearchPayload): Promise<AdminRoomEventSearchPage> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest(Method.Post, apu(`/rooms/${encodeURIComponent(roomId)}/search`), {}, payload);
    }

    /**
     * 获取房间的目录可见性状态。
     *
     * 对应 `GET /_synapse/admin/v1/rooms/{room_id}/listings`。
     *
     * @param roomId - 房间 ID
     * @returns 房间公开/目录状态
     * @example
     * ```typescript
     * const listings = await client.getAdminManager().rooms.getRoomListings("!room:example.org");
     * console.log(listings.public, listings.in_directory);
     * ```
     */
    async getRoomListings(roomId: string): Promise<AdminRoomListings> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest(Method.Get, apu(`/rooms/${encodeURIComponent(roomId)}/listings`));
    }

    /**
     * 将房间设为公开目录可见。
     *
     * 对应 `PUT /_synapse/admin/v1/rooms/{room_id}/listings/public`。
     *
     * @param roomId - 房间 ID
     * @example
     * ```typescript
     * await client.getAdminManager().rooms.setRoomPublicListing("!room:example.org");
     * ```
     */
    async setRoomPublicListing(roomId: string): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        await this.adminRequest(Method.Put, apu(`/rooms/${encodeURIComponent(roomId)}/listings/public`), {}, undefined);
    }

    /**
     * 取消房间的公开目录可见性。
     *
     * 对应 `DELETE /_synapse/admin/v1/rooms/{room_id}/listings/public`。
     *
     * @param roomId - 房间 ID
     * @example
     * ```typescript
     * await client.getAdminManager().rooms.deleteRoomPublicListing("!room:example.org");
     * ```
     */
    async deleteRoomPublicListing(roomId: string): Promise<void> {
        AdminValidators.validateRoomId(roomId);
        await this.adminRequest(
            Method.Delete,
            apu(`/rooms/${encodeURIComponent(roomId)}/listings/public`),
            {},
            undefined,
        );
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
        return await this.adminRequest<RoomStatsOverview>(Method.Get, apu("/room_stats"), queryParams);
    }

    /**
     * 获取单个房间的统计信息（`GET /room_stats/{room_id}`）。
     *
     * @param roomId - 房间 ID
     * @returns 该房间的统计信息
     * @example
     * ```typescript
     * const stats = await client.getAdminManager().rooms.getRoomStatsByRoom("!room:example.org");
     * console.log(stats.member_count, stats.message_count);
     * ```
     */
    async getRoomStatsByRoom(roomId: string): Promise<RoomStats> {
        AdminValidators.validateRoomId(roomId);
        return await this.adminRequest<RoomStats>(Method.Get, apu(`/room_stats/${encodeURIComponent(roomId)}`));
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
        await this.adminRequest(Method.Post, apu(`/rooms/${encodeURIComponent(roomId)}/join`), {}, { user_id: userId });
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
        return await this.adminRequest(Method.Get, apu("/reports"), query);
    }

    /**
     * 获取单条事件举报详情。
     *
     * 对应 `GET /_synapse/admin/v1/reports/{report_id}`。
     *
     * @param reportId - 举报 ID
     * @returns 举报详情
     * @throws {ValidationError} `reportId` 为空时
     * @example
     * ```typescript
     * const report = await client.getAdminManager().rooms.getReport("42");
     * console.log(report.id, report.status);
     * ```
     */
    async getReport(reportId: string): Promise<AdminReport> {
        if (!reportId) throw new ValidationError("Report ID is required");
        return await this.adminRequest(Method.Get, apu(`/reports/${encodeURIComponent(reportId)}`));
    }

    /**
     * 删除单条事件举报。
     *
     * 对应 `DELETE /_synapse/admin/v1/reports/{report_id}`。
     *
     * @param reportId - 举报 ID
     * @throws {ValidationError} `reportId` 为空时
     * @example
     * ```typescript
     * await client.getAdminManager().rooms.deleteReport("42");
     * ```
     */
    async deleteReport(reportId: string): Promise<void> {
        if (!reportId) throw new ValidationError("Report ID is required");
        await this.adminRequest(Method.Delete, apu(`/reports/${encodeURIComponent(reportId)}`));
    }

    /**
     * 列出某个房间的事件举报。
     *
     * 对应 `GET /_synapse/admin/v1/rooms/{room_id}/reports`，
     * 后端返回 `{reports, total}`；`from` 后端不读。
     *
     * @param roomId - 房间 ID
     * @param options - 分页选项（`from` 后端不读，`limit` 生效）
     * @returns 该房间的举报分页结果
     * @example
     * ```typescript
     * const page = await client.getAdminManager().rooms.listRoomReports("!room:example.org", { limit: 50 });
     * console.log(page.total, page.reports.length);
     * ```
     */
    async listRoomReports(roomId: string, options?: { from?: string; limit?: number }): Promise<AdminReportPage> {
        AdminValidators.validateRoomId(roomId);
        const query = buildPaginationParams(options?.limit, options?.from);
        return await this.adminRequest(Method.Get, apu(`/rooms/${encodeURIComponent(roomId)}/reports`), query);
    }

    /**
     * 获取某个房间内指定事件的举报详情。
     *
     * 对应 `GET /_synapse/admin/v1/rooms/{room_id}/reports/{report_id}`。
     *
     * @param roomId - 房间 ID
     * @param reportId - 举报 ID
     * @returns 举报详情
     * @throws {ValidationError} `reportId` 为空时
     * @example
     * ```typescript
     * const report = await client.getAdminManager().rooms.getRoomReport("!room:example.org", "42");
     * console.log(report.id, report.status);
     * ```
     */
    async getRoomReport(roomId: string, reportId: string): Promise<AdminReport> {
        AdminValidators.validateRoomId(roomId);
        if (!reportId) throw new ValidationError("Report ID is required");
        return await this.adminRequest(
            Method.Get,
            apu(`/rooms/${encodeURIComponent(roomId)}/reports/${encodeURIComponent(reportId)}`),
        );
    }

    /**
     * 获取指定 Space 的信息。
     *
     * 对应 `GET /_synapse/admin/v1/spaces/{space_id}`。
     *
     * @param spaceId - Space 的房间 ID
     * @returns Space 信息
     * @example
     * ```typescript
     * const space = await client.getAdminManager().rooms.getSpace("!space:example.org");
     * console.log(space.space_id, space.name);
     * ```
     */
    async getSpace(spaceId: string): Promise<SpaceInfo> {
        AdminValidators.validateRoomId(spaceId);
        return await this.adminRequest(Method.Get, apu(`/spaces/${encodeURIComponent(spaceId)}`));
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
        return await this.adminRequest(Method.Get, apu("/spaces"), query);
    }

    /**
     * 删除指定 Space。
     *
     * 对应 `DELETE /_synapse/admin/v1/spaces/{space_id}`。
     *
     * @param spaceId - Space 的房间 ID
     * @example
     * ```typescript
     * await client.getAdminManager().rooms.deleteSpace("!space:example.org");
     * ```
     */
    async deleteSpace(spaceId: string): Promise<void> {
        AdminValidators.validateRoomId(spaceId);
        await this.adminRequest(Method.Delete, apu(`/spaces/${encodeURIComponent(spaceId)}`));
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
        return await this.adminRequest(Method.Get, apu(`/spaces/${encodeURIComponent(spaceId)}/rooms`), query);
    }

    /**
     * 获取指定 Space 的统计信息。
     *
     * 对应 `GET /_synapse/admin/v1/spaces/{space_id}/stats`。
     *
     * @param spaceId - Space 的房间 ID
     * @returns Space 统计（成员数、子房间数等）
     * @example
     * ```typescript
     * const stats = await client.getAdminManager().rooms.getSpaceStats("!space:example.org");
     * console.log(stats.member_count, stats.child_room_count);
     * ```
     */
    async getSpaceStats(spaceId: string): Promise<SpaceStats> {
        AdminValidators.validateRoomId(spaceId);
        return await this.adminRequest(Method.Get, apu(`/spaces/${encodeURIComponent(spaceId)}/stats`));
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
        return await this.adminRequest(Method.Get, apu(`/spaces/${encodeURIComponent(spaceId)}/users`), query);
    }

    /* ────────────────────────────────────────────────────────────────────────
     * 缺口报告（artifacts/sdk-route-contract-gap-2026-10-15.md §2.C）补齐的两条
     * admin 房间面端点；参数与响应按后端 handler 实读（2026-10-15）。
     * ──────────────────────────────────────────────────────────────────────── */

    /**
     * 回填房间历史（联邦）
     *
     * 对应 `POST /_synapse/admin/v1/rooms/{room_id}/backfill`
     * （`admin/room/management.rs::backfill_room`）。后端向**房间内有 joined 成员的联邦对端**
     * 请求该房间最近本地已知事件之前的历史事件，并以完整 DAG 元数据落库。
     *
     * 房间不存在 ⇒ 后端 404（前端拿到 `NotFoundError`）。
     *
     * @param roomId - 房间 ID
     * @param options.limit - **每个候选对端**请求的事件数（后端默认 100；省略即用默认）
     * @returns `{room_id, source_server, persisted_events, candidates_tried}`
     * @throws {ValidationError} `roomId` 不是合法房间 ID 时（不发请求）
     * @throws {NotFoundError} 房间不存在时（后端 404）
     * @example
     * ```typescript
     * const res = await client.getAdminManager().rooms.backfillRoom("!r:example.org", { limit: 200 });
     * console.log(`persisted ${res.persisted_events} events from ${res.source_server}`);
     * ```
     */
    async backfillRoom(roomId: string, options?: { limit?: number }): Promise<RoomBackfillResponse> {
        AdminValidators.validateRoomId(roomId);
        const body: Record<string, number> = {};
        if (options?.limit !== undefined) {
            body.limit = options.limit;
        }
        return await this.adminRequest<RoomBackfillResponse>(
            Method.Post,
            apu(`/rooms/${encodeURIComponent(roomId)}/backfill`),
            {},
            body,
        );
    }

    /**
     * 级联删除事件（递归）
     *
     * 对应 `POST /_synapse/admin/v1/rooms/{room_id}/cascade_redact`
     * （`admin/room/mod.rs::cascade_redact_event`）。递归删除所有通过关系字段
     * （`m.in_reply_to` / `m.relates_to` / `m.replace`）**引用**目标事件的事件。
     *
     * ⚠️ 与单层 `PUT /rooms/{roomId}/redact/{eventId}/{txnId}`（MSC3912 客户端面）不同：
     * 这是**运维动作**，**不会**落 `m.room.redaction` 事件（管理员可能不是房间成员，
     * 合成事件过不了房间鉴权），归属记录只写在审计日志里。
     *
     * @param roomId - 房间 ID
     * @param options.eventId - 级联起点事件 id（**必填**，后端缺字段即 400）
     * @param options.maxDepth - 递归深度（后端默认 5，**clamp 到 ≤10**）
     * @param options.reason - 删除理由（可选；仅用于审计日志，不落事件）
     * @returns `{event_id, redacted_count, max_depth}`（`max_depth` 是后端**实际生效**值）
     * @throws {ValidationError} `roomId` 非法或 `eventId` 为空时（后端对缺 `event_id` 返回 400）
     * @throws {NotFoundError} 房间不存在时（后端 404）
     * @example
     * ```typescript
     * const res = await client.getAdminManager().rooms.cascadeRedactEvent("!r:example.org", {
     *     eventId: "$root",
     *     maxDepth: 8,
     *     reason: "spam cleanup",
     * });
     * console.log(res.redacted_count, res.max_depth);
     * ```
     */
    async cascadeRedactEvent(
        roomId: string,
        options: { eventId: string; maxDepth?: number; reason?: string },
    ): Promise<CascadeRedactResponse> {
        AdminValidators.validateRoomId(roomId);
        if (!options?.eventId) {
            throw new ValidationError("eventId is required");
        }
        const body: Record<string, unknown> = { event_id: options.eventId };
        if (options.maxDepth !== undefined) {
            body.max_depth = options.maxDepth;
        }
        if (options.reason !== undefined) {
            body.reason = options.reason;
        }
        return await this.adminRequest<CascadeRedactResponse>(
            Method.Post,
            apu(`/rooms/${encodeURIComponent(roomId)}/cascade_redact`),
            {},
            body,
        );
    }
}
