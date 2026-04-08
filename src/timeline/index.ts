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
 * 提供时间线相关功能
 */

import { MatrixClient } from "../client";
import { Room } from "../models/room";
import { EventTimeline } from "../models/event-timeline";
import { EventTimelineSet } from "../models/event-timeline-set";

export class TimelineManager {
    constructor(private client: MatrixClient) {}

    public getTimelineForRoom(roomId: string): EventTimelineSet | null {
        const room = this.client.getRoom(roomId);
        return room?.getUnfilteredTimelineSet() || null;
    }

    public getEventTimeline(roomId: string, eventId: string): EventTimeline | null {
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
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getTimelineManager(): TimelineManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getTimelineManager = function (): TimelineManager {
        return new TimelineManager(this);
    };
}

export default extendMatrixClient;
