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
import { RoomSummaryBaseManager, type RoomSummaryErrorCallback } from "../room-summary-base-manager";
import type { InviteBlocklist, InviteAllowlist } from "../types";
import type { RoomSummaryPathPattern } from "../__generated__/route-table";

type StripClientV3<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;
function _rsv<P extends StripClientV3<RoomSummaryPathPattern>>(path: P): P {
    return path;
}

/**
 * Room Invite Policy Manager - 房间邀请黑名单/白名单操作
 *
 * 处理邀请阻止列表和允许列表的查询与添加操作。
 * 无缓存、无事件。
 */
export class RoomSummaryInvitePolicyManager extends RoomSummaryBaseManager {
    private readonly onCacheInvalidation?: (roomId: string) => void;

    constructor(
        client: MatrixClient,
        onCacheInvalidation?: (roomId: string) => void,
        onError?: RoomSummaryErrorCallback,
    ) {
        super(client, onError);
        this.onCacheInvalidation = onCacheInvalidation;
    }

    /**
     * 获取 invite blocklist
     *
     * @param roomId - 房间 ID
     * @returns 阻止列表
     */
    public async getInviteBlocklist(roomId: string): Promise<InviteBlocklist> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.requestV3<InviteBlocklist>(
                Method.Get,
                this.roomSummaryPath("/rooms/$roomId/invite_blocklist", roomId),
            );
        }, "getInviteBlocklist");
    }

    /**
     * 添加到 invite blocklist
     *
     * @param roomId - 房间 ID
     * @param userId - 用户 ID
     */
    public async addInviteBlocklist(roomId: string, userId: string): Promise<void> {
        this.validateRoomId(roomId);
        this.validateUserId(userId);
        return await this.withRetry(async () => {
            await this.requestV3(
                Method.Post,
                this.roomSummaryPath("/rooms/$roomId/invite_blocklist", roomId),
                undefined,
                { user_id: userId } as Body,
            );
            this.onCacheInvalidation?.(roomId);
        }, "addInviteBlocklist");
    }

    /**
     * 获取 invite allowlist
     *
     * @param roomId - 房间 ID
     * @returns 允许列表
     */
    public async getInviteAllowlist(roomId: string): Promise<InviteAllowlist> {
        this.validateRoomId(roomId);
        return await this.withRetry(async () => {
            return await this.requestV3<InviteAllowlist>(
                Method.Get,
                this.roomSummaryPath("/rooms/$roomId/invite_allowlist", roomId),
            );
        }, "getInviteAllowlist");
    }

    /**
     * 添加到 invite allowlist
     *
     * @param roomId - 房间 ID
     * @param userId - 用户 ID
     */
    public async addInviteAllowlist(roomId: string, userId: string): Promise<void> {
        this.validateRoomId(roomId);
        this.validateUserId(userId);
        return await this.withRetry(async () => {
            await this.requestV3(
                Method.Post,
                this.roomSummaryPath("/rooms/$roomId/invite_allowlist", roomId),
                undefined,
                { user_id: userId } as Body,
            );
            this.onCacheInvalidation?.(roomId);
        }, "addInviteAllowlist");
    }
}
