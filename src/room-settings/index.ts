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

    /**
     * 获取房间名称。
     *
     * @param roomId - 房间 ID
     * @returns 房间名称；房间不存在时返回空字符串
     * @example
     * ```typescript
     * const name = client.getRoomSettingsManager().getRoomName("!room:example.org");
     * ```
     */
    public getRoomName(roomId: string): string {
        return this.client.getRoom(roomId)?.name ?? "";
    }

    /**
     * 设置房间名称。
     *
     * 通过发送 `m.room.name` 状态事件更新房间名称。
     *
     * @param roomId - 房间 ID
     * @param name - 新的房间名称
     * @returns 状态事件发送响应
     * @example
     * ```typescript
     * await client.getRoomSettingsManager().setRoomName("!room:example.org", "我的房间");
     * ```
     */
    public async setRoomName(roomId: string, name: string): Promise<ISendEventResponse> {
        return this.withRetry(
            () => this.client.sendStateEvent(roomId, EventType.RoomName, { name }, ""),
            "setRoomName",
        );
    }

    /**
     * 获取房间主题。
     *
     * @param roomId - 房间 ID
     * @returns 房间主题；房间不存在或未设置时返回空字符串
     * @example
     * ```typescript
     * const topic = client.getRoomSettingsManager().getRoomTopic("!room:example.org");
     * ```
     */
    public getRoomTopic(roomId: string): string {
        const room = this.client.getRoom(roomId);
        if (!room) return "";
        const content = room.currentState.getStateEvents(EventType.RoomTopic, "")?.getContent<{ topic?: string }>();
        return content?.topic ?? "";
    }

    /**
     * 设置房间主题。
     *
     * 通过发送 `m.room.topic` 状态事件更新房间主题。
     *
     * @param roomId - 房间 ID
     * @param topic - 新的房间主题
     * @returns 状态事件发送响应
     * @example
     * ```typescript
     * await client.getRoomSettingsManager().setRoomTopic("!room:example.org", "欢迎加入");
     * ```
     */
    public async setRoomTopic(roomId: string, topic: string): Promise<ISendEventResponse> {
        return this.withRetry(
            () => this.client.sendStateEvent(roomId, EventType.RoomTopic, { topic }, ""),
            "setRoomTopic",
        );
    }

    /**
     * 获取房间头像 URL。
     *
     * @param roomId - 房间 ID
     * @returns 头像的 `mxc://` URL；房间不存在或未设置时返回空字符串
     * @example
     * ```typescript
     * const avatarUrl = client.getRoomSettingsManager().getRoomAvatarUrl("!room:example.org");
     * ```
     */
    public getRoomAvatarUrl(roomId: string): string {
        const room = this.client.getRoom(roomId);
        if (!room) return "";
        return room.getMxcAvatarUrl() ?? "";
    }

    /**
     * 设置房间头像。
     *
     * 通过发送 `m.room.avatar` 状态事件更新房间头像。
     *
     * @param roomId - 房间 ID
     * @param avatarUrl - 头像的 `mxc://` URL
     * @example
     * ```typescript
     * await client.getRoomSettingsManager().setRoomAvatar("!room:example.org", "mxc://example.org/abc");
     * ```
     */
    public async setRoomAvatar(roomId: string, avatarUrl: string): Promise<void> {
        await this.withRetry(
            () => this.client.sendStateEvent(roomId, EventType.RoomAvatar, { url: avatarUrl }, ""),
            "setRoomAvatar",
        );
    }

    /**
     * 获取房间历史消息可见性。
     *
     * @param roomId - 房间 ID
     * @returns 历史可见性取值（如 `shared`）；房间不存在时返回默认值 `shared`
     * @example
     * ```typescript
     * const visibility = client.getRoomSettingsManager().getRoomHistoryVisibility("!room:example.org");
     * ```
     */
    public getRoomHistoryVisibility(roomId: string): string {
        const room = this.client.getRoom(roomId);
        if (!room) return HistoryVisibility.Shared;
        return room.getHistoryVisibility();
    }

    /**
     * 设置房间历史消息可见性。
     *
     * 通过发送 `m.room.history_visibility` 状态事件更新可见性。
     *
     * @param roomId - 房间 ID
     * @param visibility - 历史可见性取值（如 `shared`、`invited`、`joined`、`world_readable`）
     * @example
     * ```typescript
     * await client.getRoomSettingsManager().setRoomHistoryVisibility("!room:example.org", "shared");
     * ```
     */
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

    /**
     * 获取房间访客准入设置。
     *
     * @param roomId - 房间 ID
     * @returns 访客准入取值（`can_join` 或 `forbidden`）；房间不存在时返回空字符串
     * @example
     * ```typescript
     * const guestAccess = client.getRoomSettingsManager().getRoomGuestAccess("!room:example.org");
     * ```
     */
    public getRoomGuestAccess(roomId: string): string {
        const room = this.client.getRoom(roomId);
        if (!room) return "";
        return room.getGuestAccess();
    }

    /**
     * 设置房间访客准入。
     *
     * 通过发送 `m.room.guest_access` 状态事件更新准入设置；仅当 `allow` 为
     * `true`、`"can_join"` 或 `"true"` 时视为允许，其余情况映射为 `forbidden`。
     *
     * @param roomId - 房间 ID
     * @param allow - 是否允许访客加入（布尔值或字符串形式）
     * @example
     * ```typescript
     * await client.getRoomSettingsManager().setRoomGuestAccess("!room:example.org", true);
     * ```
     */
    public async setRoomGuestAccess(roomId: string, allow: boolean | string): Promise<void> {
        const isAllowed = typeof allow === "string" ? allow === "can_join" || allow === "true" : allow;
        const guestAccess = isAllowed ? GuestAccess.CanJoin : GuestAccess.Forbidden;
        await this.withRetry(
            () => this.client.sendStateEvent(roomId, EventType.RoomGuestAccess, { guest_access: guestAccess }, ""),
            "setRoomGuestAccess",
        );
    }

    /**
     * 获取房间加入规则。
     *
     * @param roomId - 房间 ID
     * @returns 加入规则取值（如 `public`、`invite`、`knock`）；房间不存在时返回默认值 `invite`
     * @example
     * ```typescript
     * const joinRule = client.getRoomSettingsManager().getRoomJoinRule("!room:example.org");
     * ```
     */
    public getRoomJoinRule(roomId: string): string {
        const room = this.client.getRoom(roomId);
        if (!room) return JoinRule.Invite;
        return room.getJoinRule();
    }

    /**
     * 设置房间加入规则。
     *
     * 通过发送 `m.room.join_rules` 状态事件更新加入规则。
     *
     * @param roomId - 房间 ID
     * @param joinRule - 加入规则取值（如 `public`、`invite`、`knock`）
     * @example
     * ```typescript
     * await client.getRoomSettingsManager().setRoomJoinRule("!room:example.org", "public");
     * ```
     */
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
