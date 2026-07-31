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
 * DmRoomOperationManager - DM 房间操作
 *
 * 职责：
 * - 离开 DM 房间：leaveDm
 * - 标记已读：markDmAsRead
 * - 发送消息：sendDmMessage
 *
 * 依赖：构造时注入 DmRoomListManager 引用，用于：
 * - 访问缓存（leaveDm 需要清理 dmRoomsCache / userDmMapCache）
 *
 * 使用 `import type` 引用 DmRoomListManager 避免运行时循环依赖。
 */

import { EventType } from "../../@types/event";
import type { RoomMessageEventContent } from "../../@types/events";
import { MatrixClient } from "../../client";
import type { IContent } from "../../models/event";
import { BaseManager, type ManagerOpts } from "../../managers/base-manager";
import { validateRoomId } from "../../common/validators";
import { InvalidParamError } from "../../common/errors";

import { DMEvent, type DirectMessageManagerEventMap } from "../events";
import type { DmRoomListManager } from "./dm-room-list-manager";
import type { EventIdResponse } from "./dm-room-operation-types";

export class DmRoomOperationManager extends BaseManager<DMEvent, DirectMessageManagerEventMap> {
    constructor(
        client: MatrixClient,
        private readonly listManager: DmRoomListManager,
        opts?: ManagerOpts,
    ) {
        super(client, opts);
    }

    /**
     * 离开 DM 房间
     *
     * @param roomId - 房间 ID（格式：!localpart:homeserver）
     *
     * @example
     * ```typescript
     * // 离开 DM 房间
     * await dmManager.leaveDm("!abc:example.com");
     * console.log("Left DM room");
     * ```
     *
     * @throws {ValidationError} 如果房间 ID 格式无效
     * @throws {ApiError} 如果 API 调用失败
     */
    async leaveDm(roomId: string): Promise<void> {
        validateRoomId(roomId);
        if (!roomId) {
            throw new InvalidParamError("Room ID is required");
        }

        try {
            await this.withRetry(async () => {
                return await this.client.leave(roomId);
            });

            const dmInfo = this.listManager.dmRoomsCache.get(roomId);
            if (dmInfo) {
                dmInfo.invitees.forEach((userId) => {
                    this.listManager.userDmMapCache.delete(userId);
                });
            }
            this.listManager.dmRoomsCache.delete(roomId);

            this.emit(DMEvent.DMLeft, roomId);
            this.emit(DMEvent.ListUpdated);
        } catch (error) {
            throw this.normalizeError(error, "leaveDm");
        }
    }

    /**
     * 标记 DM 为已读
     *
     * @param roomId - 房间 ID（格式：!localpart:homeserver）
     *
     * @example
     * ```typescript
     * // 标记 DM 为已读
     * await dmManager.markDmAsRead("!abc:example.com");
     * console.log("DM marked as read");
     * ```
     *
     * @throws {ValidationError} 如果房间 ID 格式无效
     * @throws {ApiError} 如果 API 调用失败
     */
    async markDmAsRead(roomId: string): Promise<void> {
        validateRoomId(roomId);
        try {
            await this.withRetry(async () => {
                const room = this.client.getRoom(roomId);
                if (room) {
                    const timeline = room.getLiveTimeline();
                    const events = timeline.getEvents();
                    const lastEvent = events[events.length - 1];
                    if (lastEvent) {
                        return await this.client
                            .getReadReceiptsManager()
                            .setRoomReadMarkers(roomId, lastEvent.getId()!, lastEvent);
                    }
                }
                return undefined;
            });
        } catch (error) {
            throw this.normalizeError(error, "markDmAsRead");
        }
    }

    /**
     * 发送 DM 消息
     *
     * @param roomId - 房间 ID
     * @param content - 消息内容（字符串或对象）
     * @returns 发送的事件 ID
     */
    async sendDmMessage(roomId: string, content: string | IContent): Promise<string> {
        if (!roomId) {
            throw new InvalidParamError("Room ID is required");
        }
        try {
            return await this.withRetry(async () => {
                let messageContent: IContent;

                if (typeof content === "string") {
                    messageContent = {
                        msgtype: "m.text",
                        body: content,
                    };
                } else {
                    messageContent = content;
                }

                const response = (await this.client.sendEvent(
                    roomId,
                    EventType.RoomMessage,
                    messageContent as unknown as RoomMessageEventContent,
                )) as EventIdResponse;
                return response.event_id;
            });
        } catch (error) {
            throw this.normalizeError(error, "sendDmMessage");
        }
    }
}
