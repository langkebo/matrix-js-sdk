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
 * Room Summary Base Manager - Room Summary 子 Manager 的公共基类
 *
 * 扩展 BaseManager，添加：
 * - requestV3：/_matrix/client/v3 前缀请求
 * - requestInternal：/_synapse/room_summary/v1 前缀请求
 * - roomSummaryPath：路径辅助函数
 * - validateRoomId/validateUserId/validateEventType：参数校验
 * - 错误回调：统一错误事件通知
 */

import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";

import { InvalidParamError } from "../common/errors";
import { encodeUri, type QueryDict } from "../utils";
import { BaseManager } from "../managers/base-manager";
import { MatrixClient } from "../client";

export type RoomSummaryErrorCallback = (error: Error) => void;

/**
 * Room Summary 子 Manager 的公共基类
 *
 * 提供 requestV3/requestInternal 请求方法和统一的参数校验。
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export abstract class RoomSummaryBaseManager<
    Events extends string = string,
    EventMap extends Record<Events, any> = Record<Events, any>,
> extends BaseManager<Events, EventMap> {
/* eslint-enable @typescript-eslint/no-explicit-any */
    protected readonly onError?: RoomSummaryErrorCallback;

    constructor(client: MatrixClient, onError?: RoomSummaryErrorCallback) {
        super(client);
        this.onError = onError;
    }

    /**
     * 验证房间 ID 格式
     */
    protected validateRoomId(roomId: string): void {
        if (!roomId || typeof roomId !== "string") {
            throw new InvalidParamError("Room ID is required and must be a string");
        }
        const trimmed = roomId.trim();
        if (trimmed.length === 0) {
            throw new InvalidParamError("Room ID cannot be empty");
        }
        if (!trimmed.startsWith("!") && !trimmed.startsWith("#")) {
            throw new InvalidParamError("Room ID must start with ! (room ID) or # (alias)");
        }
        if (!trimmed.includes(":")) {
            throw new InvalidParamError("Room ID must contain a server name (e.g., !room:server.com)");
        }
    }

    /**
     * 验证用户 ID 格式
     */
    protected validateUserId(userId: string): void {
        if (!userId || typeof userId !== "string") {
            throw new InvalidParamError("User ID is required and must be a string");
        }
        const trimmed = userId.trim();
        if (trimmed.length === 0) {
            throw new InvalidParamError("User ID cannot be empty");
        }
        if (!trimmed.startsWith("@")) {
            throw new InvalidParamError("User ID must start with @");
        }
        if (!trimmed.includes(":")) {
            throw new InvalidParamError("User ID must contain a server name (e.g., @user:server.com)");
        }
    }

    /**
     * 验证事件类型格式
     */
    protected validateEventType(eventType: string): void {
        if (!eventType || typeof eventType !== "string") {
            throw new InvalidParamError("Event type is required and must be a string");
        }
        const trimmed = eventType.trim();
        if (trimmed.length === 0) {
            throw new InvalidParamError("Event type cannot be empty");
        }
        if (!trimmed.match(/^[a-zA-Z0-9._-]+$/)) {
            throw new InvalidParamError("Event type contains invalid characters");
        }
        if (trimmed.length > 255) {
            throw new InvalidParamError("Event type is too long (max 255 characters)");
        }
    }

    /**
     * 构建带 roomId 替换的路径
     */
    protected roomSummaryPath(pathTemplate: string, roomId: string): string {
        return encodeUri(pathTemplate, { $roomId: roomId });
    }

    /**
     * 发送 v3 前缀请求
     */
    protected requestV3<T>(method: Method, path: string, queryParams?: QueryDict, body?: unknown): Promise<T> {
        return this.request<T>({ method, path, queryParams, body, prefix: ClientPrefix.V3 });
    }

    /**
     * 发送内部 API 请求
     */
    protected requestInternal<T>(method: Method, path: string, queryParams?: QueryDict, body?: unknown): Promise<T> {
        return this.request<T>({ method, path, queryParams, body, prefix: "/_synapse/room_summary/v1" });
    }
}
