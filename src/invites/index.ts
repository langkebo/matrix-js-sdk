/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You May obtain a copy of the License at

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

export class InvitesManager {
    constructor(private client: MatrixClient) {}

    /**
     * Invite by three pid
     */
    public async inviteByThreePid(medium: string, address: string, roomId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).inviteByThreePid(medium, address, roomId);
    }

    /**
     * Invite user to room
     */
    public async inviteUserToRoom(userId: string, roomId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).inviteUserToRoom(userId, roomId);
    }

    /**
     * Get invite events
     */
    public getInviteEvents(): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getInviteEvents();
    }

    /**
     * Has invite
     */
    public hasInvite(roomId: string): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).hasInvite(roomId);
    }

    /**
     * Accept invite
     */
    public async acceptInvite(roomId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).acceptInvite(roomId);
    }

    /**
     * Decline invite
     */
    public async declineInvite(roomId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).declineInvite(roomId);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getInvitesManager(): InvitesManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getInvitesManager = function (): InvitesManager {
        return new InvitesManager(this);
    };
}

export default extendMatrixClient;
