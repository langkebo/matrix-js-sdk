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

import { MatrixClient } from "../client";
import { Room } from "../models/room";
import { RoomMember } from "../models/room-member";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export interface MembershipManagerEvents {
    membership_changed: { roomId: string; userId: string; membership: string };
    member_joined: { roomId: string; userId: string };
    member_left: { roomId: string; userId: string };
}

export class MembershipManager extends BaseManager<keyof MembershipManagerEvents, MembershipManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * 获取房间内已加入的成员列表。
     *
     * @param roomId - 房间 ID
     * @returns 已加入成员列表；房间不存在时返回空数组
     *
     * @example
     * ```typescript
     * const members = client.getMembershipManager().getRoomMembers("!room:example.org");
     * console.log(members.length);
     * ```
     */
    public getRoomMembers(roomId: string): RoomMember[] {
        const room = this.client.getRoom(roomId);
        return room?.getJoinedMembers() || [];
    }

    /**
     * 获取当前用户被邀请加入的房间列表。
     *
     * @returns 成员状态为 invite 的房间列表
     *
     * @example
     * ```typescript
     * const invited = client.getMembershipManager().getInvitedRooms();
     * console.log(invited.length);
     * ```
     */
    public getInvitedRooms(): Room[] {
        return this.client.getRooms().filter((r) => r.getMyMembership() === "invite");
    }

    /**
     * 获取当前用户已加入的房间列表。
     *
     * @returns 成员状态为 join 的房间列表
     *
     * @example
     * ```typescript
     * const joined = await client.getMembershipManager().getJoinedRooms();
     * console.log(joined.length);
     * ```
     */
    public async getJoinedRooms(): Promise<Room[]> {
        return this.client.getRooms().filter((r) => r.getMyMembership() === "join");
    }

    /**
     * 获取当前用户已离开的房间列表。
     *
     * @returns 成员状态为 leave 的房间列表
     *
     * @example
     * ```typescript
     * const left = client.getMembershipManager().getLeftRooms();
     * console.log(left.length);
     * ```
     */
    public getLeftRooms(): Room[] {
        return this.client.getRooms().filter((r) => r.getMyMembership() === "leave");
    }

    /**
     * 判断当前用户是否已加入指定房间。
     *
     * @param roomId - 房间 ID
     * @returns 已加入返回 true，否则返回 false
     *
     * @example
     * ```typescript
     * const joined = client.getMembershipManager().isRoomJoined("!room:example.org");
     * console.log(joined);
     * ```
     */
    public isRoomJoined(roomId: string): boolean {
        const room = this.client.getRoom(roomId);
        return room?.getMyMembership() === "join";
    }

    /**
     * 判断当前用户是否被邀请加入指定房间。
     *
     * @param roomId - 房间 ID
     * @returns 被邀请返回 true，否则返回 false
     *
     * @example
     * ```typescript
     * const invited = client.getMembershipManager().isRoomInvited("!room:example.org");
     * console.log(invited);
     * ```
     */
    public isRoomInvited(roomId: string): boolean {
        const room = this.client.getRoom(roomId);
        return room?.getMyMembership() === "invite";
    }

    /**
     * 判断当前用户是否已离开指定房间。
     *
     * @param roomId - 房间 ID
     * @returns 已离开返回 true，否则返回 false
     *
     * @example
     * ```typescript
     * const left = client.getMembershipManager().isRoomLeft("!room:example.org");
     * console.log(left);
     * ```
     */
    public isRoomLeft(roomId: string): boolean {
        const room = this.client.getRoom(roomId);
        return room?.getMyMembership() === "leave";
    }

    /**
     * 获取房间内的指定成员。
     *
     * @param roomId - 房间 ID
     * @param userId - 用户 ID
     * @returns 对应的 RoomMember；房间或成员不存在时返回 null
     *
     * @example
     * ```typescript
     * const member = client.getMembershipManager().getMember("!room:example.org", "@alice:example.org");
     * console.log(member?.userId);
     * ```
     */
    public getMember(roomId: string, userId: string): RoomMember | null {
        const room = this.client.getRoom(roomId);
        return room?.getMember(userId) || null;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getMembershipManager = function (): MembershipManager {
        registerManagerClass("membership", MembershipManager);
        return getOrCreateManager(this, "membership", () => new MembershipManager(this));
    };
}
