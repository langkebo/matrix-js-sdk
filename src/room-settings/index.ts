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
 * Room Settings Manager - 房间设置管理
 * 
 * 提供房间设置相关功能
 */

import { MatrixClient } from "../client";

export class RoomSettingsManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get room name
     */
    public getRoomName(roomId: string): string {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getRoomName(roomId);
    }

    /**
     * Set room name
     */
    public async setRoomName(roomId: string, name: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).setRoomName(roomId, name);
    }

    /**
     * Get room topic
     */
    public getRoomTopic(roomId: string): string {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getRoomTopic(roomId);
    }

    /**
     * Set room topic
     */
    public async setRoomTopic(roomId: string, topic: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).setRoomTopic(roomId, topic);
    }

    /**
     * Get room avatar
     */
    public getRoomAvatarUrl(roomId: string): string | undefined {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getRoomAvatarUrl(roomId);
    }

    /**
     * Set room avatar
     */
    public async setRoomAvatar(roomId: string, avatarUrl: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).setRoomAvatar(roomId, avatarUrl);
    }

    /**
     * Get room history visibility
     */
    public getRoomHistoryVisibility(roomId: string): string {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getRoomHistoryVisibility(roomId);
    }

    /**
     * Set room history visibility
     */
    public async setRoomHistoryVisibility(roomId: string, visibility: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).setRoomHistoryVisibility(roomId, visibility);
    }

    /**
     * Get room guest access
     */
    public getRoomGuestAccess(roomId: string): string {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getRoomGuestAccess(roomId);
    }

    /**
     * Set room guest access
     */
    public async setRoomGuestAccess(roomId: string, allow: boolean): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).setRoomGuestAccess(roomId, allow);
    }

    /**
     * Get room join rule
     */
    public getRoomJoinRule(roomId: string): string {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getRoomJoinRule(roomId);
    }

    /**
     * Set room join rule
     */
    public async setRoomJoinRule(roomId: string, joinRule: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).setRoomJoinRule(roomId, joinRule);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getRoomSettingsManager(): RoomSettingsManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomSettingsManager = function (): RoomSettingsManager {
        return new RoomSettingsManager(this);
    };
}

export default extendMatrixClient;
