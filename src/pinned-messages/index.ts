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
 * Pinned Messages Manager - 置顶消息管理
 *
 * 提供置顶消息相关功能
 *
 * 对应后端 API:
 * - GET /rooms/{room_id}/pinned_events
 * - POST /rooms/{room_id}/pinned_events
 * - DELETE /rooms/{room_id}/pinned_events/{event_id}
 *
 * 优化特性:
 * - LRU 缓存: 置顶消息缓存
 * - 继承 BaseManager 支持统一重试与错误处理
 */

import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { MatrixClient } from "../client";
import { LRUCache } from "../utils/lru-cache";
import { BaseManager } from "../managers/base-manager";
import { ValidationError } from "../errors";

export enum PinnedEvent {
    Pinned = "Pinned",
    Unpinned = "Unpinned",
    PinnedUpdated = "PinnedUpdated",
    PinnedError = "PinnedError",
}

export interface IPinnedEventInfo {
    eventId: string;
    roomId: string;
    pinnedBy?: string;
    pinnedAt?: number;
}

export interface IServerPinnedEvent {
    event_id: string;
    pinned_by?: string;
    pinned_at?: number;
}

export interface IServerPinnedEventsResponse {
    events: IServerPinnedEvent[];
}

interface PinnedMessagesManagerEventMap {
    [PinnedEvent.Pinned]: (roomId: string, eventId: string) => void;
    [PinnedEvent.Unpinned]: (roomId: string, eventId: string) => void;
    [PinnedEvent.PinnedUpdated]: (roomId: string, events: IPinnedEventInfo[]) => void;
    [PinnedEvent.PinnedError]: (roomId: string, error: Error) => void;
}

export class PinnedMessagesManager extends BaseManager<PinnedEvent, PinnedMessagesManagerEventMap> {
    private pinnedEventsCache: LRUCache<IPinnedEventInfo[]>;

    constructor(client: MatrixClient) {
        super(client);
        this.pinnedEventsCache = new LRUCache<IPinnedEventInfo[]>({
            maxSize: 100,
            ttl: 5 * 60 * 1000,
            name: "pinned-events-cache",
        });
    }

    public getCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
        return this.pinnedEventsCache.getStats();
    }

    public async pinMessage(roomId: string, eventId: string): Promise<void> {
        const room = this.client.getRoom(roomId);
        let pinned: string[] = [];
        if (room) {
            const pinnedEvent = room.currentState.getStateEvents("m.room.pinned_events", "");
            if (pinnedEvent) {
                const content = pinnedEvent.getContent<{ pinned?: string[] }>();
                pinned = content.pinned || [];
            }
        }
        if (!pinned.includes(eventId)) {
            pinned.push(eventId);
        }
        await this.client.sendStateEvent(roomId, "m.room.pinned_events", { pinned }, "");
    }

    public async unpinMessage(roomId: string, eventId: string): Promise<void> {
        const room = this.client.getRoom(roomId);
        if (!room) return;
        const pinnedEvent = room.currentState.getStateEvents("m.room.pinned_events", "");
        if (!pinnedEvent) return;
        const content = pinnedEvent.getContent<{ pinned?: string[] }>();
        const pinned = (content.pinned || []).filter((id: string) => id !== eventId);
        await this.client.sendStateEvent(roomId, "m.room.pinned_events", { pinned }, "");
    }

    public getPinnedMessages(roomId: string): string[] {
        const room = this.client.getRoom(roomId);
        if (!room) return [];
        const pinnedEvent = room.currentState.getStateEvents("m.room.pinned_events", "");
        if (!pinnedEvent) return [];
        const content = pinnedEvent.getContent<{ pinned?: string[] }>();
        return content.pinned || [];
    }

    public hasPinnedMessages(roomId: string): boolean {
        return this.getPinnedMessages(roomId).length > 0;
    }

    public async getPinnedEventsFromServer(roomId: string): Promise<IPinnedEventInfo[]> {
        if (!roomId) throw new ValidationError("Room ID is required");
        const cached = this.pinnedEventsCache.get(roomId);
        if (cached) return cached;

        return this.withRetry(
            async () => {
                const response = (await this.client.http.authedRequest(
                    Method.Get,
                    `/rooms/${encodeURIComponent(roomId)}/pinned_events`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                )) as IServerPinnedEventsResponse;

                const events: IPinnedEventInfo[] = (response.events || []).map((e) => ({
                    eventId: e.event_id,
                    roomId,
                    pinnedBy: e.pinned_by,
                    pinnedAt: e.pinned_at,
                }));
                this.pinnedEventsCache.set(roomId, events);
                this.emit(PinnedEvent.PinnedUpdated, roomId, events);
                return events;
            },
            { label: "getPinnedEventsFromServer", idempotent: true },
        );
    }

    public async pinEventToServer(roomId: string, eventId: string): Promise<void> {
        if (!roomId) throw new ValidationError("Room ID is required");
        if (!eventId) throw new ValidationError("Event ID is required");

        return this.withRetry(
            async () => {
                await this.client.http.authedRequest(
                    Method.Post,
                    `/rooms/${encodeURIComponent(roomId)}/pinned_events`,
                    undefined,
                    { event_id: eventId },
                    { prefix: ClientPrefix.V3 },
                );
                this.emit(PinnedEvent.Pinned, roomId, eventId);
                const cached = this.pinnedEventsCache.get(roomId) || [];
                cached.push({ eventId, roomId, pinnedBy: this.client.getUserId() || undefined, pinnedAt: Date.now() });
                this.pinnedEventsCache.set(roomId, cached);
            },
            { label: "pinEventToServer", idempotent: false },
        );
    }

    public async unpinEventFromServer(roomId: string, eventId: string): Promise<void> {
        if (!roomId) throw new ValidationError("Room ID is required");
        if (!eventId) throw new ValidationError("Event ID is required");

        return this.withRetry(
            async () => {
                await this.client.http.authedRequest(
                    Method.Delete,
                    `/rooms/${encodeURIComponent(roomId)}/pinned_events/${encodeURIComponent(eventId)}`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
                this.emit(PinnedEvent.Unpinned, roomId, eventId);
                const cached = this.pinnedEventsCache.get(roomId) || [];
                this.pinnedEventsCache.set(
                    roomId,
                    cached.filter((e) => e.eventId !== eventId),
                );
            },
            { label: "unpinEventFromServer", idempotent: false },
        );
    }

    public getCachedPinnedEvents(roomId: string): IPinnedEventInfo[] {
        return this.pinnedEventsCache.get(roomId) || [];
    }

    public clearCache(): void {
        this.pinnedEventsCache.clear();
    }
    public stop(): void {
        this.pinnedEventsCache.clear();
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getPinnedMessagesManager(): PinnedMessagesManager;
    }
}

export function extendMatrixClient(): void {
    const { getOrCreateManager } = require("../client-infra/manager-registry.ts");
    MatrixClient.prototype.getPinnedMessagesManager = function (): PinnedMessagesManager {
        return getOrCreateManager(this, "pinnedMessages", PinnedMessagesManager);
    };
}

export default extendMatrixClient;
