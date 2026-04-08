/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You May obtain a copy of the License at

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
import { MatrixEvent } from "../models/event";

export interface IRoomEventResponse {
    event_id: string;
}

export interface IMessagesResponse {
    start: string;
    end?: string;
    chunk: Array<Record<string, unknown>>;
    state?: Array<Record<string, unknown>>;
}

export class RoomEventsManager {
    constructor(private client: MatrixClient) {}

    public async getRoomEvents(roomId: string, limit?: number): Promise<MatrixEvent[]> {
        return (this.client as unknown as {
            getRoomEvents: (roomId: string, limit?: number) => Promise<MatrixEvent[]>;
        }).getRoomEvents(roomId, limit);
    }

    public async getStateEventsForRoom(roomId: string): Promise<MatrixEvent[]> {
        return (this.client as unknown as {
            getStateEventsForRoom: (roomId: string) => Promise<MatrixEvent[]>;
        }).getStateEventsForRoom(roomId);
    }

    public getTimelineEvents(roomId: string): MatrixEvent[] {
        return (this.client as unknown as {
            getTimelineEvents: (roomId: string) => MatrixEvent[];
        }).getTimelineEvents(roomId);
    }

    public getEphemeralEvents(roomId: string): Array<Record<string, unknown>> {
        return (this.client as unknown as {
            getEphemeralEvents: (roomId: string) => Array<Record<string, unknown>>;
        }).getEphemeralEvents(roomId);
    }

    public hasTimelineEvent(roomId: string, eventId: string): boolean {
        return (this.client as unknown as {
            hasTimelineEvent: (roomId: string, eventId: string) => boolean;
        }).hasTimelineEvent(roomId, eventId);
    }

    public findEventById(roomId: string, eventId: string): MatrixEvent | null {
        return (this.client as unknown as {
            findEventById: (roomId: string, eventId: string) => MatrixEvent | null;
        }).findEventById(roomId, eventId);
    }

    public async getEvent(roomId: string, eventId: string): Promise<Record<string, unknown>> {
        const path = utils.encodeUri("/rooms/$roomId/event/$eventId", {
            $roomId: roomId,
            $eventId: eventId,
        });
        return this.client.http.authedRequest<Record<string, unknown>>(Method.Get, path);
    }

    public async getMessages(roomId: string, direction: string, limit: number, from?: string): Promise<IMessagesResponse> {
        const path = utils.encodeUri("/rooms/$roomId/messages", {
            $roomId: roomId,
        });
        const params: Record<string, string> = {
            dir: direction,
            limit: limit.toString(),
        };
        if (from) {
            params.from = from;
        }
        return this.client.http.authedRequest<IMessagesResponse>(
            Method.Get,
            path,
            params
        );
    }

    public async sendReaction(roomId: string, eventId: string, key: string): Promise<IRoomEventResponse> {
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
        return this.client.http.authedRequest<IRoomEventResponse>(Method.Put, reactionPath, undefined, content);
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
