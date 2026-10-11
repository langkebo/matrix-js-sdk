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
import { ClientPrefix, VendorPrefix } from "../http-api/prefix";
import { MatrixClient } from "../client";
import { BaseManager, type ManagerOpts, type RequestStats } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import { NotFoundError, ValidationError, SdkError } from "../errors";
import { logger } from "../logger";
import type { IContent } from "../models/event";
import { doesClientAdvertiseSynapseRustFeature, SynapseRustFeature } from "../server-capabilities";
import type { BurnAfterReadPath } from "./__generated__/route-table";
import type { BurnSettings, BurnStats, PendingBurnEvent } from "./__generated__/dto";
import type { PathAssert, StripVendor } from "../http-api/strip-prefix";

type BurnAfterReadApiVersion = "v1" | "v3";

function bp<const P extends string>(path: P & PathAssert<P, StripVendor<BurnAfterReadPath>>): P {
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

// 契约 DTO 别名（ISSUE-2.2）：手写 IBurn* 改为 codegen Burn* 的别名，消除双类型家族。
// 保持 I 前缀命名以不破坏既有 import，单一权威在 __generated__/dto.ts。
export type IBurnSettings = BurnSettings;
export type IBurnStats = BurnStats;
export type IBurnPendingEvent = PendingBurnEvent;

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

    private async resolveBurnPrefix(version?: BurnAfterReadApiVersion): Promise<string> {
        // 显式指定版本时保留 client 前缀（向后兼容）。
        if (version === "v3") {
            return ClientPrefix.V3;
        }
        if (version === "v1") {
            return ClientPrefix.V1;
        }
        // 默认走 vendor 前缀（ISSUE-13：私有端点，后端 client 别名仍兼容）。
        return VendorPrefix;
    }

    /**
     * 启用指定房间的阅后即焚功能，并可指定消息焚毁延时。
     *
     * @param roomId - 房间 ID
     * @param burnAfterMs - 阅后焚毁延时（毫秒），默认取管理器配置的 `default_expire_time`
     * @param version - 可选的 API 版本（`"v1"` / `"v3"`），默认走 vendor 前缀
     * @returns 应用后的阅后即焚设置
     * @throws {ValidationError} 当 `roomId` 为空或焚毁时间超出允许范围时抛出
     * @example
     * ```typescript
     * const settings = await client.getBurnAfterReadManager().enableBurn("!room:example.com", 60000);
     * ```
     */
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

        const prefix = await this.resolveBurnPrefix(version);
        const response = await this.withRetry(
            () =>
                this.request<IBurnSettings>({
                    method: Method.Put,
                    path: bp(`/rooms/${encodeURIComponent(roomId)}/burn`),
                    body: { enabled: true, burn_after_ms: burnMs },
                    prefix,
                }),
            "enableBurn",
        );

        const settings: IBurnSettings = {
            enabled: response.enabled ?? true,
            burn_after_ms: response.burn_after_ms ?? burnMs,
        };

        this.roomSettings.set(roomId, settings);
        this.emit(BurnAfterReadEvent.SettingsChanged, roomId, settings);

        return settings;
    }

    /**
     * 关闭指定房间的阅后即焚功能。
     *
     * @param roomId - 房间 ID
     * @param version - 可选的 API 版本（`"v1"` / `"v3"`），默认走 vendor 前缀
     * @returns 关闭后的阅后即焚设置
     * @throws {ValidationError} 当 `roomId` 为空时抛出
     * @example
     * ```typescript
     * const settings = await client.getBurnAfterReadManager().disableBurn("!room:example.com");
     * ```
     */
    public async disableBurn(roomId: string, version?: BurnAfterReadApiVersion): Promise<IBurnSettings> {
        if (!roomId) {
            throw new ValidationError("BurnAfterReadManager.disableBurn: roomId is required");
        }

        const prefix = await this.resolveBurnPrefix(version);
        const response = await this.withRetry(
            () =>
                this.request<IBurnSettings>({
                    method: Method.Put,
                    path: bp(`/rooms/${encodeURIComponent(roomId)}/burn`),
                    body: { enabled: false },
                    prefix,
                }),
            "disableBurn",
        );

        const settings: IBurnSettings = {
            enabled: response.enabled ?? false,
            burn_after_ms: response.burn_after_ms ?? DEFAULT_BURN_AFTER_MS,
        };

        this.roomSettings.set(roomId, settings);
        this.emit(BurnAfterReadEvent.SettingsChanged, roomId, settings);

        return settings;
    }

    /**
     * 获取指定房间的阅后即焚设置，并写入本地缓存。
     *
     * @param roomId - 房间 ID
     * @param version - 可选的 API 版本（`"v1"` / `"v3"`），默认走 vendor 前缀
     * @returns 该房间的阅后即焚设置
     * @throws {ValidationError} 当 `roomId` 为空时抛出
     * @example
     * ```typescript
     * const settings = await client.getBurnAfterReadManager().getBurnSettings("!room:example.com");
     * ```
     */
    public async getBurnSettings(roomId: string, version?: BurnAfterReadApiVersion): Promise<IBurnSettings> {
        if (!roomId) {
            throw new ValidationError("BurnAfterReadManager.getBurnSettings: roomId is required");
        }

        const prefix = await this.resolveBurnPrefix(version);
        const response = await this.withRetry(
            () =>
                this.request<IBurnSettings>({
                    method: Method.Get,
                    path: bp(`/rooms/${encodeURIComponent(roomId)}/burn`),
                    prefix,
                }),
            "getBurnSettings",
        );

        const settings: IBurnSettings = {
            enabled: response.enabled ?? false,
            burn_after_ms: response.burn_after_ms ?? DEFAULT_BURN_AFTER_MS,
        };

        this.roomSettings.set(roomId, settings);

        return settings;
    }

    /**
     * 获取指定房间中尚未焚毁的待删除消息列表。
     *
     * @param roomId - 房间 ID
     * @param version - 可选的 API 版本（`"v1"` / `"v3"`），默认走 vendor 前缀
     * @returns 待删除的阅后即焚事件数组（无数据时为空数组）
     * @throws {ValidationError} 当 `roomId` 为空时抛出
     * @example
     * ```typescript
     * const pending = await client.getBurnAfterReadManager().getPendingBurns("!room:example.com");
     * ```
     */
    public async getPendingBurns(roomId: string, version?: BurnAfterReadApiVersion): Promise<IBurnPendingEvent[]> {
        if (!roomId) {
            throw new ValidationError("BurnAfterReadManager.getPendingBurns: roomId is required");
        }

        const prefix = await this.resolveBurnPrefix(version);
        const response = await this.withRetry(
            () =>
                this.request<{ events?: IBurnPendingEvent[] }>({
                    method: Method.Get,
                    path: bp(`/rooms/${encodeURIComponent(roomId)}/burn/pending`),
                    prefix,
                }),
            "getPendingBurns",
        );

        return response.events || [];
    }

    /**
     * 标记指定消息已被阅读，触发服务端延迟焚毁，并在本地调度定时器。
     *
     * @param roomId - 房间 ID
     * @param eventId - 消息事件 ID
     * @param version - 可选的 API 版本（`"v1"` / `"v3"`），默认走 vendor 前缀
     * @returns 标记结果，含预计删除时间
     * @throws {ValidationError} 当 `roomId` 或 `eventId` 为空时抛出
     * @throws {SdkError} 请求失败时抛出（同时触发 `BurnError` 事件）
     * @example
     * ```typescript
     * const result = await client.getBurnAfterReadManager().markBurnRead("!room:example.com", "$event");
     * ```
     */
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
                    this.request<IMarkBurnReadResponse>({
                        method: Method.Post,
                        path: bp(`/rooms/${encodeURIComponent(roomId)}/burn/${encodeURIComponent(eventId)}`),
                        prefix,
                    }),
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

    /**
     * 取消指定消息的阅后即焚，清除本地定时器并通知服务端。
     *
     * @param roomId - 房间 ID
     * @param eventId - 消息事件 ID
     * @param version - 可选的 API 版本（`"v1"` / `"v3"`），默认走 vendor 前缀
     * @returns 取消结果
     * @throws {ValidationError} 当 `roomId` 或 `eventId` 为空时抛出
     * @example
     * ```typescript
     * const result = await client.getBurnAfterReadManager().cancelBurn("!room:example.com", "$event");
     * ```
     */
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

        const prefix = await this.resolveBurnPrefix(version);
        const response = await this.withRetry(
            () =>
                this.request<ICancelBurnResponse>({
                    method: Method.Delete,
                    path: bp(`/rooms/${encodeURIComponent(roomId)}/burn/${encodeURIComponent(eventId)}`),
                    prefix,
                }),
            "cancelBurn",
        );

        this.clearBurnTimer(eventId);
        this.burnRetryCount.delete(eventId);
        this.emit(BurnAfterReadEvent.BurnCancelled, eventId);

        return {
            success: response.success ?? true,
        };
    }

    /**
     * 设置当前用户的全局默认焚毁延时。
     *
     * @param defaultBurnMs - 默认焚毁延时（毫秒）
     * @param version - 可选的 API 版本（`"v1"` / `"v3"`），默认走 vendor 前缀
     * @returns 服务端确认后的默认焚毁延时
     * @example
     * ```typescript
     * const result = await client.getBurnAfterReadManager().setBurnConfig(120000);
     * ```
     */
    public async setBurnConfig(
        defaultBurnMs: number,
        version?: BurnAfterReadApiVersion,
    ): Promise<ISetBurnConfigResponse> {
        this.validateBurnTime(defaultBurnMs);

        const prefix = await this.resolveBurnPrefix(version);
        const response = await this.withRetry(
            () =>
                this.request<ISetBurnConfigResponse>({
                    method: Method.Put,
                    path: bp("/user/burn/config"),
                    body: { default_burn_ms: defaultBurnMs },
                    prefix,
                }),
            "setBurnConfig",
        );

        const resultBurnMs = response.default_burn_ms ?? defaultBurnMs;
        this.config.default_expire_time = resultBurnMs;

        return {
            default_burn_ms: resultBurnMs,
        };
    }

    /**
     * 获取当前用户的阅后即焚统计信息。
     *
     * @param version - 可选的 API 版本（`"v1"` / `"v3"`），默认走 vendor 前缀
     * @returns 累计焚毁数、待焚毁数与启用房间数
     * @example
     * ```typescript
     * const stats = await client.getBurnAfterReadManager().getBurnStats();
     * ```
     */
    public async getBurnStats(version?: BurnAfterReadApiVersion): Promise<IBurnStats> {
        const prefix = await this.resolveBurnPrefix(version);
        const response = await this.withRetry(
            () =>
                this.request<IBurnStats>({
                    method: Method.Get,
                    path: bp("/user/burn/stats"),
                    prefix,
                }),
            "getBurnStats",
        );

        return {
            total_burned: response.total_burned ?? 0,
            total_pending: response.total_pending ?? 0,
            rooms_with_burn_enabled: response.rooms_with_burn_enabled ?? 0,
        };
    }

    /**
     * 发送一条带阅后即焚元数据的消息，并在本地登记焚毁计时。
     *
     * @param request - 发送请求，含房间 ID、内容与可选的焚毁延时
     * @returns 发送结果，含事件 ID 与过期时间
     * @throws {ValidationError} 当功能未启用、`room_id` / `content` 缺失或焚毁时间非法时抛出
     * @throws {SdkError} 请求失败时抛出（同时触发 `BurnError` 事件）
     * @example
     * ```typescript
     * const result = await client.getBurnAfterReadManager().sendMessage({
     *     room_id: "!room:example.com",
     *     content: { msgtype: "m.text", body: "secret" },
     *     expires_in: 60000,
     * });
     * ```
     */
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

            // 事务 ID 必须在闭包外生成：闭包内的 Date.now() 每次重试都不同，
            // 服务端无法按 txnId 去重（P3-1）。
            const txnId = `m${Date.now()}`;
            const response = await this.withRetry(
                () =>
                    this.request<{ event_id: string }>({
                        method: Method.Put,
                        path: `/rooms/${encodeURIComponent(request.room_id)}/send/m.room.message/${txnId}`,
                        body: content,
                        prefix: ClientPrefix.V3,
                        idempotencyKey: txnId,
                    }),
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

    /**
     * 立即焚毁指定消息（发送 redact 请求）；带指数退避重试。
     *
     * @param eventId - 要焚毁的消息事件 ID
     * @throws {ValidationError} 当 `eventId` 为空时抛出
     * @throws {SdkError} 请求失败时抛出（同时触发 `BurnError` 事件）
     * @example
     * ```typescript
     * await client.getBurnAfterReadManager().burnMessage("$event");
     * ```
     */
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
                    this.request({
                        method: Method.Put,
                        path: `/rooms/${encodeURIComponent(message.room_id)}/redact/${encodeURIComponent(eventId)}/${Date.now()}`,
                        body: { reason: "Burn after read" },
                        prefix: ClientPrefix.V3,
                    }),
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

    /**
     * 在本地将指定消息标记为已读，并按需调度焚毁定时器。
     *
     * @param _roomId - 保留参数，当前未使用（房间信息取自本地缓存）
     * @param eventId - 消息事件 ID
     * @example
     * ```typescript
     * await client.getBurnAfterReadManager().markAsRead("!room:example.com", "$event");
     * ```
     */
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

    /**
     * 获取本地缓存中的阅后即焚消息，可按房间过滤。
     *
     * @param roomId - 可选，仅返回该房间的消息
     * @returns 阅后即焚消息数组
     * @example
     * ```typescript
     * const messages = await client.getBurnAfterReadManager().getBurnAfterReadMessages("!room:example.com");
     * ```
     */
    public async getBurnAfterReadMessages(roomId?: string): Promise<IBurnAfterReadMessage[]> {
        const messages = Array.from(this.messages.values());
        if (roomId) {
            return messages.filter((m) => m.room_id === roomId);
        }
        return messages;
    }

    /**
     * 按事件 ID 获取本地缓存中的单条阅后即焚消息。
     *
     * @param eventId - 消息事件 ID
     * @returns 对应消息，缓存中不存在时返回 `null`
     * @example
     * ```typescript
     * const message = await client.getBurnAfterReadManager().getBurnAfterReadMessage("$event");
     * ```
     */
    public async getBurnAfterReadMessage(eventId: string): Promise<IBurnAfterReadMessage | null> {
        return this.messages.get(eventId) || null;
    }

    /**
     * 仅取消本地的焚毁计时，不向服务端发送请求。
     *
     * @param eventId - 消息事件 ID
     * @example
     * ```typescript
     * await client.getBurnAfterReadManager().cancelLocalBurn("$event");
     * ```
     */
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

    /**
     * 延长指定消息的焚毁倒计时，并重新调度本地定时器。
     *
     * @param eventId - 消息事件 ID
     * @param additionalTime - 追加的时长（毫秒），必须为正数
     * @throws {ValidationError} 当 `eventId` 为空、`additionalTime` 非正或累计时长超出范围时抛出
     * @throws {NotFoundError} 当本地缓存中不存在该消息时抛出
     * @example
     * ```typescript
     * await client.getBurnAfterReadManager().extendBurnTime("$event", 30000);
     * ```
     */
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

    /**
     * 合并更新本地管理器配置（不发起网络请求）。
     *
     * @param config - 需要覆盖的配置字段
     * @example
     * ```typescript
     * client.getBurnAfterReadManager().setConfig({ enabled: true, default_expire_time: 30000 });
     * ```
     */
    public setConfig(config: Partial<IBurnAfterReadConfig>): void {
        if (config.default_expire_time !== undefined) {
            this.validateBurnTime(config.default_expire_time);
        }
        this.config = { ...this.config, ...config };
    }

    /**
     * 获取当前管理器配置的副本。
     *
     * @returns 管理器配置对象
     * @example
     * ```typescript
     * const config = client.getBurnAfterReadManager().getConfig();
     * ```
     */
    public getConfig(): IBurnAfterReadConfig {
        return { ...this.config };
    }

    /**
     * `getConfig` 的别名，获取当前管理器配置。
     *
     * @returns 管理器配置对象
     * @example
     * ```typescript
     * const config = client.getBurnAfterReadManager().getBurnConfig();
     * ```
     */
    public getBurnConfig(): IBurnAfterReadConfig {
        return this.getConfig();
    }

    /**
     * 获取本地缓存中的全部阅后即焚消息。
     *
     * @returns 阅后即焚消息数组
     * @example
     * ```typescript
     * const messages = client.getBurnAfterReadManager().getCachedMessages();
     * ```
     */
    public getCachedMessages(): IBurnAfterReadMessage[] {
        return Array.from(this.messages.values());
    }

    /**
     * 按事件 ID 获取本地缓存中的单条阅后即焚消息。
     *
     * @param eventId - 消息事件 ID
     * @returns 对应消息，缓存中不存在时返回 `null`
     * @example
     * ```typescript
     * const message = client.getBurnAfterReadManager().getCachedMessage("$event");
     * ```
     */
    public getCachedMessage(eventId: string): IBurnAfterReadMessage | null {
        return this.messages.get(eventId) || null;
    }

    /**
     * 获取指定房间缓存的阅后即焚设置。
     *
     * @param roomId - 房间 ID
     * @returns 缓存的设置，未缓存时返回 `undefined`
     * @example
     * ```typescript
     * const settings = client.getBurnAfterReadManager().getRoomSettings("!room:example.com");
     * ```
     */
    public getRoomSettings(roomId: string): IBurnSettings | undefined {
        return this.roomSettings.get(roomId);
    }

    /**
     * 启用阅后即焚并同步到指定房间（同时更新本地默认配置）。
     *
     * @param roomId - 房间 ID
     * @param expireTime - 可选的默认焚毁延时（毫秒）
     * @example
     * ```typescript
     * await client.getBurnAfterReadManager().enableBurnAfterRead("!room:example.com", 60000);
     * ```
     */
    public async enableBurnAfterRead(roomId: string, expireTime?: number): Promise<void> {
        this.config.enabled = true;
        if (expireTime !== undefined) {
            this.config.default_expire_time = expireTime;
        }
        await this.enableBurn(roomId, expireTime);
    }

    /**
     * 关闭阅后即焚并同步到指定房间（同时更新本地默认配置）。
     *
     * @param roomId - 房间 ID
     * @example
     * ```typescript
     * await client.getBurnAfterReadManager().disableBurnAfterRead("!room:example.com");
     * ```
     */
    public async disableBurnAfterRead(roomId: string): Promise<void> {
        this.config.enabled = false;
        await this.disableBurn(roomId);
    }

    /**
     * 判断指定房间是否已启用阅后即焚（优先读缓存，未命中再查服务端）。
     *
     * @param roomId - 房间 ID
     * @returns 是否已启用；后端不支持时返回 `false`
     * @example
     * ```typescript
     * const enabled = await client.getBurnAfterReadManager().isBurnEnabled("!room:example.com");
     * ```
     */
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

    /**
     * 判断当前后端是否支持阅后即焚特性。
     *
     * @returns 是否支持；探测失败时回退到本地配置默认值
     * @example
     * ```typescript
     * const supported = await client.getBurnAfterReadManager().isSupported();
     * ```
     */
    public async isSupported(): Promise<boolean> {
        return doesClientAdvertiseSynapseRustFeature(
            this.client,
            SynapseRustFeature.BurnAfterRead,
            this.config.enabled,
            (e) => logger.debug("BurnAfterReadManager.isSupported fallback to config default", e),
        );
    }

    /**
     * 获取指定房间本地缓存的待焚毁消息。
     *
     * @param roomId - 房间 ID
     * @returns 待焚毁消息数组
     * @example
     * ```typescript
     * const pending = await client.getBurnAfterReadManager().getPendingLocalBurns("!room:example.com");
     * ```
     */
    public async getPendingLocalBurns(roomId: string): Promise<IBurnAfterReadMessage[]> {
        return this.getBurnAfterReadMessages(roomId);
    }

    /**
     * 获取当前活跃的本地焚毁定时器数量。
     *
     * @returns 活跃定时器数量
     * @example
     * ```typescript
     * const count = client.getBurnAfterReadManager().getActiveBurnCount();
     * ```
     */
    public getActiveBurnCount(): number {
        return this.burnTimers.size;
    }

    /**
     * 获取底层请求统计信息。
     *
     * @returns 请求统计（成功/失败/重试计数等）
     * @example
     * ```typescript
     * const stats = client.getBurnAfterReadManager().getRequestStats();
     * ```
     */
    public getRequestStats(): RequestStats {
        return super.getRequestStats();
    }

    /**
     * 启动管理器（当前仅记录日志，预留生命周期钩子）。
     *
     * @example
     * ```typescript
     * client.getBurnAfterReadManager().start();
     * ```
     */
    public start(): void {
        logger.debug("BurnAfterReadManager.start: initialized");
    }

    /**
     * 清空本地的定时器、重试计数与消息/设置缓存。
     *
     * @example
     * ```typescript
     * client.getBurnAfterReadManager().clearCache();
     * ```
     */
    public clearCache(): void {
        this.burnTimers.forEach((timer) => clearTimeout(timer));
        this.burnTimers.clear();
        this.burnRetryCount.clear();
        this.messages.clear();
        this.roomSettings.clear();
    }

    /**
     * 停止管理器：清理全部定时器与缓存，并移除所有事件监听。
     *
     * @example
     * ```typescript
     * client.getBurnAfterReadManager().stop();
     * ```
     */
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
        registerManagerClass("burnAfterRead", BurnAfterReadManager);
        return getOrCreateManager(this, "burnAfterRead", () => new BurnAfterReadManager(this));
    };
}
