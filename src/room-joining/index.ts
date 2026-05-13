/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may May obtain a copy of the License at

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
import { Room } from "../models/room";
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";

export interface IJoinRoomOptions {
    syncRoom?: boolean;
    inviteSignUrl?: string;
    viaServers?: string[];
    isDirect?: boolean;
}

export interface ILeaveRoomOptions {
    reason?: string;
}

export interface RoomJoiningManagerEvents {
    room_joined: { roomId: string };
    room_left: { roomId: string };
    user_invited: { roomId: string; userId: string };
}

export class RoomJoiningManager extends BaseManager<keyof RoomJoiningManagerEvents, RoomJoiningManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public async joinRoom(roomIdOrAlias: string, opts?: IJoinRoomOptions): Promise<Room> {
        return this.withRetry(() => this.client.joinRoom(roomIdOrAlias, opts as Record<string, unknown>), "joinRoom");
    }

    public async leaveRoom(roomId: string, _opts?: ILeaveRoomOptions): Promise<{}> {
        return this.withRetry(() => this.client.leave(roomId), "leaveRoom");
    }

    public async inviteUser(userId: string, roomId: string): Promise<{}> {
        return this.withRetry(() => this.client.invite(roomId, userId), "inviteUser");
    }

    public async kickUser(userId: string, roomId: string, reason?: string): Promise<{}> {
        return this.withRetry(() => this.client.kick(roomId, userId, reason), "kickUser");
    }

    public async banUser(userId: string, roomId: string, reason?: string): Promise<{}> {
        return this.withRetry(() => this.client.ban(roomId, userId, reason), "banUser");
    }

    public async unbanUser(userId: string, roomId: string): Promise<{}> {
        return this.withRetry(() => this.client.unban(roomId, userId), "unbanUser");
    }

    public async acceptInvitation(roomId: string): Promise<Room> {
        return this.withRetry(() => this.client.joinRoom(roomId), "acceptInvitation");
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getRoomJoiningManager(): RoomJoiningManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomJoiningManager = function (): RoomJoiningManager {
        return getOrCreateManager(this, "roomJoining", () => new RoomJoiningManager(this));
    };
}

export default extendMatrixClient;
