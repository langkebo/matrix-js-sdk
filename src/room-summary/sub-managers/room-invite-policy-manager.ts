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
import type { RoomSummaryPath } from "../__generated__/route-table";
import type { PathAssert, StripV3 } from "../../http-api/strip-prefix";

function _rsv<const P extends string>(path: P & PathAssert<P, StripV3<RoomSummaryPath>>): P {
    return path;
}

/**
 * Room Invite Policy Manager - 房间邀请黑名单/白名单操作
 *
 * 处理邀请阻止列表和允许列表的查询与添加操作。
 * 无缓存、无事件。
 *
 * ⚠️ 已知缺陷（见 `docs/sdk-encapsulation-audit.md` §13.11）：
 * 这些端点的**契约前缀是 `/_matrix/vendor/v1`**（ledger 模块 `invite_blocklist`），
 * 而本文件用 `requestV3()`（`/_matrix/client/v3`）发出 —— 契约里**不存在** v3 版本。
 * 同时 `src/invite-blocklist/index.ts` 已有一份**正确**（`VendorPrefix`）的实现，
 * 本类与之重复。在收敛/修前缀之前，这里的路径构造走 `uncheckedRoomPath()`
 * （显式逃生阀，不做契约断言），以便与该缺陷一起被检索到。
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
                this.uncheckedRoomPath("/rooms/$roomId/invite_blocklist", roomId),
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
                this.uncheckedRoomPath("/rooms/$roomId/invite_blocklist", roomId),
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
                this.uncheckedRoomPath("/rooms/$roomId/invite_allowlist", roomId),
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
                this.uncheckedRoomPath("/rooms/$roomId/invite_allowlist", roomId),
                undefined,
                { user_id: userId } as Body,
            );
            this.onCacheInvalidation?.(roomId);
        }, "addInviteAllowlist");
    }
}
