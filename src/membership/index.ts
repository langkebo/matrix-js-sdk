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

    public getRoomMembers(roomId: string): RoomMember[] {
        const room = this.client.getRoom(roomId);
        return room?.getJoinedMembers() || [];
    }

    public getInvitedRooms(): Room[] {
        return this.client.getRooms().filter((r) => r.getMyMembership() === "invite");
    }

    public async getJoinedRooms(): Promise<Room[]> {
        return this.client.getRooms().filter((r) => r.getMyMembership() === "join");
    }

    public getLeftRooms(): Room[] {
        return this.client.getRooms().filter((r) => r.getMyMembership() === "leave");
    }

    public isRoomJoined(roomId: string): boolean {
        const room = this.client.getRoom(roomId);
        return room?.getMyMembership() === "join";
    }

    public isRoomInvited(roomId: string): boolean {
        const room = this.client.getRoom(roomId);
        return room?.getMyMembership() === "invite";
    }

    public isRoomLeft(roomId: string): boolean {
        const room = this.client.getRoom(roomId);
        return room?.getMyMembership() === "leave";
    }

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

export default extendMatrixClient;
