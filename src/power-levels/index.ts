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
 * Power Levels Manager - 权限级别管理
 * 
 * 提供权限级别相关功能
 */

import { MatrixClient } from "../client";

export class PowerLevelsManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get user power level
     */
    public getUserPowerLevel(userId: string, roomId: string): number {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getUserPowerLevel(userId, roomId);
    }

    /**
     * Get power level event content
     */
    public getPowerLevelEventContent(roomId: string): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getPowerLevelEventContent(roomId);
    }

    /**
     * Set user power level
     */
    public async setUserPowerLevel(userId: string, roomId: string, powerLevel: number): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).setUserPowerLevel(userId, roomId, powerLevel);
    }

    /**
     * Can send event
     */
    public canSendEvent(eventType: string, roomId: string): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).canSendEvent(eventType, roomId);
    }

    /**
     * Check auth event
     */
    public checkAuthEvent(event: any, room: any): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).checkAuthEvent(event, room);
    }

    /**
     * Is room admin
     */
    public isRoomAdmin(roomId: string): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).isRoomAdmin(roomId);
    }

    /**
     * Is room moderator
     */
    public isRoomModerator(roomId: string): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).isRoomModerator(roomId);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getPowerLevelsManager(): PowerLevelsManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getPowerLevelsManager = function (): PowerLevelsManager {
        return new PowerLevelsManager(this);
    };
}

export default extendMatrixClient;
