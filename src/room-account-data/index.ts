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
import { MatrixEvent } from "../models/event";
import { BaseManager } from "../managers/base-manager";

export interface RoomAccountDataManagerEvents {
    account_data_updated: { roomId: string; eventType: string; event: MatrixEvent };
}

export class RoomAccountDataManager extends BaseManager<
    keyof RoomAccountDataManagerEvents,
    RoomAccountDataManagerEvents
> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public async setRoomAccountData(
        roomId: string,
        eventType: string,
        content: Record<string, unknown>,
    ): Promise<void> {
        await this.client.setRoomAccountData(roomId, eventType as never, content as never);
    }

    public getRoomAccountData(roomId: string, eventType: string): MatrixEvent | undefined {
        const room = this.client.getRoom(roomId);
        return room?.getAccountData(eventType);
    }

    public getAllRoomAccountData(roomId: string): Record<string, MatrixEvent> {
        const room = this.client.getRoom(roomId);
        if (!room) return {};

        const result: Record<string, MatrixEvent> = {};
        const accountDataMap = (room as unknown as { accountData: Map<string, MatrixEvent> }).accountData;
        if (!accountDataMap) return {};

        for (const eventType of accountDataMap.keys()) {
            const event = room.getAccountData(eventType);
            if (event) {
                result[eventType] = event;
            }
        }
        return result;
    }

    public hasRoomAccountData(roomId: string, eventType: string): boolean {
        const room = this.client.getRoom(roomId);
        return room?.getAccountData(eventType) !== undefined;
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getRoomAccountDataManager(): RoomAccountDataManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomAccountDataManager = function (): RoomAccountDataManager {
        return new RoomAccountDataManager(this);
    };
}

export default extendMatrixClient;
