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
import { MatrixEvent, type IEvent } from "../models/event";
import { type IEphemeralEventData } from "../ephemeral/index";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export interface IRoomEventResponse {
    event_id: string;
}

export interface IMessagesResponse {
    start: string;
    end?: string;
    chunk: IEvent[];
    state?: IEvent[];
}

export interface RoomEventsManagerEvents {
    event_fetched: { roomId: string; eventId: string };
    messages_fetched: { roomId: string; count: number };
    reaction_sent: { roomId: string; eventId: string; key: string };
}

export class RoomEventsManager extends BaseManager<keyof RoomEventsManagerEvents, RoomEventsManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public async getRoomEvents(roomId: string, limit?: number): Promise<MatrixEvent[]> {
        return this.withRetry(
            () => this.client.getRoomEvents(roomId, limit),
            "getRoomEvents",
        );
    }

    public async getStateEventsForRoom(roomId: string): Promise<MatrixEvent[]> {
        return this.withRetry(
            () => this.client.getStateEventsForRoom(roomId),
            "getStateEventsForRoom",
        );
    }

    public getTimelineEvents(roomId: string): MatrixEvent[] {
        return this.client.getTimelineEvents(roomId);
    }

    public getEphemeralEvents(roomId: string): IEphemeralEventData[] {
        return this.client.getEphemeralEvents(roomId);
    }

    public hasTimelineEvent(roomId: string, eventId: string): boolean {
        return this.client.hasTimelineEvent(roomId, eventId);
    }

    public findEventById(roomId: string, eventId: string): MatrixEvent | null {
        return this.client.findEventById(roomId, eventId);
    }

    public async getEvent(roomId: string, eventId: string): Promise<IEvent> {
        return this.withRetry(async () => {
            const path = utils.encodeUri("/rooms/$roomId/event/$eventId", {
                $roomId: roomId,
                $eventId: eventId,
            });
            return this.request<IEvent>({
                method: Method.Get,
                path: path,
            });
        }, "getEvent");
    }

    public async getMessages(
        roomId: string,
        direction: string,
        limit: number,
        from?: string,
    ): Promise<IMessagesResponse> {
        return this.withRetry(async () => {
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
            return this.request<IMessagesResponse>({
                method: Method.Get,
                path: path,
                queryParams: params,
            });
        }, "getMessages");
    }

    public async sendReaction(roomId: string, eventId: string, key: string): Promise<IRoomEventResponse> {
        return this.withRetry(async () => {
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
            return this.request<IRoomEventResponse>({
                method: Method.Put,
                path: reactionPath,
                body: content,
            });
        }, "sendReaction");
    }
}


export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomEventsManager = function (): RoomEventsManager {
        registerManagerClass("roomEvents", RoomEventsManager);
    return getOrCreateManager(this, "roomEvents", () => new RoomEventsManager(this));
    };
}

export default extendMatrixClient;
