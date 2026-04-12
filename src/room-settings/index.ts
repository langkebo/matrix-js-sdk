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
import type { ISendEventResponse } from "../@types/requests";
import { BaseManager } from "../managers/base-manager";

export interface RoomSettingsManagerEvents {
    room_name_changed: { roomId: string; name: string };
    room_topic_changed: { roomId: string; topic: string };
    room_avatar_changed: { roomId: string; avatarUrl: string };
    room_history_visibility_changed: { roomId: string; visibility: string };
    room_guest_access_changed: { roomId: string; allow: boolean };
    room_join_rule_changed: { roomId: string; joinRule: string };
}

export class RoomSettingsManager extends BaseManager<keyof RoomSettingsManagerEvents, RoomSettingsManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public getRoomName(roomId: string): string {
        return this.client.getRoomName(roomId);
    }

    public async setRoomName(roomId: string, name: string): Promise<ISendEventResponse> {
        return this.withRetry(() => this.client.setRoomName(roomId, name), "setRoomName");
    }

    public getRoomTopic(roomId: string): string {
        return this.client.getRoomTopic(roomId);
    }

    public async setRoomTopic(roomId: string, topic: string): Promise<ISendEventResponse> {
        return this.withRetry(() => this.client.setRoomTopic(roomId, topic), "setRoomTopic");
    }

    public getRoomAvatarUrl(roomId: string): string {
        return this.client.getRoomAvatarUrl(roomId);
    }

    public async setRoomAvatar(roomId: string, avatarUrl: string): Promise<void> {
        await this.client.setRoomAvatar(roomId, avatarUrl);
    }

    public getRoomHistoryVisibility(roomId: string): string {
        return this.client.getRoomHistoryVisibility(roomId);
    }

    public async setRoomHistoryVisibility(roomId: string, visibility: string): Promise<void> {
        await this.client.setRoomHistoryVisibility(roomId, visibility);
    }

    public getRoomGuestAccess(roomId: string): string {
        return this.client.getRoomGuestAccess(roomId);
    }

    public async setRoomGuestAccess(roomId: string, allow: boolean): Promise<void> {
        await this.client.setRoomGuestAccess(roomId, allow);
    }

    public getRoomJoinRule(roomId: string): string {
        return this.client.getRoomJoinRule(roomId);
    }

    public async setRoomJoinRule(roomId: string, joinRule: string): Promise<void> {
        await this.client.setRoomJoinRule(roomId, joinRule);
    }
}

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
