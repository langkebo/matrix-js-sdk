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

export class RoomMemberManager {
    constructor(private client: MatrixClient) {}

    /**
     * Invite user to room
     */
    public async invite(roomId: string, userId: string): Promise<any> {
        const path = utils.encodeUri("/rooms/$roomId/invite", { $roomId: roomId });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Post, path, undefined, { user_id: userId });
    }

    /**
     * Invite by ThreePID
     */
    public async inviteByThreePid(roomId: string, medium: string, address: string): Promise<any> {
        const path = utils.encodeUri("/rooms/$roomId/invite", { $roomId: roomId });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Post, path, undefined, { 
            id_server: this.client.baseUrl, 
            medium, 
            address 
        });
    }

    /**
     * Kick user from room
     */
    public async kick(roomId: string, userId: string, reason?: string): Promise<any> {
        const path = utils.encodeUri("/rooms/$roomId/state/m.room.member/$userId", { 
            $roomId: roomId, 
            $userId: userId 
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Put, path, undefined, { 
            membership: "leave",
            reason
        });
    }

    /**
     * Ban user from room
     */
    public async ban(roomId: string, userId: string, reason?: string): Promise<any> {
        const path = utils.encodeUri("/rooms/$roomId/ban", { $roomId: roomId });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Post, path, undefined, { 
            user_id: userId,
            reason
        });
    }

    /**
     * Unban user from room
     */
    public async unban(roomId: string, userId: string): Promise<any> {
        const path = utils.encodeUri("/rooms/$roomId/unban", { $roomId: roomId });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Post, path, undefined, { user_id: userId });
    }

    /**
     * Get room member
     */
    public async getRoomMember(roomId: string, userId: string): Promise<any> {
        const path = utils.encodeUri("/rooms/$roomId/state/m.room.member/$userId", { 
            $roomId: roomId, 
            $userId: userId 
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Get, path);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getRoomMemberManager(): RoomMemberManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomMemberManager = function (): RoomMemberManager {
        return new RoomMemberManager(this);
    };
}

export default extendMatrixClient;
