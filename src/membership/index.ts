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
 * Membership Manager - 成员资格管理
 * 
 * 提供房间成员资格相关功能
 */

import { MatrixClient } from "../client";

export class MembershipManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get room members
     */
    public getRoomMembers(roomId: string): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getRoomMembers(roomId);
    }

    /**
     * Get invited rooms
     */
    public getInvitedRooms(): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getInvitedRooms();
    }

    /**
     * Get joined rooms
     */
    public getJoinedRooms(): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getJoinedRooms();
    }

    /**
     * Get left rooms
     */
    public getLeftRooms(): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getLeftRooms();
    }

    /**
     * Is room joined
     */
    public isRoomJoined(roomId: string): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).isRoomJoined(roomId);
    }

    /**
     * Is room invited
     */
    public isRoomInvited(roomId: string): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).isRoomInvited(roomId);
    }

    /**
     * Is room left
     */
    public isRoomLeft(roomId: string): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).isRoomLeft(roomId);
    }

    /**
     * Get member
     */
    public getMember(roomId: string, userId: string): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getMember(roomId, userId);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getMembershipManager(): MembershipManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getMembershipManager = function (): MembershipManager {
        return new MembershipManager(this);
    };
}

export default extendMatrixClient;
