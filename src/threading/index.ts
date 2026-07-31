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
 * Threading Manager - 线程管理
 *
 * 提供线程相关功能，包括线程时间线获取
 */

import { MatrixClient } from "../client";
import { Thread, THREAD_RELATION_TYPE } from "../models/thread";
import { EventTimeline, Direction } from "../models/event-timeline";
import type { EventTimelineSet } from "../models/event-timeline-set";
import type { MatrixEvent } from "../models/event";
import type { IContent } from "../models/event";
import type { IRelationsResponse, IContextResponse } from "../@types/requests";
import { getRelationsThreadFilter } from "../thread-utils";
import { ServerSupport, Feature } from "../feature";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { ClientPrefix, Method } from "../http-api";
import type { Body } from "../http-api/interface";
import type { ThreadPathPattern } from "../thread/__generated__/route-table";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

type StripV1<P extends string> = P extends `/_matrix/client/v1${infer Rest}` ? Rest : never;
type StripV3<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;

function tv1<P extends StripV1<ThreadPathPattern>>(path: P): P {
    return path;
}

function tv3<P extends StripV3<ThreadPathPattern>>(path: P): P {
    return path;
}

export interface ThreadingManagerEvents {
    threadTimelineFetched: (data: { threadId: string; eventId: string }) => void;
}

export interface ThreadListQuery {
    limit?: number;
    from?: string;
    includeAll?: boolean;
}

export interface ThreadSearchQuery {
    q: string;
    limit?: number;
}

export interface ThreadRepliesQuery {
    limit?: number;
    from?: string;
}

export interface ThreadDetailQuery {
    includeReplies?: boolean;
    replyLimit?: number;
}

export interface ThreadSummaryResponse {
    id: number;
    room_id: string;
    thread_id: string;
    root_event_id: string;
    root_sender: string;
    root_content: IContent;
    root_origin_server_ts: number;
    latest_event_id: string | null;
    latest_sender: string | null;
    latest_content: IContent | null;
    latest_origin_server_ts: number | null;
    reply_count: number;
    participants: unknown;
    is_frozen: boolean;
    created_ts: number;
    updated_ts: number;
}

export interface ThreadReadReceiptResponse {
    id: number;
    room_id: string;
    thread_id: string;
    user_id: string;
    last_read_event_id: string | null;
    last_read_ts: number;
    unread_count: number;
    updated_ts: number;
}

export interface ThreadSubscriptionResponse {
    id: number;
    room_id: string;
    thread_id: string;
    user_id: string;
    notification_level: string;
    is_muted: boolean;
    subscribed_ts: number;
    updated_ts: number;
}

export interface ThreadReplyResponse {
    event_id: string;
    thread_id: string;
    room_id: string;
    sender: string;
    content: IContent;
    origin_server_ts: number;
    in_reply_to_event_id: string | null;
    is_edited: boolean;
    is_redacted: boolean;
}

export interface ThreadCreateResponse {
    thread_id: string | null;
    root_event_id: string;
    room_id: string;
    sender: string;
    reply_count: number;
    last_reply_event_id: string | null;
    last_reply_sender: string | null;
    last_reply_ts: number | null;
    participants: unknown;
    is_fetched: boolean;
    created_ts: number;
}

export interface ThreadRootResponse {
    id: number;
    room_id: string;
    root_event_id: string;
    sender: string;
    thread_id: string | null;
    reply_count: number;
    last_reply_event_id: string | null;
    last_reply_sender: string | null;
    last_reply_ts: number | null;
    participants: unknown;
    is_fetched: boolean;
    created_ts: number;
    updated_ts: number | null;
}

export interface ThreadCreateParams {
    roomId?: string;
    rootEventId: string;
    content?: IContent;
    originServerTs?: number;
}

export interface ThreadReplyCreateParams {
    eventId: string;
    rootEventId: string;
    content: IContent;
    inReplyToEventId?: string;
    originServerTs?: number;
}

export interface ThreadDetailResponse {
    root: ThreadRootResponse;
    replies: ThreadReplyResponse[];
    reply_count: number;
    participants: string[];
    summary: ThreadSummaryResponse | null;
    user_receipt: ThreadReadReceiptResponse | null;
    user_subscription: ThreadSubscriptionResponse | null;
}

export interface ThreadListResponse {
    threads: ThreadSummaryResponse[];
    next_batch: string | null;
    total: number;
}

export interface ThreadUnreadResponse {
    threads: ThreadReadReceiptResponse[];
    total_unread: number;
    total_threads: number;
}

export interface SubscribedThreadsResponse {
    threads: ThreadSummaryResponse[];
    subscribed: ThreadSubscriptionResponse[];
}

export interface ThreadLegacyChunkItem {
    event_id: string;
    sender: string;
    content: IContent;
    origin_server_ts: number;
}

export interface ThreadLegacySearchResponse {
    chunk: ThreadLegacyChunkItem[];
    next_batch: string | null;
}

export interface ThreadStatisticsResponse {
    id: number;
    room_id: string;
    thread_id: string;
    total_replies: number;
    total_participants: number;
    total_edits: number;
    total_redactions: number;
    first_reply_ts: number | null;
    last_reply_ts: number | null;
    avg_reply_time_ms: number | null;
    created_ts: number;
    updated_ts: number;
}

type ClientInternals = {
    supportsThreads(): boolean;
    getEventContext(roomId: string, eventId: string): Promise<IContextResponse>;
    getEventMapper(): (e: unknown) => MatrixEvent;
    canSupport: Map<Feature, ServerSupport>;
    fetchRelations(
        roomId: string,
        eventId: string,
        relationType: string | null,
        eventType: string | null,
        opts: { dir: Direction; from?: string; recurse?: boolean },
    ): Promise<IRelationsResponse>;
    fetchRoomEvent(roomId: string, eventId: string): Promise<unknown>;
    processAggregatedTimelineEvents(room?: unknown, events?: unknown[]): void;
};

export class ThreadingManager extends BaseManager<keyof ThreadingManagerEvents, ThreadingManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    private buildQuery(
        query: Record<string, string | number | boolean | undefined>,
    ): Record<string, string | number | boolean> | undefined {
        const result: Record<string, string | number | boolean> = {};
        for (const [key, value] of Object.entries(query)) {
            if (value !== undefined) {
                result[key] = value;
            }
        }
        return Object.keys(result).length > 0 ? result : undefined;
    }

    private async requestThreadV1<T>(
        methodName: string,
        method: Method,
        path: StripV1<ThreadPathPattern>,
        queryParams?: Record<string, string | number | boolean>,
        body?: Body,
    ): Promise<T> {
        try {
            return await this.withRetry(async () => {
                return await this.request<T>({
                    method: method,
                    path: path,
                    queryParams: queryParams,
                    body: body,
                    prefix: ClientPrefix.V1,
                });
            }, "requestThreadV1");
        } catch (e) {
            throw this.normalizeError(e, methodName);
        }
    }

    private async requestThreadV3<T>(
        methodName: string,
        path: StripV3<ThreadPathPattern>,
        queryParams?: Record<string, string | number | boolean>,
    ): Promise<T> {
        try {
            return await this.withRetry(async () => {
                return await this.request<T>({
                    method: Method.Get,
                    path: path,
                    queryParams: queryParams,
                    prefix: ClientPrefix.V3,
                });
            }, "requestThreadV3");
        } catch (e) {
            throw this.normalizeError(e, methodName);
        }
    }

    public getThread(threadId: string): Thread | null {
        const rooms = this.client.getRooms();
        for (const room of rooms) {
            const thread = room.getThread?.(threadId);
            if (thread) return thread;
        }
        return null;
    }

    public getThreadList(): Thread[] {
        const threads: Thread[] = [];
        const rooms = this.client.getRooms();
        for (const room of rooms) {
            const roomThreads = room.getThreads?.() || [];
            threads.push(...roomThreads);
        }
        return threads;
    }

    public getThreads(): Thread[] {
        return this.getThreadList();
    }

    public hasThread(threadId: string): boolean {
        return this.getThread(threadId) !== null;
    }

    public async getGlobalThreadList(query: ThreadListQuery = {}): Promise<ThreadListResponse> {
        return await this.requestThreadV1(
            "getGlobalThreadList",
            Method.Get,
            tv1("/threads"),
            this.buildQuery({ limit: query.limit, from: query.from }),
        );
    }

    public async getSubscribedThreads(): Promise<SubscribedThreadsResponse> {
        return await this.requestThreadV1("getSubscribedThreads", Method.Get, tv1("/threads/subscribed"));
    }

    public async getGlobalUnreadThreads(): Promise<ThreadUnreadResponse> {
        return await this.requestThreadV1("getGlobalUnreadThreads", Method.Get, tv1("/threads/unread"));
    }

    public async getRoomThreadList(roomId: string, query: ThreadListQuery = {}): Promise<ThreadListResponse> {
        return await this.requestThreadV1(
            "getRoomThreadList",
            Method.Get,
            tv1(`/rooms/${encodeURIComponent(roomId)}/threads`),
            this.buildQuery({ limit: query.limit, from: query.from, include_all: query.includeAll }),
        );
    }

    public async searchRoomThreads(roomId: string, query: ThreadSearchQuery): Promise<ThreadSummaryResponse[]> {
        return await this.requestThreadV1(
            "searchRoomThreads",
            Method.Get,
            tv1(`/rooms/${encodeURIComponent(roomId)}/threads/search`),
            this.buildQuery({ q: query.q, limit: query.limit }),
        );
    }

    public async getLegacyRoomThreadList(
        userId: string,
        roomId: string,
        query: ThreadListQuery = {},
    ): Promise<ThreadLegacySearchResponse> {
        return await this.requestThreadV3(
            "getLegacyRoomThreadList",
            tv3(`/user/${encodeURIComponent(userId)}/rooms/${encodeURIComponent(roomId)}/threads`),
            this.buildQuery({ limit: query.limit, from: query.from, include_all: query.includeAll }),
        );
    }

    public async getRoomUnreadThreads(roomId: string): Promise<ThreadUnreadResponse> {
        return await this.requestThreadV1(
            "getRoomUnreadThreads",
            Method.Get,
            tv1(`/rooms/${encodeURIComponent(roomId)}/threads/unread`),
        );
    }

    public async getRoomThread(
        roomId: string,
        threadId: string,
        query: ThreadDetailQuery = {},
    ): Promise<ThreadDetailResponse> {
        return await this.requestThreadV1(
            "getRoomThread",
            Method.Get,
            tv1(`/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}`),
            this.buildQuery({ include_replies: query.includeReplies, reply_limit: query.replyLimit }),
        );
    }

    public async createGlobalThread(params: ThreadCreateParams): Promise<ThreadCreateResponse> {
        return await this.requestThreadV1("createGlobalThread", Method.Post, tv1("/threads"), undefined, {
            room_id: params.roomId,
            root_event_id: params.rootEventId,
            content: params.content ?? {},
            origin_server_ts: params.originServerTs,
        });
    }

    public async createRoomThread(
        roomId: string,
        rootEventId: string,
        options: Pick<ThreadCreateParams, "content" | "originServerTs"> = {},
    ): Promise<ThreadCreateResponse> {
        return await this.requestThreadV1(
            "createRoomThread",
            Method.Post,
            tv1(`/rooms/${encodeURIComponent(roomId)}/threads`),
            undefined,
            {
                root_event_id: rootEventId,
                content: options.content ?? {},
                origin_server_ts: options.originServerTs,
            },
        );
    }

    public async deleteRoomThread(roomId: string, threadId: string): Promise<void> {
        await this.requestThreadV1(
            "deleteRoomThread",
            Method.Delete,
            tv1(`/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}`),
        );
    }

    public async freezeThread(roomId: string, threadId: string): Promise<void> {
        await this.requestThreadV1(
            "freezeThread",
            Method.Post,
            tv1(`/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}/freeze`),
        );
    }

    public async unfreezeThread(roomId: string, threadId: string): Promise<void> {
        await this.requestThreadV1(
            "unfreezeThread",
            Method.Post,
            tv1(`/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}/unfreeze`),
        );
    }

    public async addThreadReply(
        roomId: string,
        threadId: string,
        params: ThreadReplyCreateParams,
    ): Promise<ThreadReplyResponse> {
        return await this.requestThreadV1(
            "addThreadReply",
            Method.Post,
            tv1(`/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}/replies`),
            undefined,
            {
                event_id: params.eventId,
                root_event_id: params.rootEventId,
                content: params.content,
                in_reply_to_event_id: params.inReplyToEventId,
                origin_server_ts: params.originServerTs,
            },
        );
    }

    public async getThreadReplies(
        roomId: string,
        threadId: string,
        query: ThreadRepliesQuery = {},
    ): Promise<ThreadReplyResponse[]> {
        return await this.requestThreadV1(
            "getThreadReplies",
            Method.Get,
            tv1(`/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}/replies`),
            this.buildQuery({ limit: query.limit, from: query.from }),
        );
    }

    public async subscribeToThread(
        roomId: string,
        threadId: string,
        notificationLevel = "all",
    ): Promise<ThreadSubscriptionResponse> {
        return await this.requestThreadV1(
            "subscribeToThread",
            Method.Post,
            tv1(`/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}/subscribe`),
            undefined,
            { notification_level: notificationLevel },
        );
    }

    public async unsubscribeFromThread(roomId: string, threadId: string): Promise<void> {
        await this.requestThreadV1(
            "unsubscribeFromThread",
            Method.Post,
            tv1(`/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}/unsubscribe`),
        );
    }

    public async muteThread(roomId: string, threadId: string): Promise<ThreadSubscriptionResponse> {
        return await this.requestThreadV1(
            "muteThread",
            Method.Post,
            tv1(`/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}/mute`),
        );
    }

    public async markThreadRead(
        roomId: string,
        threadId: string,
        eventId: string,
        originServerTs = Date.now(),
    ): Promise<ThreadReadReceiptResponse> {
        return await this.requestThreadV1(
            "markThreadRead",
            Method.Post,
            tv1(`/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}/read`),
            undefined,
            { event_id: eventId, origin_server_ts: originServerTs },
        );
    }

    public async getThreadStats(roomId: string, threadId: string): Promise<ThreadStatisticsResponse | null> {
        return await this.requestThreadV1(
            "getThreadStats",
            Method.Get,
            tv1(`/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}/stats`),
        );
    }

    public async redactThreadReply(roomId: string, eventId: string): Promise<void> {
        await this.requestThreadV1(
            "redactThreadReply",
            Method.Post,
            tv1(`/rooms/${encodeURIComponent(roomId)}/replies/${encodeURIComponent(eventId)}/redact`),
        );
    }

    public async createThread(roomId: string, eventId: string): Promise<Thread | null> {
        const room = this.client.getRoom(roomId);
        if (!room) return null;

        const event = room.findEventById(eventId);
        if (!event) return null;

        return room.createThread?.(eventId, event, [], false) || null;
    }

    public async getThreadTimeline(timelineSet: EventTimelineSet, eventId: string): Promise<EventTimeline | undefined> {
        const clientInternals = this.internalClient as unknown as ClientInternals;

        if (!clientInternals.supportsThreads()) {
            throw new Error("could not get thread timeline: no client support");
        }

        if (!timelineSet.room) {
            throw new Error("could not get thread timeline: not a room timeline");
        }

        if (!timelineSet.thread) {
            throw new Error("could not get thread timeline: not a thread timeline");
        }

        const res = await clientInternals.getEventContext(timelineSet.room.roomId, eventId);

        const mapper = clientInternals.getEventMapper();
        const event = mapper(res.event);

        if (!timelineSet.canContain(event)) {
            return undefined;
        }

        const recurse = clientInternals.canSupport.get(Feature.RelationsRecursion) !== ServerSupport.Unsupported;

        if (Thread.hasServerSideSupport) {
            if (Thread.hasServerSideFwdPaginationSupport) {
                return await this.getThreadTimelineWithFwdPagination(
                    timelineSet,
                    event,
                    res,
                    mapper,
                    recurse,
                    eventId,
                    clientInternals,
                );
            } else {
                return await this.getThreadTimelineLegacy(timelineSet, event, res, mapper, recurse, clientInternals);
            }
        }
        return undefined;
    }

    private async getThreadTimelineWithFwdPagination(
        timelineSet: EventTimelineSet,
        event: MatrixEvent,
        res: IContextResponse,
        mapper: (e: unknown) => MatrixEvent,
        recurse: boolean,
        eventId: string,
        clientInternals: ClientInternals,
    ): Promise<EventTimeline> {
        if (!timelineSet.thread || !timelineSet.room) {
            throw new Error("could not get thread timeline: not a thread timeline");
        }

        const thread = timelineSet.thread;
        const resOlder: IRelationsResponse = await clientInternals.fetchRelations(
            timelineSet.room.roomId,
            thread.id,
            null,
            null,
            { dir: Direction.Backward, from: res.start, recurse: recurse || undefined },
        );
        const resNewer: IRelationsResponse = await clientInternals.fetchRelations(
            timelineSet.room.roomId,
            thread.id,
            null,
            null,
            { dir: Direction.Forward, from: res.end, recurse: recurse || undefined },
        );
        const events = [
            ...resNewer.chunk.reverse().filter(getRelationsThreadFilter(thread.id)).map(mapper),
            event,
            ...resOlder.chunk.filter(getRelationsThreadFilter(thread.id)).map(mapper),
        ];

        for (const evt of events) {
            await timelineSet.thread?.processEvent(evt);
        }

        let timeline = timelineSet.getTimelineForEvent(event.getId());
        if (timeline) {
            timeline.getState(EventTimeline.BACKWARDS)!.setUnknownStateEvents((res.state ?? []).map(mapper));
        } else {
            timeline = timelineSet.addTimeline();
            timeline.initialiseState((res.state ?? []).map(mapper));
        }

        timelineSet.addEventsToTimeline(events, true, false, timeline, resNewer.next_batch);
        if (!resOlder.next_batch) {
            const originalEvent = await clientInternals.fetchRoomEvent(timelineSet.room.roomId, thread.id);
            timelineSet.addEventsToTimeline([mapper(originalEvent)], true, false, timeline, null);
        }
        timeline.setPaginationToken(resOlder.next_batch ?? null, Direction.Backward);
        timeline.setPaginationToken(resNewer.next_batch ?? null, Direction.Forward);
        clientInternals.processAggregatedTimelineEvents(timelineSet.room, events);

        return timelineSet.getTimelineForEvent(eventId) ?? timeline;
    }

    private async getThreadTimelineLegacy(
        timelineSet: EventTimelineSet,
        event: MatrixEvent,
        res: IContextResponse,
        mapper: (e: unknown) => MatrixEvent,
        recurse: boolean,
        clientInternals: ClientInternals,
    ): Promise<EventTimeline> {
        if (!timelineSet.thread || !timelineSet.room) {
            throw new Error("could not get thread timeline: not a thread timeline");
        }

        const thread = timelineSet.thread;

        const resOlder = await clientInternals.fetchRelations(
            timelineSet.room.roomId,
            thread.id,
            THREAD_RELATION_TYPE.name,
            null,
            { dir: Direction.Backward, from: res.start, recurse: recurse || undefined },
        );
        const eventsNewer: IRelationsResponse["chunk"] = [];
        let nextBatch = res.end;
        while (nextBatch) {
            const resNewer: IRelationsResponse = await clientInternals.fetchRelations(
                timelineSet.room.roomId,
                thread.id,
                THREAD_RELATION_TYPE.name,
                null,
                { dir: Direction.Forward, from: nextBatch, recurse: recurse || undefined },
            );
            nextBatch = resNewer.next_batch;
            eventsNewer.push(...resNewer.chunk);
        }
        const events = [...eventsNewer.reverse().map(mapper), event, ...resOlder.chunk.map(mapper)];
        for (const evt of events) {
            await timelineSet.thread?.processEvent(evt);
        }

        const timeline = timelineSet.getLiveTimeline();
        timeline.getState(EventTimeline.BACKWARDS)!.setUnknownStateEvents((res.state ?? []).map(mapper));

        timelineSet.addEventsToTimeline(events, true, false, timeline, null);
        if (!resOlder.next_batch) {
            const originalEvent = await clientInternals.fetchRoomEvent(timelineSet.room.roomId, thread.id);
            timelineSet.addEventsToTimeline([mapper(originalEvent)], true, false, timeline, null);
        }
        timeline.setPaginationToken(resOlder.next_batch ?? null, Direction.Backward);
        timeline.setPaginationToken(null, Direction.Forward);
        clientInternals.processAggregatedTimelineEvents(timelineSet.room, events);

        return timeline;
    }
}

export function extendMatrixClient(): void {
    if (MatrixClient.prototype.hasOwnProperty("getThreadingManager")) return;

    MatrixClient.prototype.getThreadingManager = function (this: MatrixClient): ThreadingManager {
        registerManagerClass("threading", ThreadingManager);
        return getOrCreateManager(this, "threading", () => new ThreadingManager(this));
    };
}
