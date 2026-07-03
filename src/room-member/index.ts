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
}


export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomMemberManager = function (): RoomMemberManager {
        registerManagerClass("roomMember", RoomMemberManager);
    return getOrCreateManager(this, "roomMember", () => new RoomMemberManager(this));
    };
}

export default extendMatrixClient;
