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
 * 
 * 对应后端 API:
 * - GET /_matrix/client/v3/rooms/{room_id}/sticky_events
 * - POST /_matrix/client/v3/rooms/{room_id}/sticky_events
 * - DELETE /_matrix/client/v3/rooms/{room_id}/sticky_events/{event_type}
 * 
 * 优化特性:
 * - LRU 缓存: 粘性事件缓存
 * - 重试机制: 指数退避重试
 * - 监控指标: 请求统计和性能监控
 */

import { logger } from "../logger.ts";
import { TypedEventEmitter } from "../models/typed-event-emitter.ts";
import { Method } from "../http-api/method.ts";
import { ClientPrefix } from "../http-api/prefix.ts";
import { MatrixClient } from "../client";
import { MatrixError } from "../http-api/errors.ts";

export enum StickyEvent {
    StickySet = "StickySet",
    StickyCleared = "StickyCleared",
    StickyUpdated = "StickyUpdated",
    StickyError = "StickyError",
}

export interface IStickyEventData {
    event_id: string;
    event_type: string;
    content: any;
    sender: string;
    ts: number;
}

export interface IStickyEventInfo {
    roomId: string;
    eventId: string;
    eventType: string;
    content: any;
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

interface CacheEntry<T> {
    value: T;
    timestamp: number;
}

class LRUCache<T> {
    private cache = new Map<string, CacheEntry<T>>();
    private readonly maxSize: number;
    private readonly ttl: number;
    private hits = 0;
    private misses = 0;

    constructor(maxSize: number, ttl: number) {
        this.maxSize = maxSize;
        this.ttl = ttl;
    }

    get(key: string): T | undefined {
        const entry = this.cache.get(key);
        if (!entry) {
            this.misses++;
            return undefined;
        }

        if (Date.now() - entry.timestamp > this.ttl) {
            this.cache.delete(key);
            this.misses++;
            return undefined;
        }

        this.hits++;
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.value;
    }

    set(key: string, value: T): void {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
            }
        }

        this.cache.set(key, {
            value,
            timestamp: Date.now(),
        });
    }

    delete(key: string): boolean {
        return this.cache.delete(key);
    }

    clear(): void {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
    }

    size(): number {
        return this.cache.size;
    }

    getStats(): { size: number; hits: number; misses: number; hitRate: number } {
        const total = this.hits + this.misses;
        return {
            size: this.cache.size,
            hits: this.hits,
            misses: this.misses,
            hitRate: total > 0 ? this.hits / total : 0,
        };
    }
}

export class StickyEventManager extends TypedEventEmitter<StickyEvent, StickyEventManagerEventMap> {
    private client: MatrixClient;
    private stickyEventsCache: LRUCache<IStickyEventInfo>;
    private serverEventsCache: LRUCache<IServerStickyEvent[]>;
    private stickyEventType: string = 'm.sticky_event';
    private readonly maxRetries = 3;
    private readonly retryDelay = 1000;

    private requestStats = {
        total: 0,
        successful: 0,
        failed: 0,
        retried: 0,
    };

    constructor(client: MatrixClient) {
        super();
        this.client = client;
        this.stickyEventsCache = new LRUCache<IStickyEventInfo>(100, 5 * 60 * 1000);
        this.serverEventsCache = new LRUCache<IServerStickyEvent[]>(100, 2 * 60 * 1000);
    }

    private isRetryableError(error: unknown): boolean {
        if (error instanceof MatrixError) {
            const retryableCodes = ["M_LIMIT_EXCEEDED", "M_SERVER_UNAVAILABLE"];
            const retryableStatus = [429, 500, 502, 503, 504];
            return (
                retryableCodes.includes(error.errcode ?? "") ||
                retryableStatus.includes(error.httpStatus ?? 0)
            );
        }
        const err = error as Record<string, unknown>;
        if (err?.code === "ECONNRESET" || err?.code === "ETIMEDOUT" || err?.code === "ENOTFOUND") {
            return true;
        }
        const httpStatus = err?.httpStatus as number | undefined;
        if (httpStatus && [429, 500, 502, 503, 504].includes(httpStatus)) {
            return true;
        }
        return false;
    }

    private getErrorType(error: unknown): string {
        if (error instanceof MatrixError) {
            return error.errcode ?? `http_${error.httpStatus}`;
        }
        if (error instanceof Error) {
            return error.name ?? "UnknownError";
        }
        return "UnknownError";
    }

    private async withRetry<T>(
        requestFn: () => Promise<T>,
        method: string,
        retries = this.maxRetries
    ): Promise<T> {
        let lastError: unknown;
        const startTime = Date.now();

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const result = await requestFn();
                this.recordRequest(true, attempt > 0);

                if (attempt > 0) {
                    logger.info(`StickyEventManager.${method} succeeded after ${attempt} retries`, {
                        method,
                        attempts: attempt + 1,
                        duration: Date.now() - startTime,
                    });
                }

                return result;
            } catch (error: unknown) {
                lastError = error;

                if (!this.isRetryableError(error)) {
                    this.recordRequest(false, false);
                    this.emitMetric('api_error', method, {
                        error: this.getErrorType(error),
                        attempt: attempt + 1,
                        retryable: false
                    });
                    throw error;
                }

                if (attempt < retries) {
                    const delay = this.retryDelay * Math.pow(2, attempt);
                    logger.warn(`StickyEventManager.${method} failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms`, {
                        method,
                        attempt: attempt + 1,
                        maxAttempts: retries + 1,
                        delay,
                        error: this.getErrorType(error),
                    });

                    this.emitMetric('api_retry', method, {
                        attempt: attempt + 1,
                        delay,
                        error: this.getErrorType(error)
                    });

                    await this.sleep(delay);
                }
            }
        }

        this.recordRequest(false, true);
        const duration = Date.now() - startTime;
        this.emitMetric('api_failure', method, {
            attempts: retries + 1,
            duration,
            error: this.getErrorType(lastError)
        });

        throw lastError;
    }

    private recordRequest(success: boolean, retried: boolean): void {
        this.requestStats.total++;
        if (success) {
            this.requestStats.successful++;
        } else {
            this.requestStats.failed++;
        }
        if (retried) {
            this.requestStats.retried++;
        }
    }

    private emitMetric(type: string, method: string, data: Record<string, unknown>): void {
        try {
            logger.debug(`Metric: ${type}.${method}`, { type, method, ...data, timestamp: Date.now() });
        } catch {
            // 忽略监控发送错误，不影响主流程
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    public getMetrics(): StickyEventManagerMetrics {
        return {
            cache: this.stickyEventsCache.getStats(),
            requests: { ...this.requestStats },
        };
    }

    async setStickyEvent(roomId: string, eventId: string, content?: any): Promise<void> {
        if (!roomId || !eventId) {
            throw new Error("Room ID and event ID are required");
        }

        try {
            let stickyContent = content;

            if (!stickyContent) {
                const room = this.client.getRoom(roomId);
                if (room) {
                    const event = room.findEventById(eventId);
                    if (event) {
                        stickyContent = {
                            event_id: eventId,
                            event_type: event.getType(),
                            content: event.getContent(),
                            sender: event.getSender(),
                            ts: event.getTs(),
                        };
                    }
                }
            }

            if (!stickyContent) {
                throw new Error("Could not find event content");
            }

            await this.client.sendStateEvent(
                roomId,
                this.stickyEventType as any,
                stickyContent,
                ''
            );

            const stickyInfo: IStickyEventInfo = {
                roomId,
                eventId,
                eventType: stickyContent.event_type || 'm.room.message',
                content: stickyContent.content || stickyContent,
                sender: stickyContent.sender || this.client.getUserId() || '',
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

            const stickyStateEvent = room.currentState.getStateEvents(this.stickyEventType, '');
            if (!stickyStateEvent) {
                return null;
            }

            const content = stickyStateEvent.getContent();
            const stickyInfo: IStickyEventInfo = {
                roomId,
                eventId: content.event_id || '',
                eventType: content.event_type || 'm.room.message',
                content: content.content || content,
                sender: stickyStateEvent.getSender() || '',
                timestamp: content.ts || stickyStateEvent.getTs(),
            };

            this.stickyEventsCache.set(roomId, stickyInfo);
            
            return stickyInfo;
        } catch (e) {
            logger.warn('StickyEventManager.getStickyEvent failed:', e);
            return null;
        }
    }

    async clearStickyEvent(roomId: string): Promise<void> {
        if (!roomId) {
            throw new Error("Room ID is required");
        }

        try {
            await this.client.sendStateEvent(
                roomId,
                this.stickyEventType as any,
                {},
                ''
            );

            this.stickyEventsCache.delete(roomId);
            this.emit(StickyEvent.StickyCleared, roomId);
        } catch (error) {
            this.emit(StickyEvent.StickyError, roomId, error as Error);
            throw error;
        }
    }

    async updateStickyEvent(roomId: string, eventId: string, content?: any): Promise<void> {
        await this.setStickyEvent(roomId, eventId, content);
        const stickyInfo = await this.getStickyEvent(roomId);
        if (stickyInfo) {
            this.emit(StickyEvent.StickyUpdated, roomId, stickyInfo);
        }
    }

    async hasStickyEvent(roomId: string): Promise<boolean> {
        const sticky = await this.getStickyEvent(roomId);
        return sticky !== null && sticky.eventId !== '';
    }

    async getStickyEventContent(roomId: string): Promise<any | null> {
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

    async setAnnouncement(roomId: string, message: string, options?: {
        title?: string;
        priority?: 'low' | 'medium' | 'high';
        expires?: number;
    }): Promise<void> {
        const content = {
            event_id: `announcement_${Date.now()}`,
            event_type: 'm.room.message',
            content: {
                msgtype: 'm.text',
                body: message,
                title: options?.title,
                priority: options?.priority || 'medium',
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

    handleStateEvent(roomId: string, event: any): void {
        if (event.getType() !== this.stickyEventType) {
            return;
        }

        const content = event.getContent();
        
        if (!content || Object.keys(content).length === 0) {
            this.stickyEventsCache.delete(roomId);
            this.emit(StickyEvent.StickyCleared, roomId);
        } else {
            const stickyInfo: IStickyEventInfo = {
                roomId,
                eventId: content.event_id || '',
                eventType: content.event_type || 'm.room.message',
                content: content.content || content,
                sender: event.getSender() || '',
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

        const cacheKey = `${roomId}:${eventType || 'all'}`;
        const cached = this.serverEventsCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        return this.withRetry(async () => {
            const query = eventType ? { event_type: eventType } : undefined;
            const response = await this.client.http.authedRequest(
                Method.Get,
                `/rooms/${encodeURIComponent(roomId)}/sticky_events`,
                query,
                undefined,
                { prefix: ClientPrefix.V3 }
            ) as IServerStickyEventsResponse;

            const events = response.events || [];
            this.serverEventsCache.set(cacheKey, events);
            return events;
        }, 'getStickyEventsFromServer');
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
                { prefix: ClientPrefix.V3 }
            );

            this.serverEventsCache.delete(`${roomId}:all`);
            this.emit(StickyEvent.StickyUpdated, roomId, {
                roomId,
                eventId: events.events[0].event_id,
                eventType: events.events[0].event_type,
                content: {},
                sender: this.client.getUserId() || '',
                timestamp: Date.now(),
            });
        }, 'setStickyEventsToServer');
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
                { prefix: ClientPrefix.V3 }
            );

            this.stickyEventsCache.delete(roomId);
            this.serverEventsCache.delete(`${roomId}:all`);
            this.serverEventsCache.delete(`${roomId}:${eventType}`);
            this.emit(StickyEvent.StickyCleared, roomId);
        }, 'clearStickyEventFromServer');
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
        } catch (error) {
            logger.warn('StickyEventManager.getStickyEventWithFallback: server API failed, falling back to state event');
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
