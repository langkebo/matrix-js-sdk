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
 * Tag Manager - 标签管理
 *
 * 提供房间标签的添加、删除、查询功能
 */

import { TypedEventEmitter } from "../models/typed-event-emitter.ts";
import { Method } from "../http-api/method.ts";
import { ClientPrefix } from "../http-api/prefix.ts";
import { MatrixClient } from "../client.ts";
import { logger } from "../logger";
import { ValidationError } from "../errors";
import type { TagsPathPattern } from "./__generated__/route-table.ts";

type StripV3<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;

function tp<P extends StripV3<TagsPathPattern>>(path: P): P {
    return path;
}

export enum TagEvent {
    TagAdded = "TagAdded",
    TagRemoved = "TagRemoved",
    TagsUpdated = "TagsUpdated",
    TagError = "TagError",
}

export interface IRoomTag {
    name: string;
    order?: number;
}

export interface IRoomTags {
    [tagName: string]: {
        order?: number;
    };
}

interface TagManagerEventMap {
    [TagEvent.TagAdded]: (roomId: string, tag: string) => void;
    [TagEvent.TagRemoved]: (roomId: string, tag: string) => void;
    [TagEvent.TagsUpdated]: (roomId: string, tags: IRoomTags) => void;
    [TagEvent.TagError]: (roomId: string, error: Error) => void;
}

export class TagManager extends TypedEventEmitter<TagEvent, TagManagerEventMap> {
    private client: MatrixClient;
    private roomTags: Map<string, IRoomTags> = new Map();

    constructor(client: MatrixClient) {
        super();
        this.client = client;
    }

    async getRoomTags(roomId: string): Promise<IRoomTags> {
        if (this.roomTags.has(roomId)) {
            return this.roomTags.get(roomId) || {};
        }

        try {
            const userId = this.client.getUserId();
            if (!userId) {
                throw new ValidationError("User ID is required");
            }
            const response = await this.client.http.authedRequest<{ tags?: IRoomTags }>(
                Method.Get,
                tp(
                    `/user/${encodeURIComponent(userId)}/rooms/${encodeURIComponent(roomId)}/tags` as StripV3<TagsPathPattern>,
                ),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );

            const tags = response.tags || {};
            this.roomTags.set(roomId, tags);

            return tags;
            // @swallow-error { owner: "tags", expires: "2026-12-31" }
        } catch (e) {
            logger.warn("TagManager.getRoomTags failed:", e);
            return {};
        }
    }

    async addRoomTag(roomId: string, tag: string, order?: number): Promise<void> {
        if (!roomId || !tag) {
            throw new ValidationError("Room ID and tag are required");
        }

        try {
            const userId = this.client.getUserId();
            if (!userId) {
                throw new ValidationError("User ID is required");
            }
            const body: Record<string, unknown> = {};

            if (order !== undefined) {
                body.order = order;
            }

            await this.client.http.authedRequest(
                Method.Put,
                tp(
                    `/user/${encodeURIComponent(userId)}/rooms/${encodeURIComponent(roomId)}/tags/${encodeURIComponent(tag)}` as StripV3<TagsPathPattern>,
                ),
                undefined,
                body,
                { prefix: ClientPrefix.V3 },
            );

            const tags = this.roomTags.get(roomId) || {};
            tags[tag] = { order };
            this.roomTags.set(roomId, tags);

            this.emit(TagEvent.TagAdded, roomId, tag);
            this.emit(TagEvent.TagsUpdated, roomId, tags);
        } catch (error) {
            this.emit(TagEvent.TagError, roomId, error as Error);
            throw error;
        }
    }

    async removeRoomTag(roomId: string, tag: string): Promise<void> {
        if (!roomId || !tag) {
            throw new ValidationError("Room ID and tag are required");
        }

        try {
            const userId = this.client.getUserId();
            if (!userId) {
                throw new ValidationError("User ID is required");
            }

            await this.client.http.authedRequest(
                Method.Delete,
                tp(
                    `/user/${encodeURIComponent(userId)}/rooms/${encodeURIComponent(roomId)}/tags/${encodeURIComponent(tag)}` as StripV3<TagsPathPattern>,
                ),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );

            const tags = this.roomTags.get(roomId) || {};
            delete tags[tag];
            this.roomTags.set(roomId, tags);

            this.emit(TagEvent.TagRemoved, roomId, tag);
            this.emit(TagEvent.TagsUpdated, roomId, tags);
        } catch (error) {
            this.emit(TagEvent.TagError, roomId, error as Error);
            throw error;
        }
    }

    async getRoomsByTag(tag: string): Promise<string[]> {
        const rooms: string[] = [];

        for (const [roomId, tags] of this.roomTags.entries()) {
            if (tags[tag] !== undefined) {
                rooms.push(roomId);
            }
        }

        return rooms;
    }

    async setRoomTagOrder(roomId: string, tag: string, order: number): Promise<void> {
        await this.addRoomTag(roomId, tag, order);
    }

    async clearRoomTags(roomId: string): Promise<void> {
        const tags = await this.getRoomTags(roomId);

        for (const tag of Object.keys(tags)) {
            await this.removeRoomTag(roomId, tag);
        }
    }

    async getTaggedRooms(): Promise<Map<string, string[]>> {
        const result = new Map<string, string[]>();

        for (const [roomId, tags] of this.roomTags.entries()) {
            for (const tag of Object.keys(tags)) {
                if (!result.has(tag)) {
                    result.set(tag, []);
                }
                result.get(tag)!.push(roomId);
            }
        }

        return result;
    }

    async getFavoriteRooms(): Promise<string[]> {
        return this.getRoomsByTag("m.favourite");
    }

    async addToFavorites(roomId: string): Promise<void> {
        await this.addRoomTag(roomId, "m.favourite", 0.5);
    }

    async removeFromFavorites(roomId: string): Promise<void> {
        await this.removeRoomTag(roomId, "m.favourite");
    }

    async isFavorite(roomId: string): Promise<boolean> {
        const tags = await this.getRoomTags(roomId);
        return tags["m.favourite"] !== undefined;
    }

    async getLowPriorityRooms(): Promise<string[]> {
        return this.getRoomsByTag("m.lowpriority");
    }

    async addToLowPriority(roomId: string): Promise<void> {
        await this.addRoomTag(roomId, "m.lowpriority", 1);
    }

    async removeFromLowPriority(roomId: string): Promise<void> {
        await this.removeRoomTag(roomId, "m.lowpriority");
    }

    async isLowPriority(roomId: string): Promise<boolean> {
        const tags = await this.getRoomTags(roomId);
        return tags["m.lowpriority"] !== undefined;
    }

    getCachedTags(roomId: string): IRoomTags {
        return this.roomTags.get(roomId) || {};
    }

    getCachedRoomsByTag(tag: string): string[] {
        const rooms: string[] = [];
        for (const [roomId, tags] of this.roomTags.entries()) {
            if (tags[tag] !== undefined) {
                rooms.push(roomId);
            }
        }
        return rooms;
    }

    clearCache(): void {
        this.roomTags.clear();
    }

    async start(): Promise<void> {
        const rooms = this.client.getRooms?.() || [];
        for (const room of rooms) {
            try {
                await this.getRoomTags(room.roomId);
            } catch (e) {
                logger.warn(`Failed to load tags for room ${room.roomId}:`, e);
            }
        }
    }

    stop(): void {
        this.roomTags.clear();
    }
}
