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

    // 通过第三方标识（邮箱 / 手机号）邀请某人入房。
    // ⚠️ 本轮修复：此前这里用 `as unknown as { inviteByThreePid: (medium, address, roomId) => … }`
    // 双重断言，把参数按 `(medium, address, roomId)` 传；而真实签名是
    // `inviteByThreePid(roomId, medium, address)`（`src/client.ts:2908`）。
    // `matrix-client-extensions.ts:704-708` 的注释其实承认了这处不一致（"Access via
    // type assertion in InvitesManager"）—— 断言让编译器闭嘴，运行时三个参数**整体错位**
    // （medium 被当成 roomId 发出去）。现按真实顺序调用，断言删除。
    public async inviteByThreePid(medium: string, address: string, roomId: string): Promise<IInviteResponse> {
        await this.client.inviteByThreePid(roomId, medium, address);
        return { room_id: roomId };
    }

    // 邀请用户入房。`client.invite` 的参数顺序是 `(roomId, userId)`，与本方法相反。
    public async inviteUserToRoom(userId: string, roomId: string): Promise<IInviteResponse> {
        await this.client.invite(roomId, userId);
        return { room_id: roomId };
    }

    // 当前待处理的邀请（`membership === invite` 的房间）。
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

    public hasInvite(roomId: string): boolean {
        return this.client.getRoom(roomId)?.getMyMembership() === KnownMembership.Invite;
    }

    // 接受邀请 = 加入房间。
    public async acceptInvite(roomId: string): Promise<IInviteResponse> {
        const room = await this.client.joinRoom(roomId);
        return { room_id: room.roomId };
    }

    // 拒绝邀请 = 离开房间。
    // 本 fork 没有 `client.leaveRoom(roomId)`（只有 `leaveRoomChain`，用于连带处理
    // room upgrade 链），故走后者 —— 对"拒绝一个邀请"来说语义足够，且是唯一可用入口。
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
