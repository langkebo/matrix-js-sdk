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
 * Friend Block Manager - 好友屏蔽管理
 *
 * 管理好友屏蔽、状态更新等操作。
 */

import { Method } from "../../http-api/method";
import { VendorPrefix } from "../../http-api/prefix";
import { InvalidParamError } from "../../common/errors";
import { BaseManager } from "../../managers/base-manager";
import type { FriendStatus, FriendStatusInfo } from "../index";
import type { FriendSharedState } from "./shared-state";

export enum FriendBlockManagerEvent {
    FriendUpdated = "FriendUpdated",
}

interface FriendBlockManagerEventMap {
    [FriendBlockManagerEvent.FriendUpdated]: (friend: import("../index").Friend) => void;
}

export class FriendBlockManager extends BaseManager<FriendBlockManagerEvent, FriendBlockManagerEventMap> {
    constructor(private readonly sharedState: FriendSharedState) {
        super(sharedState.client);
    }

    /**
     * 获取好友状态信息
     *
     * @param userId - 用户 ID
     * @returns 好友状态信息
     */
    async getFriendStatusInfo(userId: string): Promise<FriendStatusInfo> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }

        return this.request<FriendStatusInfo>({
            method: Method.Get,
            path: `/friends/${encodeURIComponent(userId)}/status`,
            prefix: VendorPrefix,
        });
    }

    /**
     * 获取好友状态字符串
     *
     * @param userId - 用户 ID
     * @returns 状态字符串
     */
    async getFriendStatus(userId: string): Promise<string> {
        const response = await this.getFriendStatusInfo(userId);
        return response.status;
    }

    /**
     * 更新好友状态（可用于屏蔽/取消屏蔽好友）
     *
     * @param userId - 用户 ID
     * @param status - 状态值：favorite | normal | blocked | hidden
     *
     * @example
     * ```typescript
     * // 屏蔽好友
     * await friendManager.blocks.updateFriendStatus("@alice:example.com", "blocked");
     *
     * // 取消屏蔽
     * await friendManager.blocks.updateFriendStatus("@alice:example.com", "normal");
     * ```
     *
     * @throws {InvalidParamError} 如果用户 ID 为空或状态值无效
     * @throws {ApiError} 如果 API 调用失败
     */
    async updateFriendStatus(userId: string, status: string): Promise<void> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }

        const validStatuses = ["favorite", "normal", "blocked", "hidden"];
        if (!validStatuses.includes(status)) {
            throw new InvalidParamError(`Invalid status. Valid values: ${validStatuses.join(", ")}`);
        }

        await this.request({
            method: Method.Put,
            path: `/friends/${encodeURIComponent(userId)}/status`,
            body: { status },
            prefix: VendorPrefix,
        });

        const friend = this.sharedState.friends.get(userId);
        if (friend) {
            friend.status = status as FriendStatus;
            this.sharedState.friends.set(userId, friend);
            this.emit(FriendBlockManagerEvent.FriendUpdated, friend);
        }
    }
}
