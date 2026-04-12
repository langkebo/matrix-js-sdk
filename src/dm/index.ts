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
 * Direct Message Manager - 私信管理
 *
 * 提供私信房间创建、管理功能
 *
 * ⚠️ m.direct 是用户级别的 account data，不是房间级别
 * 正确位置: client.getAccountData(EventType.Direct)
 * 错误位置: room.getAccountData(EventType.Direct)
 */

import { InvalidParamError } from "../common/errors.ts";
import { logger } from "../logger.ts";
import { NotificationCountType } from "../models/room.ts";
import { EventType } from "../@types/event.ts";
import type { RoomMessageEventContent } from "../@types/events.ts";
import { MatrixClient } from "../client";
import type { Room } from "../models/room.ts";
import type { RoomMember } from "../models/room-member.ts";
import type { MatrixEvent } from "../models/event.ts";
import { Method } from "../http-api/method.ts";
import { ClientPrefix } from "../http-api/prefix.ts";
import { BaseManager } from "../managers/base-manager.ts";
import { LRUCache } from "../utils/lru-cache.ts";
import { MatrixError } from "../http-api/errors.ts";
import { NotFoundError } from "../errors.ts";
import { getOrCreateManager } from "../client-infra/manager-registry.ts";

export enum DMEvent {
    DMCreated = "DMCreated",
    DMLeft = "DMLeft",
    DMUpdated = "DMUpdated",
    ListUpdated = "ListUpdated",
}

export interface CreateDmOptions {
    userIds: string[];
    invite?: boolean;
    name?: string;
    topic?: string;
    isEncrypted?: boolean;
}

export interface DmRoomInfo {
    roomId: string;
    inviter?: string;
    invitees: string[];
    name?: string;
    avatarUrl?: string;
    lastMessage?: {
        content: string;
        timestamp: number;
        sender: string;
    };
    unreadCount?: number;
}

export interface IDirectRoomsMap {
    [userId: string]: string[];
}

interface EventIdResponse {
    event_id: string;
}

export interface CreateDmRoomResponse {
    room_id: string;
}

export interface DirectRoomsResponse {
    rooms: IDirectRoomsMap;
}

export interface DmRoomCheckResponse {
    "room_id": string;
    "m.direct": boolean;
}

export interface DmPartnerResponse {
    room_id: string;
    user_id: string;
    display_name: string;
    avatar_url: string;
}

interface DirectMessageManagerEventMap {
    [DMEvent.DMCreated]: (roomId: string, userIds: string[]) => void;
    [DMEvent.DMLeft]: (roomId: string) => void;
    [DMEvent.DMUpdated]: (roomId: string) => void;
    [DMEvent.ListUpdated]: () => void;
}

interface ICreateRoomResponse {
    room_id: string;
}

/**
 * Direct Message Manager - 私信管理
 *
 * ⚠️ 重要说明：
 * - m.direct 是存储在用户 account data 中的映射表，格式为 { [userId]: [roomId, ...] }
 * - 不要在 room 级别读取 m.direct，应该在 client 级别读取
 * - DM 房间的判断需要结合 m.direct 映射和房间成员关系
 *
 * 后端实现: synapse-rust/src/web/routes/dm.rs
 */
export class DirectMessageManager extends BaseManager<DMEvent, DirectMessageManagerEventMap> {
    private dmRoomsCache: LRUCache<DmRoomInfo>;
    private userDmMapCache: LRUCache<string>;
    private isInitialized: boolean = false;

    constructor(client: MatrixClient) {
        super(client);

        this.dmRoomsCache = new LRUCache<DmRoomInfo>(100, 5 * 60 * 1000);
        this.userDmMapCache = new LRUCache<string>(200, 10 * 60 * 1000);
    }

    /**
     * 创建私信
     *
     * 后端实现: synapse-rust/src/web/routes/dm.rs:185-200
     *
     * @param options - 创建选项
     * @returns 新创建的 DM 房间 ID
     */
    async createDm(options: CreateDmOptions | string[]): Promise<string> {
        const opts = Array.isArray(options) ? { userIds: options } : options;

        if (!opts.userIds || opts.userIds.length === 0) {
            throw new InvalidParamError("At least one user ID is required");
        }

        const existingDm = await this.getDmForUser(opts.userIds[0]);
        if (existingDm) {
            return existingDm;
        }

        const createOptions: Record<string, unknown> = {
            is_direct: true,
            invite: opts.userIds,
            preset: opts.isEncrypted === false ? "private_chat" : "trusted_private_chat",
        };

        if (opts.name) {
            createOptions.name = opts.name;
        }

        if (opts.topic) {
            createOptions.topic = opts.topic;
        }

        if (opts.isEncrypted !== false) {
            createOptions.initial_state = [
                {
                    type: "m.room.encryption",
                    state_key: "",
                    content: {
                        algorithm: "m.megolm.v1.aes-sha2",
                    },
                },
            ];
        }

        try {
            const response = await this.withRetry(async () => {
                return (await this.client.createRoom(createOptions)) as ICreateRoomResponse;
            });

            const roomId = response.room_id;

            const dmInfo: DmRoomInfo = {
                roomId,
                invitees: opts.userIds,
            };

            this.dmRoomsCache.set(roomId, dmInfo);
            opts.userIds.forEach((userId) => {
                this.userDmMapCache.set(userId, roomId);
            });

            await this.setDmRoom(roomId, opts.userIds[0]);

            this.emit(DMEvent.DMCreated, roomId, opts.userIds);
            this.emit(DMEvent.ListUpdated);

            return roomId;
        } catch (error) {
            throw this.normalizeError(error, "createDm");
        }
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
     * 后端实现: synapse-rust/src/web/routes/dm.rs:242-254
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
     * @param userId - 用户 ID
     * @returns DM 房间 ID 或 null
     */
    async getDmForUser(userId: string): Promise<string | null> {
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
     * 离开 DM 房间
     *
     * @param roomId - 房间 ID
     */
    async leaveDm(roomId: string): Promise<void> {
        if (!roomId) {
            throw new InvalidParamError("Room ID is required");
        }

        try {
            await this.withRetry(async () => {
                return await this.client.leave(roomId);
            });

            const dmInfo = this.dmRoomsCache.get(roomId);
            if (dmInfo) {
                dmInfo.invitees.forEach((userId) => {
                    this.userDmMapCache.delete(userId);
                });
            }
            this.dmRoomsCache.delete(roomId);

            this.emit(DMEvent.DMLeft, roomId);
            this.emit(DMEvent.ListUpdated);
        } catch (error) {
            throw this.normalizeError(error, "leaveDm");
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
     * 设置 DM 房间（更新 m.direct）
     *
     * @param roomId - 房间 ID
     * @param userId - DM 伙伴用户 ID
     */
    async setDmRoom(roomId: string, userId: string): Promise<void> {
        try {
            const dmMap = await this.getDirectRoomsByUser();

            if (!dmMap[userId]) {
                dmMap[userId] = [];
            }

            if (!dmMap[userId].includes(roomId)) {
                dmMap[userId].push(roomId);
            }

            // ⚠️ m.direct 是用户级别的 account data
            await this.client.setAccountData(EventType.Direct, dmMap);

            this.userDmMapCache.set(userId, roomId);
            this.emit(DMEvent.ListUpdated);
        } catch (error) {
            logger.error("DirectMessageManager.setDmRoom failed:", error);
            throw error;
        }
    }

    /**
     * 移除 DM 房间关联
     *
     * @param roomId - 房间 ID
     * @param userId - DM 伙伴用户 ID
     */
    async removeDmRoom(roomId: string, userId: string): Promise<void> {
        try {
            const dmMap = await this.getDirectRoomsByUser();

            if (dmMap[userId]) {
                dmMap[userId] = dmMap[userId].filter((id) => id !== roomId);

                if (dmMap[userId].length === 0) {
                    delete dmMap[userId];
                }
            }

            // ⚠️ m.direct 是用户级别的 account data
            await this.client.setAccountData(EventType.Direct, dmMap);

            if (this.userDmMapCache.get(userId) === roomId) {
                this.userDmMapCache.delete(userId);
            }

            this.dmRoomsCache.delete(roomId);
            this.emit(DMEvent.ListUpdated);
        } catch (error) {
            logger.error("DirectMessageManager.removeDmRoom failed:", error);
            throw error;
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
     * 标记 DM 为已读
     *
     * @param roomId - 房间 ID
     */
    async markDmAsRead(roomId: string): Promise<void> {
        try {
            await this.withRetry(async () => {
                const room = this.client.getRoom(roomId);
                if (room) {
                    const timeline = room.getLiveTimeline();
                    const events = timeline.getEvents();
                    const lastEvent = events[events.length - 1];
                    if (lastEvent) {
                        return await this.client.setRoomReadMarkers(roomId, lastEvent.getId()!, lastEvent);
                    }
                }
                return undefined;
            });
        } catch (error) {
            throw this.normalizeError(error, "markDmAsRead");
        }
    }

    /**
     * 发送 DM 消息
     *
     * @param roomId - 房间 ID
     * @param content - 消息内容（字符串或对象）
     * @returns 发送的事件 ID
     */
    async sendDmMessage(roomId: string, content: string | Record<string, unknown>): Promise<string> {
        try {
            return await this.withRetry(async () => {
                let messageContent: Record<string, unknown>;

                if (typeof content === "string") {
                    messageContent = {
                        msgtype: "m.text",
                        body: content,
                    };
                } else {
                    messageContent = content;
                }

                const response = (await this.client.sendEvent(
                    roomId,
                    EventType.RoomMessage,
                    messageContent as unknown as RoomMessageEventContent,
                )) as EventIdResponse;
                return response.event_id;
            });
        } catch (error) {
            throw this.normalizeError(error, "sendDmMessage");
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
    async getDmRoom(roomId: string, throwOnError = false): Promise<Room | null> {
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
     * 创建 DM 房间 (专用 API 封装)
     *
     * 后端实现: POST /_matrix/client/v3/create_dm
     *
     * @param userId - 对端用户 ID
     * @param options - 可选配置
     * @returns 新创建的 DM 房间 ID
     */
    async createDmRoom(userId: string, options?: { name?: string; topic?: string }): Promise<string> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<CreateDmRoomResponse>(
                    Method.Post,
                    "/create_dm",
                    undefined,
                    {
                        user_id: userId,
                        is_direct: true,
                        ...options,
                    },
                    { prefix: ClientPrefix.V3 },
                );
            });

            const roomId = response.room_id;

            const dmInfo: DmRoomInfo = {
                roomId,
                invitees: [userId],
            };

            this.dmRoomsCache.set(roomId, dmInfo);
            this.userDmMapCache.set(userId, roomId);

            this.emit(DMEvent.DMCreated, roomId, [userId]);
            this.emit(DMEvent.ListUpdated);

            return roomId;
        } catch (error) {
            throw this.normalizeError(error, "createDmRoom");
        }
    }

    async getDirectRoomsFromServer(): Promise<IDirectRoomsMap> {
        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<DirectRoomsResponse>(
                    Method.Get,
                    "/direct",
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            });

            return response.rooms || {};
        } catch (error) {
            throw this.normalizeError(error, "getDirectRoomsFromServer");
        }
    }

    async updateDirectRoom(roomId: string, userIds: string[]): Promise<void> {
        if (!roomId) {
            throw new InvalidParamError("Room ID is required");
        }

        try {
            await this.withRetry(async () => {
                return await this.client.http.authedRequest(
                    Method.Put,
                    `/direct/${encodeURIComponent(roomId)}`,
                    undefined,
                    { users: userIds },
                    { prefix: ClientPrefix.V3 },
                );
            });

            this.emit(DMEvent.ListUpdated);
        } catch (error) {
            throw this.normalizeError(error, "updateDirectRoom");
        }
    }

    /**
     * 检查房间是否为 DM 房间（从服务器获取）
     *
     * @param roomId - 房间 ID
     * @param throwOnError - 是否抛出错误（默认 false）
     * @returns 是否为 DM 房间
     */
    async isDmRoomFromServer(roomId: string, throwOnError = false): Promise<boolean> {
        if (!roomId) {
            throw new InvalidParamError("Room ID is required");
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<DmRoomCheckResponse>(
                    Method.Get,
                    `/rooms/${encodeURIComponent(roomId)}/dm`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
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
     * @param throwOnError - 是否抛出错误（默认 false）
     * @returns 伙伴信息
     */
    async getDmPartnerFromServer(roomId: string, throwOnError = false): Promise<DmPartnerResponse | null> {
        if (!roomId) {
            throw new InvalidParamError("Room ID is required");
        }

        try {
            const response = await this.withRetry(async () => {
                return await this.client.http.authedRequest<DmPartnerResponse>(
                    Method.Get,
                    `/rooms/${encodeURIComponent(roomId)}/dm/partner`,
                    undefined,
                    undefined,
                    { prefix: ClientPrefix.V3 },
                );
            });

            return response;
        } catch (error) {
            if (throwOnError) {
                throw error;
            }
            if (error instanceof MatrixError && error.httpStatus === 404) {
                // @swallow-error { owner: "dm", expires: "2026-12-31" }
                return null;
            }
            throw this.normalizeError(error, "getDmPartnerFromServer");
        }
    }

    /**
     * 初始化 DM 管理器
     */
    async start(): Promise<void> {
        if (this.isInitialized) return;

        try {
            const dmMap = await this.getDirectRoomsByUser();

            for (const [userId, roomIds] of Object.entries(dmMap)) {
                if (roomIds.length > 0) {
                    this.userDmMapCache.set(userId, roomIds[0]);
                }
            }

            this.isInitialized = true;
        } catch (e) {
            logger.warn("DirectMessageManager.start failed:", e);
        }
    }

    /**
     * 停止 DM 管理器
     */
    stop(): void {
        this.dmRoomsCache.clear();
        this.userDmMapCache.clear();
        this.isInitialized = false;
    }

    /**
     * 获取缓存统计
     */
    public getCacheStats(): {
        dmRooms: { size: number; hits: number; misses: number; hitRate: number };
        userDmMap: { size: number; hits: number; misses: number; hitRate: number };
    } {
        return {
            dmRooms: this.dmRoomsCache.getStats(),
            userDmMap: this.userDmMapCache.getStats(),
        };
    }
}

// Type declaration for MatrixClient extension
declare module "../client.ts" {
    interface MatrixClient {
        getDirectMessageManager(): DirectMessageManager;
    }
}

/**
 * 扩展 MatrixClient 原型
 */
export function extendMatrixClient(): void {
    if (!MatrixClient || !MatrixClient.prototype) return;
    if (MatrixClient.prototype.hasOwnProperty("getDirectMessageManager")) return;

    MatrixClient.prototype.getDirectMessageManager = function (): DirectMessageManager {
        return getOrCreateManager(this, "dm", () => new DirectMessageManager(this));
    };
}

export default extendMatrixClient;
