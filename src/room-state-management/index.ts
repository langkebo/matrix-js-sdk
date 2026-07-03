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
 * Room State Management Manager - 房间状态管理
 *
 * 提供房间状态管理相关功能
 */

import { MatrixClient } from "../client";
import { MatrixEvent, type IContent } from "../models/event";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export interface IRoomStateEvent {
    type: string;
    state_key: string;
    content: IContent;
    sender: string;
    event_id: string;
}

export interface RoomStateManagementManagerEvents {
    state_event_sent: { roomId: string; eventType: string };
    state_updated: { roomId: string };
}

export class RoomStateManagementManager extends BaseManager<
    keyof RoomStateManagementManagerEvents,
    RoomStateManagementManagerEvents
> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public async getRoomState(roomId: string): Promise<IRoomStateEvent[]> {
        return this.withRetry(() => this.client.getRoomState(roomId), "getRoomState");
    }

    public async getRoomStateEvents(roomId: string, eventType: string, stateKey?: string): Promise<MatrixEvent[]> {
        return this.withRetry(() => this.client.getRoomStateEvents(roomId, eventType, stateKey), "getRoomStateEvents");
    }

    public getStateEvents(eventType: string, stateKey: string): MatrixEvent[] {
        return this.client.getStateEvents(eventType, stateKey);
    }

    public async setRoomAccountData(roomId: string, eventType: string, content: IContent): Promise<void> {
        // Type assertion needed: real MatrixClient.setRoomAccountData has generic signature
        // <K extends keyof RoomAccountDataEvents>(roomId, eventType: K, content): Promise<EmptyObject>
        // which doesn't accept arbitrary string for eventType
        return this.withRetry(
            () =>
                (
                    this.client as unknown as {
                        setRoomAccountData: (roomId: string, eventType: string, content: IContent) => Promise<void>;
                    }
                ).setRoomAccountData(roomId, eventType, content),
            "setRoomAccountData",
        );
    }

    public getRoomAccountData(roomId: string, eventType: string): IContent | null {
        return this.client.getRoomAccountData(roomId, eventType);
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomStateManagementManager = function (): RoomStateManagementManager {
        registerManagerClass("roomStateManagement", RoomStateManagementManager);
        return getOrCreateManager(this, "roomStateManagement", () => new RoomStateManagementManager(this));
    };
}

export default extendMatrixClient;
