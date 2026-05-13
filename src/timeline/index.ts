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
import { MatrixEvent } from "../models/event";
import { THREAD_RELATION_TYPE } from "../models/thread";
import { BaseManager } from "../managers/base-manager";
import type { IContextResponse } from "../@types/requests";
import { getOrCreateManager } from "../client-infra/manager-registry";

export interface TimelineManagerEvents {
    timelineFetched: (data: { roomId: string; eventId: string }) => void;
    timelinePaginated: (data: { roomId: string; direction: Direction }) => void;
}

type ClientInternals = {
    timelineSupport: boolean;
    supportsThreads(): boolean;
    getEventContext(roomId: string, eventId: string): Promise<IContextResponse>;
    getEventMapper(): (e: unknown) => MatrixEvent;
    logger: { warn(msg: string): void };
    processAggregatedTimelineEvents(room?: unknown, events?: unknown[]): void;
    processThreadEvents(room: Room, events: MatrixEvent[], shouldAggregate: boolean): void;
};

export class TimelineManager extends BaseManager<keyof TimelineManagerEvents, TimelineManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
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
        const clientInternals = this.client as unknown as { stopPeeking?: () => void };
        clientInternals.stopPeeking?.();
    }

    public async getEventTimeline(timelineSet: EventTimelineSet, eventId: string): Promise<EventTimeline | null> {
        const clientInternals = this.client as unknown as ClientInternals & {
            getThreadTimeline(timelineSet: EventTimelineSet, eventId: string): Promise<EventTimeline | undefined>;
        };

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

        const res = await clientInternals.getEventContext(timelineSet.room.roomId, eventId);

        if (timelineSet.getTimelineForEvent(eventId)) {
            return timelineSet.getTimelineForEvent(eventId);
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
}

declare module "../client.ts" {
    interface MatrixClient {
        getTimelineManager(): TimelineManager;
    }
}

export function extendMatrixClient(): void {
    if (MatrixClient.prototype.hasOwnProperty("getTimelineManager")) return;

    MatrixClient.prototype.getTimelineManager = function (this: MatrixClient): TimelineManager {
        return getOrCreateManager(this, "timeline", () => new TimelineManager(this));
    };
}

export default extendMatrixClient;
