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
 * Thread Manager - 话题/线程管理
 *
 * 提供 Matrix thread（话题/子线程）的创建、查询、管理功能
 * 对应后端: synapse-rust thread 模块
 *
 * 这是 thread 域 REST 面的**规范入口**（`client.getThreadManager()`）。
 * 旧版 `ThreadingManager`（`src/threading/index.ts`）覆盖同一批端点但方法名不一致，
 * 已标注 `@deprecated`；两者的方法级对照表写在旧类上，并由
 * `spec/unit/thread-manager-family.spec.ts` 从源码自动核对。
 *
 * 注意：本地 `Thread` 模型桥接（`getThreads` / `hasThread` / `getThreadTimeline` 等）
 * 仍只在 `ThreadingManager` 上，本类不提供。
 *
 * @see {@link ../threading/index.ts} 旧版 ThreadingManager（已废弃）
 */

import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { MatrixClient } from "../client";
import { InvalidParamError } from "../common/errors";
import { validateUserId, validateRoomId } from "../common/validators";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import type { ThreadPath } from "./__generated__/route-table";
import type { StripV1, StripVendor, PathAssert } from "../http-api/strip-prefix";
import { VendorPrefix } from "../http-api/prefix";

const THREAD_PREFIX_V1 = "/_matrix/client/v1";

function tp<const P extends string>(path: P & PathAssert<P, StripV1<ThreadPath>>): P {
    return path;
}

/**
 * vendor（`/_matrix/vendor/v1`）前缀下的路径断言。
 *
 * 话题的私有扩展（`freeze` / `unfreeze` / `mute` / `read` / 全局列表 / `search` …）
 * 已统一归位 vendor（后端 Batch 1–3 与本轮 M2）。**不能**继续用 `tp`：`ThreadPath`
 * 是只增不减的并集，残留的 v1 条目会让断言静默通过一个后端已不注册的路径。
 * 这与 MSC4354 sticky 的 `r4354` 是同一类修正（见 `docs/sdk-encapsulation-audit.md`
 * §13.15.7 关于"契约表并集 + 前缀漂移"的说明）。
 */
function tpv<const P extends string>(path: P & PathAssert<P, StripVendor<ThreadPath>>): P {
    return path;
}

// ============ Events ============

export enum ThreadEvent {
    ThreadCreated = "ThreadCreated",
    ThreadDeleted = "ThreadDeleted",
    ThreadUpdated = "ThreadUpdated",
    ThreadError = "ThreadError",
}

// ============ Types ============

export interface IThreadReply {
    event_id: string;
    room_id: string;
    thread_id: string;
    sender: string;
    content: Record<string, unknown>; // Dynamic: dynamic Matrix content
    origin_server_ts: number;
    in_reply_to_event_id?: string | null;
    is_edited?: boolean;
    is_redacted?: boolean;
}

export interface IThread {
    thread_id: string;
    room_id: string;
    root_event_id: string;
    reply_count: number;
    latest_reply_ts?: number;
    participants: string[];
    unread: boolean;
    subscribed?: boolean;
    frozen?: boolean;
    muted?: boolean;
}

export interface IThreadStats {
    thread_id: string;
    reply_count: number;
    participant_count: number;
}

export interface IThreadListResponse {
    threads: IThread[];
    next_batch?: string;
}

/**
 * 话题根事件（后端 `ThreadResponse` / `ThreadRoot` 的 wire 形状）。
 * 创建话题与话题详情中的 `root` 均使用该形状。
 * 注意：创建响应不含 `id` / `updated_ts`（故为可选）。
 */
export interface IThreadRoot {
    id?: number;
    room_id: string;
    root_event_id: string;
    sender: string;
    thread_id?: string | null;
    reply_count?: number | null;
    last_reply_event_id?: string | null;
    last_reply_sender?: string | null;
    last_reply_ts?: number | null;
    participants?: unknown;
    is_fetched: boolean;
    created_ts: number;
    updated_ts?: number | null;
}

export interface IThreadSubscription {
    id: number;
    room_id: string;
    thread_id: string;
    user_id: string;
    notification_level: string;
    is_muted: boolean;
    is_pinned: boolean;
    subscribed_ts: number;
    updated_ts: number;
}

export interface IThreadReadReceipt {
    id: number;
    room_id: string;
    thread_id: string;
    user_id: string;
    last_read_event_id: string | null;
    last_read_ts: number;
    unread_count: number;
    updated_ts: number;
}

/**
 * 话题详情（后端 `ThreadDetailResponse` 的 wire 形状，扁平结构，非 `{ thread }` 包裹）。
 */
export interface IThreadDetail {
    root: IThreadRoot;
    replies: IThreadReply[];
    reply_count: number;
    participants: string[];
    summary?: Record<string, unknown> | null;
    user_receipt?: IThreadReadReceipt | null;
    user_subscription?: IThreadSubscription | null;
}

interface ThreadManagerEventMap {
    [ThreadEvent.ThreadCreated]: (thread: IThread) => void;
    [ThreadEvent.ThreadDeleted]: (threadId: string) => void;
    [ThreadEvent.ThreadUpdated]: (thread: IThread) => void;
    [ThreadEvent.ThreadError]: (error: Error) => void;
}

// ============ Manager ============

export class ThreadManager extends BaseManager<ThreadEvent, ThreadManagerEventMap> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    // ============ Room-scoped thread list ============

    /**
     * 获取房间内的所有话题列表
     * GET /_matrix/client/v1/rooms/{room_id}/threads
     */
    async getRoomThreads(
        roomId: string,
        params?: { from?: string; limit?: number; include_all?: boolean },
    ): Promise<IThreadListResponse> {
        validateRoomId(roomId);
        const path = tp(`/rooms/${encodeURIComponent(roomId)}/threads`);
        return this.withRetry(
            () =>
                this.request<IThreadListResponse>({
                    method: Method.Get,
                    path: path,
                    queryParams: params,
                    prefix: THREAD_PREFIX_V1,
                }),
            "getRoomThreads",
        );
    }

    /**
     * 在房间中创建新话题
     * POST /_matrix/vendor/v1/rooms/{room_id}/threads
     */
    async createThread(roomId: string, body: { event_id: string; name?: string }): Promise<IThreadRoot> {
        validateRoomId(roomId);
        if (!body.event_id) {
            throw new InvalidParamError("event_id is required");
        }
        const path = tpv(`/rooms/${encodeURIComponent(roomId)}/threads`);
        return this.withRetry(
            () =>
                this.request<IThreadRoot>({
                    method: Method.Post,
                    path: path,
                    body: { root_event_id: body.event_id, content: body.name ?? {} },
                    prefix: VendorPrefix,
                }),
            "createThread",
        );
    }

    /**
     * 搜索房间内的话题
     * GET /_matrix/vendor/v1/rooms/{room_id}/threads/search
     */
    async searchThreads(
        roomId: string,
        params: { term: string; limit?: number; from?: string },
    ): Promise<IThreadListResponse> {
        validateRoomId(roomId);
        if (!params.term) {
            throw new InvalidParamError("search term is required");
        }
        const path = tpv(`/rooms/${encodeURIComponent(roomId)}/threads/search`);
        return this.withRetry(
            () =>
                this.request<IThreadListResponse>({
                    method: Method.Get,
                    path: path,
                    queryParams: { q: params.term, limit: params.limit, from: params.from },
                    prefix: VendorPrefix,
                }),
            "searchThreads",
        );
    }

    /**
     * 获取房间内未读话题列表
     * GET /_matrix/vendor/v1/rooms/{room_id}/threads/unread
     */
    async getUnreadRoomThreads(roomId: string): Promise<IThreadListResponse> {
        validateRoomId(roomId);
        const path = tpv(`/rooms/${encodeURIComponent(roomId)}/threads/unread`);
        return this.withRetry(
            () =>
                this.request<IThreadListResponse>({
                    method: Method.Get,
                    path: path,
                    prefix: VendorPrefix,
                }),
            "getUnreadRoomThreads",
        );
    }

    // ============ Single thread operations ============

    /**
     * 获取话题详情
     * GET /_matrix/client/v1/rooms/{room_id}/threads/{thread_id}
     */
    async getThread(roomId: string, threadId: string): Promise<IThreadDetail> {
        validateRoomId(roomId);
        if (!threadId) throw new InvalidParamError("thread_id is required");
        const path = tp(`/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}`);
        return this.withRetry(
            () =>
                this.request<IThreadDetail>({
                    method: Method.Get,
                    path: path,
                    prefix: THREAD_PREFIX_V1,
                }),
            "getThread",
        );
    }

    /**
     * 删除话题
     * DELETE /_matrix/vendor/v1/rooms/{room_id}/threads/{thread_id}
     */
    async deleteThread(roomId: string, threadId: string): Promise<void> {
        validateRoomId(roomId);
        if (!threadId) throw new InvalidParamError("thread_id is required");
        const path = tpv(`/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}`);
        await this.withRetry(
            () =>
                this.request<void>({
                    method: Method.Delete,
                    path: path,
                    prefix: VendorPrefix,
                }),
            "deleteThread",
        );
    }

    /**
     * 冻结话题（禁止新回复）
     * POST /_matrix/vendor/v1/rooms/{room_id}/threads/{thread_id}/freeze
     */
    async freezeThread(roomId: string, threadId: string): Promise<void> {
        validateRoomId(roomId);
        if (!threadId) throw new InvalidParamError("thread_id is required");
        const path = tpv(`/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}/freeze`);
        await this.withRetry(
            () =>
                this.request<void>({
                    method: Method.Post,
                    path: path,
                    body: {},
                    prefix: VendorPrefix,
                }),
            "freezeThread",
        );
    }

    /**
     * 取消冻结话题
     * POST /_matrix/vendor/v1/rooms/{room_id}/threads/{thread_id}/unfreeze
     */
    async unfreezeThread(roomId: string, threadId: string): Promise<void> {
        validateRoomId(roomId);
        if (!threadId) throw new InvalidParamError("thread_id is required");
        const path = tpv(`/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}/unfreeze`);
        await this.withRetry(
            () =>
                this.request<void>({
                    method: Method.Post,
                    path: path,
                    body: {},
                    prefix: VendorPrefix,
                }),
            "unfreezeThread",
        );
    }

    /**
     * 静音话题
     * POST /_matrix/vendor/v1/rooms/{room_id}/threads/{thread_id}/mute
     */
    async muteThread(roomId: string, threadId: string): Promise<IThreadSubscription> {
        validateRoomId(roomId);
        if (!threadId) throw new InvalidParamError("thread_id is required");
        const path = tpv(`/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}/mute`);
        return this.withRetry(
            () =>
                this.request<IThreadSubscription>({
                    method: Method.Post,
                    path: path,
                    body: {},
                    prefix: VendorPrefix,
                }),
            "muteThread",
        );
    }

    /**
     * 标记话题为已读
     * POST /_matrix/vendor/v1/rooms/{room_id}/threads/{thread_id}/read
     */
    async markThreadRead(roomId: string, threadId: string, readUpTo: string): Promise<IThreadReadReceipt> {
        validateRoomId(roomId);
        if (!threadId) throw new InvalidParamError("thread_id is required");
        if (!readUpTo) throw new InvalidParamError("readUpTo is required");
        const path = tpv(`/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}/read`);
        return this.withRetry(
            () =>
                this.request<IThreadReadReceipt>({
                    method: Method.Post,
                    path: path,
                    body: { event_id: readUpTo, origin_server_ts: Date.now() },
                    prefix: VendorPrefix,
                }),
            "markThreadRead",
        );
    }

    /**
     * 订阅话题
     * POST /_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/subscribe
     */
    async subscribeThread(roomId: string, threadId: string): Promise<IThreadSubscription> {
        validateRoomId(roomId);
        if (!threadId) throw new InvalidParamError("thread_id is required");
        const path = tp(`/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}/subscribe`);
        return this.withRetry(
            () =>
                this.request<IThreadSubscription>({
                    method: Method.Post,
                    path: path,
                    body: { notification_level: "all" },
                    prefix: THREAD_PREFIX_V1,
                }),
            "subscribeThread",
        );
    }

    /**
     * 取消订阅话题
     * POST /_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/unsubscribe
     */
    async unsubscribeThread(roomId: string, threadId: string): Promise<void> {
        validateRoomId(roomId);
        if (!threadId) throw new InvalidParamError("thread_id is required");
        const path = tp(`/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}/unsubscribe`);
        await this.withRetry(
            () =>
                this.request<void>({
                    method: Method.Post,
                    path: path,
                    body: {},
                    prefix: THREAD_PREFIX_V1,
                }),
            "unsubscribeThread",
        );
    }

    // ============ Thread replies ============

    /**
     * 获取话题回复列表
     * GET /_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/replies
     */
    async getThreadReplies(
        roomId: string,
        threadId: string,
        params?: { from?: string; limit?: number; dir?: string },
    ): Promise<IThreadReply[]> {
        validateRoomId(roomId);
        if (!threadId) throw new InvalidParamError("thread_id is required");
        const path = tp(`/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}/replies`);
        return this.withRetry(
            () =>
                this.request<IThreadReply[]>({
                    method: Method.Get,
                    path: path,
                    queryParams: params,
                    prefix: THREAD_PREFIX_V1,
                }),
            "getThreadReplies",
        );
    }

    /**
     * 创建话题回复
     * POST /_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/replies
     */
    async createThreadReply(
        roomId: string,
        threadId: string,
        body: { event_id: string; root_event_id: string; content: Record<string, unknown> },
    ): Promise<IThreadReply> {
        validateRoomId(roomId);
        if (!threadId) throw new InvalidParamError("thread_id is required");
        if (!body.event_id) throw new InvalidParamError("event_id is required");
        if (!body.root_event_id) throw new InvalidParamError("root_event_id is required");
        if (!body.content) throw new InvalidParamError("content is required");
        const path = tp(`/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}/replies`);
        return this.withRetry(
            () =>
                this.request<IThreadReply>({
                    method: Method.Post,
                    path: path,
                    body: body,
                    prefix: THREAD_PREFIX_V1,
                }),
            "createThreadReply",
        );
    }

    /**
     * 删除（红线）话题回复
     * POST /_matrix/vendor/v1/rooms/{room_id}/replies/{event_id}/redact
     */
    async redactReply(roomId: string, eventId: string, reason?: string): Promise<void> {
        validateRoomId(roomId);
        if (!eventId) throw new InvalidParamError("event_id is required");
        const path = tpv(`/rooms/${encodeURIComponent(roomId)}/replies/${encodeURIComponent(eventId)}/redact`);
        const body: Record<string, unknown> = {};
        if (reason) {
            body.reason = reason;
        }
        await this.withRetry(
            () =>
                this.request<void>({
                    method: Method.Post,
                    path: path,
                    body: body,
                    prefix: VendorPrefix,
                }),
            "redactReply",
        );
    }

    // ============ Thread stats ============

    /**
     * 获取话题统计信息
     * GET /_matrix/vendor/v1/rooms/{room_id}/threads/{thread_id}/stats
     */
    async getThreadStats(roomId: string, threadId: string): Promise<IThreadStats> {
        validateRoomId(roomId);
        if (!threadId) throw new InvalidParamError("thread_id is required");
        const path = tpv(`/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}/stats`);
        return this.withRetry(
            () =>
                this.request<IThreadStats>({
                    method: Method.Get,
                    path: path,
                    prefix: VendorPrefix,
                }),
            "getThreadStats",
        );
    }

    // ============ Global thread operations ============

    /**
     * 获取全局所有话题
     * GET /_matrix/vendor/v1/threads
     */
    async getAllThreads(params?: { from?: string; limit?: number }): Promise<IThreadListResponse> {
        const path = tpv("/threads");
        return this.withRetry(
            () =>
                this.request<IThreadListResponse>({
                    method: Method.Get,
                    path: path,
                    queryParams: params,
                    prefix: VendorPrefix,
                }),
            "getAllThreads",
        );
    }

    /**
     * 创建话题（无需指定房间上下文）
     * POST /_matrix/vendor/v1/threads
     */
    async createGlobalThread(body: { room_id: string; event_id: string; name?: string }): Promise<IThreadRoot> {
        if (!body.room_id) throw new InvalidParamError("room_id is required");
        if (!body.event_id) throw new InvalidParamError("event_id is required");
        const path = tpv("/threads");
        return this.withRetry(
            () =>
                this.request<IThreadRoot>({
                    method: Method.Post,
                    path: path,
                    body: { room_id: body.room_id, root_event_id: body.event_id, content: body.name ?? {} },
                    prefix: VendorPrefix,
                }),
            "createGlobalThread",
        );
    }

    /**
     * 获取已订阅的话题列表
     * GET /_matrix/vendor/v1/threads/subscribed
     */
    async getSubscribedThreads(params?: { from?: string; limit?: number }): Promise<IThreadListResponse> {
        const path = tpv("/threads/subscribed");
        return this.withRetry(
            () =>
                this.request<IThreadListResponse>({
                    method: Method.Get,
                    path: path,
                    queryParams: params,
                    prefix: VendorPrefix,
                }),
            "getSubscribedThreads",
        );
    }

    /**
     * 获取全局未读话题列表
     * GET /_matrix/vendor/v1/threads/unread
     */
    async getAllUnreadThreads(): Promise<IThreadListResponse> {
        const path = tpv("/threads/unread");
        return this.withRetry(
            () =>
                this.request<IThreadListResponse>({
                    method: Method.Get,
                    path: path,
                    prefix: VendorPrefix,
                }),
            "getAllUnreadThreads",
        );
    }

    // ============ User-scoped threads ============

    /**
     * 获取用户在某房间内的话题列表
     * GET /_matrix/vendor/v1/user/{user_id}/rooms/{room_id}/threads
     */
    async getUserThreads(
        userId: string,
        roomId: string,
        params?: { from?: string; limit?: number },
    ): Promise<IThreadListResponse> {
        validateUserId(userId);
        validateRoomId(roomId);
        const path = tpv(`/user/${encodeURIComponent(userId)}/rooms/${encodeURIComponent(roomId)}/threads`);
        return this.withRetry(
            () =>
                this.request<IThreadListResponse>({
                    method: Method.Get,
                    path: path,
                    queryParams: params,
                    prefix: VendorPrefix,
                }),
            "getUserThreads",
        );
    }

    // ============ Lifecycle ============

    start(): void {
        // Initialize thread state
    }

    stop(): void {
        // Clean up thread state
    }
}

// ============ MatrixClient extension ============

export function extendMatrixClient(): void {
    MatrixClient.prototype.getThreadManager = function (): ThreadManager {
        registerManagerClass("thread", ThreadManager);
        return getOrCreateManager(this, "thread", () => new ThreadManager(this));
    };
}
