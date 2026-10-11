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
import type { EphemeralPath } from "./__generated__/route-table";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import { logger } from "../logger";
import type { PathAssert, StripV3 } from "../http-api/strip-prefix";

function ep<const P extends string>(path: P & PathAssert<P, StripV3<EphemeralPath>>): P {
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

    /**
     * 获取管理器运行指标（缓存命中统计与请求计数）。
     *
     * @returns 缓存与请求维度的指标快照
     * @example
     * const metrics = client.getEphemeralManager().getMetrics();
     */
    public getMetrics(): EphemeralManagerMetrics {
        return { cache: this.ephemeralEventsCache.getStats(), requests: { ...this.requestStats } };
    }

    /**
     * 以 to-device 消息形式向房间发送一次性（ephemeral）事件。
     *
     * @param roomId - 目标房间 ID
     * @param type - 事件类型（如 `m.typing`）
     * @param content - 事件内容
     * @example
     * await client.getEphemeralManager().sendEphemeralEvent(roomId, "m.typing", { typing: true });
     */
    public async sendEphemeralEvent(roomId: string, type: string, content: IContent): Promise<void> {
        const userId = this.client.getUserId() ?? "";
        const contentMap = new Map<string, Map<string, IContent>>();
        const roomMap = new Map<string, IContent>();
        roomMap.set(userId, content);
        contentMap.set(roomId, roomMap);
        await this.client.getToDeviceManager().sendToDeviceFromContentMap(type, contentMap);
    }

    /**
     * 从房间当前状态中读取 `m.ephemeral` 事件。
     *
     * @param roomId - 房间 ID
     * @returns 一次性事件列表；房间不存在时返回空数组
     * @example
     * const events = client.getEphemeralManager().getEphemeralEvents(roomId);
     */
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

    /**
     * 判断房间是否存在一次性事件。
     *
     * @param roomId - 房间 ID
     * @returns 是否存在一次性事件
     * @example
     * const has = client.getEphemeralManager().hasEphemeralEvents(roomId);
     */
    public hasEphemeralEvents(roomId: string): boolean {
        return this.getEphemeralEvents(roomId).length > 0;
    }

    /**
     * 清空房间的一次性事件（本地状态与缓存），并发出 {@link EphemeralEvent.EphemeralCleared}。
     *
     * @param roomId - 房间 ID
     * @example
     * client.getEphemeralManager().clearEphemeralEvents(roomId);
     */
    public clearEphemeralEvents(roomId: string): void {
        const room = this.client.getRoom(roomId);
        if (room) {
            room.currentState.setStateEvents([]);
        }
        this.ephemeralEventsCache.delete(roomId);
        this.emit(EphemeralEvent.EphemeralCleared, roomId);
    }

    /**
     * 从服务端拉取房间的一次性事件（命中缓存时直接返回）。
     *
     * @param roomId - 房间 ID
     * @param limit - 可选条数上限，缺省使用 {@link EphemeralManager.getDefaultLimit}
     * @returns 一次性事件列表
     * @throws {ValidationError} 当 roomId 缺失时
     * @example
     * const events = await client.getEphemeralManager().getEphemeralEventsFromServer(roomId, 20);
     */
    public async getEphemeralEventsFromServer(roomId: string, limit?: number): Promise<IEphemeralEventInfo[]> {
        if (!roomId) throw new ValidationError("Room ID is required");
        const cached = this.ephemeralEventsCache.get(roomId);
        if (cached) return cached;

        return this.withRetry(
            async () => {
                const response = await this.request<IServerEphemeralEventsResponse>({
                    method: Method.Get,
                    path: ep(`/rooms/${encodeURIComponent(roomId)}/ephemeral`),
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

    /**
     * 获取房间内正在输入的用户 ID 列表。
     *
     * @param roomId - 房间 ID
     * @returns 正在输入的用户 ID 列表；获取失败时返回空数组
     * @example
     * const typing = await client.getEphemeralManager().getTypingEvents(roomId);
     */
    public async getTypingEvents(roomId: string): Promise<string[]> {
        try {
            const events = await this.getEphemeralEventsFromServer(roomId);
            const typingEvent = events.find((e) => e.type === "m.typing");
            const content = typingEvent?.content as { user_ids?: string[] } | undefined;
            return content?.user_ids || [];
        } catch (e) {
            logger.warn("EphemeralManager.getTypingEvents failed:", e);
        }
        return [];
    }

    /**
     * 获取房间的回执（`m.receipt`）信息。
     *
     * @param roomId - 房间 ID
     * @returns 用户 ID 到最近已读事件 ID 的映射
     * @example
     * const receipts = await client.getEphemeralManager().getReceiptEvents(roomId);
     */
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

    /**
     * 仅从缓存读取一次性事件，不触发网络请求。
     *
     * @param roomId - 房间 ID
     * @returns 缓存的事件列表；未缓存时返回空数组
     * @example
     * const events = client.getEphemeralManager().getCachedEphemeralEvents(roomId);
     */
    public getCachedEphemeralEvents(roomId: string): IEphemeralEventInfo[] {
        return this.ephemeralEventsCache.get(roomId) || [];
    }

    /**
     * 清空一次性事件缓存。
     *
     * @example
     * client.getEphemeralManager().clearCache();
     */
    public clearCache(): void {
        this.ephemeralEventsCache.clear();
    }
    /**
     * 设置服务端拉取一次性事件时的默认条数上限（仅接受正数）。
     *
     * @param limit - 默认条数上限
     * @example
     * client.getEphemeralManager().setDefaultLimit(50);
     */
    public setDefaultLimit(limit: number): void {
        if (limit > 0) this.defaultLimit = limit;
    }
    /**
     * 获取服务端拉取一次性事件时的默认条数上限。
     *
     * @returns 默认条数上限
     * @example
     * const limit = client.getEphemeralManager().getDefaultLimit();
     */
    public getDefaultLimit(): number {
        return this.defaultLimit;
    }
    /**
     * 停止管理器并清空缓存。
     *
     * @example
     * client.getEphemeralManager().stop();
     */
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
