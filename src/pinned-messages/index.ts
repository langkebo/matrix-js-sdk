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
import { VendorPrefix } from "../http-api/prefix";
import { MatrixClient } from "../client";
import { LRUCache } from "../utils/lru-cache";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { ValidationError } from "../errors";
import { getOrCreateManager, registerManagerClass } from "../client-infra/manager-registry";

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

export interface IServerPinnedEventsResponse {
    // FT-103: 后端 (pinned.rs) 返回 { pinned_events: Vec<String> }，是字符串数组
    pinned_events: string[];
}

interface PinnedMessagesManagerEventMap {
    [PinnedEvent.Pinned]: (roomId: string, eventId: string) => void;
    [PinnedEvent.Unpinned]: (roomId: string, eventId: string) => void;
    [PinnedEvent.PinnedUpdated]: (roomId: string, events: IPinnedEventInfo[]) => void;
    [PinnedEvent.PinnedError]: (roomId: string, error: Error) => void;
}

export class PinnedMessagesManager extends BaseManager<PinnedEvent, PinnedMessagesManagerEventMap> {
    private pinnedEventsCache: LRUCache<IPinnedEventInfo[]>;

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
        this.pinnedEventsCache = new LRUCache<IPinnedEventInfo[]>({
            maxSize: 100,
            ttl: 5 * 60 * 1000,
            name: "pinned-events-cache",
        });
    }

    /**
     * 获取置顶消息缓存的统计信息。
     *
     * @returns 缓存容量、命中/未命中次数与命中率
     *
     * @example
     * ```typescript
     * const stats = client.getPinnedMessagesManager().getCacheStats();
     * console.log(stats.size, stats.hitRate);
     * ```
     */
    public getCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
        return this.pinnedEventsCache.getStats();
    }

    /**
     * 置顶消息（通过 m.room.pinned_events 状态事件）。
     *
     * @param roomId - 房间 ID
     * @param eventId - 要置顶的事件 ID
     *
     * @example
     * ```typescript
     * await client.getPinnedMessagesManager().pinMessage("!room:example.org", "$event");
     * ```
     */
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

    /**
     * 取消置顶消息（通过 m.room.pinned_events 状态事件）。
     *
     * @param roomId - 房间 ID
     * @param eventId - 要取消置顶的事件 ID
     *
     * @example
     * ```typescript
     * await client.getPinnedMessagesManager().unpinMessage("!room:example.org", "$event");
     * ```
     */
    public async unpinMessage(roomId: string, eventId: string): Promise<void> {
        const room = this.client.getRoom(roomId);
        if (!room) return;
        const pinnedEvent = room.currentState.getStateEvents("m.room.pinned_events", "");
        if (!pinnedEvent) return;
        const content = pinnedEvent.getContent<{ pinned?: string[] }>();
        const pinned = (content.pinned || []).filter((id: string) => id !== eventId);
        await this.client.sendStateEvent(roomId, "m.room.pinned_events", { pinned }, "");
    }

    /**
     * 从房间状态中读取当前置顶事件 ID 列表。
     *
     * @param roomId - 房间 ID
     * @returns 置顶事件 ID 数组；房间或状态事件不存在时返回空数组
     *
     * @example
     * ```typescript
     * const pinned = client.getPinnedMessagesManager().getPinnedMessages("!room:example.org");
     * ```
     */
    public getPinnedMessages(roomId: string): string[] {
        const room = this.client.getRoom(roomId);
        if (!room) return [];
        const pinnedEvent = room.currentState.getStateEvents("m.room.pinned_events", "");
        if (!pinnedEvent) return [];
        const content = pinnedEvent.getContent<{ pinned?: string[] }>();
        return content.pinned || [];
    }

    /**
     * 判断房间是否存在置顶消息。
     *
     * @param roomId - 房间 ID
     * @returns 置顶列表非空时为 true
     *
     * @example
     * ```typescript
     * const hasPinned = client.getPinnedMessagesManager().hasPinnedMessages("!room:example.org");
     * ```
     */
    public hasPinnedMessages(roomId: string): boolean {
        return this.getPinnedMessages(roomId).length > 0;
    }

    /**
     * 从服务端获取置顶事件列表（命中缓存则直接返回）。
     *
     * @param roomId - 房间 ID
     * @returns 置顶事件信息数组
     * @throws {ValidationError} roomId 为空时
     *
     * @example
     * ```typescript
     * const events = await client.getPinnedMessagesManager().getPinnedEventsFromServer("!room:example.org");
     * console.log(events.map((e) => e.eventId));
     * ```
     */
    public async getPinnedEventsFromServer(roomId: string): Promise<IPinnedEventInfo[]> {
        if (!roomId) throw new ValidationError("Room ID is required");
        const cached = this.pinnedEventsCache.get(roomId);
        if (cached) return cached;

        return this.withRetry(
            async () => {
                const response = (await this.request({
                    method: Method.Get,
                    path: `/rooms/${encodeURIComponent(roomId)}/pinned_events`,
                    prefix: VendorPrefix,
                })) as IServerPinnedEventsResponse;

                // FT-103: 后端返回 { pinned_events: string[] }，映射为 IPinnedEventInfo[]
                const events: IPinnedEventInfo[] = (response.pinned_events || []).map((eventId) => ({
                    eventId,
                    roomId,
                }));
                this.pinnedEventsCache.set(roomId, events);
                this.emit(PinnedEvent.PinnedUpdated, roomId, events);
                return events;
            },
            { label: "getPinnedEventsFromServer", idempotent: true },
        );
    }

    /**
     * 将事件置顶到服务端并更新本地缓存。
     *
     * @param roomId - 房间 ID
     * @param eventId - 要置顶的事件 ID
     * @throws {ValidationError} roomId 或 eventId 为空时
     *
     * @example
     * ```typescript
     * await client.getPinnedMessagesManager().pinEventToServer("!room:example.org", "$event");
     * ```
     */
    public async pinEventToServer(roomId: string, eventId: string): Promise<void> {
        if (!roomId) throw new ValidationError("Room ID is required");
        if (!eventId) throw new ValidationError("Event ID is required");

        return this.withRetry(
            async () => {
                await this.request({
                    method: Method.Post,
                    path: `/rooms/${encodeURIComponent(roomId)}/pinned_events`,
                    body: { event_id: eventId },
                    prefix: VendorPrefix,
                });
                this.emit(PinnedEvent.Pinned, roomId, eventId);
                const cached = this.pinnedEventsCache.get(roomId) || [];
                cached.push({ eventId, roomId, pinnedBy: this.client.getUserId() || undefined, pinnedAt: Date.now() });
                this.pinnedEventsCache.set(roomId, cached);
            },
            { label: "pinEventToServer", idempotent: false },
        );
    }

    /**
     * 取消服务端的置顶并更新本地缓存。
     *
     * @param roomId - 房间 ID
     * @param eventId - 要取消置顶的事件 ID
     * @throws {ValidationError} roomId 或 eventId 为空时
     *
     * @example
     * ```typescript
     * await client.getPinnedMessagesManager().unpinEventFromServer("!room:example.org", "$event");
     * ```
     */
    public async unpinEventFromServer(roomId: string, eventId: string): Promise<void> {
        if (!roomId) throw new ValidationError("Room ID is required");
        if (!eventId) throw new ValidationError("Event ID is required");

        return this.withRetry(
            async () => {
                await this.request({
                    method: Method.Delete,
                    path: `/rooms/${encodeURIComponent(roomId)}/pinned_events/${encodeURIComponent(eventId)}`,
                    prefix: VendorPrefix,
                });
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

    /**
     * 获取本地缓存的置顶事件。
     *
     * @param roomId - 房间 ID
     * @returns 缓存的置顶事件信息数组；无缓存时返回空数组
     *
     * @example
     * ```typescript
     * const cached = client.getPinnedMessagesManager().getCachedPinnedEvents("!room:example.org");
     * ```
     */
    public getCachedPinnedEvents(roomId: string): IPinnedEventInfo[] {
        return this.pinnedEventsCache.get(roomId) || [];
    }

    /**
     * 清空置顶消息缓存。
     *
     * @example
     * ```typescript
     * client.getPinnedMessagesManager().clearCache();
     * ```
     */
    public clearCache(): void {
        this.pinnedEventsCache.clear();
    }
    /**
     * 停止管理器并清空置顶消息缓存。
     *
     * @example
     * ```typescript
     * client.getPinnedMessagesManager().stop();
     * ```
     */
    public stop(): void {
        this.pinnedEventsCache.clear();
    }
}

export function extendMatrixClient(): void {
    registerManagerClass("pinnedMessages", PinnedMessagesManager);
    MatrixClient.prototype.getPinnedMessagesManager = function (): PinnedMessagesManager {
        return getOrCreateManager(this, "pinnedMessages", () => new PinnedMessagesManager(this));
    };
}
