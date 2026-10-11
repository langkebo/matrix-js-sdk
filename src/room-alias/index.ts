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
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

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
     * @param options.throwOnError - 是否抛出错误（默认 true，传 false 时使用兼容 fallback）
     * @returns 房间别名响应
     * @throws {InvalidParamError} 当 `alias` 为空时抛出。
     * @example
     * ```typescript
     * const info = await client.getRoomAliasManager().getAliasRoom("#room:example.org");
     * console.log(info?.room_id);
     * ```
     */
    async getAliasRoom(
        alias: string,
        options: ErrorHandlingOptions | boolean = {},
    ): Promise<IRoomAliasResponse | null> {
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

    /**
     * 设置房间别名。
     *
     * 将 `alias` 绑定到目标房间，成功后更新本地别名缓存并触发 `AliasCreated` 事件。
     *
     * @param roomId - 目标房间 ID
     * @param alias - 要设置的房间别名（形如 `#alias:domain`）
     * @throws {InvalidParamError} 当 `roomId` 或 `alias` 为空时抛出
     * @example
     * ```typescript
     * await client.getRoomAliasManager().setRoomAlias("!room:example.org", "#alias:example.org");
     * ```
     */
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

    /**
     * 删除房间别名。
     *
     * 移除 `alias` 的目录映射并清理本地缓存；若缓存中存在对应房间 ID，则触发 `AliasDeleted` 事件。
     *
     * @param alias - 要删除的房间别名
     * @throws {InvalidParamError} 当 `alias` 为空时抛出
     * @example
     * ```typescript
     * await client.getRoomAliasManager().deleteRoomAlias("#alias:example.org");
     * ```
     */
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
     * @param options.throwOnError - 是否抛出错误（默认 true，传 false 时使用兼容 fallback）
     * @returns 房间别名列表响应
     * @throws {InvalidParamError} 当 `roomId` 为空时抛出。
     * @example
     * ```typescript
     * const res = await client.getRoomAliasManager().getRoomAliases("!room:example.org");
     * console.log(res?.aliases);
     * ```
     */
    async getRoomAliases(
        roomId: string,
        options: ErrorHandlingOptions | boolean = {},
    ): Promise<IRoomAliasesResponse | null> {
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

    /**
     * 创建房间别名。
     *
     * 使用当前客户端域名将 `aliasLocalpart` 拼接为完整别名（`#<localpart>:<domain>`），
     * 再委托 {@link setRoomAlias} 完成绑定。
     *
     * @param roomId - 目标房间 ID
     * @param aliasLocalpart - 别名本地部分（不含 `#` 与域名）
     * @returns 拼接后的完整房间别名
     * @throws {InvalidParamError} 当 `roomId` 或 `aliasLocalpart` 为空时抛出
     * @example
     * ```typescript
     * const alias = await client.getRoomAliasManager().createAlias("!room:example.org", "my-room");
     * // => "#my-room:example.org"
     * ```
     */
    async createAlias(roomId: string, aliasLocalpart: string): Promise<string> {
        if (!roomId || !aliasLocalpart) {
            throw new InvalidParamError("Room ID and alias localpart are required");
        }

        const domain = this.client.getDomain();
        const alias = `#${aliasLocalpart}:${domain}`;

        await this.setRoomAlias(roomId, alias);

        return alias;
    }

    /**
     * 移除房间别名。
     *
     * 是 {@link deleteRoomAlias} 的语义化别名。
     *
     * @param alias - 要移除的房间别名
     * @example
     * ```typescript
     * await client.getRoomAliasManager().removeAlias("#alias:example.org");
     * ```
     */
    async removeAlias(alias: string): Promise<void> {
        await this.deleteRoomAlias(alias);
    }

    /**
     * 解析房间别名对应的房间 ID。
     *
     * 内部以 `throwOnError = false` 调用 {@link getAliasRoom}，解析失败时返回 `null`。
     *
     * @param alias - 要解析的房间别名
     * @returns 别名对应的房间 ID；未找到时返回 `null`
     * @example
     * ```typescript
     * const roomId = await client.getRoomAliasManager().resolveAlias("#alias:example.org");
     * ```
     */
    async resolveAlias(alias: string): Promise<string | null> {
        const response = await this.getAliasRoom(alias, false);
        return response?.room_id || null;
    }

    /**
     * 获取房间的主别名
     *
     * @param roomId - 房间 ID
     * @param options.throwOnError - 是否抛出错误（默认 true，传 false 时使用兼容 fallback）
     * @returns 主别名
     * @example
     * ```typescript
     * const alias = await client.getRoomAliasManager().getCanonicalAlias("!room:example.org");
     * ```
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

    /**
     * 设置房间的主别名。
     *
     * 通过发送 `m.room.canonical_alias` 状态事件写入主别名；传入 `null` 表示清除主别名。
     *
     * @param roomId - 房间 ID
     * @param alias - 主别名；传 `null` 以清除主别名
     * @throws {InvalidParamError} 当 `roomId` 为空时抛出
     * @example
     * ```typescript
     * await client.getRoomAliasManager().setCanonicalAlias("!room:example.org", "#main:example.org");
     * ```
     */
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
     * @param options.throwOnError - 是否抛出错误（默认 true，传 false 时使用兼容 fallback）
     * @returns 备选别名列表
     * @example
     * ```typescript
     * const altAliases = await client.getRoomAliasManager().getAltAliases("!room:example.org");
     * ```
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

    /**
     * 添加备选别名。
     *
     * 读取 `m.room.canonical_alias` 中现有的备选别名列表，追加 `alias` 后回写；
     * 若 `alias` 已存在则直接返回。
     *
     * @param roomId - 房间 ID
     * @param alias - 要添加的备选别名
     * @throws {InvalidParamError} 当 `roomId` 或 `alias` 为空时抛出
     * @example
     * ```typescript
     * await client.getRoomAliasManager().addAltAlias("!room:example.org", "#alt:example.org");
     * ```
     */
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

    /**
     * 移除备选别名。
     *
     * 从 `m.room.canonical_alias` 的备选别名列表中剔除 `alias` 后回写。
     *
     * @param roomId - 房间 ID
     * @param alias - 要移除的备选别名
     * @throws {InvalidParamError} 当 `roomId` 或 `alias` 为空时抛出
     * @example
     * ```typescript
     * await client.getRoomAliasManager().removeAltAlias("!room:example.org", "#alt:example.org");
     * ```
     */
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

    /**
     * 检查别名是否可用。
     *
     * 别名尚未被占用（解析返回 `null`）即为可用；查询异常时按可用处理。
     *
     * @param alias - 要检查的房间别名
     * @returns 别名可用时为 `true`
     * @example
     * ```typescript
     * const available = await client.getRoomAliasManager().isAliasAvailable("#alias:example.org");
     * ```
     */
    async isAliasAvailable(alias: string): Promise<boolean> {
        try {
            const response = await this.getAliasRoom(alias, false);
            return response === null;
        } catch (e) {
            logger.debug("RoomAliasManager.isAliasAvailable failed, assuming available", e);
            return true;
        }
    }

    /**
     * 为房间建议别名。
     *
     * 通过发送 `m.room.aliases` 状态事件记录建议的别名本地部分。
     *
     * @param roomId - 房间 ID
     * @param aliasLocalpart - 建议的别名本地部分
     * @throws {InvalidParamError} 当 `roomId` 或 `aliasLocalpart` 为空时抛出
     * @example
     * ```typescript
     * await client.getRoomAliasManager().suggestAlias("!room:example.org", "my-room");
     * ```
     */
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

    /**
     * 从本地缓存读取别名信息。
     *
     * @param alias - 房间别名
     * @returns 缓存的别名信息；未命中时返回 `null`
     * @example
     * ```typescript
     * const info = client.getRoomAliasManager().getCachedAlias("#alias:example.org");
     * ```
     */
    getCachedAlias(alias: string): IRoomAliasInfo | null {
        return this.aliasCache.get(alias) || null;
    }

    /**
     * 从本地缓存读取房间的别名列表。
     *
     * @param roomId - 房间 ID
     * @returns 缓存的别名列表；未命中时返回空数组
     * @example
     * ```typescript
     * const aliases = client.getRoomAliasManager().getCachedRoomAliases("!room:example.org");
     * ```
     */
    getCachedRoomAliases(roomId: string): string[] {
        return this.roomAliasesCache.get(roomId) || [];
    }

    /**
     * 清空本地别名缓存。
     *
     * 同时清空「别名 → 房间」与「房间 → 别名列表」两级缓存。
     *
     * @example
     * ```typescript
     * client.getRoomAliasManager().clearCache();
     * ```
     */
    clearCache(): void {
        this.aliasCache.clear();
        this.roomAliasesCache.clear();
    }

    /**
     * 启动管理器并预热别名缓存。
     *
     * 遍历客户端已知房间，逐个拉取别名列表写入缓存；单个房间失败不会中断整体流程。
     *
     * @example
     * ```typescript
     * await client.getRoomAliasManager().start();
     * ```
     */
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

    /**
     * 停止管理器并释放缓存。
     *
     * @example
     * ```typescript
     * client.getRoomAliasManager().stop();
     * ```
     */
    stop(): void {
        this.aliasCache.clear();
        this.roomAliasesCache.clear();
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomAliasManager = function (): RoomAliasManager {
        registerManagerClass("roomAlias", RoomAliasManager);
        return getOrCreateManager(this, "roomAlias", () => new RoomAliasManager(this));
    };
}
