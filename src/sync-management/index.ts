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
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";

export interface SyncManagerEvents {
    sync_started: void;
    sync_stopped: void;
    sync_state_changed: { state: SyncState };
    sync_error: { error: Error };
}

export class SyncManager extends BaseManager<keyof SyncManagerEvents, SyncManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public getSyncToken(): string | undefined {
        return this.client.syncToken ?? undefined;
    }

    public getSyncState(): SyncState | null {
        return this.client.getSyncState();
    }

    public getSyncStateData(): unknown {
        return this.client.getSyncStateData();
    }

    public isSyncing(): boolean {
        return this.client.syncing || false;
    }

    public getRooms(): Room[] {
        return this.client.getRooms();
    }

    public async getJoinedRooms(): Promise<string[]> {
        return this.withRetry(async () => {
            const response = await this.client.getJoinedRooms();
            return response.joined_rooms;
        }, "getJoinedRooms");
    }

    public getInvitedRooms(): Room[] {
        return this.client.getRooms().filter((r) => r.getMyMembership() === "invite");
    }

    public getLeftRooms(): Room[] {
        return this.client.getRooms().filter((r) => r.getMyMembership() === "leave");
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getSyncManager(): SyncManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getSyncManager = function (): SyncManager {
        return getOrCreateManager(this, "syncManagement", () => new SyncManager(this));
    };
}

export default extendMatrixClient;
