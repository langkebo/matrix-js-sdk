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
import { InvalidParamError } from "../../common/errors";
import { logger } from "../../logger";
import { encodeUri } from "../../http-api/utils";import { RoomSummaryBaseManager, type RoomSummaryErrorCallback } from "../room-summary-base-manager";
import type { RoomThreadResult, RoomThreadDetailResult, EventKeysResult } from "../types";

/**
 * Room Thread Sub-Manager - 房间线程操作子管理器
 *
 * 处理线程相关的 API 请求：
 * - getEventKeys: 获取事件签名密钥
 * - getRoomThread: 通过根事件 ID 获取线程
 * - getRoomThreadById: 通过线程 ID 获取线程详情
 */
export class RoomSummaryThreadManager extends RoomSummaryBaseManager {
    constructor(client: MatrixClient, onError?: RoomSummaryErrorCallback) {
        super(client, onError);
    }

    /**
     * 获取事件的签名密钥
     * GET /_matrix/client/v3/rooms/{roomId}/keys/{eventId}
     *
     * @param roomId - 房间 ID
     * @param eventId - 事件 ID
     * @returns 事件密钥结果
     */
    public async getEventKeys(roomId: string, eventId: string): Promise<EventKeysResult> {
        this.validateRoomId(roomId);
        if (!eventId) {
            throw new InvalidParamError("eventId is required");
        }

        try {
            return await this.withRetry(async () => {
                return await this.requestV3<EventKeysResult>(
                    Method.Get,
                    encodeUri("/rooms/$roomId/keys/$eventId", { $roomId: roomId, $eventId: eventId }),
                );
            }, "getEventKeys");
        } catch (error) {
            logger.warn(`RoomSummaryThreadManager.getEventKeys failed for ${eventId}:`, error);
            throw this.normalizeError(error, "getEventKeys");
        }
    }

    /**
     * 获取房间线程（通过根事件 ID）
     * GET /_matrix/client/v3/rooms/{roomId}/thread/{eventId}
     *
     * @param roomId - 房间 ID
     * @param eventId - 线程根事件 ID
     * @returns 线程详情，包含根事件、回复和参与者
     */
    public async getRoomThread(roomId: string, eventId: string): Promise<RoomThreadResult> {
        this.validateRoomId(roomId);
        if (!eventId) {
            throw new InvalidParamError("eventId is required");
        }

        try {
            return await this.withRetry(async () => {
                return await this.requestV3<RoomThreadResult>(
                    Method.Get,
                    encodeUri("/rooms/$roomId/thread/$eventId", { $roomId: roomId, $eventId: eventId }),
                );
            }, "getRoomThread");
        } catch (error) {
            logger.warn(`RoomSummaryThreadManager.getRoomThread failed for ${eventId}:`, error);
            throw this.normalizeError(error, "getRoomThread");
        }
    }

    /**
     * 获取房间线程（通过线程 ID）
     * GET /_matrix/client/v3/rooms/{roomId}/threads/{threadId}
     *
     * @param roomId - 房间 ID
     * @param threadId - 线程 ID
     * @returns 线程详情
     */
    public async getRoomThreadById(roomId: string, threadId: string): Promise<RoomThreadDetailResult> {
        this.validateRoomId(roomId);
        if (!threadId) {
            throw new InvalidParamError("threadId is required");
        }

        try {
            return await this.withRetry(async () => {
                return await this.requestV3<RoomThreadDetailResult>(
                    Method.Get,
                    encodeUri("/rooms/$roomId/threads/$threadId", { $roomId: roomId, $threadId: threadId }),
                );
            }, "getRoomThreadById");
        } catch (error) {
            logger.warn(`RoomSummaryThreadManager.getRoomThreadById failed for ${threadId}:`, error);
            throw this.normalizeError(error, "getRoomThreadById");
        }
    }
}
