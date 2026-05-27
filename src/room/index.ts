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
import { RoomManager } from "./RoomManager";
import { getOrCreateManager } from "../client-infra/manager-registry";

export * from "./RoomManager";

export function setRoomManagerRetryOptions(
    client: MatrixClient,
    options: import("../managers/base-manager").RetryOptions,
): void {
    client.getRoomManager().setRetryOptions(options);
}

declare module "../client.ts" {
    interface MatrixClient {
        getRoomManager(): RoomManager;
        getRoom(roomId: string): import("../models/room").Room | null;
        getRooms(): import("../models/room").Room[];
        sendStateEvent(
            roomId: string,
            eventType: string,
            content: Record<string, unknown>,
            stateKey?: string,
        ): Promise<{ event_id: string }>;
    }
}

/**
 * 为 MatrixClient 扩展 RoomManager 相关能力
 */
export function extendMatrixClient(): void {
    if (MatrixClient.prototype.hasOwnProperty("getRoomManager")) return;

    MatrixClient.prototype.getRoomManager = function (this: MatrixClient): RoomManager {
        return getOrCreateManager(this, "room", () => new RoomManager(this));
    };

    MatrixClient.prototype.getRoom = function (this: MatrixClient, roomId: string) {
        return this.getRoomManager().getRoom(roomId);
    };

    MatrixClient.prototype.getRooms = function (this: MatrixClient) {
        return this.getRoomManager().getRooms();
    };
}

export default extendMatrixClient;
