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

/** Generic paginated response wrapper used across all admin modules */
export interface PaginatedResponse<T> {
    items: T[];
    nextToken?: string;
    total?: number;
}

/** Admin API error class */
export class AdminApiError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly statusCode: number,
        public readonly details?: Record<string, unknown>, // Dynamic: error details shape varies
    ) {
        super(message);
        this.name = "AdminApiError";
    }
}

/** Central admin event enum */
export enum AdminEvent {
    UserCreated = "UserCreated",
    UserDeactivated = "UserDeactivated",
    UserShadowBanned = "UserShadowBanned",
    UserUnshadowBanned = "UserUnshadowBanned",
    RoomDeleted = "RoomDeleted",
    RoomBlocked = "RoomBlocked",
    ServerStatsUpdated = "ServerStatsUpdated",
    AdminError = "AdminError",
}

// ===== User payloads =====

export interface AdminToken {
    id: number;
    device_id: string;
    user_id: string;
    name?: string;
    [key: string]: unknown;
}

export interface AdminRefreshToken {
    id: number;
    user_id: string;
    device_id: string;
    token: string;
    [key: string]: unknown;
}

export interface AdminLogoutRequest {
    devices?: string[];
    revoke_all?: boolean;
}

export interface AdminEvictRequest {
    reason?: string;
}

export interface DeactivateUserResponse {
    id_server_unbind_result?: string;
}

// ===== Device and session types =====

export interface DeviceInfo {
    device_id: string;
    display_name?: string;
    last_seen_ip?: string;
    last_seen_ts?: number;
    user_id?: string;
}

export interface UserSession {
    session_id: string;
    device_id?: string;
    last_seen_ts?: number;
    last_seen_ip?: string;
    user_agent?: string;
}

// ===== Account types =====

export interface AdminAccountDetails {
    user_id: string;
    name?: string;
    displayname?: string;
    avatar_url?: string;
    admin?: boolean;
    deactivated?: boolean;
    suspended?: boolean;
    created_ts?: number;
    last_seen_ts?: number;
    last_seen_ip?: string;
    user_type?: string;
    is_guest?: boolean;
    erased?: boolean;
}

export interface AccountStatus {
    user_id: string;
    exists: boolean;
    deactivated?: boolean;
    locked?: boolean;
    suspended?: boolean;
}

export interface ShadowBanStatus {
    user_id: string;
    banned: boolean;
    banned_at?: number;
}

export interface RateLimitConfig {
    messages_per_second?: number;
    burst_count?: number;
}

// ===== Whois / pusher types =====

export interface WhoisResponse {
    user_id: string;
    devices: Record<
        string,
        {
            sessions: Array<{
                connections: Array<{
                    ip: string;
                    last_seen: number;
                    user_agent: string;
                }>;
            }>;
        }
    >;
}

export interface PusherData {
    /** The URL to use for sending push notifications */
    url?: string;
    /** The format of the push notification */
    format?: string;
    /** Additional pusher data fields */
    [key: string]: unknown;
}

export interface UserPusher {
    pushkey: string;
    app_id: string;
    kind?: string;
    app_display_name?: string;
    device_display_name?: string;
    profile_tag?: string;
    lang?: string;
    data?: PusherData;
}

// ===== Login as user types =====

export interface LoginWellKnown {
    /** The homeserver's base URL */
    "m.homeserver"?: { base_url: string };
    /** The identity server's base URL */
    "m.identity_server"?: { base_url: string };
    /** Additional well-known properties */
    [key: string]: unknown;
}

export interface AdminLoginAsUserRequest {
    type?: string;
    device_id?: string;
    initial_device_display_name?: string;
}

export interface AdminLoginAsUserResponse {
    access_token: string;
    device_id: string;
    user_id: string;
    well_known?: LoginWellKnown;
}

// ===== Batch user operations =====

export interface BatchCreateUsersRequest {
    users: Array<{
        user_id: string;
        password?: string;
        displayname?: string;
        admin?: boolean;
    }>;
}

export interface BatchCreateUsersResponse {
    created: string[];
    errors?: Array<{ user_id: string; error: string }>;
}

export interface BatchDeactivateUsersRequest {
    user_ids: string[];
    erase?: boolean;
}

export interface BatchDeactivateUsersResponse {
    deactivated: string[];
    errors?: Array<{ user_id: string; error: string }>;
}

// ===== Update account types =====

export interface UpdateAccountDetailsRequest {
    displayname?: string;
    avatar_url?: string;
    password?: string;
    suspended?: boolean;
    threepids?: Array<{ medium: string; address: string }>;
    external_ids?: Array<{ auth_provider: string; external_id: string }>;
}

export interface UpdateAccountDetailsResponse {
    updated: boolean;
    [key: string]: unknown;
}

// ===== Logout / evict response types =====

export interface AdminLogoutResponse {
    device_id?: string;
    [key: string]: unknown;
}

export interface AdminEvictResponse {
    evicted: boolean;
    [key: string]: unknown;
}

// ===== User stats types =====

/** Response for GET /users/{userId}/stats — single user statistics */
export interface UserStatsResponse {
    user_id: string;
    rooms_joined: number;
    messages_sent: number;
    last_seen_ts: number | null;
    creation_ts?: number;
    is_admin?: boolean;
    dashboard?: {
        total_rooms: number;
        total_messages: number;
        last_seen: number | null;
    };
}

/** Response for GET /user_stats — aggregated user statistics list */
export interface UserStatsListResponse {
    total_users: number;
    active_users: number;
    admin_users: number;
    deactivated_users: number;
    guest_users: number;
    average_rooms_per_user: number;
    user_registration_enabled: boolean;
}

/** Response for GET /users/{userId}/rooms — user's joined rooms */
export interface UserRoomsResponse {
    rooms: string[];
}

// ===== User notification types =====

/** Response for GET /users/{userId}/notification — user notification setting */
export interface UserNotificationResponse {
    enabled: boolean;
}

/** Payload for PUT /users/{userId}/notification — set user notification setting */
export interface UserNotificationPayload {
    enabled: boolean;
}

// ===== Shared media info (used by both user and media managers) =====

export interface MediaInfo {
    created_ts?: number;
    last_access_ts?: number;
    media_id: string;
    media_type?: string;
    upload_name?: string;
    quarantined_by?: string;
}
