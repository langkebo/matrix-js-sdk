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
 * Invites Manager - 邀请管理
 *
 * 提供邀请相关功能
 */

import { MatrixClient } from "../client";
import { MatrixEvent } from "../models/event";
import { EventType } from "../@types/event";
import { KnownMembership } from "../@types/membership";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export interface IInviteEvent {
    roomId: string;
    sender: string;
    timestamp: number;
    event: MatrixEvent;
}

export interface IInviteResponse {
    room_id: string;
}

export interface InvitesManagerEvents {
    invite_received: { roomId: string; sender: string };
    invite_accepted: { roomId: string };
    invite_declined: { roomId: string };
}

export class InvitesManager extends BaseManager<keyof InvitesManagerEvents, InvitesManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * 通过第三方标识（邮箱 / 手机号）邀请用户加入房间。
     *
     * 内部按真实签名 `inviteByThreePid(roomId, medium, address)` 调用 `client.inviteByThreePid`。
     *
     * @param medium - 第三方标识类型，例如 "email" 或 "msisdn"。
     * @param address - 第三方标识地址，例如邮箱或手机号。
     * @param roomId - 目标房间 ID。
     * @returns 包含被邀请房间 ID 的结果对象。
     * @example
     * const result = await client
     *     .getInvitesManager()
     *     .inviteByThreePid("email", "friend@example.org", "!room:example.org");
     * console.log(result.room_id); // "!room:example.org"
     */
    public async inviteByThreePid(medium: string, address: string, roomId: string): Promise<IInviteResponse> {
        await this.client.inviteByThreePid(roomId, medium, address);
        return { room_id: roomId };
    }

    /**
     * 邀请用户加入房间。
     *
     * 注意 `client.invite` 的参数顺序是 `(roomId, userId)`，与本方法相反，内部已做转换。
     *
     * @param userId - 被邀请用户的 Matrix ID。
     * @param roomId - 目标房间 ID。
     * @returns 包含被邀请房间 ID 的结果对象。
     * @example
     * const result = await client
     *     .getInvitesManager()
     *     .inviteUserToRoom("@friend:example.org", "!room:example.org");
     * console.log(result.room_id); // "!room:example.org"
     */
    public async inviteUserToRoom(userId: string, roomId: string): Promise<IInviteResponse> {
        await this.client.invite(roomId, userId);
        return { room_id: roomId };
    }

    /**
     * 获取当前待处理的邀请列表（`membership === invite` 的房间）。
     *
     * @returns 待处理邀请数组，每项包含 roomId、sender、timestamp 与原始事件。
     * @example
     * const invites = client.getInvitesManager().getInviteEvents();
     * for (const invite of invites) {
     *     console.log(invite.roomId, invite.sender);
     * }
     */
    public getInviteEvents(): IInviteEvent[] {
        const userId = this.client.getUserId();
        if (!userId) return [];

        const invites: IInviteEvent[] = [];
        for (const room of this.client.getRooms()) {
            if (room.getMyMembership() !== KnownMembership.Invite) continue;

            const event = room.currentState.getStateEvents(EventType.RoomMember, userId);
            if (!event) continue;

            invites.push({
                roomId: room.roomId,
                sender: event.getSender() ?? "",
                timestamp: event.getTs(),
                event,
            });
        }
        return invites;
    }

    /**
     * 判断指定房间是否存在待处理的邀请。
     *
     * @param roomId - 目标房间 ID。
     * @returns 若当前用户在该房间的 membership 为 invite 则返回 true。
     * @example
     * const pending = client.getInvitesManager().hasInvite("!room:example.org");
     * console.log(pending); // true
     */
    public hasInvite(roomId: string): boolean {
        return this.client.getRoom(roomId)?.getMyMembership() === KnownMembership.Invite;
    }

    /**
     * 接受邀请（等价于加入房间）。
     *
     * @param roomId - 目标房间 ID。
     * @returns 包含已加入房间 ID 的结果对象。
     * @example
     * const result = await client.getInvitesManager().acceptInvite("!room:example.org");
     * console.log(result.room_id); // "!room:example.org"
     */
    public async acceptInvite(roomId: string): Promise<IInviteResponse> {
        const room = await this.client.joinRoom(roomId);
        return { room_id: room.roomId };
    }

    /**
     * 拒绝邀请（等价于离开房间）。
     *
     * 本 fork 没有 `client.leaveRoom(roomId)`，只有 `leaveRoomChain`（用于连带处理
     * room upgrade 链），故走后者 —— 对"拒绝一个邀请"来说语义足够，且是唯一可用入口。
     *
     * @param roomId - 目标房间 ID。
     * @returns 包含被拒绝房间 ID 的结果对象。
     * @example
     * const result = await client.getInvitesManager().declineInvite("!room:example.org");
     * console.log(result.room_id); // "!room:example.org"
     */
    public async declineInvite(roomId: string): Promise<IInviteResponse> {
        await this.client.leaveRoomChain(roomId);
        return { room_id: roomId };
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getInvitesManager = function (): InvitesManager {
        registerManagerClass("invites", InvitesManager);
        return getOrCreateManager(this, "invites", () => new InvitesManager(this));
    };
}
