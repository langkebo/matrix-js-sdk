import { logger } from "../logger"
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
 * Room Alias Manager - 房间别名管理
 * 
 * 提供房间别名的创建、删除、查询功能
 */

import { TypedEventEmitter } from "../models/typed-event-emitter.ts";
import { Method } from "../http-api/method.ts";
import { ClientPrefix } from "../http-api/prefix.ts";
import { MatrixClient } from "../client.ts";

export enum RoomAliasEvent {
    AliasCreated = "AliasCreated",
    AliasDeleted = "AliasDeleted",
    AliasUpdated = "AliasUpdated",
    AliasError = "AliasError",
}

export interface IRoomAliasResponse {
    room_id: string;
    servers?: string[];
}

export interface IRoomAliasesResponse {
    aliases: string[];
}

export interface IRoomAliasInfo {
    alias: string;
    roomId: string;
    servers?: string[];
}

interface RoomAliasManagerEventMap {
    [RoomAliasEvent.AliasCreated]: (roomId: string, alias: string) => void;
    [RoomAliasEvent.AliasDeleted]: (roomId: string, alias: string) => void;
    [RoomAliasEvent.AliasUpdated]: (roomId: string, alias: string) => void;
    [RoomAliasEvent.AliasError]: (roomId: string, error: Error) => void;
}

export class RoomAliasManager extends TypedEventEmitter<RoomAliasEvent, RoomAliasManagerEventMap> {
    private client: MatrixClient;
    private aliasCache: Map<string, IRoomAliasInfo> = new Map();
    private roomAliasesCache: Map<string, string[]> = new Map();

    constructor(client: MatrixClient) {
        super();
        this.client = client;
    }

    async getAliasRoom(alias: string): Promise<IRoomAliasResponse | null> {
        if (!alias) {
            throw new Error("Alias is required");
        }

        if (this.aliasCache.has(alias)) {
            const info = this.aliasCache.get(alias)!;
            return {
                room_id: info.roomId,
                servers: info.servers,
            };
        }

        try {
            const response = await this.client.http.authedRequest<IRoomAliasResponse>(
                Method.Get,
                `/directory/room/${encodeURIComponent(alias)}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );

            const info: IRoomAliasInfo = {
                alias,
                roomId: response.room_id,
                servers: response.servers,
            };
            this.aliasCache.set(alias, info);

            return response;
        } catch (e) {
            logger.warn('RoomAliasManager.getAliasRoom failed:', e);
            return null;
        }
    }

    async setRoomAlias(roomId: string, alias: string): Promise<void> {
        if (!roomId || !alias) {
            throw new Error("Room ID and alias are required");
        }

        try {
            await this.client.http.authedRequest(
                Method.Put,
                `/directory/room/${encodeURIComponent(alias)}`,
                undefined,
                { room_id: roomId },
                { prefix: ClientPrefix.V3 }
            );

            const info: IRoomAliasInfo = {
                alias,
                roomId,
            };
            this.aliasCache.set(alias, info);

            const aliases = this.roomAliasesCache.get(roomId) || [];
            if (!aliases.includes(alias)) {
                aliases.push(alias);
                this.roomAliasesCache.set(roomId, aliases);
            }

            this.emit(RoomAliasEvent.AliasCreated, roomId, alias);
        } catch (error) {
            this.emit(RoomAliasEvent.AliasError, roomId, error as Error);
            throw error;
        }
    }

    async deleteRoomAlias(alias: string): Promise<void> {
        if (!alias) {
            throw new Error("Alias is required");
        }

        const info = this.aliasCache.get(alias);
        const roomId = info?.roomId;

        try {
            await this.client.http.authedRequest(
                Method.Delete,
                `/directory/room/${encodeURIComponent(alias)}`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );

            this.aliasCache.delete(alias);

            if (roomId) {
                const aliases = this.roomAliasesCache.get(roomId) || [];
                const filtered = aliases.filter(a => a !== alias);
                this.roomAliasesCache.set(roomId, filtered);
                this.emit(RoomAliasEvent.AliasDeleted, roomId, alias);
            }
        } catch (error) {
            if (roomId) {
                this.emit(RoomAliasEvent.AliasError, roomId, error as Error);
            }
            throw error;
        }
    }

    async getRoomAliases(roomId: string): Promise<IRoomAliasesResponse | null> {
        if (!roomId) {
            throw new Error("Room ID is required");
        }

        if (this.roomAliasesCache.has(roomId)) {
            return { aliases: this.roomAliasesCache.get(roomId)! };
        }

        try {
            const response = await this.client.http.authedRequest<IRoomAliasesResponse>(
                Method.Get,
                `/rooms/${encodeURIComponent(roomId)}/aliases`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );

            const aliases = response.aliases || [];
            this.roomAliasesCache.set(roomId, aliases);

            return { aliases };
        } catch (e) {
            logger.warn('RoomAliasManager.getRoomAliases failed:', e);
            return null;
        }
    }

    async createAlias(roomId: string, aliasLocalpart: string): Promise<string> {
        if (!roomId || !aliasLocalpart) {
            throw new Error("Room ID and alias localpart are required");
        }

        const domain = this.client.getDomain();
        const alias = `#${aliasLocalpart}:${domain}`;

        await this.setRoomAlias(roomId, alias);

        return alias;
    }

    async removeAlias(alias: string): Promise<void> {
        await this.deleteRoomAlias(alias);
    }

    async resolveAlias(alias: string): Promise<string | null> {
        const response = await this.getAliasRoom(alias);
        return response?.room_id || null;
    }

    async getCanonicalAlias(roomId: string): Promise<string | null> {
        try {
            const room = this.client.getRoom(roomId);
            if (!room) {
                return null;
            }

            const canonicalAliasEvent = room.currentState.getStateEvents('m.room.canonical_alias', '');
            if (canonicalAliasEvent) {
                return canonicalAliasEvent.getContent()?.alias || null;
            }

            return null;
        } catch (e) {
            logger.warn('RoomAliasManager.getCanonicalAlias failed:', e);
            return null;
        }
    }

    async setCanonicalAlias(roomId: string, alias: string | null): Promise<void> {
        if (!roomId) {
            throw new Error("Room ID is required");
        }

        try {
            await this.client.sendStateEvent(
                roomId,
                'm.room.canonical_alias',
                alias ? { alias } : {},
                ''
            );

            this.emit(RoomAliasEvent.AliasUpdated, roomId, alias || '');
        } catch (error) {
            this.emit(RoomAliasEvent.AliasError, roomId, error as Error);
            throw error;
        }
    }

    async getAltAliases(roomId: string): Promise<string[]> {
        try {
            const room = this.client.getRoom(roomId);
            if (!room) {
                return [];
            }

            const canonicalAliasEvent = room.currentState.getStateEvents('m.room.canonical_alias', '');
            if (canonicalAliasEvent) {
                return canonicalAliasEvent.getContent()?.alt_aliases || [];
            }

            return [];
        } catch (e) {
            logger.warn('RoomAliasManager.getAltAliases failed:', e);
            return [];
        }
    }

    async addAltAlias(roomId: string, alias: string): Promise<void> {
        if (!roomId || !alias) {
            throw new Error("Room ID and alias are required");
        }

        const altAliases = await this.getAltAliases(roomId);
        if (altAliases.includes(alias)) {
            return;
        }

        const canonicalAlias = await this.getCanonicalAlias(roomId);
        altAliases.push(alias);

        await this.client.sendStateEvent(
            roomId,
            'm.room.canonical_alias',
            {
                alias: canonicalAlias ?? undefined,
                alt_aliases: altAliases,
            },
            ''
        );
    }

    async removeAltAlias(roomId: string, alias: string): Promise<void> {
        if (!roomId || !alias) {
            throw new Error("Room ID and alias are required");
        }

        const altAliases = await this.getAltAliases(roomId);
        const filtered = altAliases.filter(a => a !== alias);

        const canonicalAlias = await this.getCanonicalAlias(roomId);

        await this.client.sendStateEvent(
            roomId,
            'm.room.canonical_alias',
            {
                alias: canonicalAlias ?? undefined,
                alt_aliases: filtered,
            },
            ''
        );
    }

    async isAliasAvailable(alias: string): Promise<boolean> {
        try {
            const response = await this.getAliasRoom(alias);
            return response === null;
        } catch (e) {
            return true;
        }
    }

    async suggestAlias(roomId: string, aliasLocalpart: string): Promise<void> {
        if (!roomId || !aliasLocalpart) {
            throw new Error("Room ID and alias localpart are required");
        }

        await this.client.sendStateEvent(
            roomId,
            'm.room.aliases',
            { alias: aliasLocalpart },
            this.client.getDomain() ?? undefined
        );
    }

    getCachedAlias(alias: string): IRoomAliasInfo | null {
        return this.aliasCache.get(alias) || null;
    }

    getCachedRoomAliases(roomId: string): string[] {
        return this.roomAliasesCache.get(roomId) || [];
    }

    clearCache(): void {
        this.aliasCache.clear();
        this.roomAliasesCache.clear();
    }

    async start(): Promise<void> {
        const rooms = this.client.getRooms?.() || [];
        for (const room of rooms) {
            try {
                await this.getRoomAliases(room.roomId);
            } catch (e) {
                logger.warn(`Failed to load aliases for room ${room.roomId}:`, e);
            }
        }
    }

    stop(): void {
        this.aliasCache.clear();
        this.roomAliasesCache.clear();
    }
}
