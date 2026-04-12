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
 * Sticky Event Manager - 粘性事件管理 (MSC4354)
 *
 * 提供粘性事件的设置、获取、清除功能
 * 粘性事件是一种在房间中持久显示的事件，如公告、置顶消息等
 */

import { logger } from "../logger.ts";
import { Method } from "../http-api/method.ts";
import { ClientPrefix } from "../http-api/prefix.ts";
import { MatrixClient } from "../client";
import { MatrixEvent } from "../models/event.ts";
import { EventType } from "../@types/event.ts";
import { BaseManager } from "../managers/base-manager";
import { LRUCache } from "../utils/lru-cache.ts";

export enum StickyEvent {
    StickySet = "StickySet",
    StickyCleared = "StickyCleared",
    StickyUpdated = "StickyUpdated",
    StickyError = "StickyError",
}

export interface IStickyEventData {
    event_id: string;
    event_type: string;
    content: Record<string, unknown>;
    sender: string;
    ts: number;
}

export interface IStickyEventInfo {
    roomId: string;
    eventId: string;
    eventType: string;
    content: Record<string, unknown>;
    sender: string;
    timestamp: number;
}

export interface IServerStickyEvent {
    room_id: string;
    user_id: string;
    event_id: string;
    event_type: string;
}

export interface IServerStickyEventsResponse {
    events: IServerStickyEvent[];
}

export interface ISetStickyEventsRequest {
    events: Array<{
        event_type: string;
        event_id: string;
    }>;
}

export interface StickyEventManagerMetrics {
    cache: {
        size: number;
        hits: number;
        misses: number;
        hitRate: number;
    };
    requests: {
        total: number;
        successful: number;
        failed: number;
        retried: number;
    };
}

interface StickyEventManagerEventMap {
    [StickyEvent.StickySet]: (roomId: string, stickyInfo: IStickyEventInfo) => void;
    [StickyEvent.StickyCleared]: (roomId: string) => void;
    [StickyEvent.StickyUpdated]: (roomId: string, stickyInfo: IStickyEventInfo) => void;
    [StickyEvent.StickyError]: (roomId: string, error: Error) => void;
}
export class StickyEventManager extends BaseManager<StickyEvent, StickyEventManagerEventMap> {
    private stickyEventsCache: LRUCache<IStickyEventInfo>;
    private serverEventsCache: LRUCache<IServerStickyEvent[]>;
    private stickyEventType: string = "m.sticky_event";

    private stickyRequestStats = {
        total: 0,
        successful: 0,
        failed: 0,
        retried: 0,
    };

    constructor(client: MatrixClient) {
        super(client);
        this.stickyEventsCache = new LRUCache<IStickyEventInfo>({
            maxSize: 100,
            ttl: 5 * 60 * 1000,
            name: "index.ts-istickyeventinfo",
        });
        this.serverEventsCache = new LRUCache<IServerStickyEvent[]>({
            maxSize: 100,
            ttl: 2 * 60 * 1000,
            name: "index.ts-iserverstickyevent",
        });
    }

    public getMetrics(): StickyEventManagerMetrics {
        return {
            cache: this.stickyEventsCache.getStats(),
            requests: { ...this.stickyRequestStats },
        };
    }

    async setStickyEvent(roomId: string, eventId: string, content?: Record<string, unknown>): Promise<void> {
        if (!roomId || !eventId) {
            throw new Error("Room ID and event ID are required");
        }

        try {
            let stickyContent: IStickyEventData | undefined = content as IStickyEventData | undefined;

            if (!stickyContent) {
                const room = this.client.getRoom(roomId);
                if (room) {
                    const event = room.findEventById(eventId);
                    if (event) {
                        stickyContent = {
                            event_id: eventId,
                            event_type: event.getType(),
                            content: event.getContent<Record<string, unknown>>(),
                            sender: event.getSender() ?? "",
                            ts: event.getTs(),
                        };
                    }
                }
            }

            if (!stickyContent) {
                throw new Error("Could not find event content");
            }

            await this.client.sendStateEvent(roomId, this.stickyEventType as EventType, stickyContent, "");

            const stickyInfo: IStickyEventInfo = {
                roomId,
                eventId,
                eventType: stickyContent.event_type || "m.room.message",
                content: stickyContent.content || stickyContent,
                sender: stickyContent.sender || this.client.getUserId() || "",
                timestamp: stickyContent.ts || Date.now(),
            };

            this.stickyEventsCache.set(roomId, stickyInfo);
            this.emit(StickyEvent.StickySet, roomId, stickyInfo);
        } catch (error) {
            this.emit(StickyEvent.StickyError, roomId, error as Error);
            throw error;
        }
    }

    async getStickyEvent(roomId: string): Promise<IStickyEventInfo | null> {
        if (!roomId) {
            throw new Error("Room ID is required");
        }

        const cached = this.stickyEventsCache.get(roomId);
        if (cached) {
            return cached;
        }

        try {
            const room = this.client.getRoom(roomId);
            if (!room) {
                return null;
            }

            const stickyStateEvent = room.currentState.getStateEvents(this.stickyEventType, "");
            if (!stickyStateEvent) {
                return null;
            }

            const content = stickyStateEvent.getContent();
            const stickyInfo: IStickyEventInfo = {
                roomId,
                eventId: content.event_id || "",
                eventType: content.event_type || "m.room.message",
                content: content.content || content,
                sender: stickyStateEvent.getSender() || "",
                timestamp: content.ts || stickyStateEvent.getTs(),
            };

            this.stickyEventsCache.set(roomId, stickyInfo);

            return stickyInfo;
            // @swallow-error { owner: "sticky-event", expires: "2026-12-31" }
        } catch (e) {
            logger.warn("StickyEventManager.getStickyEvent failed:", e);
            return null;
        }
    }

    async clearStickyEvent(roomId: string): Promise<void> {
        if (!roomId) {
            throw new Error("Room ID is required");
        }

        try {
            await this.client.sendStateEvent(roomId, this.stickyEventType as EventType, {}, "");

            this.stickyEventsCache.delete(roomId);
            this.emit(StickyEvent.StickyCleared, roomId);
        } catch (error) {
            this.emit(StickyEvent.StickyError, roomId, error as Error);
            throw error;
        }
    }

    async updateStickyEvent(roomId: string, eventId: string, content?: Record<string, unknown>): Promise<void> {
        await this.setStickyEvent(roomId, eventId, content);
        const stickyInfo = await this.getStickyEvent(roomId);
        if (stickyInfo) {
            this.emit(StickyEvent.StickyUpdated, roomId, stickyInfo);
        }
    }

    async hasStickyEvent(roomId: string): Promise<boolean> {
        const sticky = await this.getStickyEvent(roomId);
        return sticky !== null && sticky.eventId !== "";
    }

    async getStickyEventContent(roomId: string): Promise<Record<string, unknown> | null> {
        const stickyInfo = await this.getStickyEvent(roomId);
        return stickyInfo?.content || null;
    }

    async getStickyEventSender(roomId: string): Promise<string | null> {
        const stickyInfo = await this.getStickyEvent(roomId);
        return stickyInfo?.sender || null;
    }

    async getStickyEventTimestamp(roomId: string): Promise<number | null> {
        const stickyInfo = await this.getStickyEvent(roomId);
        return stickyInfo?.timestamp || null;
    }

    async pinMessage(roomId: string, eventId: string): Promise<void> {
        await this.setStickyEvent(roomId, eventId);
    }

    async unpinMessage(roomId: string): Promise<void> {
        await this.clearStickyEvent(roomId);
    }

    async getPinnedMessage(roomId: string): Promise<IStickyEventInfo | null> {
        return this.getStickyEvent(roomId);
    }

    async setAnnouncement(
        roomId: string,
        message: string,
        options?: {
            title?: string;
            priority?: "low" | "medium" | "high";
            expires?: number;
        },
    ): Promise<void> {
        const content = {
            event_id: `announcement_${Date.now()}`,
            event_type: "m.room.message",
            content: {
                msgtype: "m.text",
                body: message,
                title: options?.title,
                priority: options?.priority || "medium",
            },
            sender: this.client.getUserId(),
            ts: Date.now(),
            expires: options?.expires,
        };

        await this.setStickyEvent(roomId, content.event_id, content);
    }

    async setPollAsSticky(roomId: string, pollEventId: string): Promise<void> {
        await this.setStickyEvent(roomId, pollEventId);
    }

    async getActiveStickyRooms(): Promise<string[]> {
        return [];
    }

    async getStickyEventsForRooms(roomIds: string[]): Promise<Map<string, IStickyEventInfo>> {
        const result = new Map<string, IStickyEventInfo>();

        for (const roomId of roomIds) {
            const sticky = await this.getStickyEvent(roomId);
            if (sticky) {
                result.set(roomId, sticky);
            }
        }

        return result;
    }

    handleStateEvent(roomId: string, event: MatrixEvent): void {
        if (event.getType() !== this.stickyEventType) {
            return;
        }

        const content = event.getContent<IStickyEventData>();

        if (!content || Object.keys(content).length === 0) {
            this.stickyEventsCache.delete(roomId);
            this.emit(StickyEvent.StickyCleared, roomId);
        } else {
            const stickyInfo: IStickyEventInfo = {
                roomId,
                eventId: content.event_id || "",
                eventType: content.event_type || "m.room.message",
                content: content.content || content,
                sender: event.getSender() || "",
                timestamp: content.ts || event.getTs(),
            };

            this.stickyEventsCache.set(roomId, stickyInfo);
            this.emit(StickyEvent.StickyUpdated, roomId, stickyInfo);
        }
    }

    getCachedStickyEvent(roomId: string): IStickyEventInfo | null {
        return this.stickyEventsCache.get(roomId) || null;
    }

    clearCache(): void {
        this.stickyEventsCache.clear();
        this.serverEventsCache.clear();
    }

    async start(): Promise<void> {
        const rooms = this.client.getRooms?.() || [];
        for (const room of rooms) {
            try {
                await this.getStickyEvent(room.roomId);
            } catch (e) {
                logger.warn(`Failed to load sticky event for room ${room.roomId}:`, e);
            }
        }
    }

    stop(): void {
        this.stickyEventsCache.clear();
        this.serverEventsCache.clear();
    }

    public async getStickyEventsFromServer(roomId: string, eventType?: string): Promise<IServerStickyEvent[]> {
        if (!roomId) {
            throw new Error("Room ID is required");
        }

        const cacheKey = `${roomId}:${eventType || "all"}`;
        const cached = this.serverEventsCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        return this.withRetry(async () => {
            const query = eventType ? { event_type: eventType } : undefined;
            const response = (await this.client.http.authedRequest(
                Method.Get,
                `/rooms/${encodeURIComponent(roomId)}/sticky_events`,
                query,
                undefined,
                { prefix: ClientPrefix.V3 },
            )) as IServerStickyEventsResponse;

            const events = response.events || [];
            this.serverEventsCache.set(cacheKey, events);
            return events;
        }, "getStickyEventsFromServer");
    }

    public async setStickyEventsToServer(roomId: string, events: ISetStickyEventsRequest): Promise<void> {
        if (!roomId) {
            throw new Error("Room ID is required");
        }

        if (!events || !events.events || events.events.length === 0) {
            throw new Error("Events array is required");
        }

        return this.withRetry(async () => {
            await this.client.http.authedRequest(
                Method.Post,
                `/rooms/${encodeURIComponent(roomId)}/sticky_events`,
                undefined,
                events,
                { prefix: ClientPrefix.V3 },
            );

            this.serverEventsCache.delete(`${roomId}:all`);
            this.emit(StickyEvent.StickyUpdated, roomId, {
                roomId,
                eventId: events.events[0].event_id,
                eventType: events.events[0].event_type,
                content: {},
                sender: this.client.getUserId() || "",
                timestamp: Date.now(),
            });
        }, "setStickyEventsToServer");
    }

    public async clearStickyEventFromServer(roomId: string, eventType: string): Promise<void> {
        if (!roomId) {
            throw new Error("Room ID is required");
        }

        if (!eventType) {
            throw new Error("Event type is required");
        }

        return this.withRetry(async () => {
            await this.client.http.authedRequest(
                Method.Delete,
                `/rooms/${encodeURIComponent(roomId)}/sticky_events/${encodeURIComponent(eventType)}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );

            this.stickyEventsCache.delete(roomId);
            this.serverEventsCache.delete(`${roomId}:all`);
            this.serverEventsCache.delete(`${roomId}:${eventType}`);
            this.emit(StickyEvent.StickyCleared, roomId);
        }, "clearStickyEventFromServer");
    }

    public async getStickyEventWithFallback(roomId: string): Promise<IStickyEventInfo | null> {
        try {
            const serverEvents = await this.getStickyEventsFromServer(roomId);
            if (serverEvents && serverEvents.length > 0) {
                const event = serverEvents[0];
                const stickyInfo: IStickyEventInfo = {
                    roomId: event.room_id,
                    eventId: event.event_id,
                    eventType: event.event_type,
                    content: {},
                    sender: event.user_id,
                    timestamp: Date.now(),
                };
                this.stickyEventsCache.set(roomId, stickyInfo);
                return stickyInfo;
            }
        } catch {
            logger.warn(
                "StickyEventManager.getStickyEventWithFallback: server API failed, falling back to state event",
            );
        }

        return this.getStickyEvent(roomId);
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getStickyEventManager(): StickyEventManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getStickyEventManager = function (): StickyEventManager {
        return new StickyEventManager(this);
    };
}

export default extendMatrixClient;
