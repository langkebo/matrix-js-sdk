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
 * Invites Manager - 邀请管理
 *
 * 提供邀请相关功能
 */

import { MatrixClient } from "../client";
import { MatrixEvent } from "../models/event";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export interface IInviteEvent {
    roomId: string;
    sender: string;
    timestamp: number;
    event: MatrixEvent;
}

export interface IInviteResponse {
    room_id: string;
}

export interface InvitesManagerEvents {
    invite_received: { roomId: string; sender: string };
    invite_accepted: { roomId: string };
    invite_declined: { roomId: string };
}

export class InvitesManager extends BaseManager<keyof InvitesManagerEvents, InvitesManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public async inviteByThreePid(medium: string, address: string, roomId: string): Promise<IInviteResponse> {
        // Type assertion needed: real MatrixClient.inviteByThreePid has different param order (roomId, medium, address)
        // and return type (Promise<EmptyObject>), but this manager expects (medium, address, roomId) => Promise<IInviteResponse>
        return this.withRetry(
            () =>
                (
                    this.client as unknown as {
                        inviteByThreePid: (medium: string, address: string, roomId: string) => Promise<IInviteResponse>;
                    }
                ).inviteByThreePid(medium, address, roomId),
            "inviteByThreePid",
        );
    }

    public async inviteUserToRoom(userId: string, roomId: string): Promise<IInviteResponse> {
        return this.withRetry(() => this.client.inviteUserToRoom(userId, roomId), "inviteUserToRoom");
    }

    public getInviteEvents(): IInviteEvent[] {
        return this.client.getInviteEvents();
    }

    public hasInvite(roomId: string): boolean {
        return this.client.hasInvite(roomId);
    }

    public async acceptInvite(roomId: string): Promise<IInviteResponse> {
        return this.withRetry(() => this.client.acceptInvite(roomId), "acceptInvite");
    }

    public async declineInvite(roomId: string): Promise<IInviteResponse> {
        return this.withRetry(() => this.client.declineInvite(roomId), "declineInvite");
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getInvitesManager = function (): InvitesManager {
        registerManagerClass("invites", InvitesManager);
        return getOrCreateManager(this, "invites", () => new InvitesManager(this));
    };
}
