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
 * - 重试机制: 指数退避重试
 * - 监控指标: 请求统计和性能监控
 */

import { logger } from "../logger.ts";
import { TypedEventEmitter } from "../models/typed-event-emitter.ts";
import { Method } from "../http-api/method.ts";
import { ClientPrefix } from "../http-api/prefix.ts";
import { MatrixClient } from "../client";
import { MatrixError } from "../http-api/errors.ts";
import { LRUCache } from "../utils/lru-cache.ts";

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

export interface PinnedMessagesManagerMetrics {
    cache: { size: number; hits: number; misses: number; hitRate: number };
    requests: { total: number; successful: number; failed: number; retried: number };
}

interface PinnedMessagesManagerEventMap {
    [PinnedEvent.Pinned]: (roomId: string, eventId: string) => void;
    [PinnedEvent.Unpinned]: (roomId: string, eventId: string) => void;
    [PinnedEvent.PinnedUpdated]: (roomId: string, events: IPinnedEventInfo[]) => void;
    [PinnedEvent.PinnedError]: (roomId: string, error: Error) => void;
}
export class PinnedMessagesManager extends TypedEventEmitter<PinnedEvent, PinnedMessagesManagerEventMap> {
    private client: MatrixClient;
    private pinnedEventsCache: LRUCache<IPinnedEventInfo[]>;
    private readonly maxRetries = 3;
    private readonly retryDelay = 1000;
    private requestStats = { total: 0, successful: 0, failed: 0, retried: 0 };

    constructor(client: MatrixClient) {
        super();
        this.client = client;
        this.pinnedEventsCache = new LRUCache<IPinnedEventInfo[]>({
            maxSize: 100,
            ttl: 5 * 60 * 1000,
            name: "index.ts-ipinnedeventinfo",
        });
    }

    private isRetryableError(error: unknown): boolean {
        if (error instanceof MatrixError) {
            return (
                ["M_LIMIT_EXCEEDED", "M_SERVER_UNAVAILABLE"].includes(error.errcode ?? "") ||
                [429, 500, 502, 503, 504].includes(error.httpStatus ?? 0)
            );
        }
        const err = error as Record<string, unknown>;
        return (
            ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND"].includes(err?.code as string) ||
            [429, 500, 502, 503, 504].includes(err?.httpStatus as number)
        );
    }

    private getErrorType(error: unknown): string {
        if (error instanceof MatrixError) return error.errcode ?? `http_${error.httpStatus}`;
        if (error instanceof Error) return error.name ?? "UnknownError";
        return "UnknownError";
    }

    private async withRetry<T>(requestFn: () => Promise<T>, method: string, retries = this.maxRetries): Promise<T> {
        let lastError: unknown;
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const result = await requestFn();
                this.recordRequest(true, attempt > 0);
                return result;
            } catch (error: unknown) {
                lastError = error;
                if (!this.isRetryableError(error)) {
                    this.recordRequest(false, false);
                    throw error;
                }
                if (attempt < retries) {
                    const delay = this.retryDelay * Math.pow(2, attempt);
                    logger.warn(`PinnedMessagesManager.${method} failed, retrying in ${delay}ms`);
                    await new Promise((r) => setTimeout(r, delay));
                }
            }
        }
        this.recordRequest(false, true);
        throw lastError;
    }

    private recordRequest(success: boolean, retried: boolean): void {
        this.requestStats.total++;
        if (success) this.requestStats.successful++;
        else this.requestStats.failed++;
        if (retried) this.requestStats.retried++;
    }

    public getMetrics(): PinnedMessagesManagerMetrics {
        return { cache: this.pinnedEventsCache.getStats(), requests: { ...this.requestStats } };
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
        if (!roomId) throw new Error("Room ID is required");
        const cached = this.pinnedEventsCache.get(roomId);
        if (cached) return cached;

        return this.withRetry(async () => {
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
        }, "getPinnedEventsFromServer");
    }

    public async pinEventToServer(roomId: string, eventId: string): Promise<void> {
        if (!roomId) throw new Error("Room ID is required");
        if (!eventId) throw new Error("Event ID is required");

        return this.withRetry(async () => {
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
        }, "pinEventToServer");
    }

    public async unpinEventFromServer(roomId: string, eventId: string): Promise<void> {
        if (!roomId) throw new Error("Room ID is required");
        if (!eventId) throw new Error("Event ID is required");

        return this.withRetry(async () => {
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
        }, "unpinEventFromServer");
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
    MatrixClient.prototype.getPinnedMessagesManager = function (): PinnedMessagesManager {
        return new PinnedMessagesManager(this);
    };
}

export default extendMatrixClient;
