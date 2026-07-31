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
 * DmRoomListManager - DM 房间查询与缓存
 *
 * 职责：
 * - 持有 dmRoomsCache / userDmMapCache（creation/operation 通过 listManager 引用访问）
 * - 提供 DM 房间查询：getDMRooms、getDmForUser、getDmRoomInfo、checkRoomIsDm 等
 * - 提供 m.direct 映射读取：getDirectRoomsByUser(Sync)
 * - 提供服务器查询：getDirectRoomsFromServer、isDmRoomFromServer、getDmPartnerFromServer
 *
 * 缓存归属：dmRoomsCache 与 userDmMapCache 由本 manager 持有，
 * creation/operation sub-manager 通过 `this.listManager.dmRoomsCache` 等公开只读字段访问。
 */

import { InvalidParamError } from "../../common/errors";
import { logger } from "../../logger";
import { NotificationCountType } from "../../models/room";
import { EventType } from "../../@types/event";
import { MatrixClient } from "../../client";
import type { Room } from "../../models/room";
import type { RoomMember } from "../../models/room-member";
import type { MatrixEvent } from "../../models/event";
import { Method } from "../../http-api/method";
import { ClientPrefix } from "../../http-api/prefix";
import { BaseManager, type ManagerOpts } from "../../managers/base-manager";
import { LRUCache } from "../../utils/lru-cache";
import { MatrixError } from "../../http-api/errors";
import { NotFoundError } from "../../errors";
import { validateUserId } from "../../common/validators";

import { DMEvent, type DirectMessageManagerEventMap } from "../events";
import type {
    DmRoomInfo,
    IDirectRoomsMap,
    DirectRoomsResponse,
    DmRoomCheckResponse,
    DmPartnerResponse,
} from "./dm-room-list-types";

export class DmRoomListManager extends BaseManager<DMEvent, DirectMessageManagerEventMap> {
    // 缓存为 public readonly：creation/operation sub-manager 通过 listManager 引用直接读写缓存内容。
    // （字段引用不可重新赋值，但 LRUCache 内部状态可变——这是有意的，避免为每个操作包装一层方法。）
    public readonly dmRoomsCache: LRUCache<DmRoomInfo>;
    public readonly userDmMapCache: LRUCache<string>;

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
        this.dmRoomsCache = new LRUCache<DmRoomInfo>(100, 5 * 60 * 1000);
        this.userDmMapCache = new LRUCache<string>(200, 10 * 60 * 1000);
    }

    /**
     * 获取当前用户的所有 DM 房间
     *
     * ⚠️ 注意：m.direct 是用户级别的 account data，不是房间级别
     * 正确做法是读取 client.getAccountData(EventType.Direct)
     *
     * 优先使用 m.direct 映射获取 DM，如果映射为空或不完整，
     * 会回退到扫描所有房间来识别 DM 房间
     *
     * 后端实现: synapse-rust/src/web/routes/dm.rs:268-281
     *
     * @returns DM 房间信息列表
     */
    async getDMRooms(): Promise<DmRoomInfo[]> {
        try {
            const dmMap = await this.getDirectRoomsByUser();
            const rooms = this.client.getRooms();
            const dmRooms: DmRoomInfo[] = [];
            const currentUserId = this.client.getUserId();

            if (!currentUserId) {
                return [];
            }

            let foundFromDirectMap = 0;

            for (const [userId, roomIds] of Object.entries(dmMap)) {
                for (const roomId of roomIds as string[]) {
                    const room = rooms.find((r) => r.roomId === roomId);
                    if (room) {
                        const membership = room.getMyMembership();
                        if (membership === "join" || membership === "invite") {
                            const dmInfo = await this.buildDmRoomInfo(room, userId);
                            dmRooms.push(dmInfo);
                            this.dmRoomsCache.set(roomId, dmInfo);
                            foundFromDirectMap++;
                        }
                    }
                }
            }

            if (foundFromDirectMap === 0) {
                const fallbackDmRooms = await this.getDMRoomsFromRoomScan();
                for (const room of fallbackDmRooms) {
                    if (!dmRooms.find((r) => r.roomId === room.roomId)) {
                        dmRooms.push(room);
                    }
                }
            }

            return dmRooms;
        } catch (e) {
            throw this.normalizeError(e, "getDMRooms");
        }
    }

    /**
     * 通过扫描房间来获取 DM 房间（回退机制）
     *
     * 当 m.direct 映射不可用时使用
     */
    private async getDMRoomsFromRoomScan(): Promise<DmRoomInfo[]> {
        const rooms = this.client.getRooms();
        const dmRooms: DmRoomInfo[] = [];
        const currentUserId = this.client.getUserId();

        if (!currentUserId) {
            return [];
        }

        for (const room of rooms) {
            const memberCount = room.getJoinedMembers().length;
            if (memberCount > 2) {
                continue;
            }

            const membership = room.getMyMembership();
            if (membership === "join" || membership === "invite") {
                const otherMembers = room.getJoinedMembers().filter((m: RoomMember) => m.userId !== currentUserId);

                if (otherMembers.length === 1) {
                    const dmPartner = otherMembers[0].userId;
                    const dmInfo = await this.buildDmRoomInfo(room, dmPartner);
                    dmRooms.push(dmInfo);
                    this.dmRoomsCache.set(room.roomId, dmInfo);
                }
            }
        }

        return dmRooms;
    }

    /**
     * 构建 DM 房间信息
     *
     * @param room - 房间对象
     * @param dmPartner - DM 伙伴用户 ID（可选，如果不传则从 m.direct 推断）
     * @returns DM 房间信息
     */
    private async buildDmRoomInfo(room: Room, dmPartner?: string): Promise<DmRoomInfo> {
        const roomId = room.roomId;
        const members = room.getJoinedMembers() || [];
        const currentUserId = this.client.getUserId();

        // 获取 DM 伙伴（优先使用传入的，否则从 m.direct 推断）
        let partner: string | undefined = dmPartner;
        if (!partner) {
            partner = this.getDmPartnerFromDirect(roomId) ?? undefined;
        }

        // 获取其他成员（排除当前用户）
        const otherMembers = members.filter((m: RoomMember) => m.userId !== currentUserId);

        const dmInfo: DmRoomInfo = {
            roomId,
            inviter: partner,
            invitees: otherMembers.map((m: RoomMember) => m.userId),
            name: room.name,
            avatarUrl: room.getAvatarUrl(this.client.getHomeserverUrl(), 32, 32, "crop") ?? undefined,
        };

        // ⚠️ m.direct 不是房间级别的 account data，不要在这里读取
        // 房间可能有 m.direct 事件但这不是判断 DM 的正确方式
        // 应该使用 client.getAccountData(EventType.Direct) 获取用户级别的 DM 映射

        // 获取最后消息
        const timeline = room.getLiveTimeline?.();
        if (timeline) {
            const events = timeline.getEvents?.() || [];
            const lastMessageEvent = events.filter((e: MatrixEvent) => e.getType() === "m.room.message").pop();

            if (lastMessageEvent) {
                dmInfo.lastMessage = {
                    content: lastMessageEvent.getContent?.()?.body || "",
                    timestamp: lastMessageEvent.getTs?.() || 0,
                    sender: lastMessageEvent.getSender?.() || "",
                };
            }
        }

        // 获取未读数
        const unreadNotifications = room.getUnreadNotificationCount(NotificationCountType.Total);
        if (unreadNotifications !== undefined) {
            dmInfo.unreadCount = unreadNotifications;
        }

        return dmInfo;
    }

    /**
     * 从 m.direct 获取 DM 伙伴用户 ID
     *
     * ⚠️ m.direct 是用户级别的 account data，格式为 { [userId]: [roomId, ...] }
     *
     * @param roomId - 房间 ID
     * @returns DM 伙伴用户 ID 或 null
     */
    private getDmPartnerFromDirect(roomId: string): string | null {
        const dmMap = this.getDirectRoomsByUserSync();
        for (const [userId, roomIds] of Object.entries(dmMap)) {
            if ((roomIds as string[]).includes(roomId)) {
                return userId;
            }
        }
        return null;
    }

    /**
     * 同步获取 m.direct 映射（从缓存）
     *
     * ⚠️ 这是同步方法，直接从 account data 缓存读取
     * 如果缓存未更新，可能返回过时数据
     *
     * @returns m.direct 映射 { [userId]: [roomId, ...] }
     */
    public getDirectRoomsByUserSync(): IDirectRoomsMap {
        try {
            const accountData = this.client.getAccountData(EventType.Direct);
            if (!accountData) {
                return {};
            }
            const content = accountData.getContent() || {};
            return content as IDirectRoomsMap;
        } catch (e) {
            logger.warn("DirectMessageManager.getDirectRoomsByUserSync failed:", e);
            throw this.normalizeError(e, "getDirectRoomsByUserSync");
        }
    }

    /**
     * 获取用户的 DM 房间
     *
     * @param userId - 用户 ID（格式：@localpart:homeserver）
     * @returns DM 房间 ID 或 null
     *
     * @example
     * ```typescript
     * // 获取与用户的 DM 房间
     * const roomId = await dmManager.getDmForUser("@alice:example.com");
     * if (roomId) {
     *     console.log("DM room:", roomId);
     *     // 发送消息
     *     await dmManager.sendDmMessage(roomId, "Hello!");
     * } else {
     *     console.log("No DM room exists");
     *     // 创建新的 DM
     *     const newRoomId = await dmManager.createDm(["@alice:example.com"]);
     * }
     * ```
     *
     * @throws {ValidationError} 如果用户 ID 格式无效
     * @throws {ApiError} 如果 API 调用失败
     */
    async getDmForUser(userId: string): Promise<string | null> {
        validateUserId(userId);
        const cached = this.userDmMapCache.get(userId);
        if (cached) {
            return cached;
        }

        try {
            const dmMap = await this.getDirectRoomsByUser();
            const roomIds = dmMap[userId];

            if (roomIds && roomIds.length > 0) {
                const roomId = roomIds[0];
                this.userDmMapCache.set(userId, roomId);
                return roomId;
            }

            return null;
        } catch (e) {
            throw this.normalizeError(e, "getDmForUser");
        }
    }

    /**
     * 获取用户级别的 m.direct 映射
     *
     * ⚠️ m.direct 是用户级别的 account data，不是房间级别
     * 正确: client.getAccountData(EventType.Direct)
     *
     * @returns m.direct 映射 { [userId]: [roomId, ...] }
     */
    async getDirectRoomsByUser(): Promise<IDirectRoomsMap> {
        try {
            // ⚠️ 关键：m.direct 是用户级别的 account data
            const accountData = this.client.getAccountData(EventType.Direct);
            if (!accountData) {
                return {};
            }

            const content = accountData.getContent() || {};
            return content as IDirectRoomsMap;
        } catch (e) {
            logger.warn("DirectMessageManager.getDirectRoomsByUser failed:", e);
            throw this.normalizeError(e, "getDirectRoomsByUser");
        }
    }

    /**
     * 获取 DM 房间信息
     *
     * @param roomId - 房间 ID
     * @returns DM 房间信息
     */
    async getDmRoomInfo(roomId: string): Promise<DmRoomInfo | null> {
        const cached = this.dmRoomsCache.get(roomId);
        if (cached) {
            return cached;
        }

        try {
            const room = this.client.getRoom(roomId);
            if (!room) {
                return null;
            }

            const dmPartner = this.getDmPartnerFromDirect(roomId);
            const dmInfo = await this.buildDmRoomInfo(room, dmPartner ?? undefined);
            this.dmRoomsCache.set(roomId, dmInfo);

            return dmInfo;
        } catch (e) {
            throw this.normalizeError(e, "getDmRoomInfo");
        }
    }

    /**
     * 获取缓存的 DM 房间列表
     */
    getCachedDmRooms(): DmRoomInfo[] {
        return this.dmRoomsCache.values();
    }

    /**
     * 获取缓存的用户 DM 房间 ID
     */
    getCachedDmForUser(userId: string): string | null {
        return this.userDmMapCache.get(userId) || null;
    }

    /**
     * 获取所有 DM 房间信息（使用缓存）
     */
    async getDmRoomInfos(): Promise<DmRoomInfo[]> {
        return this.getCachedDmRooms();
    }

    /**
     * 检查房间是否为 DM
     *
     * ⚠️ 判断逻辑：
     * 1. 首先检查 m.direct 映射中是否包含此房间
     * 2. m.direct 是用户级别的 account data
     *
     * @param roomId - 房间 ID
     * @returns 是否为 DM 房间
     */
    async checkRoomIsDm(roomId: string): Promise<boolean> {
        const dmMap = this.getDirectRoomsByUserSync();
        for (const roomIds of Object.values(dmMap)) {
            if ((roomIds as string[]).includes(roomId)) {
                return true;
            }
        }

        const room = this.client.getRoom(roomId);
        if (room) {
            const members = room.getJoinedMembers();
            if (members && members.length === 2) {
                return true;
            }
        }

        return false;
    }

    /**
     * 获取 DM 伙伴用户 ID
     *
     * ⚠️ 从 m.direct 映射中获取 DM 伙伴
     *
     * @param roomId - 房间 ID
     * @returns 伙伴用户 ID 或 null
     */
    async getDmPartner(roomId: string): Promise<string | null> {
        const dmPartner = this.getDmPartnerFromDirect(roomId);
        if (dmPartner) {
            return dmPartner;
        }

        const room = this.client.getRoom(roomId);
        if (room) {
            const currentUserId = this.client.getUserId();
            const members = room.getJoinedMembers();
            const otherMembers = members.filter((m: RoomMember) => m.userId !== currentUserId);
            if (otherMembers.length === 1) {
                return otherMembers[0].userId;
            }
        }

        return null;
    }

    /**
     * 根据用户 ID 列表获取 DM 房间
     *
     * @param userIds - 用户 ID 列表
     * @returns 匹配的 DM 房间列表
     */
    async getDmRoomsByUserIds(userIds: string[]): Promise<Room[]> {
        try {
            const dmMap = await this.getDirectRoomsByUser();
            const matchedRooms: Room[] = [];
            const rooms = this.client.getRooms();

            for (const userId of userIds) {
                const roomIds = dmMap[userId];
                if (roomIds) {
                    for (const roomId of roomIds) {
                        const room = rooms.find((r) => r.roomId === roomId);
                        if (room && !matchedRooms.includes(room)) {
                            const membership = room.getMyMembership();
                            if (membership === "join" || membership === "invite") {
                                matchedRooms.push(room);
                            }
                        }
                    }
                }
            }

            return matchedRooms;
        } catch (e) {
            throw this.normalizeError(e, "getDmRoomsByUserIds");
        }
    }

    /**
     * 获取 DM 房间对象
     *
     * @param roomId - 房间 ID
     * @returns Room 对象或 null
     */
    async getDmRoom(roomId: string, throwOnError = true): Promise<Room | null> {
        const room = this.client.getRoom(roomId);
        if (room) {
            return room;
        }
        if (throwOnError) {
            throw new NotFoundError(`DM room not found: ${roomId}`);
        }
        return null;
    }

    /**
     * 从服务器获取 m.direct 映射
     *
     * 后端实现: GET /_matrix/client/v3/direct
     *
     * @returns m.direct 映射 { [userId]: [roomId, ...] }
     */
    async getDirectRoomsFromServer(): Promise<IDirectRoomsMap> {
        try {
            const response = await this.withRetry(async () => {
                return await this.request<DirectRoomsResponse>({
                    method: Method.Get,
                    path: "/direct",
                    prefix: ClientPrefix.V3,
                });
            });

            return response.rooms || {};
        } catch (error) {
            throw this.normalizeError(error, "getDirectRoomsFromServer");
        }
    }

    /**
     * 检查房间是否为 DM 房间（从服务器获取）
     *
     * @param roomId - 房间 ID
     * @param throwOnError - 是否抛出错误（默认 true，传 false 时使用兼容 fallback）
     * @returns 是否为 DM 房间
     */
    async isDmRoomFromServer(roomId: string, throwOnError = true): Promise<boolean> {
        if (!roomId) {
            throw new InvalidParamError("Room ID is required");
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.request<DmRoomCheckResponse>({
                    method: Method.Get,
                    path: `/rooms/${encodeURIComponent(roomId)}/dm`,
                    prefix: ClientPrefix.V3,
                });
            });

            return response["m.direct"] ?? false;
        } catch (error: unknown) {
            if (throwOnError) {
                throw error;
            }
            const httpStatus = (error as { httpStatus?: number })?.httpStatus;
            const errcode = (error as { errcode?: string })?.errcode;

            if (httpStatus === 404 || errcode === "M_NOT_FOUND") {
                return false;
            }
            throw this.normalizeError(error, "isDmRoomFromServer");
        }
    }

    /**
     * 获取 DM 伙伴（从服务器获取）
     *
     * @param roomId - 房间 ID
     * @param throwOnError - 是否抛出错误（默认 true，传 false 时使用兼容 fallback）
     * @returns 伙伴信息
     */
    async getDmPartnerFromServer(roomId: string, throwOnError = true): Promise<DmPartnerResponse | null> {
        if (!roomId) {
            throw new InvalidParamError("Room ID is required");
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.request<DmPartnerResponse>({
                    method: Method.Get,
                    path: `/rooms/${encodeURIComponent(roomId)}/dm/partner`,
                    prefix: ClientPrefix.V3,
                });
            });

            return response;
        } catch (error) {
            if (throwOnError) {
                throw error;
            }
            const status =
                error instanceof MatrixError ? error.httpStatus : (error as { statusCode?: number })?.statusCode;
            if (status === 404 || error instanceof NotFoundError) {
                // @swallow-error { owner: "dm", expires: "2026-12-31" }
                return null;
            }
            throw this.normalizeError(error, "getDmPartnerFromServer");
        }
    }

    /** 清空缓存（供顶层 DirectMessageManager.stop() 委托） */
    clearCache(): void {
        this.dmRoomsCache.clear();
        this.userDmMapCache.clear();
    }

    /** 返回缓存统计（供顶层 DirectMessageManager.getCacheStats() 委托） */
    getCacheStats(): {
        dmRooms: { size: number; hits: number; misses: number; hitRate: number };
        userDmMap: { size: number; hits: number; misses: number; hitRate: number };
    } {
        return {
            dmRooms: this.dmRoomsCache.getStats(),
            userDmMap: this.userDmMapCache.getStats(),
        };
    }
}
