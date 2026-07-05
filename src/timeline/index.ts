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
 * Timeline Manager - 时间线管理
 *
 * 提供时间线相关功能，包括时间线获取、分页等
 */

import { MatrixClient } from "../client";
import { Room } from "../models/room";
import { EventTimeline, Direction } from "../models/event-timeline";
import { EventTimelineSet } from "../models/event-timeline-set";
import { MatrixEvent, type IContent } from "../models/event";
import { Thread, THREAD_RELATION_TYPE, ThreadFilterType } from "../models/thread";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import type { IContextResponse } from "../@types/requests";
import type { IMessagesResponse } from "../client-internal-types";
import type { IRelationsResponse } from "../@types/requests";
import { Filter } from "../filter";
import { noUnsafeEventProps } from "../common/safety";
import { sleep } from "../common/async";import { mapStateAndChunkFromMessages, deriveBackPaginationTokenFromMessages } from "../client-timeline-core";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export interface TimelineManagerEvents {
    timelineFetched: (data: { roomId: string; eventId: string }) => void;
    timelinePaginated: (data: { roomId: string; direction: Direction }) => void;
}

type ClientInternals = {
    timelineSupport: boolean;
    supportsThreads(): boolean;
    getThreadTimeline(timelineSet: EventTimelineSet, eventId: string): Promise<EventTimeline | undefined>;
    getEventContext(
        roomId: string,
        eventId: string,
        params?: { limit?: number; filter?: IContent | string },
    ): Promise<IContextResponse>;
    getEventMapper(): (e: unknown) => MatrixEvent;
    logger: { warn(msg: string): void };
    processAggregatedTimelineEvents(room?: unknown, events?: unknown[]): void;
    processThreadEvents(room: Room, events: MatrixEvent[], shouldAggregate: boolean): void;
    canSupportRelationsRecursion: boolean;
    createMessagesRequest(
        roomId: string,
        fromToken: string | null,
        limit: number,
        dir: Direction,
        timelineFilter?: Filter,
    ): Promise<IMessagesResponse>;
    createThreadListMessagesRequest(
        roomId: string,
        fromToken: string | null,
        limit: number,
        dir: Direction,
        threadListType: ThreadFilterType | null,
        timelineFilter?: Filter,
    ): Promise<IMessagesResponse>;
    fetchRelations(
        roomId: string,
        eventId: string,
        relationType: string | null,
        eventType: string | null,
        opts: { dir: Direction; limit?: number; recurse?: boolean },
    ): Promise<IRelationsResponse>;
    storeScrollback(room: Room, limit: number): MatrixEvent[];
    storeEvents(room: Room, events: MatrixEvent[], token: string | null, backwards: boolean): void;
};

export class TimelineManager extends BaseManager<keyof TimelineManagerEvents, TimelineManagerEvents> {
    private static SCROLLBACK_DELAY_MS = 3000;
    private ongoingScrollbacks: Record<string, { promise?: Promise<Room>; errorTs?: number }> = {};

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public getTimelineForRoom(roomId: string): EventTimelineSet | null {
        const room = this.client.getRoom(roomId);
        return room?.getUnfilteredTimelineSet() || null;
    }

    public getEventTimelineSync(roomId: string, eventId: string): EventTimeline | null {
        const room = this.client.getRoom(roomId);
        if (!room) return null;

        const timelineSet = room.getUnfilteredTimelineSet();
        return timelineSet?.getTimelineForEvent(eventId) || null;
    }

    public getEventAndComments(eventId: string): { event: unknown; comments: unknown[] } | null {
        const rooms = this.client.getRooms();
        for (const room of rooms) {
            const timelineSet = room.getUnfilteredTimelineSet();
            const event = timelineSet?.getTimelineForEvent(eventId);
            if (event) {
                return {
                    event,
                    comments: [],
                };
            }
        }
        return null;
    }

    public async peekRoom(roomId: string): Promise<Room | null> {
        return await this.client.peekInRoom(roomId);
    }

    public async stopPeeking(): Promise<void> {
        this.client.stopPeeking?.();
    }

    public async getEventTimeline(timelineSet: EventTimelineSet, eventId: string): Promise<EventTimeline | null> {
        const clientInternals = this.client as unknown as ClientInternals;

        if (!clientInternals.timelineSupport) {
            throw new Error(
                "timeline support is disabled. Set the 'timelineSupport'" +
                    " parameter to true when creating MatrixClient to enable it.",
            );
        }

        if (!timelineSet?.room) {
            throw new Error("getEventTimeline only supports room timelines");
        }

        if (timelineSet.getTimelineForEvent(eventId)) {
            return timelineSet.getTimelineForEvent(eventId);
        }

        if (timelineSet.thread && clientInternals.supportsThreads()) {
            return (await clientInternals.getThreadTimeline(timelineSet, eventId)) ?? null;
        }

        const res = await clientInternals.getEventContext(timelineSet.room.roomId, eventId, {
            filter: this.client.clientOptions?.lazyLoadMembers ? { lazy_load_members: true } : undefined,
        });

        if (timelineSet.getTimelineForEvent(eventId)) {
            return timelineSet.getTimelineForEvent(eventId);
        }

        if (!res.event) {
            throw new Error("Context response must have an 'event' field");
        }

        const mapper = clientInternals.getEventMapper();
        const event = mapper(res.event);
        if (event.isRelation(THREAD_RELATION_TYPE.name)) {
            clientInternals.logger.warn("Tried loading a regular timeline at the position of a thread event");
            return null;
        }
        const events = [
            ...(res.events_after ?? []).reverse().map(mapper),
            event,
            ...(res.events_before ?? []).map(mapper),
        ];

        let timeline = timelineSet.getTimelineForEvent(events[0].getId());
        if (timeline) {
            timeline.getState(EventTimeline.BACKWARDS)!.setUnknownStateEvents((res.state ?? []).map(mapper));
        } else {
            timeline = timelineSet.addTimeline();
            timeline.initialiseState((res.state ?? []).map(mapper));
            timeline.getState(EventTimeline.FORWARDS)!.paginationToken = res.end ?? null;
        }

        const [timelineEvents, threadedEvents, unknownRelations] = timelineSet.room.partitionThreadedEvents(events);
        clientInternals.processAggregatedTimelineEvents(timelineSet.room, timelineEvents);
        timelineSet.addEventsToTimeline(timelineEvents, true, false, timeline, res.start);
        clientInternals.processThreadEvents(timelineSet.room, threadedEvents, true);
        clientInternals.processAggregatedTimelineEvents(timelineSet.room, timelineEvents);
        unknownRelations.forEach((e) => timelineSet.relations.aggregateChildEvent(e));

        return (
            timelineSet.getTimelineForEvent(eventId) ??
            timelineSet.room.findThreadForEvent(event)?.liveTimeline ??
            timeline
        );
    }

    /**
     * Get an EventTimeline for the latest events in the room. This will just
     * call `/messages` to get the latest message in the room, then use
     * `getEventTimeline(...)` to construct a new timeline from it.
     *
     * @param timelineSet -  The timelineSet to find or add the timeline to
     *
     * @returns Promise which resolves:
     *    {@link EventTimeline} timeline with the latest events in the room
     */
    public async getLatestTimeline(timelineSet: EventTimelineSet): Promise<EventTimeline | null> {
        const clientInternals = this.client as unknown as ClientInternals;

        // don't allow any timeline support unless it's been enabled.
        if (!clientInternals.timelineSupport) {
            throw new Error(
                "timeline support is disabled. Set the 'timelineSupport'" +
                    " parameter to true when creating MatrixClient to enable it.",
            );
        }

        if (!timelineSet.room) {
            throw new Error("getLatestTimeline only supports room timelines");
        }

        let event: { event_id: string } | undefined;
        if (timelineSet.threadListType !== null) {
            const res = await clientInternals.createThreadListMessagesRequest(
                timelineSet.room.roomId,
                null,
                1,
                Direction.Backward,
                timelineSet.threadListType,
                timelineSet.getFilter(),
            );
            event = res.chunk?.[0];
        } else if (timelineSet.thread && Thread.hasServerSideSupport) {
            const res = await clientInternals.fetchRelations(
                timelineSet.room.roomId,
                timelineSet.thread.id,
                THREAD_RELATION_TYPE.name,
                null,
                {
                    dir: Direction.Backward,
                    limit: 1,
                    recurse: clientInternals.canSupportRelationsRecursion || undefined,
                },
            );
            event = res.chunk?.[0];
        } else {
            const res = await clientInternals.createMessagesRequest(
                timelineSet.room.roomId,
                null,
                1,
                Direction.Backward,
            );
            event = res.chunk?.[0];
        }
        if (!event) {
            throw new Error("No message returned when trying to construct getLatestTimeline");
        }

        return this.getEventTimeline(timelineSet, event.event_id);
    }

    /**
     * Scroll back in the timeline for the given room, loading more events
     * from the store and/or server.
     *
     * @param room - The room to scroll back in
     * @param limit - The maximum number of events to pull in. Default: 30.
     * @returns Promise which resolves: Room. If you are at the beginning
     * of the timeline, `Room.oldState.paginationToken` will be
     * `null`.
     */
    public scrollback(room: Room, limit = 30): Promise<Room> {
        const clientInternals = this.client as unknown as ClientInternals;

        let timeToWaitMs = 0;

        let info = this.ongoingScrollbacks[room.roomId] || {};
        if (info.promise) {
            return info.promise;
        } else if (info.errorTs) {
            const timeWaitedMs = Date.now() - info.errorTs;
            timeToWaitMs = Math.max(TimelineManager.SCROLLBACK_DELAY_MS - timeWaitedMs, 0);
        }

        if (room.oldState.paginationToken === null) {
            return Promise.resolve(room); // already at the start.
        }
        // attempt to grab more events from the store first
        const numAdded = clientInternals.storeScrollback(room, limit).length;
        if (numAdded === limit) {
            // store contained everything we needed.
            return Promise.resolve(room);
        }
        // reduce the required number of events appropriately
        limit = limit - numAdded;

        const promise = new Promise<Room>((resolve, reject) => {
            // wait for a time before doing this request
            // (which may be 0 in order not to special case the code paths)
            sleep(timeToWaitMs)
                .then(() => {
                    return clientInternals.createMessagesRequest(
                        room.roomId,
                        room.oldState.paginationToken,
                        limit,
                        Direction.Backward,
                    );
                })
                .then((res: IMessagesResponse) => {
                    const { matrixEvents, stateEvents } = mapStateAndChunkFromMessages(
                        res,
                        noUnsafeEventProps,
                        clientInternals.getEventMapper(),
                    );
                    if (stateEvents.length > 0) {
                        room.currentState.setUnknownStateEvents(stateEvents);
                    }

                    const [timelineEvents, threadedEvents, unknownRelations] =
                        room.partitionThreadedEvents(matrixEvents);

                    clientInternals.processAggregatedTimelineEvents(room, timelineEvents);
                    room.addEventsToTimeline(timelineEvents, true, true, room.getLiveTimeline());
                    clientInternals.processThreadEvents(room, threadedEvents, true);
                    unknownRelations.forEach((event) => room.relations.aggregateChildEvent(event));

                    const nextToken = deriveBackPaginationTokenFromMessages(res);
                    room.oldState.paginationToken = nextToken;
                    clientInternals.storeEvents(room, matrixEvents, nextToken, true);
                    delete this.ongoingScrollbacks[room.roomId];
                    resolve(room);
                })
                .catch((err) => {
                    this.ongoingScrollbacks[room.roomId] = {
                        errorTs: Date.now(),
                    };
                    reject(err);
                });
        });

        info = { promise };

        this.ongoingScrollbacks[room.roomId] = info;
        return promise;
    }

    /**
     * Processes a list of threaded events and adds them to their respective timelines
     * @param room - the room the adds the threaded events
     * @param threadedEvents - an array of the threaded events
     * @param toStartOfTimeline - the direction in which we want to add the events
     */
    public processThreadEvents(room: Room, threadedEvents: MatrixEvent[], toStartOfTimeline: boolean): void {
        room.processThreadedEvents(threadedEvents, toStartOfTimeline);
    }

    /**
     * Processes a list of thread roots and creates a thread model
     * @param room - the room to create the threads in
     * @param threadedEvents - an array of thread roots
     * @param toStartOfTimeline - the direction
     * @param supportsThreads - whether threads are supported
     */
    public processThreadRoots(
        room: Room,
        threadedEvents: MatrixEvent[],
        toStartOfTimeline: boolean,
        supportsThreads: boolean,
    ): void {
        if (!supportsThreads) return;
        room.processThreadRoots(threadedEvents, toStartOfTimeline);
    }

    /**
     * Process beacon events
     * @param room - room the events belong to
     * @param events - timeline events to be processed
     */
    public processBeaconEvents(room?: Room, events?: MatrixEvent[]): void {
        this.processAggregatedTimelineEvents(room, events);
    }

    /**
     * Calls aggregation functions for event types that are aggregated
     * Polls and location beacons
     * @param room - room the events belong to
     * @param events - timeline events to be processed
     */
    public processAggregatedTimelineEvents(room?: Room, events?: MatrixEvent[]): void {
        if (!events?.length) return;
        if (!room) return;
        for (const ev of events) {
            room.relations.aggregateChildEvent(ev);
        }
        room.currentState.processBeaconEvents(events, this.client);
    }

    /**
     * Common logic for processing events received from pagination.
     * @internal
     */
    public processPaginationEvents(
        eventTimeline: EventTimeline,
        matrixEvents: MatrixEvent[],
        backwards: boolean,
        token: string | null,
        room?: Room,
        options: {
            partitionThreads?: boolean;
            processThreadRoots?: boolean;
        } = {},
        supportsThreads?: boolean,
    ): void {
        const timelineSet = eventTimeline.getTimelineSet();
        let eventsToProcess = matrixEvents;

        if (options.partitionThreads && room) {
            const [timelineEvents, , unknownRelations] = room.partitionThreadedEvents(matrixEvents);
            eventsToProcess = timelineEvents;
            unknownRelations.forEach((event) => room.relations.aggregateChildEvent(event));
        }

        timelineSet.addEventsToTimeline(eventsToProcess, backwards, false, eventTimeline, token);
        this.processAggregatedTimelineEvents(room, eventsToProcess);

        if (options.processThreadRoots && room) {
            this.processThreadRoots(
                room,
                options.partitionThreads
                    ? eventsToProcess.filter((it) => it.getServerAggregatedRelation(THREAD_RELATION_TYPE.name))
                    : eventsToProcess,
                options.partitionThreads ? false : backwards,
                supportsThreads ?? false,
            );
        }
    }
}

export function extendMatrixClient(): void {
    if (MatrixClient.prototype.hasOwnProperty("getTimelineManager")) return;

    MatrixClient.prototype.getTimelineManager = function (this: MatrixClient): TimelineManager {
        registerManagerClass("timeline", TimelineManager);
        return getOrCreateManager(this, "timeline", () => new TimelineManager(this));
    };
}

export default extendMatrixClient;
