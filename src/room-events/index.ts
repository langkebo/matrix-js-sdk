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
 * Room Events Manager - 房间事件管理
 * 
 * 提供房间事件相关功能
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/index";
import * as utils from "../utils";

export class RoomEventsManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get room events
     */
    public async getRoomEvents(roomId: string, limit?: number): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getRoomEvents(roomId, limit);
    }

    /**
     * Get state events for room
     */
    public async getStateEventsForRoom(roomId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getStateEventsForRoom(roomId);
    }

    /**
     * Get timeline events
     */
    public getTimelineEvents(roomId: string): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getTimelineEvents(roomId);
    }

    /**
     * Get ephemeral events
     */
    public getEphemeralEvents(roomId: string): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getEphemeralEvents(roomId);
    }

    /**
     * Has timeline event
     */
    public hasTimelineEvent(roomId: string, eventId: string): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).hasTimelineEvent(roomId, eventId);
    }

    /**
     * Find event by id
     */
    public findEventById(roomId: string, eventId: string): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).findEventById(roomId, eventId);
    }

    /**
     * Get a specific event from a room
     * Gets a single event from a room by event ID.
     * @param roomId - The room ID
     * @param eventId - The event ID to get
     * @returns The event object
     */
    public async getEvent(roomId: string, eventId: string): Promise<any> {
        const path = utils.encodeUri("/rooms/$roomId/event/$eventId", {
            $roomId: roomId,
            $eventId: eventId,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Get, path);
    }

    /**
     * Get messages from a room (pagination)
     * Gets a list of message events for a room.
     * @param roomId - The room ID to get messages from
     * @param direction - "b" for backward, "f" for forward
     * @param limit - Maximum number of messages to get
     * @param from - Pagination token from previous request
     * @returns The messages response
     */
    public async getMessages(roomId: string, direction: string, limit: number, from?: string): Promise<any> {
        const path = utils.encodeUri("/rooms/$roomId/messages", {
            $roomId: roomId,
        });
        const params = new URLSearchParams({
            dir: direction,
            limit: limit.toString(),
        });
        if (from) {
            params.set("from", from);
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(
            Method.Get,
            path,
            undefined,
            undefined,
            { params: params.toString() }
        );
    }

    /**
     * Send a reaction to an event
     * Sends a reaction to an event in a room.
     * @param roomId - The room ID
     * @param eventId - The event ID to react to
     * @param key - The reaction key (emoji)
     * @returns The response
     */
    public async sendReaction(roomId: string, eventId: string, key: string): Promise<any> {
        const txnId = "m" + Date.now();
        const reactionPath = utils.encodeUri("/rooms/$roomId/send/m.reaction/$txnId", {
            $roomId: roomId,
            $txnId: txnId,
        });
        const content = {
            "m.relates_to": {
                rel_type: "m.annotation",
                event_id: eventId,
                key: key,
            },
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Put, reactionPath, undefined, content);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getRoomEventsManager(): RoomEventsManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomEventsManager = function (): RoomEventsManager {
        return new RoomEventsManager(this);
    };
}

export default extendMatrixClient;
