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
 * Ephemeral Manager - 临时事件管理
 * 
 * 提供临时事件(如输入状态、已读标记等)相关功能
 * 
 * 对应后端 API:
 * - GET /_matrix/client/v3/rooms/{room_id}/ephemeral
 * 
 * 优化特性:
 * - LRU 缓存: 临时事件缓存
 * - 重试机制: 指数退避重试
 * - 监控指标: 请求统计和性能监控
 */

import { logger } from "../logger.ts";
import { TypedEventEmitter } from "../models/typed-event-emitter.ts";
import { Method } from "../http-api/method.ts";
import { ClientPrefix } from "../http-api/prefix.ts";
import { MatrixClient } from "../client";
import { MatrixError } from "../http-api/errors.ts";

export enum EphemeralEvent {
    EphemeralReceived = "EphemeralReceived",
    EphemeralCleared = "EphemeralCleared",
    EphemeralError = "EphemeralError",
}

export interface IEphemeralEventData {
    type: string;
    sender: string;
    content: any;
}

export interface IEphemeralEventInfo {
    roomId: string;
    type: string;
    sender: string;
    content: any;
    timestamp: number;
}

export interface IServerEphemeralEvent {
    type: string;
    sender: string;
    content: any;
}

export interface IServerEphemeralEventsResponse {
    chunk: IServerEphemeralEvent[];
    start?: string;
    end?: string;
}

export interface EphemeralManagerMetrics {
    cache: { size: number; hits: number; misses: number; hitRate: number };
    requests: { total: number; successful: number; failed: number; retried: number };
}

interface EphemeralManagerEventMap {
    [EphemeralEvent.EphemeralReceived]: (roomId: string, events: IEphemeralEventInfo[]) => void;
    [EphemeralEvent.EphemeralCleared]: (roomId: string) => void;
    [EphemeralEvent.EphemeralError]: (roomId: string, error: Error) => void;
}

interface CacheEntry<T> { value: T; timestamp: number; }

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
        if (!entry) { this.misses++; return undefined; }
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
        if (this.cache.has(key)) { this.cache.delete(key); }
        else if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) this.cache.delete(firstKey);
        }
        this.cache.set(key, { value, timestamp: Date.now() });
    }

    delete(key: string): boolean { return this.cache.delete(key); }
    clear(): void { this.cache.clear(); this.hits = 0; this.misses = 0; }
    size(): number { return this.cache.size; }
    getStats(): { size: number; hits: number; misses: number; hitRate: number } {
        const total = this.hits + this.misses;
        return { size: this.cache.size, hits: this.hits, misses: this.misses, hitRate: total > 0 ? this.hits / total : 0 };
    }
}

export class EphemeralManager extends TypedEventEmitter<EphemeralEvent, EphemeralManagerEventMap> {
    private client: MatrixClient;
    private ephemeralEventsCache: LRUCache<IEphemeralEventInfo[]>;
    private defaultLimit = 100;
    private readonly maxRetries = 3;
    private readonly retryDelay = 1000;
    private requestStats = { total: 0, successful: 0, failed: 0, retried: 0 };

    constructor(client: MatrixClient) {
        super();
        this.client = client;
        this.ephemeralEventsCache = new LRUCache<IEphemeralEventInfo[]>(100, 60 * 1000);
    }

    private isRetryableError(error: unknown): boolean {
        if (error instanceof MatrixError) {
            return ["M_LIMIT_EXCEEDED", "M_SERVER_UNAVAILABLE"].includes(error.errcode ?? "") ||
                [429, 500, 502, 503, 504].includes(error.httpStatus ?? 0);
        }
        const err = error as Record<string, unknown>;
        return ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND"].includes(err?.code as string) ||
            [429, 500, 502, 503, 504].includes(err?.httpStatus as number);
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
                    logger.warn(`EphemeralManager.${method} failed, retrying in ${delay}ms`);
                    await new Promise(r => setTimeout(r, delay));
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

    public getMetrics(): EphemeralManagerMetrics {
        return { cache: this.ephemeralEventsCache.getStats(), requests: { ...this.requestStats } };
    }

    public async sendEphemeralEvent(roomId: string, type: string, content: any): Promise<any> {
        return (this.client as any).sendEphemeralEvent(roomId, type, content);
    }

    public getEphemeralEvents(roomId: string): any[] {
        return (this.client as any).getEphemeralEvents(roomId);
    }

    public hasEphemeralEvents(roomId: string): boolean {
        return (this.client as any).hasEphemeralEvents(roomId);
    }

    public clearEphemeralEvents(roomId: string): void {
        (this.client as any).clearEphemeralEvents(roomId);
        this.ephemeralEventsCache.delete(roomId);
        this.emit(EphemeralEvent.EphemeralCleared, roomId);
    }

    public async getEphemeralEventsFromServer(roomId: string, limit?: number): Promise<IEphemeralEventInfo[]> {
        if (!roomId) throw new Error("Room ID is required");
        const cached = this.ephemeralEventsCache.get(roomId);
        if (cached) return cached;

        return this.withRetry(async () => {
            const response = await this.client.http.authedRequest(
                Method.Get, `/rooms/${encodeURIComponent(roomId)}/ephemeral`,
                { limit: limit ?? this.defaultLimit }, undefined, { prefix: ClientPrefix.V3 }
            ) as IServerEphemeralEventsResponse;

            const events: IEphemeralEventInfo[] = (response.chunk || []).map(e => ({
                roomId, type: e.type, sender: e.sender, content: e.content, timestamp: Date.now()
            }));
            this.ephemeralEventsCache.set(roomId, events);
            this.emit(EphemeralEvent.EphemeralReceived, roomId, events);
            return events;
        }, 'getEphemeralEventsFromServer');
    }

    public async getTypingEvents(roomId: string): Promise<string[]> {
        try {
            const events = await this.getEphemeralEventsFromServer(roomId);
            const typingEvent = events.find(e => e.type === "m.typing");
            return typingEvent?.content?.user_ids || [];
        } catch { return []; }
    }

    public async getReceiptEvents(roomId: string): Promise<Map<string, string>> {
        const receipts = new Map<string, string>();
        try {
            const events = await this.getEphemeralEventsFromServer(roomId);
            const receiptEvent = events.find(e => e.type === "m.receipt");
            if (receiptEvent?.content) {
                for (const [eventId, data] of Object.entries(receiptEvent.content)) {
                    const readData = (data as any)?.["m.read"];
                    if (readData) for (const userId of Object.keys(readData)) receipts.set(userId, eventId);
                }
            }
        } catch { /* ignore */ }
        return receipts;
    }

    public getCachedEphemeralEvents(roomId: string): IEphemeralEventInfo[] {
        return this.ephemeralEventsCache.get(roomId) || [];
    }

    public clearCache(): void { this.ephemeralEventsCache.clear(); }
    public setDefaultLimit(limit: number): void { if (limit > 0) this.defaultLimit = limit; }
    public getDefaultLimit(): number { return this.defaultLimit; }
    public stop(): void { this.ephemeralEventsCache.clear(); }
}

declare module "../client.ts" {
    interface MatrixClient { getEphemeralManager(): EphemeralManager; }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getEphemeralManager = function (): EphemeralManager { return new EphemeralManager(this); };
}

export default extendMatrixClient;
