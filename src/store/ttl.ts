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
 * 对应的几档，并显式区分「持久不过期」的数据（sync token / to_device 队列，
 * 不写 deadline 即持久），避免误删关键数据导致冷启动重复全量 /sync。
 *
 * TTL 单位：秒（与后端 `Duration::from_secs` 一致）。
 *
 * **统一 deadline 语义**：所有 TTL 先经 {@link computeDeadlineMs} 归一为「绝对过期
 * 时间戳（毫秒）」，再用 {@link isDeadlineExpired} 判活。约定：
 * - `Infinity`：持久不过期（对应 {@link TTL_PERSISTENT} 或「不写 deadline」）；
 * - `0`：立即过期（等价「禁用缓存」，每次读都 miss）；
 * - 正数时间戳：到期即过期。
 */

/**
 * 持久不过期的哨兵值。任何等于该值的 TTL 都表示「永不因时间过期而被淘汰」。
 * 对齐后端无 TTL 的语义（如 sync token 在客户端不应过期，不同于后端 token
 * 的 5min 短 TTL）。
 */
export const TTL_PERSISTENT = -1;

/**
 * 分级 TTL 常量表，对齐后端 `CacheTtl`（单位：秒）。
 */
export class CacheTtl {
    /** room 成员 900s（15min，对齐 room_members）。 */
    public static readonly ROOM_MEMBERS = 900;

    /** 用户 profile 3600s（1h，对齐 user_profile）。 */
    public static readonly USER_PROFILE = 3600;

    /**
     * sync 快照 staleness 阈值 86400s（24h）。
     *
     * 注意：后端 `room_events` 900s 是「独立 room 查询缓存」的 TTL（miss 后重查 DB）。
     * 客户端 IndexedDBStore 持久化的不是独立 room 缓存，而是「增量 /sync 快照对」
     * （roomsData + nextBatch），二者绑定。拆开 TTL 会破坏增量 sync 一致性，故此处
     * 采用「快照整体 staleness」语义：快照写入超过该阈值未更新即视为不可信、整体丢弃
     * 触发全量 /sync，token 跟随快照生命周期（不单独 TTL）。
     */
    public static readonly SYNC_SNAPSHOT = 24 * 3600;
}

/**
 * 计算绝对过期时间戳（毫秒）。
 *
 * - `ttlSeconds === TTL_PERSISTENT`：返回 `Infinity`（持久不过期）。
 * - `ttlSeconds <= 0`：返回 `0`（立即过期，等价于「禁用缓存」——写入后每次读都 miss）。
 * - 否则返回 `nowMs + ttlSeconds * 1000`。
 */
export function computeDeadlineMs(ttlSeconds: number, nowMs: number = Date.now()): number {
    if (ttlSeconds === TTL_PERSISTENT) return Infinity;
    if (ttlSeconds <= 0) return 0;
    return nowMs + ttlSeconds * 1000;
}

/**
 * 判断绝对过期时间戳是否已过期。`Infinity` 持久不过期，`0` 立即过期。
 */
export function isDeadlineExpired(deadlineMs: number, nowMs: number = Date.now()): boolean {
    return deadlineMs !== Infinity && nowMs > deadlineMs;
}

/**
 * OOB 成员 TTL 解析器：按 roomId 动态返回 TTL（秒）。
 *
 * 允许调用方按房间类型差异化设置缓存存活时间，例如：
 * - 静态房间：`CacheTtl.ROOM_MEMBERS`（900s）；
 * - 动态房间（成员频繁变化）：`60` 或 `0`（禁用缓存，每次读都触发重新拉取）。
 *
 * @returns TTL 秒数。`TTL_PERSISTENT`（-1）持久；`0` 禁用缓存；正数为 TTL 秒。
 */
export type OobMembersTtlProvider = (roomId: string) => number;

/**
 * 默认 OOB 成员 TTL：所有房间统一 room_members 900s（静态语义）。
 */
export function defaultOobMembersTtl(_roomId: string): number {
    return CacheTtl.ROOM_MEMBERS;
}
