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
 * store 缓存统计 —— 对齐后端 synapse-rust `synapse-cache` 的 `CacheStats`
 * （`synapse-cache/src/query_cache.rs`）。
 *
 * 后端指标：`hits / misses / evictions / total_entries / memory_usage_bytes / hit_rate`。
 * 前端 store 在 get/set/delete 路径埋点，形成与后端对等的缓存观测。
 */

/**
 * store 缓存统计快照，字段对齐后端 `CacheStats`。
 */
export interface StoreStats {
    /** 命中次数。 */
    hits: number;
    /** 未命中次数。 */
    misses: number;
    /** 淘汰条目数（含容量淘汰与过期清理）。 */
    evictions: number;
    /** 当前条目总数。 */
    totalEntries: number;
    /** 内存占用字节（估算值，见实现说明）。 */
    memoryUsageBytes: number;
    /** 命中率（0~1），对齐后端 `hit_rate`。 */
    hitRate: number;
}

/**
 * 无锁统计收集器 —— 对齐后端 `AtomicCacheStats`。
 *
 * 后端用 `AtomicU64`（`Ordering::Relaxed`）替代 `RwLock<CacheStats>`，避免读路径
 * 加锁。JavaScript 单线程事件循环下，普通数值自增天然无锁，无需 `Atomics`，
 * 故此处采用与后端等价的「纯计数 + 无锁」设计，读写均不加锁。
 */
export class StoreStatsCollector {
    private hits = 0;
    private misses = 0;
    private evictions = 0;
    private totalEntries = 0;
    private memoryUsageBytes = 0;

    /** 记录一次命中。 */
    public recordHit(): void {
        this.hits++;
    }

    /** 记录一次未命中。 */
    public recordMiss(): void {
        this.misses++;
    }

    /** 记录 `count` 次淘汰。 */
    public recordEvictions(count: number): void {
        this.evictions += count;
    }

    /** 设置当前条目总数。 */
    public setTotalEntries(total: number): void {
        this.totalEntries = total;
    }

    /** 设置内存占用字节（估算值）。 */
    public setMemoryUsageBytes(bytes: number): void {
        this.memoryUsageBytes = bytes;
    }

    /** 生成当前统计快照。 */
    public snapshot(): StoreStats {
        const total = this.hits + this.misses;
        const hitRate = total === 0 ? 0 : this.hits / total;
        return {
            hits: this.hits,
            misses: this.misses,
            evictions: this.evictions,
            totalEntries: this.totalEntries,
            memoryUsageBytes: this.memoryUsageBytes,
            hitRate,
        };
    }

    /** 重置所有计数。 */
    public reset(): void {
        this.hits = 0;
        this.misses = 0;
        this.evictions = 0;
        this.totalEntries = 0;
        this.memoryUsageBytes = 0;
    }
}
