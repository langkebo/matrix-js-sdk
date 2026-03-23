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
 * Sticky Event Manager - 粘性事件管理
 * 
 * 提供粘性事件的设置、获取、清除功能
 * 粘性事件是一种在房间中持久显示的事件，如公告、置顶消息等
 */

import { TypedEventEmitter } from "../models/typed-event-emitter.ts";

export enum StickyEvent {
    StickySet = "StickySet",
    StickyCleared = "StickyCleared",
    StickyUpdated = "StickyUpdated",
    StickyError = "StickyError",
}

export interface IStickyEventData {
    event_id: string;
    event_type: string;
    content: any;
    sender: string;
    ts: number;
}

export interface IStickyEventInfo {
    roomId: string;
    eventId: string;
    eventType: string;
    content: any;
    sender: string;
    timestamp: number;
}

interface StickyEventManagerEventMap {
    [StickyEvent.StickySet]: (roomId: string, stickyInfo: IStickyEventInfo) => void;
    [StickyEvent.StickyCleared]: (roomId: string) => void;
    [StickyEvent.StickyUpdated]: (roomId: string, stickyInfo: IStickyEventInfo) => void;
    [StickyEvent.StickyError]: (roomId: string, error: Error) => void;
}

export class StickyEventManager extends TypedEventEmitter<StickyEvent, StickyEventManagerEventMap> {
    private client: any;
    private stickyEvents: Map<string, IStickyEventInfo> = new Map();
    private stickyEventType: string = 'm.sticky_event';

    constructor(client: any) {
        super();
        this.client = client;
    }

    async setStickyEvent(roomId: string, eventId: string, content?: any): Promise<void> {
        if (!roomId || !eventId) {
            throw new Error("Room ID and event ID are required");
        }

        try {
            let stickyContent = content;

            if (!stickyContent) {
                const room = this.client.getRoom(roomId);
                if (room) {
                    const event = room.findEventById(eventId);
                    if (event) {
                        stickyContent = {
                            event_id: eventId,
                            event_type: event.getType(),
                            content: event.getContent(),
                            sender: event.getSender(),
                            ts: event.getTs(),
                        };
                    }
                }
            }

            if (!stickyContent) {
                throw new Error("Could not find event content");
            }

            await this.client.sendStateEvent(
                roomId,
                this.stickyEventType,
                stickyContent,
                ''
            );

            const stickyInfo: IStickyEventInfo = {
                roomId,
                eventId,
                eventType: stickyContent.event_type || 'm.room.message',
                content: stickyContent.content || stickyContent,
                sender: stickyContent.sender || this.client.getUserId(),
                timestamp: stickyContent.ts || Date.now(),
            };

            this.stickyEvents.set(roomId, stickyInfo);
            this.emit(StickyEvent.StickySet, roomId, stickyInfo);
        } catch (error) {
            this.emit(StickyEvent.StickyError, roomId, error as Error);
            throw error;
        }
    }

    async getStickyEvent(roomId: string): Promise<IStickyEventInfo | null> {
        if (!roomId) {
            throw new Error("Room ID is required");
        }

        if (this.stickyEvents.has(roomId)) {
            return this.stickyEvents.get(roomId) || null;
        }

        try {
            const room = this.client.getRoom(roomId);
            if (!room) {
                return null;
            }

            const stickyStateEvent = room.currentState.getStateEvents(this.stickyEventType, '');
            if (!stickyStateEvent) {
                return null;
            }

            const content = stickyStateEvent.getContent();
            const stickyInfo: IStickyEventInfo = {
                roomId,
                eventId: content.event_id || '',
                eventType: content.event_type || 'm.room.message',
                content: content.content || content,
                sender: stickyStateEvent.getSender(),
                timestamp: content.ts || stickyStateEvent.getTs(),
            };

            this.stickyEvents.set(roomId, stickyInfo);
            
            return stickyInfo;
        } catch (e) {
            logger.warn('StickyEventManager.getStickyEvent failed:', e);
            return null;
        }
    }

    async clearStickyEvent(roomId: string): Promise<void> {
        if (!roomId) {
            throw new Error("Room ID is required");
        }

        try {
            await this.client.sendStateEvent(
                roomId,
                this.stickyEventType,
                {},
                ''
            );

            this.stickyEvents.delete(roomId);
            this.emit(StickyEvent.StickyCleared, roomId);
        } catch (error) {
            this.emit(StickyEvent.StickyError, roomId, error as Error);
            throw error;
        }
    }

    async updateStickyEvent(roomId: string, eventId: string, content?: any): Promise<void> {
        await this.setStickyEvent(roomId, eventId, content);
        const stickyInfo = await this.getStickyEvent(roomId);
        if (stickyInfo) {
            this.emit(StickyEvent.StickyUpdated, roomId, stickyInfo);
        }
    }

    async hasStickyEvent(roomId: string): Promise<boolean> {
        const sticky = await this.getStickyEvent(roomId);
        return sticky !== null && sticky.eventId !== '';
    }

    async getStickyEventContent(roomId: string): Promise<any | null> {
        const stickyInfo = await this.getStickyEvent(roomId);
        return stickyInfo?.content || null;
    }

    async getStickyEventSender(roomId: string): Promise<string | null> {
        const stickyInfo = await this.getStickyEvent(roomId);
        return stickyInfo?.sender || null;
    }

    async getStickyEventTimestamp(roomId: string): Promise<number | null> {
        const stickyInfo = await this.getStickyEvent(roomId);
        return stickyInfo?.timestamp || null;
    }

    async pinMessage(roomId: string, eventId: string): Promise<void> {
        await this.setStickyEvent(roomId, eventId);
    }

    async unpinMessage(roomId: string): Promise<void> {
        await this.clearStickyEvent(roomId);
    }

    async getPinnedMessage(roomId: string): Promise<IStickyEventInfo | null> {
        return this.getStickyEvent(roomId);
    }

    async setAnnouncement(roomId: string, message: string, options?: {
        title?: string;
        priority?: 'low' | 'medium' | 'high';
        expires?: number;
    }): Promise<void> {
        const content = {
            event_id: `announcement_${Date.now()}`,
            event_type: 'm.room.message',
            content: {
                msgtype: 'm.text',
                body: message,
                title: options?.title,
                priority: options?.priority || 'medium',
            },
            sender: this.client.getUserId(),
            ts: Date.now(),
            expires: options?.expires,
        };

        await this.setStickyEvent(roomId, content.event_id, content);
    }

    async setPollAsSticky(roomId: string, pollEventId: string): Promise<void> {
        await this.setStickyEvent(roomId, pollEventId);
    }

    async getActiveStickyRooms(): Promise<string[]> {
        return Array.from(this.stickyEvents.keys());
    }

    async getStickyEventsForRooms(roomIds: string[]): Promise<Map<string, IStickyEventInfo>> {
        const result = new Map<string, IStickyEventInfo>();

        for (const roomId of roomIds) {
            const sticky = await this.getStickyEvent(roomId);
            if (sticky) {
                result.set(roomId, sticky);
            }
        }

        return result;
    }

    handleStateEvent(roomId: string, event: any): void {
        if (event.getType() !== this.stickyEventType) {
            return;
        }

        const content = event.getContent();
        
        if (!content || Object.keys(content).length === 0) {
            this.stickyEvents.delete(roomId);
            this.emit(StickyEvent.StickyCleared, roomId);
        } else {
            const stickyInfo: IStickyEventInfo = {
                roomId,
                eventId: content.event_id || '',
                eventType: content.event_type || 'm.room.message',
                content: content.content || content,
                sender: event.getSender(),
                timestamp: content.ts || event.getTs(),
            };

            this.stickyEvents.set(roomId, stickyInfo);
            this.emit(StickyEvent.StickyUpdated, roomId, stickyInfo);
        }
    }

    getCachedStickyEvent(roomId: string): IStickyEventInfo | null {
        return this.stickyEvents.get(roomId) || null;
    }

    getCachedStickyEvents(): Map<string, IStickyEventInfo> {
        return new Map(this.stickyEvents);
    }

    clearCache(): void {
        this.stickyEvents.clear();
    }

    async start(): Promise<void> {
        const rooms = this.client.getRooms?.() || [];
        for (const room of rooms) {
            try {
                await this.getStickyEvent(room.roomId);
            } catch (e) {
                logger.warn(`Failed to load sticky event for room ${room.roomId}:`, e);
            }
        }
    }

    stop(): void {
        this.stickyEvents.clear();
    }
}
