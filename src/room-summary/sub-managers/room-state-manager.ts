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

import { MatrixClient } from "../../client";
import { Method } from "../../http-api/method";
import { Body } from "../../http-api/interface";
import type { IRoomSummaryState, RoomSummaryStateContent } from "../types";
import type { RoomSummaryErrorCallback } from "../room-summary-base-manager";
import { RoomSummaryBaseManager } from "../room-summary-base-manager";
import type { RoomSummaryPathPattern } from "../__generated__/route-table";

type StripClientV3<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;

function _rsv<P extends StripClientV3<RoomSummaryPathPattern>>(path: P): P {
    return path;
}

/**
 * Room State Sub-Manager - 房间摘要状态管理
 *
 * 处理房间摘要的 state 相关操作：
 * - 获取房间所有摘要状态
 * - 获取指定事件类型和 state key 的摘要状态
 * - 更新摘要状态
 */
export class RoomSummaryStateManager extends RoomSummaryBaseManager {
    public constructor(client: MatrixClient, onError?: RoomSummaryErrorCallback) {
        super(client, onError);
    }

    // ─── Path helpers ──────────────────────────────────────────────────────

    private summaryStateCollectionPath(roomId: string): StripClientV3<RoomSummaryPathPattern> {
        return _rsv(`/rooms/${encodeURIComponent(roomId)}/summary/state`);
    }

    private summaryStatePath(
        roomId: string,
        eventType: string,
        stateKey: string,
    ): StripClientV3<RoomSummaryPathPattern> {
        return _rsv(
            `/rooms/${encodeURIComponent(roomId)}/summary/state/${encodeURIComponent(eventType)}/${encodeURIComponent(stateKey)}`,
        );
    }

    // ─── API methods ───────────────────────────────────────────────────────

    /**
     * 获取房间所有摘要状态
     *
     * GET /_matrix/client/v3/rooms/{roomId}/summary/state
     *
     * @param roomId - 房间 ID
     * @returns 摘要状态列表
     * @throws {InvalidParamError} 当房间 ID 无效时
     */
    public async getAllSummaryState(roomId: string): Promise<IRoomSummaryState[]> {
        this.validateRoomId(roomId);

        return this.withRetry(async () => {
            return await this.requestV3<IRoomSummaryState[]>(
                Method.Get,
                this.summaryStateCollectionPath(roomId),
            );
        }, "getAllSummaryState");
    }

    /**
     * 获取指定事件类型和 state key 的摘要状态
     *
     * GET /_matrix/client/v3/rooms/{roomId}/summary/state/{eventType}/{stateKey}
     *
     * @param roomId - 房间 ID
     * @param eventType - 事件类型
     * @param stateKey - 状态键（默认为空字符串）
     * @returns 摘要状态内容
     * @throws {InvalidParamError} 当房间 ID 或事件类型无效时
     */
    public async getSummaryState(
        roomId: string,
        eventType: string,
        stateKey: string = "",
    ): Promise<RoomSummaryStateContent> {
        this.validateRoomId(roomId);
        this.validateEventType(eventType);

        return this.withRetry(async () => {
            return await this.requestV3<RoomSummaryStateContent>(
                Method.Get,
                this.summaryStatePath(roomId, eventType, stateKey),
            );
        }, "getSummaryState");
    }

    /**
     * 更新摘要状态
     *
     * PUT /_matrix/client/v3/rooms/{roomId}/summary/state/{eventType}/{stateKey}
     *
     * @param roomId - 房间 ID
     * @param eventType - 事件类型
     * @param stateKey - 状态键
     * @param content - 状态内容
     * @returns 更新后的摘要状态内容
     * @throws {InvalidParamError} 当房间 ID 或事件类型无效时
     */
    public async updateSummaryState(
        roomId: string,
        eventType: string,
        stateKey: string,
        content: RoomSummaryStateContent,
    ): Promise<RoomSummaryStateContent> {
        this.validateRoomId(roomId);
        this.validateEventType(eventType);

        return this.withRetry(async () => {
            return await this.requestV3<RoomSummaryStateContent>(
                Method.Put,
                this.summaryStatePath(roomId, eventType, stateKey),
                undefined,
                content as Body,
            );
        }, "updateSummaryState");
    }
}
