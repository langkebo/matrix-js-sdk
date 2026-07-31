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
 * DmRoomCreationManager - DM 房间创建与 m.direct 写入
 *
 * 职责：
 * - 创建 DM 房间：createDm、createDmRoom、createDmRoomDetailed
 * - 维护 m.direct 映射：setDmRoom、removeDmRoom、updateDirectRoom
 *
 * 依赖：构造时注入 DmRoomListManager 引用，用于：
 * - 查询现有 DM（getDmForUser，避免重复创建）
 * - 读取 m.direct 映射（getDirectRoomsByUser）
 * - 写入缓存（listManager.dmRoomsCache / userDmMapCache）
 *
 * 使用 `import type` 引用 DmRoomListManager 避免运行时循环依赖。
 */

import { logger } from "../../logger";
import { EventType } from "../../@types/event";
import { MatrixClient } from "../../client";
import type { ICreateRoomOpts } from "../../@types/requests";
import { Preset } from "../../@types/partials";
import { Method } from "../../http-api/method";
import { ClientPrefix } from "../../http-api/prefix";
import { BaseManager, type ManagerOpts } from "../../managers/base-manager";
import { validateUserId } from "../../common/validators";
import { InvalidParamError } from "../../common/errors";

import { DMEvent, type DirectMessageManagerEventMap } from "../events";
import type { DmRoomListManager } from "./dm-room-list-manager";
import type { DmRoomInfo } from "./dm-room-list-types";
import type {
    CreateDmOptions,
    CreateDmRoomResponse,
    CreateDmRoomOptions,
    UpdateDirectRoomResponse,
    UpdateDirectRoomOptions,
    ICreateRoomResponse,
} from "./dm-room-creation-types";

export class DmRoomCreationManager extends BaseManager<DMEvent, DirectMessageManagerEventMap> {
    constructor(
        client: MatrixClient,
        private readonly listManager: DmRoomListManager,
        opts?: ManagerOpts,
    ) {
        super(client, opts);
    }

    /**
     * 创建私信房间
     *
     * @param options - 创建选项或用户 ID 数组
     * @returns 新创建的 DM 房间 ID
     *
     * @example
     * ```typescript
     * // 简单创建（使用用户 ID 数组）
     * const roomId = await dmManager.createDm(["@alice:example.com"]);
     * console.log("Created DM room:", roomId);
     *
     * // 使用完整选项
     * const roomId = await dmManager.createDm({
     *     userIds: ["@alice:example.com"],
     *     name: "Chat with Alice",
     *     topic: "Private conversation",
     *     isEncrypted: true
     * });
     *
     * // 创建群聊 DM
     * const roomId = await dmManager.createDm({
     *     userIds: ["@alice:example.com", "@bob:example.com"],
     *     name: "Group Chat"
     * });
     * ```
     *
     * @throws {ValidationError} 如果用户 ID 格式无效
     * @throws {InvalidParamError} 如果未提供用户 ID
     * @throws {ApiError} 如果 API 调用失败
     *
     * 后端实现: synapse-rust/src/web/routes/dm.rs:204-266
     */
    async createDm(options: CreateDmOptions | string[]): Promise<string> {
        const opts = Array.isArray(options) ? { userIds: options } : options;

        if (!opts.userIds || opts.userIds.length === 0) {
            throw new InvalidParamError("At least one user ID is required");
        }

        // 验证所有用户 ID
        opts.userIds.forEach((userId) => {
            validateUserId(userId);
        });

        const existingDm = await this.listManager.getDmForUser(opts.userIds[0]);
        if (existingDm) {
            return existingDm;
        }

        const createOptions: ICreateRoomOpts = {
            is_direct: true,
            invite: opts.userIds,
            preset: opts.isEncrypted === false ? Preset.PrivateChat : Preset.TrustedPrivateChat,
        };

        if (opts.name) {
            createOptions.name = opts.name;
        }

        if (opts.topic) {
            createOptions.topic = opts.topic;
        }

        if (opts.isEncrypted !== false) {
            createOptions.initial_state = [
                {
                    type: "m.room.encryption",
                    state_key: "",
                    content: {
                        algorithm: "m.megolm.v1.aes-sha2",
                    },
                },
            ];
        }

        try {
            const response = await this.withRetry(async () => {
                return (await this.client.createRoom(createOptions)) as ICreateRoomResponse;
            });

            const roomId = response.room_id;

            const dmInfo: DmRoomInfo = {
                roomId,
                invitees: opts.userIds,
            };

            this.listManager.dmRoomsCache.set(roomId, dmInfo);
            opts.userIds.forEach((userId) => {
                this.listManager.userDmMapCache.set(userId, roomId);
            });

            await this.setDmRoom(roomId, opts.userIds[0]);

            this.emit(DMEvent.DMCreated, roomId, opts.userIds);
            this.emit(DMEvent.ListUpdated);

            return roomId;
        } catch (error) {
            throw this.normalizeError(error, "createDm");
        }
    }

    /**
     * 设置 DM 房间（更新 m.direct）
     *
     * @param roomId - 房间 ID
     * @param userId - DM 伙伴用户 ID
     */
    async setDmRoom(roomId: string, userId: string): Promise<void> {
        if (!roomId) {
            throw new InvalidParamError("Room ID is required");
        }
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }
        try {
            const dmMap = await this.listManager.getDirectRoomsByUser();

            if (!dmMap[userId]) {
                dmMap[userId] = [];
            }

            if (!dmMap[userId].includes(roomId)) {
                dmMap[userId].push(roomId);
            }

            // ⚠️ m.direct 是用户级别的 account data
            await this.client.setAccountData(EventType.Direct, dmMap);

            this.listManager.userDmMapCache.set(userId, roomId);
            this.emit(DMEvent.ListUpdated);
            this.emit(DMEvent.DMUpdated, roomId);
        } catch (error) {
            logger.error("DirectMessageManager.setDmRoom failed:", error);
            throw error;
        }
    }

    /**
     * 移除 DM 房间关联
     *
     * @param roomId - 房间 ID
     * @param userId - DM 伙伴用户 ID
     */
    async removeDmRoom(roomId: string, userId: string): Promise<void> {
        if (!roomId) {
            throw new InvalidParamError("Room ID is required");
        }
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }
        try {
            const dmMap = await this.listManager.getDirectRoomsByUser();

            if (dmMap[userId]) {
                dmMap[userId] = dmMap[userId].filter((id) => id !== roomId);

                if (dmMap[userId].length === 0) {
                    delete dmMap[userId];
                }
            }

            // ⚠️ m.direct 是用户级别的 account data
            await this.client.setAccountData(EventType.Direct, dmMap);

            if (this.listManager.userDmMapCache.get(userId) === roomId) {
                this.listManager.userDmMapCache.delete(userId);
            }

            this.listManager.dmRoomsCache.delete(roomId);
            this.emit(DMEvent.ListUpdated);
            this.emit(DMEvent.DMUpdated, roomId);
        } catch (error) {
            logger.error("DirectMessageManager.removeDmRoom failed:", error);
            throw error;
        }
    }

    /**
     * 创建 DM 房间 (专用 API 封装)
     *
     * 后端实现: POST /_matrix/client/v3/create_dm
     *
     * @param userId - 对端用户 ID
     * @param options - 可选配置
     * @returns 后端原始响应
     */
    async createDmRoomDetailed(userId: string, options?: CreateDmRoomOptions): Promise<CreateDmRoomResponse> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }

        validateUserId(userId);
        options?.invite?.forEach((invitee) => validateUserId(invitee));

        try {
            return await this.withRetry(async () => {
                const invite = options?.invite?.length ? Array.from(new Set([userId, ...options.invite])) : undefined;
                return await this.request<CreateDmRoomResponse>({
                    method: Method.Post,
                    path: "/create_dm",
                    body: {
                        user_id: userId,
                        invite,
                        is_direct: true,
                        name: options?.name,
                        topic: options?.topic,
                        visibility: options?.visibility,
                    },
                    prefix: ClientPrefix.V3,
                });
            });
        } catch (error) {
            throw this.normalizeError(error, "createDmRoomDetailed");
        }
    }

    /**
     * 创建 DM 房间 (专用 API 封装)
     *
     * 后端实现: POST /_matrix/client/v3/create_dm
     *
     * @param userId - 对端用户 ID
     * @param options - 可选配置
     * @returns 新创建的 DM 房间 ID
     */
    async createDmRoom(userId: string, options?: CreateDmRoomOptions): Promise<string> {
        try {
            const response = await this.createDmRoomDetailed(userId, options);

            const roomId = response.room_id;

            const dmInfo: DmRoomInfo = {
                roomId,
                invitees: [userId],
            };

            this.listManager.dmRoomsCache.set(roomId, dmInfo);
            this.listManager.userDmMapCache.set(userId, roomId);

            this.emit(DMEvent.DMCreated, roomId, [userId]);
            this.emit(DMEvent.ListUpdated);

            return roomId;
        } catch (error) {
            throw this.normalizeError(error, "createDmRoom");
        }
    }

    async updateDirectRoom(roomId: string, userIds: string[]): Promise<UpdateDirectRoomResponse>;
    async updateDirectRoom(roomId: string, options: UpdateDirectRoomOptions): Promise<UpdateDirectRoomResponse>;
    async updateDirectRoom(
        roomId: string,
        userIdsOrOptions: string[] | UpdateDirectRoomOptions,
    ): Promise<UpdateDirectRoomResponse> {
        if (!roomId) {
            throw new InvalidParamError("Room ID is required");
        }

        const usersToValidate = Array.isArray(userIdsOrOptions) ? userIdsOrOptions : (userIdsOrOptions.userIds ?? []);
        usersToValidate.forEach((userId) => validateUserId(userId));

        const body = Array.isArray(userIdsOrOptions)
            ? { users: userIdsOrOptions }
            : userIdsOrOptions.content
              ? { content: userIdsOrOptions.content }
              : { users: userIdsOrOptions.userIds ?? [] };

        try {
            const response = await this.withRetry(async () => {
                return await this.request<UpdateDirectRoomResponse>({
                    method: Method.Put,
                    path: `/direct/${encodeURIComponent(roomId)}`,
                    body: body,
                    prefix: ClientPrefix.V3,
                });
            });

            this.emit(DMEvent.ListUpdated);
            this.emit(DMEvent.DMUpdated, roomId);
            return response;
        } catch (error) {
            throw this.normalizeError(error, "updateDirectRoom");
        }
    }
}
