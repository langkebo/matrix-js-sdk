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
 * Room Upgrades Manager - 房间升级管理
 *
 * 提供房间升级相关功能
 */

import { MatrixClient } from "../client";
import { BaseManager } from "../managers/base-manager";

export interface IRoomUpgradeHistory {
    roomId: string;
    version?: string;
    predecessor?: string;
    successor?: string;
}

export interface IUpgradeRoomResponse {
    replacement_room: string;
}

export interface RoomUpgradesManagerEvents {
    room_upgraded: { oldRoomId: string; newRoomId: string };
    upgrade_failed: { roomId: string; error: Error };
}

export class RoomUpgradesManager extends BaseManager<keyof RoomUpgradesManagerEvents, RoomUpgradesManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public getRoomUpgradeHistory(roomId: string): IRoomUpgradeHistory[] {
        return (
            this.client as unknown as {
                getRoomUpgradeHistory: (roomId: string) => IRoomUpgradeHistory[];
            }
        ).getRoomUpgradeHistory(roomId);
    }

    public async upgradeRoom(roomId: string, newVersion: string): Promise<IUpgradeRoomResponse> {
        return this.withRetry(
            () =>
                (
                    this.client as unknown as {
                        upgradeRoom: (roomId: string, newVersion: string) => Promise<IUpgradeRoomResponse>;
                    }
                ).upgradeRoom(roomId, newVersion),
            "upgradeRoom",
        );
    }

    public canUpgradeRoom(roomId: string): boolean {
        return (
            this.client as unknown as {
                canUpgradeRoom: (roomId: string) => boolean;
            }
        ).canUpgradeRoom(roomId);
    }

    public async getRecommendedRoomVersion(): Promise<string> {
        return this.withRetry(
            () =>
                (
                    this.client as unknown as {
                        getRecommendedRoomVersion: () => Promise<string>;
                    }
                ).getRecommendedRoomVersion(),
            "getRecommendedRoomVersion",
        );
    }
}

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
