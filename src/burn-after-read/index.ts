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
 * Burn After Read Manager - 阅后即焚管理
 *
 * 提供消息阅后即焚功能
 * 对应后端 API:
 * - PUT /_matrix/client/v1/rooms/{room_id}/burn - 启用/配置阅后即焚
 * - GET /_matrix/client/v1/rooms/{room_id}/burn - 获取阅后即焚设置
 * - GET /_matrix/client/v1/rooms/{room_id}/burn/pending - 获取待删除消息
 * - POST /_matrix/client/v1/rooms/{room_id}/burn/{event_id} - 标记消息已读
 * - DELETE /_matrix/client/v1/rooms/{room_id}/burn/{event_id} - 取消阅后即焚
 * - PUT /_matrix/client/v1/user/burn/config - 设置全局默认配置
 * - GET /_matrix/client/v1/user/burn/stats - 获取统计信息
 */

import { logger } from "../logger.ts";
import { TypedEventEmitter } from "../models/typed-event-emitter.ts";
import { Method } from "../http-api/index.ts";
import { MatrixClient } from "../client.ts";

const CLIENT_PREFIX_V1 = { prefix: "/_matrix/client/v1" };

export enum BurnAfterReadEvent {
    MessageSent = "MessageSent",
    MessageRead = "MessageRead",
    MessageBurned = "MessageBurned",
    BurnError = "BurnError",
}

export interface IBurnAfterReadMessage {
    eventId: string;
    roomId: string;
    sender: string;
    content: any;
    sentAt: number;
    readAt?: number;
    burnedAt?: number;
    expiresIn?: number;
    expiresAt?: number;
    deleteAt?: number;
}

export interface IBurnAfterReadConfig {
    enabled: boolean;
    burnAfterMs?: number;
    defaultExpireTime?: number;
    maxExpireTime?: number;
    allowedRoomTypes?: string[];
}

export interface IBurnSettings {
    enabled: boolean;
    burnAfterMs: number;
}

export interface IBurnStats {
    totalBurned: number;
    totalPending: number;
    roomsWithBurnEnabled: number;
}

export interface IBurnPendingEvent {
    eventId: string;
    createdAt: number;
    deleteAt: number;
}

export interface ISendBurnAfterReadMessageRequest {
    roomId: string;
    content: any;
    expiresIn?: number;
    msgtype?: string;
}

export interface IBurnAfterReadMessageResponse {
    eventId: string;
    expiresIn: number;
    expiresAt: number;
}

interface BurnAfterReadManagerEventMap {
    [BurnAfterReadEvent.MessageSent]: (message: IBurnAfterReadMessage) => void;
    [BurnAfterReadEvent.MessageRead]: (eventId: string, readAt: number) => void;
    [BurnAfterReadEvent.MessageBurned]: (eventId: string, burnedAt: number) => void;
    [BurnAfterReadEvent.BurnError]: (eventId: string, error: Error) => void;
}

export class BurnAfterReadManager extends TypedEventEmitter<BurnAfterReadEvent, BurnAfterReadManagerEventMap> {
    private client: any;
    private config: IBurnAfterReadConfig;
    private messages: Map<string, IBurnAfterReadMessage> = new Map();
    private burnTimers: Map<string, NodeJS.Timeout> = new Map();

    constructor(client: any, config?: Partial<IBurnAfterReadConfig>) {
        super();
        this.client = client;
        this.config = {
            enabled: config?.enabled ?? true,
            defaultExpireTime: config?.defaultExpireTime ?? 30000,
            maxExpireTime: config?.maxExpireTime ?? 86400000,
            allowedRoomTypes: config?.allowedRoomTypes,
        };
    }

    /**
     * Enable burn after read for a room
     * PUT /_matrix/client/v1/rooms/{room_id}/burn
     */
    public async enableBurn(roomId: string, burnAfterMs?: number): Promise<IBurnSettings> {
        const burnMs = burnAfterMs ?? this.config.defaultExpireTime ?? 30000;

        const response = await this.client.http.authedRequest(
            Method.Put,
            `/_matrix/client/v1/rooms/${encodeURIComponent(roomId)}/burn`,
            undefined,
            { enabled: true, burn_after_ms: burnMs },
            CLIENT_PREFIX_V1,
        );

        return {
            enabled: response.enabled ?? true,
            burnAfterMs: response.burn_after_ms ?? burnMs,
        };
    }

    /**
     * Disable burn after read for a room
     * PUT /_matrix/client/v1/rooms/{room_id}/burn
     */
    public async disableBurn(roomId: string): Promise<IBurnSettings> {
        const response = await this.client.http.authedRequest(
            Method.Put,
            `/_matrix/client/v1/rooms/${encodeURIComponent(roomId)}/burn`,
            undefined,
            { enabled: false },
            CLIENT_PREFIX_V1,
        );

        return {
            enabled: response.enabled ?? false,
            burnAfterMs: response.burn_after_ms ?? 60000,
        };
    }

    /**
     * Get burn settings for a room
     * GET /_matrix/client/v1/rooms/{room_id}/burn
     */
    public async getBurnSettings(roomId: string): Promise<IBurnSettings> {
        const response = await this.client.http.authedRequest(
            Method.Get,
            `/_matrix/client/v1/rooms/${encodeURIComponent(roomId)}/burn`,
            undefined,
            undefined,
            CLIENT_PREFIX_V1,
        );

        return {
            enabled: response.enabled ?? false,
            burnAfterMs: response.burn_after_ms ?? 60000,
        };
    }

    /**
     * Get pending burn events for a room
     * GET /_matrix/client/v1/rooms/{room_id}/burn/pending
     */
    public async getPendingBurns(roomId: string): Promise<IBurnPendingEvent[]> {
        const response = await this.client.http.authedRequest(
            Method.Get,
            `/_matrix/client/v1/rooms/${encodeURIComponent(roomId)}/burn/pending`,
            undefined,
            undefined,
            CLIENT_PREFIX_V1,
        );

        const events = response.events || [];
        return events.map((e: any) => ({
            eventId: e.event_id,
            createdAt: e.created_at,
            deleteAt: e.delete_at,
        }));
    }

    /**
     * Mark message as read (triggers burn timer)
     * POST /_matrix/client/v1/rooms/{room_id}/burn/{event_id}
     */
    public async markBurnRead(roomId: string, eventId: string): Promise<{ success: boolean; willDeleteAt: number }> {
        const response = await this.client.http.authedRequest(
            Method.Post,
            `/_matrix/client/v1/rooms/${encodeURIComponent(roomId)}/burn/${encodeURIComponent(eventId)}`,
            undefined,
            undefined,
            CLIENT_PREFIX_V1,
        );

        return {
            success: response.success ?? true,
            willDeleteAt: response.will_delete_at,
        };
    }

    /**
     * Cancel pending burn for a message
     * DELETE /_matrix/client/v1/rooms/{room_id}/burn/{event_id}
     */
    public async cancelBurn(roomId: string, eventId: string): Promise<{ success: boolean }> {
        const response = await this.client.http.authedRequest(
            Method.Delete,
            `/_matrix/client/v1/rooms/${encodeURIComponent(roomId)}/burn/${encodeURIComponent(eventId)}`,
            undefined,
            undefined,
            CLIENT_PREFIX_V1,
        );

        return {
            success: response.success ?? true,
        };
    }

    /**
     * Set global burn configuration
     * PUT /_matrix/client/v1/user/burn/config
     */
    public async setBurnConfig(defaultBurnMs: number): Promise<{ defaultBurnMs: number }> {
        const response = await this.client.http.authedRequest(
            Method.Put,
            "/_matrix/client/v1/user/burn/config",
            undefined,
            { default_burn_ms: defaultBurnMs },
            CLIENT_PREFIX_V1,
        );

        return {
            defaultBurnMs: response.default_burn_ms ?? defaultBurnMs,
        };
    }

    /**
     * Get burn statistics for current user
     * GET /_matrix/client/v1/user/burn/stats
     */
    public async getBurnStats(): Promise<IBurnStats> {
        const response = await this.client.http.authedRequest(
            Method.Get,
            "/_matrix/client/v1/user/burn/stats",
            undefined,
            undefined,
            CLIENT_PREFIX_V1,
        );

        return {
            totalBurned: response.total_burned ?? 0,
            totalPending: response.total_pending ?? 0,
            roomsWithBurnEnabled: response.rooms_with_burn_enabled ?? 0,
        };
    }

    /**
     * Send a burn after read message
     * PUT /_matrix/client/v3/rooms/{room_id}/send/m.room.message/{txn_id}
     */
    public async sendMessage(request: ISendBurnAfterReadMessageRequest): Promise<IBurnAfterReadMessageResponse> {
        if (!this.config.enabled) {
            throw new Error("Burn after read is disabled");
        }

        if (!request.roomId) {
            throw new Error("Room ID is required");
        }

        const expiresIn = request.expiresIn ?? this.config.defaultExpireTime ?? 30000;

        if (this.config.maxExpireTime && expiresIn > this.config.maxExpireTime) {
            throw new Error(`Expire time exceeds maximum allowed (${this.config.maxExpireTime}ms)`);
        }

        try {
            const content = {
                ...request.content,
                "m.burn_after_read": {
                    expires_in: expiresIn,
                },
            };

            const response = await this.client.http.authedRequest(
                Method.Put,
                `/_matrix/client/v3/rooms/${encodeURIComponent(request.roomId)}/send/m.room.message/${Date.now()}`,
                undefined,
                content,
                { prefix: "/_matrix/client/v3" },
            );

            const eventId = response.event_id;
            const now = Date.now();

            const message: IBurnAfterReadMessage = {
                eventId,
                roomId: request.roomId,
                sender: this.client.getUserId(),
                content: request.content,
                sentAt: now,
                expiresIn,
                expiresAt: now + expiresIn,
            };

            this.messages.set(eventId, message);
            this.emit(BurnAfterReadEvent.MessageSent, message);

            this.scheduleBurn(eventId, expiresIn);

            return {
                eventId,
                expiresIn,
                expiresAt: message.expiresAt!,
            };
        } catch (error) {
            this.emit(BurnAfterReadEvent.BurnError, "", error as Error);
            throw error;
        }
    }

    public async markAsRead(roomId: string, eventId: string): Promise<void> {
        const message = this.messages.get(eventId);
        if (!message) {
            return;
        }

        const now = Date.now();
        message.readAt = now;

        this.emit(BurnAfterReadEvent.MessageRead, eventId, now);

        if (message.expiresIn) {
            this.scheduleBurn(eventId, message.expiresIn);
        }
    }

    public async burnMessage(eventId: string): Promise<void> {
        const message = this.messages.get(eventId);
        if (!message) {
            return;
        }

        try {
            await this.client.http.authedRequest(
                Method.Post,
                `/_matrix/client/v3/rooms/${encodeURIComponent(message.roomId)}/redact/${encodeURIComponent(eventId)}/${Date.now()}`,
                undefined,
                { reason: "Burn after read" },
                { prefix: "/_matrix/client/v3" },
            );

            const now = Date.now();
            message.burnedAt = now;

            this.clearBurnTimer(eventId);
            this.emit(BurnAfterReadEvent.MessageBurned, eventId, now);

            this.messages.delete(eventId);
        } catch (error) {
            this.emit(BurnAfterReadEvent.BurnError, eventId, error as Error);
            throw error;
        }
    }

    public async getBurnAfterReadMessages(roomId?: string): Promise<IBurnAfterReadMessage[]> {
        const messages = Array.from(this.messages.values());

        if (roomId) {
            return messages.filter((m) => m.roomId === roomId);
        }

        return messages;
    }

    public async getBurnAfterReadMessage(eventId: string): Promise<IBurnAfterReadMessage | null> {
        return this.messages.get(eventId) || null;
    }

    public async cancelLocalBurn(eventId: string): Promise<void> {
        const message = this.messages.get(eventId);
        if (!message) {
            return;
        }

        this.clearBurnTimer(eventId);
        message.expiresAt = undefined;
        message.expiresIn = undefined;
    }

    public async extendBurnTime(eventId: string, additionalTime: number): Promise<void> {
        const message = this.messages.get(eventId);
        if (!message) {
            throw new Error("Message not found");
        }

        const newExpiresIn = (message.expiresIn || 0) + additionalTime;

        if (this.config.maxExpireTime && newExpiresIn > this.config.maxExpireTime) {
            throw new Error(`Extended time exceeds maximum allowed (${this.config.maxExpireTime}ms)`);
        }

        message.expiresIn = newExpiresIn;
        message.expiresAt = Date.now() + newExpiresIn;

        this.clearBurnTimer(eventId);
        this.scheduleBurn(eventId, newExpiresIn);
    }

    private scheduleBurn(eventId: string, delay: number): void {
        this.clearBurnTimer(eventId);

        const timer = setTimeout(() => {
            this.burnMessage(eventId).catch((e) => {
                logger.warn(`Failed to burn message ${eventId}:`, e);
            });
        }, delay);

        this.burnTimers.set(eventId, timer);
    }

    private clearBurnTimer(eventId: string): void {
        const timer = this.burnTimers.get(eventId);
        if (timer) {
            clearTimeout(timer);
            this.burnTimers.delete(eventId);
        }
    }

    public setConfig(config: Partial<IBurnAfterReadConfig>): void {
        this.config = { ...this.config, ...config };
    }

    public getConfig(): IBurnAfterReadConfig {
        return { ...this.config };
    }

    public getCachedMessages(): IBurnAfterReadMessage[] {
        return Array.from(this.messages.values());
    }

    public getCachedMessage(eventId: string): IBurnAfterReadMessage | null {
        return this.messages.get(eventId) || null;
    }

    public async enableBurnAfterRead(roomId: string, expireTime?: number): Promise<void> {
        this.config.enabled = true;
        if (expireTime) {
            this.config.defaultExpireTime = expireTime;
        }
    }

    public async disableBurnAfterRead(_roomId: string): Promise<void> {
        this.config.enabled = false;
    }

    public async isBurnEnabled(_roomId: string): Promise<boolean> {
        return this.config.enabled;
    }

    public async getPendingLocalBurns(roomId: string): Promise<IBurnAfterReadMessage[]> {
        return this.getBurnAfterReadMessages(roomId);
    }

    public start(): void {
        // Initialization if needed
    }

    public clearCache(): void {
        this.burnTimers.forEach((timer) => clearTimeout(timer));
        this.burnTimers.clear();
        this.messages.clear();
    }

    public stop(): void {
        this.burnTimers.forEach((timer) => clearTimeout(timer));
        this.burnTimers.clear();
        this.messages.clear();
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getBurnAfterReadManager(): BurnAfterReadManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getBurnAfterReadManager = function (): BurnAfterReadManager {
        return new BurnAfterReadManager(this);
    };
}

export default BurnAfterReadManager;
