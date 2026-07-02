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

// ===== Federation blacklist types =====

export interface FederationBlacklistEntry {
    server_name: string;
    added_ts?: number;
    reason?: string;
}

// ===== Federation destination types =====

export interface FederationDestination {
    destination: string;
    retry_last_ts?: number;
    retry_interval?: number;
    failure_ts?: number;
    last_successful_stream_ordering?: number;
    status?: "pending" | "active" | "rejected";
    updated_ts?: number;
}

/** 单个联邦目的地的详细信息（GET /federation/destinations/{destination}） */
export interface AdminFederationDestinationDetail extends FederationDestination {
    failure_count: number;
    last_successful_ts?: number;
}

export interface AdminFederationDestinationRoom {
    room_id: string;
    stream_ordering?: number;
    event_id?: string;
    sent_ts?: number;
}

export interface AdminFederationDestinationRooms {
    rooms: AdminFederationDestinationRoom[];
    total: number;
    next_token?: string;
}

// ===== Federation admission types =====

export interface FederationAdmissionResult {
    server_name: string;
    status: "active" | "rejected";
    previous_status: string;
    updated_ts: number;
    confirmed_by: string;
}

export interface PendingFederationServer {
    server_name: string;
    failure_count: number;
    last_failed_connect_at?: number;
    last_successful_connect_at?: number;
    status: "pending";
    updated_ts?: number;
}

export interface PendingFederationList {
    servers: PendingFederationServer[];
    total: number;
    limit: number;
    offset: number;
}

// ===== Federation cache types =====

export interface AdminFederationCacheEntry {
    key: string;
    value: Record<string, unknown>; // Dynamic: feature flag value shape varies
    size?: number;
    last_access_ts?: number;
}

export interface AdminFederationCache {
    entries: AdminFederationCacheEntry[];
    total?: number;
}

// ===== Federation resolve/rewrite types =====

/** Response for POST /federation/resolve — federation resolve result */
export interface FederationResolveResponse {
    server_name: string;
    resolved: boolean;
    blacklisted: boolean;
    in_destinations: boolean;
    resolved_by?: string;
}

/** Response for POST /federation/rewrite — federation rewrite result */
export interface FederationRewriteResponse {
    from: string;
    to: string;
    rewritten: boolean;
    rooms_affected: number;
    rewritten_by?: string;
}
