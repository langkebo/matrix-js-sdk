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
 * Friend Shared State
 *
 * 好友模块子 Manager 之间共享的状态对象。
 * 由 FriendManager 创建并注入到各个子 Manager 中。
 */

import type { MatrixClient } from "../../client";
import type { LRUCache } from "../../utils/lru-cache";
import type { Friend, FriendRequest, FriendGroups } from "../index";

export interface FriendSharedState {
    /** MatrixClient 引用，供子 Manager 进行 HTTP 请求 */
    readonly client: MatrixClient;
    /** 好友列表房间 ID（缓存） */
    friendListRoomId: string | null;
    /** 好友缓存（LRU） */
    friends: LRUCache<Friend>;
    /** 收到的好友请求（按 user_id 索引） */
    incomingRequests: Map<string, FriendRequest>;
    /** 发出的好友请求（按 user_id 索引） */
    outgoingRequests: Map<string, FriendRequest>;
    /** 好友分组（按 group id 索引） */
    groups: FriendGroups;
    /** 是否已初始化 */
    initialized: boolean;
}
