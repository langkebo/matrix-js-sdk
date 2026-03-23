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
 */

import { TypedEventEmitter } from "../models/typed-event-emitter.ts";
import { InvalidParamError } from "../common/errors.ts";
import { logger } from "../logger.ts";
import { NotificationCountType } from "../models/room.ts";
import { EventType } from "../@types/event.ts";
import type { MatrixClient } from "../client.ts";
import type { Room } from "../models/room.ts";
import type { RoomMember } from "../models/room-member.ts";
import type { MatrixEvent } from "../models/event.ts";

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

interface DirectMessageManagerEventMap {
    [DMEvent.DMCreated]: (roomId: string, userIds: string[]) => void;
    [DMEvent.DMLeft]: (roomId: string) => void;
    [DMEvent.DMUpdated]: (roomId: string) => void;
    [DMEvent.ListUpdated]: () => void;
}

interface ICreateRoomResponse {
    room_id: string;
}

interface IRoomMember {
    userId: string;
}

export class DirectMessageManager extends TypedEventEmitter<DMEvent, DirectMessageManagerEventMap> {
    private client: MatrixClient;
    private dmRooms: Map<string, DmRoomInfo> = new Map();
    private userDmMap: Map<string, string> = new Map();
    private initialized: boolean = false;

    constructor(client: MatrixClient) {
        super();
        this.client = client;
    }

    async createDm(options: CreateDmOptions | string[]): Promise<string> {
        const opts = Array.isArray(options) 
            ? { userIds: options } 
            : options;

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
            preset: opts.isEncrypted === false ? 'private_chat' : 'trusted_private_chat',
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
                    type: 'm.room.encryption',
                    state_key: '',
                    content: {
                        algorithm: 'm.megolm.v1.aes-sha2',
                    },
                },
            ];
        }

        try {
            const response = await this.client.createRoom(createOptions) as ICreateRoomResponse;
            const roomId = response.room_id;

            const dmInfo: DmRoomInfo = {
                roomId,
                invitees: opts.userIds,
            };

            this.dmRooms.set(roomId, dmInfo);
            opts.userIds.forEach(userId => {
                this.userDmMap.set(userId, roomId);
            });

            this.emit(DMEvent.DMCreated, roomId, opts.userIds);
            this.emit(DMEvent.ListUpdated);

            return roomId;
        } catch (error) {
            logger.error('DirectMessageManager.createDm failed:', error);
            throw error;
        }
    }

    async getDMRooms(): Promise<DmRoomInfo[]> {
        try {
            const rooms = this.client.getRooms();
            const dmRooms: DmRoomInfo[] = [];

            for (const room of rooms) {
                const membership = room.getMyMembership();
                if (membership === 'invite') {
                    const roomId = room.roomId;
                    const dmInfo = await this.buildDmRoomInfo(room);
                    dmRooms.push(dmInfo);
                    this.dmRooms.set(roomId, dmInfo);
                }
            }

            return dmRooms;
        } catch (e) {
            logger.warn('DirectMessageManager.getDMRooms failed:', e);
            return Array.from(this.dmRooms.values());
        }
    }

    private async buildDmRoomInfo(room: Room): Promise<DmRoomInfo> {
        const roomId = room.roomId;
        const members = room.getJoinedMembers() || [];
        const currentUserId = this.client.getUserId();
        const otherMembers = members.filter(
            (m: RoomMember) => m.userId !== currentUserId
        );

        const dmInfo: DmRoomInfo = {
            roomId,
            invitees: otherMembers.map((m: RoomMember) => m.userId),
            name: room.name,
            avatarUrl: room.getAvatarUrl(this.client.getHomeserverUrl(), 32, 32, 'crop') ?? undefined,
        };

        const accountData = room.getAccountData(EventType.Direct);
        if (accountData) {
            const content = accountData.getContent() || {};
            for (const [userId, roomIds] of Object.entries(content)) {
                if ((roomIds as string[]).includes(roomId)) {
                    dmInfo.inviter = userId;
                    break;
                }
            }
        }

        const timeline = room.getLiveTimeline?.();
        if (timeline) {
            const events = timeline.getEvents?.() || [];
            const lastMessageEvent = events
                .filter((e: MatrixEvent) => e.getType() === 'm.room.message')
                .pop();
            
            if (lastMessageEvent) {
                dmInfo.lastMessage = {
                    content: lastMessageEvent.getContent?.()?.body || '',
                    timestamp: lastMessageEvent.getTs?.() || 0,
                    sender: lastMessageEvent.getSender?.() || '',
                };
            }
        }

        const unreadNotifications = room.getUnreadNotificationCount(NotificationCountType.Total);
        if (unreadNotifications !== undefined) {
            dmInfo.unreadCount = unreadNotifications;
        }

        return dmInfo;
    }

    async getDmForUser(userId: string): Promise<string | null> {
        if (this.userDmMap.has(userId)) {
            return this.userDmMap.get(userId) || null;
        }

        try {
            const dmMap = await this.getDirectRoomsByUser();
            const roomIds = dmMap[userId];
            
            if (roomIds && roomIds.length > 0) {
                const roomId = roomIds[0];
                this.userDmMap.set(userId, roomId);
                return roomId;
            }

            return null;
        } catch (e) {
            logger.warn('DirectMessageManager.getDmForUser failed:', e);
            return null;
        }
    }

    async leaveDm(roomId: string): Promise<void> {
        if (!roomId) {
            throw new InvalidParamError("Room ID is required");
        }

        try {
            await this.client.leave(roomId);

            const dmInfo = this.dmRooms.get(roomId);
            if (dmInfo) {
                dmInfo.invitees.forEach(userId => {
                    this.userDmMap.delete(userId);
                });
            }
            this.dmRooms.delete(roomId);

            this.emit(DMEvent.DMLeft, roomId);
            this.emit(DMEvent.ListUpdated);
        } catch (error) {
            logger.error('DirectMessageManager.leaveDm failed:', error);
            throw error;
        }
    }

    async getDirectRoomsByUser(): Promise<IDirectRoomsMap> {
        try {
            const accountData = this.client.getAccountData(EventType.Direct);
            if (!accountData) {
                return {};
            }

            const content = accountData.getContent() || {};
            return content as IDirectRoomsMap;
        } catch (e) {
            logger.warn('DirectMessageManager.getDirectRoomsByUser failed:', e);
            return {};
        }
    }

    async setDmRoom(roomId: string, userId: string): Promise<void> {
        try {
            const dmMap = await this.getDirectRoomsByUser();
            
            if (!dmMap[userId]) {
                dmMap[userId] = [];
            }
            
            if (!dmMap[userId].includes(roomId)) {
                dmMap[userId].push(roomId);
            }

            await this.client.setAccountData(EventType.Direct, dmMap);

            this.userDmMap.set(userId, roomId);
            this.emit(DMEvent.ListUpdated);
        } catch (error) {
            logger.error('DirectMessageManager.setDmRoom failed:', error);
            throw error;
        }
    }

    async removeDmRoom(roomId: string, userId: string): Promise<void> {
        try {
            const dmMap = await this.getDirectRoomsByUser();
            
            if (dmMap[userId]) {
                dmMap[userId] = dmMap[userId].filter(id => id !== roomId);
                
                if (dmMap[userId].length === 0) {
                    delete dmMap[userId];
                }
            }

            await this.client.setAccountData(EventType.Direct, dmMap);

            if (this.userDmMap.get(userId) === roomId) {
                this.userDmMap.delete(userId);
            }
            
            this.emit(DMEvent.ListUpdated);
        } catch (error) {
            logger.error('DirectMessageManager.removeDmRoom failed:', error);
            throw error;
        }
    }

    async getDmRoomInfo(roomId: string): Promise<DmRoomInfo | null> {
        if (this.dmRooms.has(roomId)) {
            return this.dmRooms.get(roomId) || null;
        }

        try {
            const room = this.client.getRoom(roomId);
            if (!room) {
                return null;
            }

            const dmInfo = await this.buildDmRoomInfo(room);
            this.dmRooms.set(roomId, dmInfo);
            
            return dmInfo;
        } catch (e) {
            logger.warn('DirectMessageManager.getDmRoomInfo failed:', e);
            return null;
        }
    }

    async markDmAsRead(roomId: string): Promise<void> {
        try {
            const room = this.client.getRoom(roomId);
            if (room) {
                const timeline = room.getLiveTimeline();
                const events = timeline.getEvents();
                const lastEvent = events[events.length - 1];
                if (lastEvent) {
                    await this.client.setRoomReadMarkers(roomId, lastEvent.getId()!, lastEvent);
                }
            }
        } catch (error) {
            logger.error('DirectMessageManager.markDmAsRead failed:', error);
            throw error;
        }
    }

    async sendDmMessage(roomId: string, content: string | Record<string, unknown>): Promise<string> {
        try {
            let messageContent: Record<string, unknown>;
            
            if (typeof content === 'string') {
                messageContent = {
                    msgtype: 'm.text',
                    body: content,
                };
            } else {
                messageContent = content;
            }

            const response = await this.client.sendEvent(roomId, EventType.RoomMessage, messageContent as any);
            return response.event_id;
        } catch (error) {
            logger.error('DirectMessageManager.sendDmMessage failed:', error);
            throw error;
        }
    }

    getCachedDmRooms(): DmRoomInfo[] {
        return Array.from(this.dmRooms.values());
    }

    getCachedDmForUser(userId: string): string | null {
        return this.userDmMap.get(userId) || null;
    }

    async getDmRoomInfos(): Promise<DmRoomInfo[]> {
        return this.getCachedDmRooms();
    }

    async checkRoomIsDm(roomId: string): Promise<boolean> {
        const room = this.client.getRoom(roomId);
        if (!room) {
            return false;
        }
        const accountData = room.getAccountData(EventType.Direct);
        return !!accountData;
    }

    async getDmPartner(roomId: string): Promise<string | null> {
        const room = this.client.getRoom(roomId);
        if (!room) {
            return null;
        }
        const accountData = room.getAccountData(EventType.Direct);
        if (accountData) {
            const content = accountData.getContent() || {};
            for (const [userId, roomIds] of Object.entries(content)) {
                if ((roomIds as string[]).includes(roomId)) {
                    return userId;
                }
            }
        }
        return null;
    }

    async getDmRoomsByUserIds(userIds: string[]): Promise<Room[]> {
        return [];
    }

    async getDmRoom(roomId: string): Promise<Room | null> {
        const room = this.client.getRoom(roomId);
        return room || null;
    }

    async start(): Promise<void> {
        if (this.initialized) return;

        try {
            await this.getDMRooms();
            await this.getDirectRoomsByUser();
            this.initialized = true;
        } catch (e) {
            logger.warn('DirectMessageManager.start failed:', e);
        }
    }

    stop(): void {
        this.dmRooms.clear();
        this.userDmMap.clear();
        this.initialized = false;
    }
}
