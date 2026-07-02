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

// ===== Room operation payloads =====

export interface AdminReasonPayload {
    reason?: string;
}

export interface AdminBanKickPayload {
    user_id?: string;
    reason?: string;
}

export interface AdminMakeRoomAdminPayload {
    user_id?: string;
}

export interface RoomSearchPayload {
    search_term?: string;
    limit?: number;
    order_by?: string;
    from?: number;
    direction?: "f" | "b";
    [key: string]: unknown;
}

export interface RoomDeletePayload {
    block?: boolean;
    purge?: boolean;
    force_purge?: boolean;
    reason?: string;
    [key: string]: unknown;
}

export interface PurgeHistoryPayload {
    purge_up_to_event_id?: string;
    purge_up_to_ts?: number;
    delete_local_events?: boolean;
    [key: string]: unknown;
}

export interface RoomEventSearchPayload {
    search_term?: string;
    filter?: import("../../models/event").IContent;
    limit?: number;
    [key: string]: unknown;
}

// ===== Room info types =====

export interface RoomInfo {
    room_id: string;
    name?: string;
    topic?: string;
    avatar_url?: string;
    creator?: string;
    joined_members?: number;
    joined_local_members?: number;
    invited_members?: number;
    version?: string;
    created_ts?: number;
    join_rules?: string;
    public?: boolean;
    guest_access?: string;
    history_visibility?: string;
    state_events?: number;
}

export interface RoomStats {
    room_id: string;
    name?: string;
    topic?: string;
    avatar_url?: string;
    member_count?: number;
    message_count?: number;
    last_message_ts?: number;
    is_encrypted?: boolean;
    admin_count?: number;
    created_ts?: number;
}

export interface RoomStateEvent {
    type: string;
    state_key: string;
    content: import("../../models/event").IContent;
    sender: string;
    event_id: string;
}

export interface RoomMessage {
    event_id: string;
    type: string;
    content: import("../../models/event").IContent;
    sender: string;
    origin_server_ts: number;
}

// ===== Space types =====

export interface SpaceInfo {
    space_id: string;
    name?: string;
    room_id: string;
    creator?: string;
    child_rooms?: string[];
    member_count?: number;
}

export interface SpaceStats {
    joined_members: number;
    rooms_count: number;
    [key: string]: unknown;
}

export interface SpacePage {
    spaces: SpaceInfo[];
    next_batch?: string;
}

export interface SpaceUser {
    user_id: string;
}

export interface SpaceRoom {
    room_id: string;
}

// ===== Room admin response types =====

export interface AdminRoomVersionResponse {
    room_version: string;
    room_id?: string;
}

export interface AdminRoomBlockStatus {
    block: boolean;
    room_id: string;
    user_id?: string;
}

// ===== Room event context and search types =====

export interface AdminEventContextEvent {
    event_id: string;
    type: string;
    content: import("../../models/event").IContent;
    sender: string;
    origin_server_ts: number;
    state_key?: string;
}

export interface AdminEventContext {
    events: AdminEventContextEvent[];
    state?: AdminEventContextEvent[];
    start?: string;
    end?: string;
}

export interface AdminForwardExtremity {
    event_id: string;
    state_group: number;
    depth: number;
    received_ts: number;
}

export interface AdminTokenSync {
    stream_ordering: number;
    room_id: string;
}

export interface AdminRoomSearchResult {
    results: AdminEventContextEvent[];
    count: number;
    next_batch?: string;
    highlights?: string[];
}

export interface AdminRoomListing {
    room_id: string;
    name?: string;
    alias?: string;
    joined_members?: number;
    public?: boolean;
}

export interface AdminRoomListings {
    rooms: AdminRoomListing[];
    total?: number;
    next_batch?: string;
}

// ===== AdminReport types (shared with config manager) =====

export interface AdminReport {
    id: string;
    event_id?: string;
    room_id?: string;
    name?: string;
    score?: number;
    reason?: string;
    received_ts?: number;
    user_id?: string;
    sender?: string;
}

export interface AdminReportPage {
    reports: AdminReport[];
    total?: number;
    next_token?: string;
}

// ===== Purge history result (shared with server manager) =====

export interface AdminPurgeHistoryResult {
    purge_id: string;
}
