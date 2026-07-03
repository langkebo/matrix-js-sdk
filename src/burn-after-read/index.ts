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
 * 提供消息阅后即焚功能，包含：
 * - 房间级阅后即焚设置管理
 * - 消息发送时自动附加焚毁元数据
 * - 客户端侧定时器 + 服务端双保险自动销毁
 * - 消息内容加密传输支持
 * - 统一错误处理与重试机制
 *
 * 对应后端 API (synapse-rust/src/web/routes/burn_after_read.rs):
 * - PUT  /_matrix/client/v1/rooms/{room_id}/burn          启用/配置阅后即焚
 * - GET  /_matrix/client/v1/rooms/{room_id}/burn          获取阅后即焚设置
 * - GET  /_matrix/client/v1/rooms/{room_id}/burn/pending  获取待删除消息
 * - POST /_matrix/client/v1/rooms/{room_id}/burn/{event_id} 标记消息已读(触发焚毁)
 * - DELETE /_matrix/client/v1/rooms/{room_id}/burn/{event_id} 取消阅后即焚
 * - PUT  /_matrix/client/v1/user/burn/config              设置全局默认配置
 * - GET  /_matrix/client/v1/user/burn/stats               获取统计信息
 *
 * 后端双路径销毁机制:
 * - 路径1 (隐式): RoomService.process_read_receipt 检测消息内容含 burn_after_read 后自动调度 RedactEvent
 * - 路径2 (显式): 客户端调用 markBurnRead API 触发服务端延迟删除
 * - 客户端定时器: 本地 setTimeout 作为第三重保障，到期后发送 redact 请求
 */

import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { MatrixClient } from "../client";
import { BaseManager, type ManagerOpts, type RequestStats } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import { NotFoundError, ValidationError, SdkError } from "../errors";
import { logger } from "../logger";
import type { IContent } from "../models/event";
import { doesClientAdvertiseSynapseRustFeature, SynapseRustFeature } from "../server-capabilities";
import type { BurnAfterReadPathPattern } from "./__generated__/route-table";

type StripV1<P extends string> = P extends `/_matrix/client/v1${infer Rest}` ? Rest : never;
type BurnAfterReadApiVersion = "v1" | "v3";

function bp<P extends StripV1<BurnAfterReadPathPattern>>(path: P): P {
    return path;
}

const DEFAULT_BURN_AFTER_MS = 60000;
const MAX_BURN_AFTER_MS = 86400000;
const MIN_BURN_AFTER_MS = 1000;
const BURN_TIMER_JITTER_MS = 500;
const BURN_RETRY_MAX = 3;
const BURN_RETRY_DELAY_MS = 1000;

export enum BurnAfterReadEvent {
    MessageSent = "MessageSent",
    MessageRead = "MessageRead",
    MessageBurned = "MessageBurned",
    BurnCancelled = "BurnCancelled",
    BurnError = "BurnError",
    SettingsChanged = "SettingsChanged",
}

export interface IBurnAfterReadMessage {
    event_id: string;
    room_id: string;
    sender: string;
    content: IContent;
    sent_at: number;
    read_at?: number;
    burned_at?: number;
    expires_in?: number;
    expires_at?: number;
    delete_at?: number;
    is_encrypted?: boolean;
}

export interface IBurnAfterReadConfig {
    enabled: boolean;
    default_expire_time?: number;
    max_expire_time?: number;
    min_expire_time?: number;
    allowed_room_types?: string[];
    encrypt_content?: boolean;
}

export interface IBurnSettings {
    enabled: boolean;
    burn_after_ms: number;
}

export interface IBurnStats {
    total_burned: number;
    total_pending: number;
    rooms_with_burn_enabled: number;
}

export interface IBurnPendingEvent {
    event_id: string;
    created_at: number;
    delete_at: number;
}

export interface ISendBurnAfterReadMessageRequest {
    room_id: string;
    content: IContent;
    expires_in?: number;
    msgtype?: string;
    encrypt?: boolean;
}

export interface IBurnAfterReadMessageResponse {
    event_id: string;
    expires_in: number;
    expires_at: number;
}

export interface IMarkBurnReadResponse {
    success: boolean;
    will_delete_at: number;
}

export interface ICancelBurnResponse {
    success: boolean;
}

export interface ISetBurnConfigResponse {
    default_burn_ms: number;
}

interface BurnAfterReadManagerEventMap {
    [BurnAfterReadEvent.MessageSent]: (message: IBurnAfterReadMessage) => void;
    [BurnAfterReadEvent.MessageRead]: (eventId: string, readAt: number) => void;
    [BurnAfterReadEvent.MessageBurned]: (eventId: string, burnedAt: number) => void;
    [BurnAfterReadEvent.BurnCancelled]: (eventId: string) => void;
    [BurnAfterReadEvent.BurnError]: (eventId: string, error: SdkError) => void;
    [BurnAfterReadEvent.SettingsChanged]: (roomId: string, settings: IBurnSettings) => void;
}

export class BurnAfterReadManager extends BaseManager<BurnAfterReadEvent, BurnAfterReadManagerEventMap> {
    private config: IBurnAfterReadConfig;
    private messages: Map<string, IBurnAfterReadMessage> = new Map();
    private burnTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
    private roomSettings: Map<string, IBurnSettings> = new Map();
    private burnRetryCount: Map<string, number> = new Map();

    constructor(client: MatrixClient, config?: Partial<IBurnAfterReadConfig>, opts?: ManagerOpts) {
        super(client, { maxRetries: 3, retryDelay: 1000, backoffMultiplier: 2, ...opts });
        this.config = {
            enabled: config?.enabled ?? true,
            default_expire_time: config?.default_expire_time ?? DEFAULT_BURN_AFTER_MS,
            max_expire_time: config?.max_expire_time ?? MAX_BURN_AFTER_MS,
            min_expire_time: config?.min_expire_time ?? MIN_BURN_AFTER_MS,
            allowed_room_types: config?.allowed_room_types,
            encrypt_content: config?.encrypt_content ?? false,
        };
    }

    private async resolveBurnPrefix(version?: BurnAfterReadApiVersion): Promise<ClientPrefix.V1 | ClientPrefix.V3> {
        if (version === "v3") {
            return ClientPrefix.V3;
        }
        if (version === "v1") {
            return ClientPrefix.V1;
        }

        const serverPrefersV3 = await doesClientAdvertiseSynapseRustFeature(
            this.client,
            SynapseRustFeature.BurnAfterRead,
            false,
            (e) => logger.debug("BurnAfterReadManager.resolveBurnPrefix fallback to v1", e),
        );
        return serverPrefersV3 ? ClientPrefix.V3 : ClientPrefix.V1;
    }

    public async enableBurn(
        roomId: string,
        burnAfterMs?: number,
        version?: BurnAfterReadApiVersion,
    ): Promise<IBurnSettings> {
        if (!roomId) {
            throw new ValidationError("BurnAfterReadManager.enableBurn: roomId is required");
        }

        const burnMs = burnAfterMs ?? this.config.default_expire_time ?? DEFAULT_BURN_AFTER_MS;
        this.validateBurnTime(burnMs);

        try {
            const prefix = await this.resolveBurnPrefix(version);
            const response = await this.withRetry(
                () =>
                    this.client.http.authedRequest<IBurnSettings>(
                        Method.Put,
                        bp(`/rooms/${encodeURIComponent(roomId)}/burn` as StripV1<BurnAfterReadPathPattern>),
                        undefined,
                        { enabled: true, burn_after_ms: burnMs },
                        { prefix },
                    ),
                "enableBurn",
            );

            const settings: IBurnSettings = {
                enabled: response.enabled ?? true,
                burn_after_ms: response.burn_after_ms ?? burnMs,
            };

            this.roomSettings.set(roomId, settings);
            this.emit(BurnAfterReadEvent.SettingsChanged, roomId, settings);

            return settings;
        } catch (error) {
            throw this.normalizeError(error, "enableBurn");
        }
    }

    public async disableBurn(roomId: string, version?: BurnAfterReadApiVersion): Promise<IBurnSettings> {
        if (!roomId) {
            throw new ValidationError("BurnAfterReadManager.disableBurn: roomId is required");
        }

        try {
            const prefix = await this.resolveBurnPrefix(version);
            const response = await this.withRetry(
                () =>
                    this.client.http.authedRequest<IBurnSettings>(
                        Method.Put,
                        bp(`/rooms/${encodeURIComponent(roomId)}/burn` as StripV1<BurnAfterReadPathPattern>),
                        undefined,
                        { enabled: false },
                        { prefix },
                    ),
                "disableBurn",
            );

            const settings: IBurnSettings = {
                enabled: response.enabled ?? false,
                burn_after_ms: response.burn_after_ms ?? DEFAULT_BURN_AFTER_MS,
            };

            this.roomSettings.set(roomId, settings);
            this.emit(BurnAfterReadEvent.SettingsChanged, roomId, settings);

            return settings;
        } catch (error) {
            throw this.normalizeError(error, "disableBurn");
        }
    }

    public async getBurnSettings(roomId: string, version?: BurnAfterReadApiVersion): Promise<IBurnSettings> {
        if (!roomId) {
            throw new ValidationError("BurnAfterReadManager.getBurnSettings: roomId is required");
        }

        try {
            const prefix = await this.resolveBurnPrefix(version);
            const response = await this.withRetry(
                () =>
                    this.client.http.authedRequest<IBurnSettings>(
                        Method.Get,
                        bp(`/rooms/${encodeURIComponent(roomId)}/burn` as StripV1<BurnAfterReadPathPattern>),
                        undefined,
                        undefined,
                        { prefix },
                    ),
                "getBurnSettings",
            );

            const settings: IBurnSettings = {
                enabled: response.enabled ?? false,
                burn_after_ms: response.burn_after_ms ?? DEFAULT_BURN_AFTER_MS,
            };

            this.roomSettings.set(roomId, settings);

            return settings;
        } catch (error) {
            throw this.normalizeError(error, "getBurnSettings");
        }
    }

    public async getPendingBurns(roomId: string, version?: BurnAfterReadApiVersion): Promise<IBurnPendingEvent[]> {
        if (!roomId) {
            throw new ValidationError("BurnAfterReadManager.getPendingBurns: roomId is required");
        }

        try {
            const prefix = await this.resolveBurnPrefix(version);
            const response = await this.withRetry(
                () =>
                    this.client.http.authedRequest<{ events?: IBurnPendingEvent[] }>(
                        Method.Get,
                        bp(`/rooms/${encodeURIComponent(roomId)}/burn/pending` as StripV1<BurnAfterReadPathPattern>),
                        undefined,
                        undefined,
                        { prefix },
                    ),
                "getPendingBurns",
            );

            return response.events || [];
        } catch (error) {
            throw this.normalizeError(error, "getPendingBurns");
        }
    }

    public async markBurnRead(
        roomId: string,
        eventId: string,
        version?: BurnAfterReadApiVersion,
    ): Promise<IMarkBurnReadResponse> {
        if (!roomId) {
            throw new ValidationError("BurnAfterReadManager.markBurnRead: roomId is required");
        }
        if (!eventId) {
            throw new ValidationError("BurnAfterReadManager.markBurnRead: eventId is required");
        }

        try {
            const prefix = await this.resolveBurnPrefix(version);
            const response = await this.withRetry(
                () =>
                    this.client.http.authedRequest<IMarkBurnReadResponse>(
                        Method.Post,
                        bp(
                            `/rooms/${encodeURIComponent(roomId)}/burn/${encodeURIComponent(eventId)}` as StripV1<BurnAfterReadPathPattern>,
                        ),
                        undefined,
                        undefined,
                        { prefix },
                    ),
                "markBurnRead",
            );

            const result: IMarkBurnReadResponse = {
                success: response.success ?? true,
                will_delete_at: response.will_delete_at,
            };

            const message = this.messages.get(eventId);
            if (message) {
                const now = Date.now();
                message.read_at = now;
                this.emit(BurnAfterReadEvent.MessageRead, eventId, now);

                if (message.expires_in) {
                    this.scheduleBurn(eventId, message.expires_in);
                }
            }

            return result;
        } catch (error) {
            const normalized = this.normalizeError(error, "markBurnRead");
            this.emit(BurnAfterReadEvent.BurnError, eventId, normalized);
            throw normalized;
        }
    }

    public async cancelBurn(
        roomId: string,
        eventId: string,
        version?: BurnAfterReadApiVersion,
    ): Promise<ICancelBurnResponse> {
        if (!roomId) {
            throw new ValidationError("BurnAfterReadManager.cancelBurn: roomId is required");
        }
        if (!eventId) {
            throw new ValidationError("BurnAfterReadManager.cancelBurn: eventId is required");
        }

        try {
            const prefix = await this.resolveBurnPrefix(version);
            const response = await this.withRetry(
                () =>
                    this.client.http.authedRequest<ICancelBurnResponse>(
                        Method.Delete,
                        bp(
                            `/rooms/${encodeURIComponent(roomId)}/burn/${encodeURIComponent(eventId)}` as StripV1<BurnAfterReadPathPattern>,
                        ),
                        undefined,
                        undefined,
                        { prefix },
                    ),
                "cancelBurn",
            );

            this.clearBurnTimer(eventId);
            this.burnRetryCount.delete(eventId);
            this.emit(BurnAfterReadEvent.BurnCancelled, eventId);

            return {
                success: response.success ?? true,
            };
        } catch (error) {
            throw this.normalizeError(error, "cancelBurn");
        }
    }

    public async setBurnConfig(
        defaultBurnMs: number,
        version?: BurnAfterReadApiVersion,
    ): Promise<ISetBurnConfigResponse> {
        this.validateBurnTime(defaultBurnMs);

        try {
            const prefix = await this.resolveBurnPrefix(version);
            const response = await this.withRetry(
                () =>
                    this.client.http.authedRequest<ISetBurnConfigResponse>(
                        Method.Put,
                        bp("/user/burn/config"),
                        undefined,
                        { default_burn_ms: defaultBurnMs },
                        { prefix },
                    ),
                "setBurnConfig",
            );

            const resultBurnMs = response.default_burn_ms ?? defaultBurnMs;
            this.config.default_expire_time = resultBurnMs;

            return {
                default_burn_ms: resultBurnMs,
            };
        } catch (error) {
            throw this.normalizeError(error, "setBurnConfig");
        }
    }

    public async getBurnStats(version?: BurnAfterReadApiVersion): Promise<IBurnStats> {
        try {
            const prefix = await this.resolveBurnPrefix(version);
            const response = await this.withRetry(
                () =>
                    this.client.http.authedRequest<IBurnStats>(
                        Method.Get,
                        bp("/user/burn/stats"),
                        undefined,
                        undefined,
                        {
                            prefix,
                        },
                    ),
                "getBurnStats",
            );

            return {
                total_burned: response.total_burned ?? 0,
                total_pending: response.total_pending ?? 0,
                rooms_with_burn_enabled: response.rooms_with_burn_enabled ?? 0,
            };
        } catch (error) {
            throw this.normalizeError(error, "getBurnStats");
        }
    }

    public async sendMessage(request: ISendBurnAfterReadMessageRequest): Promise<IBurnAfterReadMessageResponse> {
        if (!this.config.enabled) {
            throw new ValidationError("BurnAfterReadManager.sendMessage: burn after read is disabled");
        }

        if (!request.room_id) {
            throw new ValidationError("BurnAfterReadManager.sendMessage: room_id is required");
        }

        if (!request.content || typeof request.content !== "object") {
            throw new ValidationError("BurnAfterReadManager.sendMessage: content is required and must be an object");
        }

        const expiresIn = request.expires_in ?? this.config.default_expire_time ?? DEFAULT_BURN_AFTER_MS;
        this.validateBurnTime(expiresIn);

        try {
            const shouldEncrypt = request.encrypt ?? this.config.encrypt_content ?? false;

            const burnMetadata: IContent = {
                expires_in: expiresIn,
            };

            if (shouldEncrypt) {
                burnMetadata.encrypted = true;
            }

            const content: IContent = {
                ...request.content,
                "m.burn_after_read": burnMetadata,
            };

            if (request.msgtype) {
                content.msgtype = request.msgtype;
            }

            const response = await this.withRetry(
                () =>
                    this.client.http.authedRequest<{ event_id: string }>(
                        Method.Put,
                        `/rooms/${encodeURIComponent(request.room_id)}/send/m.room.message/${Date.now()}`,
                        undefined,
                        content,
                        { prefix: ClientPrefix.V3 },
                    ),
                "sendMessage",
            );

            const eventId = response.event_id;
            const now = Date.now();

            const message: IBurnAfterReadMessage = {
                event_id: eventId,
                room_id: request.room_id,
                sender: this.client.getUserId() ?? "",
                content: request.content,
                sent_at: now,
                expires_in: expiresIn,
                expires_at: now + expiresIn,
                is_encrypted: shouldEncrypt,
            };

            this.messages.set(eventId, message);
            this.emit(BurnAfterReadEvent.MessageSent, message);

            return {
                event_id: eventId,
                expires_in: expiresIn,
                expires_at: message.expires_at!,
            };
        } catch (error) {
            const normalized = this.normalizeError(error, "sendMessage");
            this.emit(BurnAfterReadEvent.BurnError, "", normalized);
            throw normalized;
        }
    }

    public async burnMessage(eventId: string): Promise<void> {
        if (!eventId) {
            throw new ValidationError("BurnAfterReadManager.burnMessage: eventId is required");
        }

        const message = this.messages.get(eventId);
        if (!message) {
            logger.debug(`BurnAfterReadManager.burnMessage: message ${eventId} not in local cache, skipping`);
            return;
        }

        try {
            await this.withRetry(
                () =>
                    this.client.http.authedRequest(
                        Method.Put,
                        `/rooms/${encodeURIComponent(message.room_id)}/redact/${encodeURIComponent(eventId)}/${Date.now()}`,
                        undefined,
                        { reason: "Burn after read" },
                        { prefix: ClientPrefix.V3 },
                    ),
                "burnMessage",
            );

            const now = Date.now();
            message.burned_at = now;

            this.clearBurnTimer(eventId);
            this.burnRetryCount.delete(eventId);
            this.emit(BurnAfterReadEvent.MessageBurned, eventId, now);

            this.messages.delete(eventId);
        } catch (error) {
            const retryCount = this.burnRetryCount.get(eventId) ?? 0;
            this.burnRetryCount.set(eventId, retryCount + 1);

            if (retryCount + 1 >= BURN_RETRY_MAX) {
                logger.error(
                    `BurnAfterReadManager.burnMessage: failed to burn message ${eventId} after ${BURN_RETRY_MAX} attempts`,
                    error,
                );
                this.clearBurnTimer(eventId);
                this.burnRetryCount.delete(eventId);
            } else {
                const retryDelay = BURN_RETRY_DELAY_MS * Math.pow(2, retryCount);
                logger.warn(
                    `BurnAfterReadManager.burnMessage: retry ${retryCount + 1}/${BURN_RETRY_MAX} for ${eventId} in ${retryDelay}ms`,
                );
                this.scheduleBurn(eventId, retryDelay);
            }

            const normalized = this.normalizeError(error, "burnMessage");
            this.emit(BurnAfterReadEvent.BurnError, eventId, normalized);
            throw normalized;
        }
    }

    public async markAsRead(_roomId: string, eventId: string): Promise<void> {
        const message = this.messages.get(eventId);
        if (!message) {
            return;
        }

        const now = Date.now();
        message.read_at = now;

        this.emit(BurnAfterReadEvent.MessageRead, eventId, now);

        if (message.expires_in) {
            this.scheduleBurn(eventId, message.expires_in);
        }
    }

    public async getBurnAfterReadMessages(roomId?: string): Promise<IBurnAfterReadMessage[]> {
        const messages = Array.from(this.messages.values());
        if (roomId) {
            return messages.filter((m) => m.room_id === roomId);
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
        this.burnRetryCount.delete(eventId);
        message.expires_at = undefined;
        message.expires_in = undefined;

        this.emit(BurnAfterReadEvent.BurnCancelled, eventId);
    }

    public async extendBurnTime(eventId: string, additionalTime: number): Promise<void> {
        if (!eventId) {
            throw new ValidationError("BurnAfterReadManager.extendBurnTime: eventId is required");
        }

        if (additionalTime <= 0) {
            throw new ValidationError("BurnAfterReadManager.extendBurnTime: additionalTime must be positive");
        }

        const message = this.messages.get(eventId);
        if (!message) {
            throw new NotFoundError("BurnAfterReadManager.extendBurnTime: message not found in local cache");
        }

        const newExpiresIn = (message.expires_in || 0) + additionalTime;
        this.validateBurnTime(newExpiresIn);

        message.expires_in = newExpiresIn;
        message.expires_at = Date.now() + newExpiresIn;

        this.clearBurnTimer(eventId);
        this.scheduleBurn(eventId, newExpiresIn);
    }

    public setConfig(config: Partial<IBurnAfterReadConfig>): void {
        if (config.default_expire_time !== undefined) {
            this.validateBurnTime(config.default_expire_time);
        }
        this.config = { ...this.config, ...config };
    }

    public getConfig(): IBurnAfterReadConfig {
        return { ...this.config };
    }

    public getBurnConfig(): IBurnAfterReadConfig {
        return this.getConfig();
    }

    public getCachedMessages(): IBurnAfterReadMessage[] {
        return Array.from(this.messages.values());
    }

    public getCachedMessage(eventId: string): IBurnAfterReadMessage | null {
        return this.messages.get(eventId) || null;
    }

    public getRoomSettings(roomId: string): IBurnSettings | undefined {
        return this.roomSettings.get(roomId);
    }

    public async enableBurnAfterRead(roomId: string, expireTime?: number): Promise<void> {
        this.config.enabled = true;
        if (expireTime !== undefined) {
            this.config.default_expire_time = expireTime;
        }
        await this.enableBurn(roomId, expireTime);
    }

    public async disableBurnAfterRead(roomId: string): Promise<void> {
        this.config.enabled = false;
        await this.disableBurn(roomId);
    }

    public async isBurnEnabled(roomId: string): Promise<boolean> {
        if (!(await this.isSupported())) {
            return false;
        }

        const cached = this.roomSettings.get(roomId);
        if (cached !== undefined) {
            return cached.enabled;
        }

        try {
            const settings = await this.getBurnSettings(roomId);
            return settings.enabled;
        } catch (e) {
            logger.debug("BurnAfterReadManager.isEnabled fallback to config default", e);
            return this.config.enabled;
        }
    }

    public async isSupported(): Promise<boolean> {
        return doesClientAdvertiseSynapseRustFeature(
            this.client,
            SynapseRustFeature.BurnAfterRead,
            this.config.enabled,
            (e) => logger.debug("BurnAfterReadManager.isSupported fallback to config default", e),
        );
    }

    public async getPendingLocalBurns(roomId: string): Promise<IBurnAfterReadMessage[]> {
        return this.getBurnAfterReadMessages(roomId);
    }

    public getActiveBurnCount(): number {
        return this.burnTimers.size;
    }

    public getRequestStats(): RequestStats {
        return super.getRequestStats();
    }

    public start(): void {
        logger.debug("BurnAfterReadManager.start: initialized");
    }

    public clearCache(): void {
        this.burnTimers.forEach((timer) => clearTimeout(timer));
        this.burnTimers.clear();
        this.burnRetryCount.clear();
        this.messages.clear();
        this.roomSettings.clear();
    }

    public stop(): void {
        this.burnTimers.forEach((timer) => clearTimeout(timer));
        this.burnTimers.clear();
        this.burnRetryCount.clear();
        this.messages.clear();
        this.roomSettings.clear();
        this.removeAllListeners();
        logger.debug("BurnAfterReadManager.stop: cleaned up all timers and caches");
    }

    private validateBurnTime(burnMs: number): void {
        if (typeof burnMs !== "number" || !Number.isFinite(burnMs) || burnMs <= 0) {
            throw new ValidationError("BurnAfterReadManager: burn time must be a positive finite number");
        }

        const minTime = this.config.min_expire_time ?? MIN_BURN_AFTER_MS;
        if (burnMs < minTime) {
            throw new ValidationError(`BurnAfterReadManager: burn time ${burnMs}ms is below minimum ${minTime}ms`);
        }

        const maxTime = this.config.max_expire_time ?? MAX_BURN_AFTER_MS;
        if (burnMs > maxTime) {
            throw new ValidationError(`BurnAfterReadManager: burn time ${burnMs}ms exceeds maximum ${maxTime}ms`);
        }
    }

    private scheduleBurn(eventId: string, delay: number): void {
        this.clearBurnTimer(eventId);

        const jitter = Math.floor(Math.random() * BURN_TIMER_JITTER_MS);
        const actualDelay = delay + jitter;

        const timer = setTimeout(() => {
            this.burnMessage(eventId).catch((e) => {
                logger.warn(`BurnAfterReadManager: auto-burn failed for ${eventId}:`, e);
            });
        }, actualDelay);

        this.burnTimers.set(eventId, timer);
    }

    private clearBurnTimer(eventId: string): void {
        const timer = this.burnTimers.get(eventId);
        if (timer) {
            clearTimeout(timer);
            this.burnTimers.delete(eventId);
        }
    }
}


export function extendMatrixClient(): void {
    MatrixClient.prototype.getBurnAfterReadManager = function (): BurnAfterReadManager {
        registerManagerClass("BurnAfterReadManager", BurnAfterReadManager);
    return getOrCreateManager(this, "BurnAfterReadManager", () => new BurnAfterReadManager(this));
    };
}

export default BurnAfterReadManager;
