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
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import { EventType } from "../@types/event";
import { HistoryVisibility, GuestAccess, JoinRule } from "../@types/partials";

export interface RoomSettingsManagerEvents {
    room_name_changed: { roomId: string; name: string };
    room_topic_changed: { roomId: string; topic: string };
    room_avatar_changed: { roomId: string; avatarUrl: string };
    room_history_visibility_changed: { roomId: string; visibility: string };
    room_guest_access_changed: { roomId: string; allow: boolean };
    room_join_rule_changed: { roomId: string; joinRule: string };
}

export class RoomSettingsManager extends BaseManager<keyof RoomSettingsManagerEvents, RoomSettingsManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public getRoomName(roomId: string): string {
        return this.client.getRoom(roomId)?.name ?? "";
    }

    public async setRoomName(roomId: string, name: string): Promise<ISendEventResponse> {
        return this.withRetry(
            () => this.client.sendStateEvent(roomId, EventType.RoomName, { name }, ""),
            "setRoomName",
        );
    }

    public getRoomTopic(roomId: string): string {
        const room = this.client.getRoom(roomId);
        if (!room) return "";
        const content = room.currentState.getStateEvents(EventType.RoomTopic, "")?.getContent<{ topic?: string }>();
        return content?.topic ?? "";
    }

    public async setRoomTopic(roomId: string, topic: string): Promise<ISendEventResponse> {
        return this.withRetry(
            () => this.client.sendStateEvent(roomId, EventType.RoomTopic, { topic }, ""),
            "setRoomTopic",
        );
    }

    public getRoomAvatarUrl(roomId: string): string {
        const room = this.client.getRoom(roomId);
        if (!room) return "";
        return room.getMxcAvatarUrl() ?? "";
    }

    public async setRoomAvatar(roomId: string, avatarUrl: string): Promise<void> {
        await this.withRetry(
            () => this.client.sendStateEvent(roomId, EventType.RoomAvatar, { url: avatarUrl }, ""),
            "setRoomAvatar",
        );
    }

    public getRoomHistoryVisibility(roomId: string): string {
        const room = this.client.getRoom(roomId);
        if (!room) return HistoryVisibility.Shared;
        return room.getHistoryVisibility();
    }

    public async setRoomHistoryVisibility(roomId: string, visibility: string): Promise<void> {
        await this.withRetry(
            () =>
                this.client.sendStateEvent(
                    roomId,
                    EventType.RoomHistoryVisibility,
                    { history_visibility: visibility as HistoryVisibility },
                    "",
                ),
            "setRoomHistoryVisibility",
        );
    }

    public getRoomGuestAccess(roomId: string): string {
        const room = this.client.getRoom(roomId);
        if (!room) return "";
        return room.getGuestAccess();
    }

    public async setRoomGuestAccess(roomId: string, allow: boolean | string): Promise<void> {
        const isAllowed = typeof allow === "string" ? allow === "can_join" || allow === "true" : allow;
        const guestAccess = isAllowed ? GuestAccess.CanJoin : GuestAccess.Forbidden;
        await this.withRetry(
            () => this.client.sendStateEvent(roomId, EventType.RoomGuestAccess, { guest_access: guestAccess }, ""),
            "setRoomGuestAccess",
        );
    }

    public getRoomJoinRule(roomId: string): string {
        const room = this.client.getRoom(roomId);
        if (!room) return JoinRule.Invite;
        return room.getJoinRule();
    }

    public async setRoomJoinRule(roomId: string, joinRule: string): Promise<void> {
        await this.withRetry(
            () => this.client.sendStateEvent(roomId, EventType.RoomJoinRules, { join_rule: joinRule as JoinRule }, ""),
            "setRoomJoinRule",
        );
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomSettingsManager = function (): RoomSettingsManager {
        registerManagerClass("roomSettings", RoomSettingsManager);
        return getOrCreateManager(this, "roomSettings", () => new RoomSettingsManager(this));
    };
}

export default extendMatrixClient;
