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
 * Space 共享类型定义
 *
 * 由 index.ts 和所有 sub-managers 共同消费。
 */

import type { QueryDict } from "../http-api/utils";

export interface Space {
    space_id: string;
    room_id: string;
    name?: string;
    topic?: string;
    avatar_url?: string;
    creator?: string;
    join_rule?: string;
    visibility?: string;
    is_public?: boolean;
    created_ts?: number;
    updated_ts?: number;
    parent_space_id?: string;
}

export interface SpaceChild {
    space_id: string;
    room_id: string;
    via_servers: string[];
    sender?: string;
    is_suggested?: boolean;
    added_ts?: number;
    order?: string;
}

export interface SpaceMember {
    space_id: string;
    user_id: string;
    membership?: string;
    joined_ts?: number;
}

export interface SpaceHierarchy {
    space: Space;
    children: SpaceChild[];
    members: SpaceMember[];
}

export interface SpaceListResponse {
    chunk?: Space[];
    spaces?: Space[];
    rooms?: Space[];
    next_batch?: string;
    prev_batch?: string;
    total_room_count_estimate?: number;
}

export interface SpaceHierarchyPage {
    rooms?: unknown[];
    next_batch?: string;
}

export interface SpaceStatistics {
    total_spaces?: number;
    public_spaces?: number;
    private_spaces?: number;
    joined_spaces?: number;
}

export interface SpaceQueryOptions extends QueryDict {
    limit?: number;
    from?: string;
    since?: string;
    max_depth?: number;
    suggested_only?: boolean;
    server?: string;
    search_term?: string;
}

export interface CreateSpaceOptions {
    /** 必填：Space 关联的房间 ID（后端 CreateSpaceBody.room_id 是必填字段） */
    room_id: string;
    name?: string;
    topic?: string;
    avatar_url?: string;
    join_rule?: string;
    visibility?: "public" | "private";
    is_public?: boolean;
    parent_space_id?: string;
}

export interface UpdateSpaceOptions {
    name?: string;
    topic?: string;
    avatar_url?: string;
    join_rule?: string;
    visibility?: "public" | "private";
    is_public?: boolean;
}

export interface AddChildOptions {
    room_id: string;
    /** 后端 AddChildBody.via_servers 是必填 Vec<String>；缺省时 SDK 自动填 [] */
    via_servers?: string[];
    /** 排序键（对应 m.space.child 事件的 order 字段） */
    order?: string;
    suggested?: boolean;
}

export interface SpaceManagerMetrics {
    cache: { size: number; hits: number; misses: number; hitRate: number };
    requests: { total: number; successful: number; failed: number; retried: number };
}
