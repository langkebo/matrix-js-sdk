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
 * Room State Manager - 房间状态管理
 *
 * 提供房间状态获取、设置等功能
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/index";
import * as utils from "../utils";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import type { IContent } from "../models/event";
import { logger } from "../logger";

export interface IStateEvent {
    type: string;
    state_key: string;
    content: IContent;
    sender: string;
    event_id: string;
    origin_server_ts: number;
}

export interface ISendStateEventResponse {
    event_id: string;
}

export interface IEncryptionConfig {
    [key: string]: unknown;
    algorithm: string;
    rotation_period_ms?: number;
    rotation_period_msgs?: number;
}

export interface RoomStateManagerEvents {
    state_event_sent: { roomId: string; eventType: string; stateKey: string };
    state_updated: { roomId: string };
}

export class RoomStateManager extends BaseManager<keyof RoomStateManagerEvents, RoomStateManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * 获取房间的全部状态事件（可按事件类型过滤）
     *
     * @param roomId - 房间 ID
     * @param eventType - 可选的事件类型，用于服务端过滤
     * @returns 状态事件列表
     * @example
     * ```typescript
     * const state = await client.getRoomStateManager().roomState("!room:example.com");
     * console.log(state.length);
     * ```
     */
    public async roomState(roomId: string, eventType?: string): Promise<IStateEvent[]> {
        return this.withRetry(async () => {
            const path = utils.encodeUri("/rooms/$roomId/state", { $roomId: roomId });
            return this.request<IStateEvent[]>({
                method: Method.Get,
                path: path,
                // MSC4497: optional `type` query param filters state events by
                // event type server-side.
                queryParams: eventType ? { type: eventType } : undefined,
            });
        }, "roomState");
    }

    /**
     * 获取指定类型/状态键的状态事件
     *
     * 传入 `eventType` 时返回单个事件或事件数组；未传时返回房间全部状态事件。
     *
     * @param roomId - 房间 ID
     * @param eventType - 可选的事件类型
     * @param stateKey - 可选的状态键（默认为空字符串）
     * @returns 单个状态事件或状态事件数组
     * @example
     * ```typescript
     * const event = await client
     *     .getRoomStateManager()
     *     .getStateEvents("!room:example.com", "m.room.name", "");
     * console.log(event);
     * ```
     */
    public async getStateEvents(
        roomId: string,
        eventType?: string,
        stateKey?: string,
    ): Promise<IStateEvent | IStateEvent[]> {
        return this.withRetry(async () => {
            const path = eventType
                ? utils.encodeUri("/rooms/$roomId/state/$eventType/$stateKey", {
                      $roomId: roomId,
                      $eventType: eventType,
                      $stateKey: stateKey || "",
                  })
                : utils.encodeUri("/rooms/$roomId/state", { $roomId: roomId });
            return this.request<IStateEvent | IStateEvent[]>({
                method: Method.Get,
                path: path,
            });
        }, "getStateEvents");
    }

    /**
     * 获取房间的全部状态事件
     *
     * @param roomId - 房间 ID
     * @returns 状态事件列表，失败时返回空数组
     * @example
     * ```typescript
     * const events = await client.getRoomStateManager().getAllStateEvents("!room:example.com");
     * console.log(events.length);
     * ```
     */
    public async getAllStateEvents(roomId: string): Promise<IStateEvent[]> {
        try {
            const state = await this.roomState(roomId);
            return Array.isArray(state) ? state : [];
        } catch (e) {
            logger.warn("RoomStateManager.getAllStateEvents failed:", e);
        }
        return [];
    }

    /**
     * 按事件类型获取房间状态事件
     *
     * @param roomId - 房间 ID
     * @param eventType - 事件类型
     * @returns 匹配的状态事件列表，失败时返回空数组
     * @example
     * ```typescript
     * const events = await client
     *     .getRoomStateManager()
     *     .getStateEventsByType("!room:example.com", "m.room.member");
     * console.log(events.length);
     * ```
     */
    public async getStateEventsByType(roomId: string, eventType: string): Promise<IStateEvent[]> {
        try {
            const result = await this.getStateEvents(roomId, eventType);
            return Array.isArray(result) ? result : [result].filter(Boolean);
        } catch (e) {
            logger.warn("RoomStateManager.getStateEventsByType failed:", e);
        }
        return [];
    }

    /**
     * 发送房间状态事件
     *
     * @param roomId - 房间 ID
     * @param eventType - 事件类型
     * @param content - 状态事件内容
     * @param stateKey - 可选的状态键（默认为空字符串）
     * @returns 发送结果，包含事件 ID
     * @example
     * ```typescript
     * const response = await client
     *     .getRoomStateManager()
     *     .sendStateEvent("!room:example.com", "m.room.topic", { topic: "Hello" });
     * console.log(response.event_id);
     * ```
     */
    public async sendStateEvent(
        roomId: string,
        eventType: string,
        content: IContent,
        stateKey?: string,
    ): Promise<ISendStateEventResponse> {
        return this.withRetry(async () => {
            const path = utils.encodeUri("/rooms/$roomId/state/$eventType/$stateKey", {
                $roomId: roomId,
                $eventType: eventType,
                $stateKey: stateKey || "",
            });
            return this.request<ISendStateEventResponse>({
                method: Method.Put,
                path: path,
                body: content,
            });
        }, "sendStateEvent");
    }

    /**
     * 获取房间加密配置
     *
     * @param roomId - 房间 ID
     * @returns 加密配置，房间未启用加密时返回 null
     * @example
     * ```typescript
     * const encryption = await client.getRoomStateManager().getRoomEncryption("!room:example.com");
     * console.log(encryption?.algorithm);
     * ```
     */
    public async getRoomEncryption(roomId: string): Promise<IEncryptionConfig | null> {
        return this.withRetry(async () => {
            const path = utils.encodeUri("/rooms/$roomId/state/m.room.encryption", { $roomId: roomId });
            return this.request<IEncryptionConfig>({
                method: Method.Get,
                path: path,
            });
        }, "getRoomEncryption");
    }

    /**
     * 设置房间加密配置
     *
     * 等价于发送 `m.room.encryption` 状态事件。
     *
     * @param roomId - 房间 ID
     * @param config - 加密配置
     * @returns 发送结果，包含事件 ID
     * @example
     * ```typescript
     * const response = await client
     *     .getRoomStateManager()
     *     .setRoomEncryption("!room:example.com", { algorithm: "m.megolm.v1.aes-sha2" });
     * console.log(response.event_id);
     * ```
     */
    public async setRoomEncryption(roomId: string, config: IEncryptionConfig): Promise<ISendStateEventResponse> {
        return this.sendStateEvent(roomId, "m.room.encryption", config);
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomStateManager = function (): RoomStateManager {
        registerManagerClass("roomState", RoomStateManager);
        return getOrCreateManager(this, "roomState", () => new RoomStateManager(this));
    };
}
