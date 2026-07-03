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

import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { MatrixClient } from "../client";
import { type IContent } from "../models/event";
import { LRUCache } from "../utils/lru-cache";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { ValidationError } from "../errors";
import type { EphemeralPathPattern } from "./__generated__/route-table";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

type StripV3<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;

function ep<P extends StripV3<EphemeralPathPattern>>(path: P): P {
    return path;
}

export enum EphemeralEvent {
    EphemeralReceived = "EphemeralReceived",
    EphemeralCleared = "EphemeralCleared",
    EphemeralError = "EphemeralError",
}

export interface IEphemeralEventData {
    type: string;
    sender: string;
    content: IContent;
}

export interface IEphemeralEventInfo {
    roomId: string;
    type: string;
    sender: string;
    content: IContent;
    timestamp: number;
}

export interface IServerEphemeralEvent {
    type: string;
    sender: string;
    content: IContent;
    origin_server_ts?: number;
    stream_id?: number;
    event_id?: string;
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

/**
 * EphemeralManager handles room ephemeral events like typing and receipts.
 * Aligned with synapse-rust /room_keys/ephemeral logic.
 */
export class EphemeralManager extends BaseManager<EphemeralEvent, EphemeralManagerEventMap> {
    private ephemeralEventsCache: LRUCache<IEphemeralEventInfo[]>;
    private defaultLimit = 100;

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
        this.ephemeralEventsCache = new LRUCache<IEphemeralEventInfo[]>({
            maxSize: 100,
            ttl: 60 * 1000,
            name: "ephemeral-events-cache",
        });
    }

    public getMetrics(): EphemeralManagerMetrics {
        return { cache: this.ephemeralEventsCache.getStats(), requests: { ...this.requestStats } };
    }

    public async sendEphemeralEvent(roomId: string, type: string, content: IContent): Promise<void> {
        const userId = this.client.getUserId() ?? "";
        const contentMap = new Map<string, Map<string, IContent>>();
        const roomMap = new Map<string, IContent>();
        roomMap.set(userId, content);
        contentMap.set(roomId, roomMap);
        await this.client.getToDeviceManager().sendToDeviceFromContentMap(type, contentMap);
    }

    public getEphemeralEvents(roomId: string): IEphemeralEventInfo[] {
        const room = this.client.getRoom(roomId);
        if (!room) return [];
        const ephemeralEvents = room.currentState.getStateEvents("m.ephemeral");
        return ephemeralEvents.map(
            (event): IEphemeralEventInfo => ({
                roomId,
                type: event.getType(),
                sender: event.getSender() ?? "",
                content: event.getContent<IContent>(),
                timestamp: event.getTs(),
            }),
        );
    }

    public hasEphemeralEvents(roomId: string): boolean {
        return this.getEphemeralEvents(roomId).length > 0;
    }

    public clearEphemeralEvents(roomId: string): void {
        const room = this.client.getRoom(roomId);
        if (room) {
            room.currentState.setStateEvents([]);
        }
        this.ephemeralEventsCache.delete(roomId);
        this.emit(EphemeralEvent.EphemeralCleared, roomId);
    }

    public async getEphemeralEventsFromServer(roomId: string, limit?: number): Promise<IEphemeralEventInfo[]> {
        if (!roomId) throw new ValidationError("Room ID is required");
        const cached = this.ephemeralEventsCache.get(roomId);
        if (cached) return cached;

        return this.withRetry(
            async () => {
                const response = await this.request<IServerEphemeralEventsResponse>({
                    method: Method.Get,
                    path: ep(`/rooms/${encodeURIComponent(roomId)}/ephemeral` as StripV3<EphemeralPathPattern>),
                    queryParams: { limit: limit ?? this.defaultLimit },
                    prefix: ClientPrefix.V3,
                });

                const events: IEphemeralEventInfo[] = (response.chunk || []).map((e) => ({
                    roomId,
                    type: e.type,
                    sender: e.sender,
                    content: e.content,
                    timestamp: e.origin_server_ts ?? Date.now(),
                }));
                this.ephemeralEventsCache.set(roomId, events);
                this.emit(EphemeralEvent.EphemeralReceived, roomId, events);
                return events;
            },
            { label: "getEphemeralEventsFromServer", idempotent: true },
        );
    }

    public async getTypingEvents(roomId: string): Promise<string[]> {
        try {
            const events = await this.getEphemeralEventsFromServer(roomId);
            const typingEvent = events.find((e) => e.type === "m.typing");
            const content = typingEvent?.content as { user_ids?: string[] } | undefined;
            return content?.user_ids || [];
        } catch {
            return [];
        }
    }

    public async getReceiptEvents(roomId: string): Promise<Map<string, string>> {
        const receipts = new Map<string, string>();
        try {
            const events = await this.getEphemeralEventsFromServer(roomId);
            const receiptEvent = events.find((e) => e.type === "m.receipt");
            if (receiptEvent?.content) {
                for (const [eventId, data] of Object.entries(receiptEvent.content)) {
                    const readData = (data as Record<string, Record<string, unknown>>)?.["m.read"]; // Dynamic: receipt data with variable structure
                    if (readData) for (const userId of Object.keys(readData)) receipts.set(userId, eventId);
                }
            }
        } catch {
            /* ignore */
        }
        return receipts;
    }

    public getCachedEphemeralEvents(roomId: string): IEphemeralEventInfo[] {
        return this.ephemeralEventsCache.get(roomId) || [];
    }

    public clearCache(): void {
        this.ephemeralEventsCache.clear();
    }
    public setDefaultLimit(limit: number): void {
        if (limit > 0) this.defaultLimit = limit;
    }
    public getDefaultLimit(): number {
        return this.defaultLimit;
    }
    public stop(): void {
        this.ephemeralEventsCache.clear();
    }

}


export function extendMatrixClient(): void {
    MatrixClient.prototype.getEphemeralManager = function (): EphemeralManager {
        registerManagerClass("ephemeral", EphemeralManager);
    return getOrCreateManager(this, "ephemeral", () => new EphemeralManager(this));
    };
}

export default extendMatrixClient;
