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

import type { IStoredClientOpts } from "../client-config-types";
import { MatrixClient } from "../client";
import { Room } from "../models/room";
import { SyncApi, SyncState, type ISyncStateData, type SyncApiOptions } from "../sync";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import { logger } from "../logger";

export interface SyncManagerEvents {
    sync_started: void;
    sync_stopped: void;
    sync_state_changed: { state: SyncState };
    sync_error: { error: Error };
}

export class SyncManager extends BaseManager<keyof SyncManagerEvents, SyncManagerEvents> {
    private syncedLeftRooms = false;
    private syncLeftRoomsPromise: Promise<Room[]> | undefined;

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public getSyncToken(): string | undefined {
        return this.client.syncToken ?? undefined;
    }

    public getSyncState(): SyncState | null {
        return (
            (this.client as unknown as { syncApi?: { getSyncState(): SyncState | null } }).syncApi?.getSyncState() ??
            null
        );
    }

    public getSyncStateData(): ISyncStateData | null {
        const syncApi = (this.client as unknown as { syncApi?: { getSyncStateData(): ISyncStateData | null } }).syncApi;
        if (!syncApi) {
            return null;
        }
        return syncApi.getSyncStateData();
    }

    public isSyncing(): boolean {
        return this.client.syncing || false;
    }

    public getRooms(): Room[] {
        return this.client.store.getRooms();
    }

    public async getJoinedRooms(): Promise<string[]> {
        return this.withRetry(async () => {
            const response = await this.client.getJoinedRooms();
            return response.joined_rooms;
        }, "getJoinedRooms");
    }

    public getInvitedRooms(): Room[] {
        return this.client.store.getRooms().filter((r) => r.getMyMembership() === "invite");
    }

    public getLeftRooms(): Room[] {
        return this.client.store.getRooms().filter((r) => r.getMyMembership() === "leave");
    }

    public syncLeftRooms(): Promise<Room[]> {
        // Guard against multiple calls whilst ongoing and multiple calls post success
        if (this.syncedLeftRooms) {
            return Promise.resolve([]); // don't call syncRooms again if it succeeded.
        }
        if (this.syncLeftRoomsPromise) {
            return this.syncLeftRoomsPromise; // return the ongoing request
        }
        const clientInternals = this.client as unknown as {
            clientOpts: IStoredClientOpts;
            buildSyncApiOptions(): SyncApiOptions;
        };
        const syncApi = new SyncApi(this.client, clientInternals.clientOpts, clientInternals.buildSyncApiOptions());
        this.syncLeftRoomsPromise = syncApi.syncLeftRooms();

        // cleanup locks
        this.syncLeftRoomsPromise
            .then(() => {
                logger.debug("Marking success of sync left room request");
                this.syncedLeftRooms = true; // flip the bit on success
            })
            .finally(() => {
                this.syncLeftRoomsPromise = undefined; // cleanup ongoing request state
            });

        return this.syncLeftRoomsPromise;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getSyncManager = function (): SyncManager {
        registerManagerClass("syncManagement", SyncManager);
        return getOrCreateManager(this, "syncManagement", () => new SyncManager(this));
    };
}
