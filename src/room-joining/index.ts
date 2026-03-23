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
 * Room Joining Manager - 房间加入管理
 * 
 * 提供房间加入/离开相关功能
 */

import { MatrixClient } from "../client";

export class RoomJoiningManager {
    constructor(private client: MatrixClient) {}

    /**
     * Join room
     */
    public async joinRoom(roomIdOrAlias: string, opts?: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).joinRoom(roomIdOrAlias, opts);
    }

    /**
     * Leave room
     */
    public async leaveRoom(roomId: string, opts?: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).leaveRoom(roomId, opts);
    }

    /**
     * Invite user
     */
    public async inviteUser(userId: string, roomId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).invite(userId, roomId);
    }

    /**
     * Kick user
     */
    public async kickUser(userId: string, roomId: string, reason?: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).kick(userId, roomId, reason);
    }

    /**
     * Ban user
     */
    public async banUser(userId: string, roomId: string, reason?: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).ban(userId, roomId, reason);
    }

    /**
     * Unban user
     */
    public async unbanUser(userId: string, roomId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).unban(userId, roomId);
    }

    /**
     * Accept invitation
     */
    public async acceptInvitation(roomId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).joinRoom(roomId);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getRoomJoiningManager(): RoomJoiningManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomJoiningManager = function (): RoomJoiningManager {
        return new RoomJoiningManager(this);
    };
}

export default extendMatrixClient;
