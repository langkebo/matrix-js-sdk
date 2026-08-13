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
 * 统一容量管理 —— 对齐后端 synapse-rust `synapse-cache` 的 `max_capacity`
 * 与按类型分区容量（`synapse-cache/src/query_cache.rs`）。
 *
 * 将 store 原先分散的局部上限（OOB 成员 50、pending 100）泛化为一份整体的
 * 容量预算，并用通用的 {@link LruMap} 做 LRU 淘汰，淘汰事件可回传统计层。
 */

/**
 * store 整体容量预算。各字段含义与默认值：
 *
 * - `maxRooms` / `maxUsers`：对齐后端 `max_capacity: 100_000` 的兜底上限，
 *   防止异常场景下 room / user 无限增长。
 * - `maxOutOfBandMembersRooms`：OOB 成员缓存 room 数上限（沿用原局部 LRU 的 50）。
 * - `maxPendingEventsPerRoom`：单 room pending 事件数上限（沿用原 100）。
 */
export interface StoreCapacityConfig {
    /** room 总数上限。 */
    maxRooms: number;
    /** user 总数上限。 */
    maxUsers: number;
    /** OOB 成员缓存 room 数上限。 */
    maxOutOfBandMembersRooms: number;
    /** 单 room pending 事件数上限。 */
    maxPendingEventsPerRoom: number;
}

/**
 * 默认容量预算。
 */
export const DEFAULT_STORE_CAPACITY: StoreCapacityConfig = {
    // 对齐后端 max_capacity: 100_000。
    maxRooms: 100_000,
    maxUsers: 100_000,
    // 保留原局部 LRU 上限（ISSUE-11b）。
    maxOutOfBandMembersRooms: 50,
    maxPendingEventsPerRoom: 100,
};

/**
 * 泛化的有界 LRU Map。
 *
 * 在 `Map` 插入顺序的基础上实现容量预算 + LRU 淘汰：容量耗尽时淘汰最久未访问
 * 的条目（`Map` 首元素），并通过 `onEvict` 回调上报淘汰事件。它是原先 store 内
 * 手写的「`Map` 首键删除」LRU 逻辑的通用化，供 OOB 成员等集合复用。
 */
export class LruMap<K, V> {
    private readonly map = new Map<K, V>();
    private readonly capacity: number;
    private readonly onEvict?: (key: K, value: V) => void;

    /**
     * @param capacity - 容量上限。
     * @param onEvict - 可选淘汰回调，在条目因容量不足被淘汰时触发。
     */
    public constructor(capacity: number, onEvict?: (key: K, value: V) => void) {
        this.capacity = capacity;
        this.onEvict = onEvict;
    }

    /** 当前条目数。 */
    public get size(): number {
        return this.map.size;
    }

    /**
     * 读取并「触摸」条目（移到 LRU 末尾）。
     * @returns 值，不存在时为 `undefined`。
     */
    public get(key: K): V | undefined {
        const value = this.map.get(key);
        if (value !== undefined) {
            // 命中即视为最近使用，移到末尾。
            this.map.delete(key);
            this.map.set(key, value);
        }
        return value;
    }

    /**
     * 写入条目。容量耗尽时先淘汰最久未访问的条目。
     * @returns 自身，便于链式调用。
     */
    public set(key: K, value: V): this {
        if (this.map.has(key)) {
            this.map.delete(key);
        } else if (this.map.size >= this.capacity) {
            const oldestKey = this.map.keys().next().value;
            if (oldestKey !== undefined) {
                const oldestValue = this.map.get(oldestKey);
                this.map.delete(oldestKey);
                if (oldestValue !== undefined) {
                    this.onEvict?.(oldestKey, oldestValue);
                }
            }
        }
        this.map.set(key, value);
        return this;
    }

    /** 是否存在指定键。 */
    public has(key: K): boolean {
        return this.map.has(key);
    }

    /** 删除指定键，返回是否删除成功。 */
    public delete(key: K): boolean {
        return this.map.delete(key);
    }

    /** 键迭代器（插入顺序）。 */
    public keys(): IterableIterator<K> {
        return this.map.keys();
    }

    /** 值迭代器（插入顺序）。 */
    public values(): IterableIterator<V> {
        return this.map.values();
    }

    /** 清空。 */
    public clear(): void {
        this.map.clear();
    }
}
