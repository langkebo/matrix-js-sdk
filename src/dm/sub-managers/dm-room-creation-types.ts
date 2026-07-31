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
 * DmRoomCreationManager 类型定义
 *
 * 创建 DM 房间、更新 m.direct 映射相关的请求/响应类型。
 */

import type { IContent } from "../../models/event";
import type { IDirectRoomsMap } from "./dm-room-list-types";

export interface CreateDmOptions {
    userIds: string[];
    invite?: boolean;
    name?: string;
    topic?: string;
    isEncrypted?: boolean;
}

export interface CreateDmRoomResponse {
    room_id: string;
}

export interface CreateDmRoomOptions {
    name?: string;
    topic?: string;
    invite?: string[];
    visibility?: "private" | "public";
}

export interface UpdateDirectRoomResponse {
    room_id: string;
    users: string[];
    direct_map: IDirectRoomsMap;
    updated_ts: number;
}

export interface UpdateDirectRoomOptions {
    userIds?: string[];
    content?: IContent;
}

/**
 * `client.createRoom()` 的响应类型（内部使用）。
 */
export interface ICreateRoomResponse {
    room_id: string;
}
