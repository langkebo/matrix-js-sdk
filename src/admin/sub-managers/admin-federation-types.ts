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

/**
 * 联邦黑名单条目
 *
 * 键取自后端 `federation.rs::get_blacklist` 的内联 `json!`（3 键）。
 * ⚠️ 时间戳键是 **`added_at`**（值来自 `row.created_ts.unwrap_or(0)`），
 * 不是 `added_ts` —— 原声明读的是后者，恒为 `undefined`。
 */
export interface FederationBlacklistEntry {
    server_name: string;
    /** 加入黑名单的时间（毫秒）；后端缺 `created_ts` 时回填 `0` */
    added_at: number;
    reason: string | null;
}

/**
 * `GET /_synapse/admin/v1/federation/blacklist` 的响应壳
 *
 * 后端返回 `{blacklist, total, next_batch}`；`total` 是**本页条数**
 * （处理器写的是 `list.len()`），游标键是 `next_batch`（`null` 表示末页）。
 */
export interface FederationBlacklistPage {
    blacklist: FederationBlacklistEntry[];
    /** 本页条数（后端语义；非全局总数） */
    total: number;
    next_batch: string | null;
}

// ===== Federation destination types =====

/**
 * 联邦目的地（列表与详情同形状）
 *
 * 键取自后端 `admin_federation_service::map_destination_row` → `DestinationInfo`（8 键）。
 * ⚠️ 原先声明的 `last_successful_stream_ordering` 后端**不返回**（那是上游 Synapse 的字段）；
 * 真实键是 `last_successful_ts` 与 `failure_count`。
 * ⚠️ `retry_interval` 在后端被写死为 `None`，因而**恒为 `null`**。
 */
export interface FederationDestination {
    destination: string;
    retry_last_ts: number | null;
    /** 后端当前恒为 `null`（`map_destination_row` 里写死 `None`） */
    retry_interval: number | null;
    failure_ts: number | null;
    last_successful_ts: number | null;
    /** 连续失败次数 */
    failure_count: number;
    /** `"active"` / `"rejected"` / …（后端默认 `"active"`） */
    status: string;
    updated_ts: number | null;
}

/** 单个联邦目的地的详细信息（`GET /federation/destinations/{destination}`）—— 与列表项同形状 */
export type AdminFederationDestinationDetail = FederationDestination;

/**
 * `GET /_synapse/admin/v1/federation/destinations/{destination}/rooms`
 *
 * ⚠️ `rooms` 是 **room id 字符串数组**（后端 `get_destination_rooms` 返回 `Vec<String>`），
 * 不是对象数组。原先声明的 `AdminFederationDestinationRoom`（`{room_id, stream_ordering, …}`）
 * 纯属虚构，已删除。响应也没有分页游标。
 */
export interface AdminFederationDestinationRooms {
    rooms: string[];
    total: number;
}

// ===== Federation admission types =====

/** `POST /_synapse/admin/v1/federation/confirm` 的响应 */
export interface FederationAdmissionResult {
    server_name: string;
    status: string;
    previous_status: string;
    updated_ts: number | null;
    confirmed_by: string;
}

/**
 * 待处理联邦服务器
 *
 * 键取自后端 `admin_federation_service::list_pending_federation` → `PendingFederationInfo`（6 键）；
 * `status` 是处理器显式写死的 `"pending"`。
 */
export interface PendingFederationServer {
    server_name: string;
    failure_count: number;
    last_failed_connect_at: number | null;
    last_successful_connect_at: number | null;
    status: "pending";
    updated_ts: number | null;
}

/**
 * `GET /_synapse/admin/v1/federation/pending` 的响应
 *
 * 后端返回 `{servers, total, limit, next_batch}`。
 * ⚠️ 原先声明的 `offset` 后端**不返回**（`offset` 分页已被显式拒绝并返回 400）；
 * 真实游标键是 `next_batch`。
 */
export interface PendingFederationList {
    servers: PendingFederationServer[];
    total: number;
    /** 后端回显生效的 limit */
    limit: number;
    next_batch: string | null;
}

// ===== Federation cache types =====

/**
 * 联邦缓存条目
 *
 * 键取自后端 `admin_federation_service::map_cache_entry` → `FederationCacheEntry`（3 键）。
 * ⚠️ 原先声明的 `size` / `last_access_ts` 后端**不返回**；真实键是 `expiry_ts`。
 */
export interface AdminFederationCacheEntry {
    key: string;
    /** 缓存值（后端从 TEXT 反序列化，失败或空时为 `null`） */
    value: unknown;
    expiry_ts: number | null;
}

/**
 * `GET /_synapse/admin/v1/federation/cache` 的响应
 *
 * ⚠️ 列表键是 **`cache`**（不是 `entries`）—— 原声明读 `entries`，恒为 `undefined`。
 * `total` 是条目数。
 */
export interface AdminFederationCache {
    cache: AdminFederationCacheEntry[];
    total: number;
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
