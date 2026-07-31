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
 * DmRoomListManager 类型定义
 *
 * DM 房间查询、缓存、服务器查询相关的类型。list manager 持有 dmRoomsCache，
 * 因此 DmRoomInfo（缓存值类型）定义在此处，供 creation/operation sub-manager 引用。
 */

export interface DmRoomInfo {
    roomId: string;
    inviter?: string;
    invitees: string[];
    name?: string;
    avatarUrl?: string;
    lastMessage?: {
        content: string;
        timestamp: number;
        sender: string;
    };
    unreadCount?: number;
}

export interface IDirectRoomsMap {
    [userId: string]: string[];
}

export interface DirectRoomsResponse {
    rooms: IDirectRoomsMap;
}

export interface DmRoomCheckResponse {
    room_id: string;
    "m.direct": boolean;
}

export interface DmPartnerResponse {
    room_id: string;
    user_id: string;
    display_name: string;
    avatar_url: string;
}
