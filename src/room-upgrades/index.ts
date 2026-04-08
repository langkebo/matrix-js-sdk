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
 * Room Upgrades Manager - 房间升级管理
 * 
 * 提供房间升级相关功能
 */

import { MatrixClient } from "../client";
import { Room } from "../models/room";

export interface IRoomUpgradeHistory {
    roomId: string;
    version?: string;
    predecessor?: string;
    successor?: string;
}

export interface IUpgradeRoomResponse {
    replacement_room: string;
}

export class RoomUpgradesManager {
    constructor(private client: MatrixClient) {}

    public getRoomUpgradeHistory(roomId: string): IRoomUpgradeHistory[] {
        return (this.client as unknown as {
            getRoomUpgradeHistory: (roomId: string) => IRoomUpgradeHistory[];
        }).getRoomUpgradeHistory(roomId);
    }

    public async upgradeRoom(roomId: string, newVersion: string): Promise<IUpgradeRoomResponse> {
        return (this.client as unknown as {
            upgradeRoom: (roomId: string, newVersion: string) => Promise<IUpgradeRoomResponse>;
        }).upgradeRoom(roomId, newVersion);
    }

    public canUpgradeRoom(roomId: string): boolean {
        return (this.client as unknown as {
            canUpgradeRoom: (roomId: string) => boolean;
        }).canUpgradeRoom(roomId);
    }

    public async getRecommendedRoomVersion(): Promise<string> {
        return (this.client as unknown as {
            getRecommendedRoomVersion: () => Promise<string>;
        }).getRecommendedRoomVersion();
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getRoomUpgradesManager(): RoomUpgradesManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomUpgradesManager = function (): RoomUpgradesManager {
        return new RoomUpgradesManager(this);
    };
}

export default extendMatrixClient;
