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
 * Room Creation Manager - 房间创建管理
 *
 * 提供房间创建相关功能
 */

import { MatrixClient } from "../client";
import { type IContent } from "../models/event";
import { EventType } from "../@types/event";
import { Preset } from "../@types/partials";
import type { ICreateRoomOpts } from "../@types/requests";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export interface ICreateRoomOptions {
    room_alias_name?: string;
    visibility?: "public" | "private";
    invite?: string[];
    invite_3pid?: Array<{
        id_server: string;
        id_access_token: string;
        medium: string;
        address: string;
    }>;
    room_version?: string;
    creation_content?: IContent;
    initial_state?: Array<{
        type: string;
        state_key?: string;
        content: IContent;
    }>;
    preset?: "private_chat" | "public_chat" | "trusted_private_chat";
    is_direct?: boolean;
    name?: string;
    topic?: string;
    power_level_content_override?: IContent;
}

export interface ICreateRoomResponse {
    room_id: string;
}

export interface ICreateRoomOptionsConfig extends ICreateRoomOptions {
    [key: string]: unknown;
}

export interface RoomCreationManagerEvents {
    room_created: { roomId: string };
    room_creation_failed: { error: Error };
    direct_room_created: { roomId: string; userId: string };
}

export class RoomCreationManager extends BaseManager<keyof RoomCreationManagerEvents, RoomCreationManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    // 房间创建选项模板（模块内自持状态，不随 client 走）。 */
    // private createRoomOptionsTemplate: ICreateRoomOptionsConfig = {};
    // public async createRoom(options?: ICreateRoomOptions): Promise<ICreateRoomResponse> {
    // return this.withRetry(
    // () => this.client.createRoom({ ...this.createRoomOptionsTemplate, ...options } as ICreateRoomOpts),
    // "createRoom",
    // );
    // }
    // /**
    // 创建私聊房间。
    // 本 fork 没有 `client.createDirectRoom` —— 它只是 `createRoom` 外加
    // `invite: [userId]` 与 `is_direct: true`（Matrix 规范里"私聊"就是这个形状）。
    public async createDirectRoom(userId: string, options?: ICreateRoomOptions): Promise<ICreateRoomResponse> {
        const opts = { ...this.createRoomOptionsTemplate, ...options } as ICreateRoomOpts;
        opts.invite = [...(opts.invite ?? []), userId];
        opts.is_direct = true;
        opts.preset = opts.preset ?? Preset.TrustedPrivateChat;

        return this.withRetry(() => this.client.createRoom(opts), "createDirectRoom");
    }

    // 找到与某人的既有私聊；没有就新建。
    // 依据 `m.direct` account data —— Matrix 规范里它是"私聊房间"的权威索引。
    // 本 fork 没有 `client.findOrCreateDirectRoom`。
    public async findOrCreateDirectRoom(userId: string): Promise<ICreateRoomResponse> {
        const direct = this.client.getAccountData(EventType.Direct)?.getContent() as
            | Record<string, string[]>
            | undefined;

        for (const roomId of direct?.[userId] ?? []) {
            if (this.client.getRoom(roomId)) return { room_id: roomId };
        }

        return this.createDirectRoom(userId);
    }

    // 读 / 写"房间创建选项模板"——**模块内自持状态**。
    // 此前这两个方法转发给 `client.getCreateRoomOptions()` / `setCreateRoomOptions()`，
    // 而 MatrixClient 上没有这两个方法 —— "模板"是本模块的概念，不是 client 的概念。
    public getCreateRoomOptions(): ICreateRoomOptionsConfig {
        return { ...this.createRoomOptionsTemplate };
    }

    public setCreateRoomOptions(options: ICreateRoomOptionsConfig): void {
        this.createRoomOptionsTemplate = { ...options };
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRoomCreationManager = function (): RoomCreationManager {
        registerManagerClass("roomCreation", RoomCreationManager);
        return getOrCreateManager(this, "roomCreation", () => new RoomCreationManager(this));
    };
}
