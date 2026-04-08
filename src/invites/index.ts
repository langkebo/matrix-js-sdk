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
import { MatrixEvent } from "../models/event";

export interface IInviteEvent {
    roomId: string;
    sender: string;
    timestamp: number;
    event: MatrixEvent;
}

export interface IInviteResponse {
    room_id: string;
}

export class InvitesManager {
    constructor(private client: MatrixClient) {}

    public async inviteByThreePid(medium: string, address: string, roomId: string): Promise<IInviteResponse> {
        return (this.client as unknown as {
            inviteByThreePid: (medium: string, address: string, roomId: string) => Promise<IInviteResponse>;
        }).inviteByThreePid(medium, address, roomId);
    }

    public async inviteUserToRoom(userId: string, roomId: string): Promise<IInviteResponse> {
        return (this.client as unknown as {
            inviteUserToRoom: (userId: string, roomId: string) => Promise<IInviteResponse>;
        }).inviteUserToRoom(userId, roomId);
    }

    public getInviteEvents(): IInviteEvent[] {
        return (this.client as unknown as {
            getInviteEvents: () => IInviteEvent[];
        }).getInviteEvents();
    }

    public hasInvite(roomId: string): boolean {
        return (this.client as unknown as {
            hasInvite: (roomId: string) => boolean;
        }).hasInvite(roomId);
    }

    public async acceptInvite(roomId: string): Promise<IInviteResponse> {
        return (this.client as unknown as {
            acceptInvite: (roomId: string) => Promise<IInviteResponse>;
        }).acceptInvite(roomId);
    }

    public async declineInvite(roomId: string): Promise<IInviteResponse> {
        return (this.client as unknown as {
            declineInvite: (roomId: string) => Promise<IInviteResponse>;
        }).declineInvite(roomId);
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
