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
import type { QueryDict } from "../../utils";
import { RoomSummaryBaseManager, type RoomSummaryErrorCallback } from "../room-summary-base-manager";
import type {
    RoomKeyClaimResult,
    RoomKeyCountResult,
    RoomKeysVersionResult,
    RoomForwardKeysResult,
    EncryptedEventsResult,
} from "../types";
import type { RoomSummaryPathPattern } from "../__generated__/route-table";

type StripClientV3<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;
function _rsv<P extends StripClientV3<RoomSummaryPathPattern>>(path: P): P {
    return path;
}

/**
 * Room Key Manager - 房间密钥/加密操作
 *
 * 处理房间密钥申领、计数、版本、转发及加密事件获取等操作。
 * 无缓存、无事件。
 */
export class RoomSummaryKeyManager extends RoomSummaryBaseManager {
    constructor(client: MatrixClient, onError?: RoomSummaryErrorCallback) {
        super(client, onError);
    }

    /**
     * 申领房间密钥
     *
     * @param roomId - 房间 ID
     * @param body - 申领请求体
     * @returns 申领结果
     */
    public async claimRoomKeys(roomId: string, body: Record<string, unknown>): Promise<RoomKeyClaimResult> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.requestV3<RoomKeyClaimResult>(
                Method.Post,
                this.roomSummaryPath("/rooms/$roomId/keys/claim", roomId),
                undefined,
                body as Body,
            );
        }, "claimRoomKeys");
    }

    /**
     * 获取房间密钥计数
     *
     * @param roomId - 房间 ID
     * @returns 密钥计数结果
     */
    public async getRoomKeyCount(roomId: string): Promise<RoomKeyCountResult> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.requestV3<RoomKeyCountResult>(
                Method.Get,
                this.roomSummaryPath("/rooms/$roomId/keys/count", roomId),
            );
        }, "getRoomKeyCount");
    }

    /**
     * 获取房间密钥版本
     *
     * @param roomId - 房间 ID
     * @returns 密钥版本结果
     */
    public async getRoomKeysVersion(roomId: string): Promise<RoomKeysVersionResult> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.requestV3<RoomKeysVersionResult>(
                Method.Get,
                this.roomSummaryPath("/rooms/$roomId/keys/version", roomId),
            );
        }, "getRoomKeysVersion");
    }

    /**
     * 转发房间密钥
     *
     * @param roomId - 房间 ID
     * @param body - 转发请求体
     * @returns 转发结果
     */
    public async forwardRoomKeys(roomId: string, body: Record<string, unknown>): Promise<RoomForwardKeysResult> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.requestV3<RoomForwardKeysResult>(
                Method.Put,
                this.roomSummaryPath("/rooms/$roomId/room_keys/keys", roomId),
                undefined,
                body as Body,
            );
        }, "forwardRoomKeys");
    }

    /**
     * 获取加密事件摘要
     *
     * @param roomId - 房间 ID
     * @param options - 查询选项
     * @returns 加密事件结果
     */
    public async getEncryptedEvents(
        roomId: string,
        options?: { from?: string; limit?: number },
    ): Promise<EncryptedEventsResult> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            const queryParams: QueryDict = {};
            if (options?.from) queryParams.from = options.from;
            if (options?.limit !== undefined) queryParams.limit = String(options.limit);
            return await this.requestV3<EncryptedEventsResult>(
                Method.Get,
                this.roomSummaryPath("/rooms/$roomId/encrypted_events", roomId),
                queryParams,
            );
        }, "getEncryptedEvents");
    }
}
