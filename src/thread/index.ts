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
 */

import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { MatrixClient } from "../client";
import { InvalidParamError } from "../common/errors";
import { validateUserId, validateRoomId } from "../common/validators";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import type { ThreadPathPattern } from "./__generated__/route-table";

const THREAD_PREFIX_V1 = "/_matrix/client/v1";
const THREAD_PREFIX_V3 = "/_matrix/client/v3";

type StripV1<P extends string> = P extends `/_matrix/client/v1${infer Rest}` ? Rest : never;
type StripV3<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;

function tp(path: StripV1<ThreadPathPattern>): string {
    return path;
}

function tpV3(path: StripV3<ThreadPathPattern>): string {
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

export interface IThreadRepliesResponse {
    replies: IThreadReply[];
    next_batch?: string;
}

export interface IThreadResponse {
    thread: IThread;
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
        params?: { from?: string; limit?: number; include?: string },
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
     * POST /_matrix/client/v1/rooms/{room_id}/threads
     */
    async createThread(roomId: string, body: { event_id: string; name?: string }): Promise<IThreadResponse> {
        validateRoomId(roomId);
        if (!body.event_id) {
            throw new InvalidParamError("event_id is required");
        }
        const path = tp(`/rooms/${encodeURIComponent(roomId)}/threads`);
        return this.withRetry(
            () =>
                this.request<IThreadResponse>({
                    method: Method.Post,
                    path: path,
                    body: body,
                    prefix: THREAD_PREFIX_V1,
                }),
            "createThread",
        );
    }

    /**
     * 搜索房间内的话题
     * GET /_matrix/client/v1/rooms/{room_id}/threads/search
     */
    async searchThreads(
        roomId: string,
        params: { term: string; limit?: number; from?: string },
    ): Promise<IThreadListResponse> {
        validateRoomId(roomId);
        if (!params.term) {
            throw new InvalidParamError("search term is required");
        }
        const path = tp(`/rooms/${encodeURIComponent(roomId)}/threads/search`);
        return this.withRetry(
            () =>
                this.request<IThreadListResponse>({
                    method: Method.Get,
                    path: path,
                    queryParams: params,
                    prefix: THREAD_PREFIX_V1,
                }),
            "searchThreads",
        );
    }

    /**
     * 获取房间内未读话题列表
     * GET /_matrix/client/v1/rooms/{room_id}/threads/unread
     */
    async getUnreadRoomThreads(roomId: string): Promise<IThreadListResponse> {
        validateRoomId(roomId);
        const path = tp(`/rooms/${encodeURIComponent(roomId)}/threads/unread`);
        return this.withRetry(
            () =>
                this.request<IThreadListResponse>({
                    method: Method.Get,
                    path: path,
                    prefix: THREAD_PREFIX_V1,
                }),
            "getUnreadRoomThreads",
        );
    }

    // ============ Single thread operations ============

    /**
     * 获取话题详情
     * GET /_matrix/client/v1/rooms/{room_id}/threads/{thread_id}
     */
    async getThread(roomId: string, threadId: string): Promise<IThreadResponse> {
        validateRoomId(roomId);
        if (!threadId) throw new InvalidParamError("thread_id is required");
        const path = tp(`/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}`);
        return this.withRetry(
            () =>
                this.request<IThreadResponse>({
                    method: Method.Get,
                    path: path,
                    prefix: THREAD_PREFIX_V1,
                }),
            "getThread",
        );
    }

    /**
     * 删除话题
     * DELETE /_matrix/client/v1/rooms/{room_id}/threads/{thread_id}
     */
    async deleteThread(roomId: string, threadId: string): Promise<void> {
        validateRoomId(roomId);
        if (!threadId) throw new InvalidParamError("thread_id is required");
        const path = tp(`/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}`);
        await this.withRetry(
            () =>
                this.request<void>({
                    method: Method.Delete,
                    path: path,
                    prefix: THREAD_PREFIX_V1,
                }),
            "deleteThread",
        );
    }

    /**
     * 冻结话题（禁止新回复）
     * POST /_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/freeze
     */
    async freezeThread(roomId: string, threadId: string): Promise<IThreadResponse> {
        validateRoomId(roomId);
        if (!threadId) throw new InvalidParamError("thread_id is required");
        const path = tp(`/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}/freeze`);
        return this.withRetry(
            () =>
                this.request<IThreadResponse>({
                    method: Method.Post,
                    path: path,
                    body: {},
                    prefix: THREAD_PREFIX_V1,
                }),
            "freezeThread",
        );
    }

    /**
     * 取消冻结话题
     * POST /_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/unfreeze
     */
    async unfreezeThread(roomId: string, threadId: string): Promise<IThreadResponse> {
        validateRoomId(roomId);
        if (!threadId) throw new InvalidParamError("thread_id is required");
        const path = tp(`/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}/unfreeze`);
        return this.withRetry(
            () =>
                this.request<IThreadResponse>({
                    method: Method.Post,
                    path: path,
                    body: {},
                    prefix: THREAD_PREFIX_V1,
                }),
            "unfreezeThread",
        );
    }

    /**
     * 静音话题
     * POST /_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/mute
     */
    async muteThread(roomId: string, threadId: string): Promise<IThreadResponse> {
        validateRoomId(roomId);
        if (!threadId) throw new InvalidParamError("thread_id is required");
        const path = tp(`/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}/mute`);
        return this.withRetry(
            () =>
                this.request<IThreadResponse>({
                    method: Method.Post,
                    path: path,
                    body: {},
                    prefix: THREAD_PREFIX_V1,
                }),
            "muteThread",
        );
    }

    /**
     * 标记话题为已读
     * POST /_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/read
     */
    async markThreadRead(roomId: string, threadId: string, readUpTo?: string): Promise<void> {
        validateRoomId(roomId);
        if (!threadId) throw new InvalidParamError("thread_id is required");
        const path = tp(`/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}/read`);
        const body: Record<string, unknown> = {};
        if (readUpTo) {
            body.read_up_to = readUpTo;
        }
        await this.withRetry(
            () =>
                this.request<void>({
                    method: Method.Post,
                    path: path,
                    body: body,
                    prefix: THREAD_PREFIX_V1,
                }),
            "markThreadRead",
        );
    }

    /**
     * 订阅话题
     * POST /_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/subscribe
     */
    async subscribeThread(roomId: string, threadId: string): Promise<IThreadResponse> {
        validateRoomId(roomId);
        if (!threadId) throw new InvalidParamError("thread_id is required");
        const path = tp(`/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}/subscribe`);
        return this.withRetry(
            () =>
                this.request<IThreadResponse>({
                    method: Method.Post,
                    path: path,
                    body: {},
                    prefix: THREAD_PREFIX_V1,
                }),
            "subscribeThread",
        );
    }

    /**
     * 取消订阅话题
     * POST /_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/unsubscribe
     */
    async unsubscribeThread(roomId: string, threadId: string): Promise<IThreadResponse> {
        validateRoomId(roomId);
        if (!threadId) throw new InvalidParamError("thread_id is required");
        const path = tp(`/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}/unsubscribe`);
        return this.withRetry(
            () =>
                this.request<IThreadResponse>({
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
    ): Promise<IThreadRepliesResponse> {
        validateRoomId(roomId);
        if (!threadId) throw new InvalidParamError("thread_id is required");
        const path = tp(`/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}/replies`);
        return this.withRetry(
            () =>
                this.request<IThreadRepliesResponse>({
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
        body: { content: Record<string, unknown> },
    ): Promise<IThreadReply> {
        validateRoomId(roomId);
        if (!threadId) throw new InvalidParamError("thread_id is required");
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
     * POST /_matrix/client/v1/rooms/{room_id}/replies/{event_id}/redact
     */
    async redactReply(roomId: string, eventId: string, reason?: string): Promise<void> {
        validateRoomId(roomId);
        if (!eventId) throw new InvalidParamError("event_id is required");
        const path = tp(`/rooms/${encodeURIComponent(roomId)}/replies/${encodeURIComponent(eventId)}/redact`);
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
                    prefix: THREAD_PREFIX_V1,
                }),
            "redactReply",
        );
    }

    // ============ Thread stats ============

    /**
     * 获取话题统计信息
     * GET /_matrix/client/v1/rooms/{room_id}/threads/{thread_id}/stats
     */
    async getThreadStats(roomId: string, threadId: string): Promise<IThreadStats> {
        validateRoomId(roomId);
        if (!threadId) throw new InvalidParamError("thread_id is required");
        const path = tp(`/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}/stats`);
        return this.withRetry(
            () =>
                this.request<IThreadStats>({
                    method: Method.Get,
                    path: path,
                    prefix: THREAD_PREFIX_V1,
                }),
            "getThreadStats",
        );
    }

    // ============ Global thread operations ============

    /**
     * 获取全局所有话题
     * GET /_matrix/client/v1/threads
     */
    async getAllThreads(params?: { from?: string; limit?: number }): Promise<IThreadListResponse> {
        const path = tp("/threads");
        return this.withRetry(
            () =>
                this.request<IThreadListResponse>({
                    method: Method.Get,
                    path: path,
                    queryParams: params,
                    prefix: THREAD_PREFIX_V1,
                }),
            "getAllThreads",
        );
    }

    /**
     * 创建话题（无需指定房间上下文）
     * POST /_matrix/client/v1/threads
     */
    async createGlobalThread(body: { room_id: string; event_id: string; name?: string }): Promise<IThreadResponse> {
        if (!body.room_id) throw new InvalidParamError("room_id is required");
        if (!body.event_id) throw new InvalidParamError("event_id is required");
        const path = tp("/threads");
        return this.withRetry(
            () =>
                this.request<IThreadResponse>({
                    method: Method.Post,
                    path: path,
                    body: body,
                    prefix: THREAD_PREFIX_V1,
                }),
            "createGlobalThread",
        );
    }

    /**
     * 获取已订阅的话题列表
     * GET /_matrix/client/v1/threads/subscribed
     */
    async getSubscribedThreads(params?: { from?: string; limit?: number }): Promise<IThreadListResponse> {
        const path = tp("/threads/subscribed");
        return this.withRetry(
            () =>
                this.request<IThreadListResponse>({
                    method: Method.Get,
                    path: path,
                    queryParams: params,
                    prefix: THREAD_PREFIX_V1,
                }),
            "getSubscribedThreads",
        );
    }

    /**
     * 获取全局未读话题列表
     * GET /_matrix/client/v1/threads/unread
     */
    async getAllUnreadThreads(): Promise<IThreadListResponse> {
        const path = tp("/threads/unread");
        return this.withRetry(
            () =>
                this.request<IThreadListResponse>({
                    method: Method.Get,
                    path: path,
                    prefix: THREAD_PREFIX_V1,
                }),
            "getAllUnreadThreads",
        );
    }

    // ============ User-scoped threads ============

    /**
     * 获取用户在某房间内的话题列表
     * GET /_matrix/client/v3/user/{user_id}/rooms/{room_id}/threads
     */
    async getUserThreads(
        userId: string,
        roomId: string,
        params?: { from?: string; limit?: number },
    ): Promise<IThreadListResponse> {
        validateUserId(userId);
        validateRoomId(roomId);
        const path = tpV3(`/user/${encodeURIComponent(userId)}/rooms/${encodeURIComponent(roomId)}/threads`);
        return this.withRetry(
            () =>
                this.request<IThreadListResponse>({
                    method: Method.Get,
                    path: path,
                    queryParams: params,
                    prefix: THREAD_PREFIX_V3,
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
