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

export class RoomUpgradesManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get room upgrade history
     */
    public getRoomUpgradeHistory(roomId: string): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getRoomUpgradeHistory(roomId);
    }

    /**
     * Upgrade room
     */
    public async upgradeRoom(roomId: string, newVersion: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).upgradeRoom(roomId, newVersion);
    }

    /**
     * Can upgrade room
     */
    public canUpgradeRoom(roomId: string): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).canUpgradeRoom(roomId);
    }

    /**
     * Get recommended room version
     */
    public async getRecommendedRoomVersion(): Promise<string> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getRecommendedRoomVersion();
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
