/*
Copyright 2026 The Matrix.org Foundation C.I.C.

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
 * 分级 TTL —— 对齐后端 synapse-rust `synapse-cache` 的 `CacheTtl`
 * （`synapse-cache/src/strategy.rs`）。
 *
 * 后端按数据类型分级设置缓存存活时间：presence 60s → token 300s →
 * room 900~1800s → profile 3600s。客户端 store 采纳其中与 SDK 数据分类
 * 对应的几档，并显式区分「持久不过期」的数据（sync token / to_device 队列），
 * 避免误删关键数据导致冷启动重复全量 /sync。
 *
 * TTL 单位：秒（与后端 `Duration::from_secs` 一致）。
 */

/**
 * 持久不过期的哨兵值。任何等于该值的 TTL 都表示「永不因时间过期而被淘汰」。
 * 对齐后端无 TTL 的语义（如 sync token 在客户端不应过期，不同于后端 token
 * 的 5min 短 TTL）。
 */
export const TTL_PERSISTENT = -1;

/**
 * store 数据分类，与后端缓存数据分类（user_profile / room_info / room_members /
 * room_events / token）对应，用于选择分级 TTL。
 */
export enum StoreDataType {
    /** room 数据（对齐 room_events / room_messages 15min）。 */
    Room = "room",
    /** room 成员数据（对齐 room_members 15min）。 */
    RoomMembers = "room_members",
    /** 用户 profile（对齐 user_profile 1h）。 */
    UserProfile = "user_profile",
    /** sync token —— 持久不 TTL。 */
    SyncToken = "sync_token",
    /** to_device 队列 —— 持久不 TTL。 */
    ToDeviceQueue = "to_device_queue",
}

/**
 * 分级 TTL 常量表，对齐后端 `CacheTtl`（单位：秒）。
 */
export class CacheTtl {
    /** room 数据 900s（15min，对齐 room_events / room_messages）。 */
    public static readonly ROOM = 900;

    /** room 成员 900s（15min，对齐 room_members）。 */
    public static readonly ROOM_MEMBERS = 900;

    /** 用户 profile 3600s（1h，对齐 user_profile）。 */
    public static readonly USER_PROFILE = 3600;

    /** sync token —— 持久不 TTL。 */
    public static readonly SYNC_TOKEN = TTL_PERSISTENT;

    /** to_device 队列 —— 持久不 TTL。 */
    public static readonly TO_DEVICE_QUEUE = TTL_PERSISTENT;
}

/**
 * 返回指定数据类型的 TTL（秒）。持久类型返回 {@link TTL_PERSISTENT}。
 */
export function getTtlSeconds(type: StoreDataType): number {
    switch (type) {
        case StoreDataType.Room:
            return CacheTtl.ROOM;
        case StoreDataType.RoomMembers:
            return CacheTtl.ROOM_MEMBERS;
        case StoreDataType.UserProfile:
            return CacheTtl.USER_PROFILE;
        case StoreDataType.SyncToken:
            return CacheTtl.SYNC_TOKEN;
        case StoreDataType.ToDeviceQueue:
            return CacheTtl.TO_DEVICE_QUEUE;
        default: {
            // 防御：未知类型默认对齐 room 档（保守 15min）。
            return CacheTtl.ROOM;
        }
    }
}

/**
 * 返回指定数据类型的 TTL（毫秒）。持久类型返回 {@link TTL_PERSISTENT}。
 */
export function getTtlMs(type: StoreDataType): number {
    const seconds = getTtlSeconds(type);
    return seconds === TTL_PERSISTENT ? TTL_PERSISTENT : seconds * 1000;
}

/**
 * 判断某条记录是否已过期。
 *
 * @param createdAtMs - 记录创建时间（毫秒时间戳）。
 * @param ttlSeconds - TTL（秒）；等于 {@link TTL_PERSISTENT} 时永不过期。
 * @param nowMs - 当前时间（毫秒时间戳），默认 `Date.now()`。
 * @returns 是否已过期。
 */
export function isTtlExpired(createdAtMs: number, ttlSeconds: number, nowMs: number = Date.now()): boolean {
    if (ttlSeconds === TTL_PERSISTENT) return false;
    return nowMs - createdAtMs > ttlSeconds * 1000;
}
