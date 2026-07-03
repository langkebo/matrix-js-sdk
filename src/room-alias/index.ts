import { logger } from "../logger";
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

import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { MatrixClient } from "../client";
import { InvalidParamError } from "../common/errors";
import { handleManagerError, type ErrorHandlingOptions } from "../error/index.js";

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

export class RoomAliasManager extends BaseManager<RoomAliasEvent, RoomAliasManagerEventMap> {
    private aliasCache: Map<string, IRoomAliasInfo> = new Map();
    private roomAliasesCache: Map<string, string[]> = new Map();

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * 获取别名对应的房间 ID
     *
     * @param alias - 房间别名
     * @param throwOnError - 是否抛出错误（默认 true，传 false 时使用兼容 fallback）
     * @returns 房间别名响应
     */
    async getAliasRoom(alias: string, options: ErrorHandlingOptions | boolean = {}): Promise<IRoomAliasResponse | null> {
        if (!alias) {
            throw new InvalidParamError("Alias is required");
        }

        if (this.aliasCache.has(alias)) {
            const info = this.aliasCache.get(alias)!;
            return {
                room_id: info.roomId,
                servers: info.servers,
            };
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.request<IRoomAliasResponse>({
                    method: Method.Get,
                    path: `/directory/room/${encodeURIComponent(alias)}`,
                    prefix: ClientPrefix.V3,
                });
            }, "getAliasRoom");

            const info: IRoomAliasInfo = {
                alias,
                roomId: response.room_id,
                servers: response.servers,
            };
            this.aliasCache.set(alias, info);

            return response;
        } catch (e) {
            this.emit(RoomAliasEvent.AliasError, "", e as Error);
            return handleManagerError<IRoomAliasResponse>(e, options, "getAliasRoom");
        }
    }

    async setRoomAlias(roomId: string, alias: string): Promise<void> {
        if (!roomId || !alias) {
            throw new InvalidParamError("Room ID and alias are required");
        }

        try {
            await this.withRetry(async () => {
                await this.request({
                    method: Method.Put,
                    path: `/directory/room/${encodeURIComponent(alias)}`,
                    body: { room_id: roomId },
                    prefix: ClientPrefix.V3,
                });
            }, "setRoomAlias");

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
            throw new InvalidParamError("Alias is required");
        }

        const info = this.aliasCache.get(alias);
        const roomId = info?.roomId;

        try {
            await this.withRetry(async () => {
                await this.request({
                    method: Method.Delete,
                    path: `/directory/room/${encodeURIComponent(alias)}`,
                    prefix: ClientPrefix.V3,
                });
            }, "deleteRoomAlias");

            this.aliasCache.delete(alias);

            if (roomId) {
                const aliases = this.roomAliasesCache.get(roomId) || [];
                const filtered = aliases.filter((a) => a !== alias);
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

    /**
     * 获取房间的所有别名
     *
     * @param roomId - 房间 ID
     * @param throwOnError - 是否抛出错误（默认 true，传 false 时使用兼容 fallback）
     * @returns 房间别名列表响应
     */
    async getRoomAliases(roomId: string, options: ErrorHandlingOptions | boolean = {}): Promise<IRoomAliasesResponse | null> {
        if (!roomId) {
            throw new InvalidParamError("Room ID is required");
        }

        if (this.roomAliasesCache.has(roomId)) {
            return { aliases: this.roomAliasesCache.get(roomId)! };
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.request<IRoomAliasesResponse>({
                    method: Method.Get,
                    path: `/rooms/${encodeURIComponent(roomId)}/aliases`,
                    prefix: ClientPrefix.V3,
                });
            }, "getRoomAliases");

            const aliases = response.aliases || [];
            this.roomAliasesCache.set(roomId, aliases);

            return { aliases };
        } catch (e) {
            this.emit(RoomAliasEvent.AliasError, roomId, e as Error);
            return handleManagerError<IRoomAliasesResponse>(e, options, "getRoomAliases");
        }
    }

    async createAlias(roomId: string, aliasLocalpart: string): Promise<string> {
        if (!roomId || !aliasLocalpart) {
            throw new InvalidParamError("Room ID and alias localpart are required");
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
        const response = await this.getAliasRoom(alias, false);
        return response?.room_id || null;
    }

    /**
     * 获取房间的主别名
     *
     * @param roomId - 房间 ID
     * @param throwOnError - 是否抛出错误（默认 true，传 false 时使用兼容 fallback）
     * @returns 主别名
     */
    async getCanonicalAlias(roomId: string, options: ErrorHandlingOptions | boolean = {}): Promise<string | null> {
        try {
            const room = this.client.getRoom(roomId);
            if (!room) {
                return null;
            }

            const canonicalAliasEvent = room.currentState.getStateEvents("m.room.canonical_alias", "");
            if (canonicalAliasEvent) {
                const content = canonicalAliasEvent.getContent<{ alias?: string; alt_aliases?: string[] }>();
                return content.alias || null;
            }

            return null;
        } catch (e) {
            this.emit(RoomAliasEvent.AliasError, roomId, e as Error);
            return handleManagerError<string>(e, options, "getCanonicalAlias");
        }
    }

    async setCanonicalAlias(roomId: string, alias: string | null): Promise<void> {
        if (!roomId) {
            throw new InvalidParamError("Room ID is required");
        }

        try {
            await this.client.sendStateEvent(roomId, "m.room.canonical_alias", alias ? { alias } : {}, "");

            this.emit(RoomAliasEvent.AliasUpdated, roomId, alias || "");
        } catch (error) {
            this.emit(RoomAliasEvent.AliasError, roomId, error as Error);
            throw error;
        }
    }

    /**
     * 获取房间的备选别名列表
     *
     * @param roomId - 房间 ID
     * @param throwOnError - 是否抛出错误（默认 true，传 false 时使用兼容 fallback）
     * @returns 备选别名列表
     */
    async getAltAliases(roomId: string, options: ErrorHandlingOptions | boolean = {}): Promise<string[]> {
        try {
            const room = this.client.getRoom(roomId);
            if (!room) {
                return [];
            }

            const canonicalAliasEvent = room.currentState.getStateEvents("m.room.canonical_alias", "");
            if (canonicalAliasEvent) {
                const content = canonicalAliasEvent.getContent<{ alias?: string; alt_aliases?: string[] }>();
                return Array.isArray(content.alt_aliases) ? content.alt_aliases : [];
            }

            return [];
        } catch (e) {
            this.emit(RoomAliasEvent.AliasError, roomId, e as Error);
            return handleManagerError<string[]>(e, options, "getAltAliases") ?? [];
        }
    }

    async addAltAlias(roomId: string, alias: string): Promise<void> {
        if (!roomId || !alias) {
            throw new InvalidParamError("Room ID and alias are required");
        }

        const altAliases = await this.getAltAliases(roomId, false);
        if (altAliases.includes(alias)) {
            return;
        }

        const canonicalAlias = await this.getCanonicalAlias(roomId, false);
        altAliases.push(alias);

        await this.client.sendStateEvent(
            roomId,
            "m.room.canonical_alias",
            {
                alias: canonicalAlias ?? undefined,
                alt_aliases: altAliases,
            },
            "",
        );
    }

    async removeAltAlias(roomId: string, alias: string): Promise<void> {
        if (!roomId || !alias) {
            throw new InvalidParamError("Room ID and alias are required");
        }

        const altAliases = await this.getAltAliases(roomId, false);
        const filtered = altAliases.filter((a) => a !== alias);

        const canonicalAlias = await this.getCanonicalAlias(roomId, false);

        await this.client.sendStateEvent(
            roomId,
            "m.room.canonical_alias",
            {
                alias: canonicalAlias ?? undefined,
                alt_aliases: filtered,
            },
            "",
        );
    }

    async isAliasAvailable(alias: string): Promise<boolean> {
        try {
            const response = await this.getAliasRoom(alias, false);
            return response === null;
        } catch (e) {
            logger.debug("RoomAliasManager.isAliasAvailable failed, assuming available", e);
            return true;
        }
    }

    async suggestAlias(roomId: string, aliasLocalpart: string): Promise<void> {
        if (!roomId || !aliasLocalpart) {
            throw new InvalidParamError("Room ID and alias localpart are required");
        }

        await this.client.sendStateEvent(
            roomId,
            "m.room.aliases",
            { alias: aliasLocalpart },
            this.client.getDomain() ?? undefined,
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
                await this.getRoomAliases(room.roomId, false);
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
