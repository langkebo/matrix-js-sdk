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
 * Room Member Manager - 房间成员管理
 *
 * 提供房间成员邀请、踢出、封禁等功能
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/index";
import { VendorPrefix } from "../http-api/prefix";
import * as utils from "../utils";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export interface RoomMemberInfo {
    user_id: string;
    displayname?: string;
    avatar_url?: string;
    membership: string;
    reason?: string;
}

export interface MembershipEvent {
    event_id: string;
    type: string;
    sender: string;
    state_key: string;
    content: { membership: string; [key: string]: unknown };
    origin_server_ts: number;
}

export interface MembershipEventsResponse {
    events: MembershipEvent[];
}

export interface RoomMemberManagerEvents {
    member_invited: { roomId: string; userId: string };
    member_kicked: { roomId: string; userId: string; reason?: string };
    member_banned: { roomId: string; userId: string; reason?: string };
    member_unbanned: { roomId: string; userId: string };
}

export class RoomMemberManager extends BaseManager<keyof RoomMemberManagerEvents, RoomMemberManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * 邀请用户加入房间。
     *
     * @param roomId - 房间 ID
     * @param userId - 被邀请用户的 ID
     * @example
     * ```typescript
     * await client.getRoomMemberManager().invite("!room:example.org", "@alice:example.org");
     * ```
     */
    public async invite(roomId: string, userId: string): Promise<void> {
        return this.withRetry(async () => {
            const path = utils.encodeUri("/rooms/$roomId/invite", { $roomId: roomId });
            await this.request({
                method: Method.Post,
                path,
                body: { user_id: userId },
            });
        }, "invite");
    }

    /**
     * 通过第三方标识（如邮箱、手机号）邀请用户加入房间。
     *
     * @param roomId - 房间 ID
     * @param medium - 第三方标识类型（如 `email`、`msisdn`）
     * @param address - 第三方标识地址
     * @example
     * ```typescript
     * await client.getRoomMemberManager().inviteByThreePid("!room:example.org", "email", "alice@example.org");
     * ```
     */
    public async inviteByThreePid(roomId: string, medium: string, address: string): Promise<void> {
        return this.withRetry(async () => {
            const path = utils.encodeUri("/rooms/$roomId/invite", { $roomId: roomId });
            await this.request({
                method: Method.Post,
                path,
                body: {
                    id_server: this.client.baseUrl,
                    medium,
                    address,
                },
            });
        }, "inviteByThreePid");
    }

    /**
     * 将用户踢出房间。
     *
     * 通过发送 `m.room.member` 状态事件把目标成员的身份设置为 `leave`。
     *
     * @param roomId - 房间 ID
     * @param userId - 被踢出用户的 ID
     * @param reason - 可选，踢出原因
     * @example
     * ```typescript
     * await client.getRoomMemberManager().kick("!room:example.org", "@bob:example.org", "违规发言");
     * ```
     */
    public async kick(roomId: string, userId: string, reason?: string): Promise<void> {
        return this.withRetry(async () => {
            const path = utils.encodeUri("/rooms/$roomId/state/m.room.member/$userId", {
                $roomId: roomId,
                $userId: userId,
            });
            await this.request({
                method: Method.Put,
                path,
                body: {
                    membership: "leave",
                    reason,
                },
            });
        }, "kick");
    }

    /**
     * 封禁用户。
     *
     * @param roomId - 房间 ID
     * @param userId - 被封禁用户的 ID
     * @param reason - 可选，封禁原因
     * @example
     * ```typescript
     * await client.getRoomMemberManager().ban("!room:example.org", "@bob:example.org", "屡次违规");
     * ```
     */
    public async ban(roomId: string, userId: string, reason?: string): Promise<void> {
        return this.withRetry(async () => {
            const path = utils.encodeUri("/rooms/$roomId/ban", { $roomId: roomId });
            await this.request({
                method: Method.Post,
                path,
                body: {
                    user_id: userId,
                    reason,
                },
            });
        }, "ban");
    }

    /**
     * 解除对用户的封禁。
     *
     * @param roomId - 房间 ID
     * @param userId - 被解除封禁用户的 ID
     * @example
     * ```typescript
     * await client.getRoomMemberManager().unban("!room:example.org", "@bob:example.org");
     * ```
     */
    public async unban(roomId: string, userId: string): Promise<void> {
        return this.withRetry(async () => {
            const path = utils.encodeUri("/rooms/$roomId/unban", { $roomId: roomId });
            await this.request({
                method: Method.Post,
                path,
                body: { user_id: userId },
            });
        }, "unban");
    }

    /**
     * 获取指定成员在房间中的信息。
     *
     * @param roomId - 房间 ID
     * @param userId - 用户 ID
     * @returns 成员信息（含 `user_id`、`membership`、`displayname` 等）
     * @example
     * ```typescript
     * const member = await client.getRoomMemberManager().getRoomMember("!room:example.org", "@alice:example.org");
     * ```
     */
    public async getRoomMember(roomId: string, userId: string): Promise<RoomMemberInfo> {
        return this.withRetry(async () => {
            const path = utils.encodeUri("/rooms/$roomId/state/m.room.member/$userId", {
                $roomId: roomId,
                $userId: userId,
            });
            return this.request<RoomMemberInfo>({
                method: Method.Get,
                path,
            });
        }, "getRoomMember");
    }

    /**
     * Get membership event history for a room.
     * POST /_matrix/vendor/v1/rooms/{room_id}/get_membership_events
     *
     * @param roomId - The room ID.
     * @param params - Optional parameters.
     * @param params.limit - Maximum number of events to return (default 100, max 1000).
     * @example
     * ```typescript
     * const { events } = await client.getRoomMemberManager().getMembershipEvents("!room:example.org", { limit: 50 });
     * ```
     */
    public async getMembershipEvents(roomId: string, params?: { limit?: number }): Promise<MembershipEventsResponse> {
        this.requireNonEmptyString(roomId, "roomId");
        return this.withRetry(async () => {
            const path = utils.encodeUri("/rooms/$roomId/get_membership_events", { $roomId: roomId });
            return this.request<MembershipEventsResponse>({
                method: Method.Post,
                path,
                body: params,
                prefix: VendorPrefix,
            });
        }, "getMembershipEvents");
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomMemberManager = function (): RoomMemberManager {
        registerManagerClass("roomMember", RoomMemberManager);
        return getOrCreateManager(this, "roomMember", () => new RoomMemberManager(this));
    };
}
