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
import { SyncState } from "../sync";

export class SyncManager {
    constructor(private client: MatrixClient) {}

    public getSyncToken(): string | undefined {
        return (this.client as any).syncToken;
    }

    public getSyncState(): SyncState | null {
        return this.client.getSyncState();
    }

    public getSyncStateData(): unknown {
        return this.client.getSyncStateData();
    }

    public isSyncing(): boolean {
        return (this.client as any).syncing || false;
    }

    public getRooms(): Room[] {
        return this.client.getRooms();
    }

    public async getJoinedRooms(): Promise<string[]> {
        const response = await this.client.getJoinedRooms();
        return response.joined_rooms;
    }

    public getInvitedRooms(): Room[] {
        return this.client.getRooms().filter(r => r.getMyMembership() === 'invite');
    }

    public getLeftRooms(): Room[] {
        return this.client.getRooms().filter(r => r.getMyMembership() === 'leave');
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getSyncManager(): SyncManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getSyncManager = function (): SyncManager {
        return new SyncManager(this);
    };
}

export default extendMatrixClient;
