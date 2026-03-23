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
 * Room Summaries Manager - 房间摘要管理
 * 
 * 提供房间摘要相关功能
 */

import { MatrixClient } from "../client";

export class RoomSummariesManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get room summary
     */
    public getRoomSummary(roomId: string): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getRoomSummary(roomId);
    }

    /**
     * Get room hierarchy
     */
    public async getRoomHierarchy(roomId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getRoomHierarchy(roomId);
    }

    /**
     * Get public room list
     */
    public async getPublicRoomList(server?: string, limit?: number): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getPublicRoomList(server, limit);
    }

    /**
     * Get joined members
     */
    public async getJoinedMembers(roomId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getJoinedMembers(roomId);
    }

    /**
     * Get invited members
     */
    public async getInvitedMembers(roomId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getInvitedMembers(roomId);
    }

    /**
     * Get member events
     */
    public async getMemberEvents(roomId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getMemberEvents(roomId);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getRoomSummariesManager(): RoomSummariesManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomSummariesManager = function (): RoomSummariesManager {
        return new RoomSummariesManager(this);
    };
}

export default extendMatrixClient;
