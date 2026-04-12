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
import type { IRelationsResponse, IContextResponse } from "../@types/requests";
import { getRelationsThreadFilter } from "../thread-utils";
import { ServerSupport, Feature } from "../feature";
import { BaseManager } from "../managers/base-manager";

export interface ThreadingManagerEvents {
    threadTimelineFetched: (data: { threadId: string; eventId: string }) => void;
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
    constructor(client: MatrixClient) {
        super(client);
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

    public async createThread(roomId: string, eventId: string): Promise<Thread | null> {
        const room = this.client.getRoom(roomId);
        if (!room) return null;

        const event = room.findEventById(eventId);
        if (!event) return null;

        return room.createThread?.(eventId, event, [], false) || null;
    }

    public async getThreadTimeline(timelineSet: EventTimelineSet, eventId: string): Promise<EventTimeline | undefined> {
        const clientInternals = this.client as unknown as ClientInternals;

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

declare module "../client.ts" {
    interface MatrixClient {
        getThreadingManager(): ThreadingManager;
    }
}

export function extendMatrixClient(): void {
    if (MatrixClient.prototype.hasOwnProperty("getThreadingManager")) return;

    MatrixClient.prototype.getThreadingManager = function (this: MatrixClient): ThreadingManager {
        return new ThreadingManager(this);
    };
}

export default extendMatrixClient;
