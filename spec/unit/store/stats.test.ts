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

import { describe, expect, it } from "vitest";

import { StoreStatsCollector } from "../../../src/store/stats";

describe("StoreStatsCollector (对齐后端 AtomicCacheStats)", () => {
    it("初始快照全为 0", () => {
        const s = new StoreStatsCollector();
        expect(s.snapshot()).toEqual({
            hits: 0,
            misses: 0,
            evictions: 0,
            totalEntries: 0,
            memoryUsageBytes: 0,
            hitRate: 0,
        });
    });

    it("记录命中/未命中并计算命中率", () => {
        const s = new StoreStatsCollector();
        s.recordHit();
        s.recordHit();
        s.recordMiss();
        const snap = s.snapshot();
        expect(snap.hits).toBe(2);
        expect(snap.misses).toBe(1);
        expect(snap.hitRate).toBeCloseTo(2 / 3);
    });

    it("无访问时命中率为 0", () => {
        const s = new StoreStatsCollector();
        s.setTotalEntries(5);
        expect(s.snapshot().hitRate).toBe(0);
    });

    it("累计淘汰次数", () => {
        const s = new StoreStatsCollector();
        s.recordEvictions(3);
        s.recordEvictions(2);
        expect(s.snapshot().evictions).toBe(5);
    });

    it("设置条目数与内存占用", () => {
        const s = new StoreStatsCollector();
        s.setTotalEntries(42);
        s.setMemoryUsageBytes(1024);
        const snap = s.snapshot();
        expect(snap.totalEntries).toBe(42);
        expect(snap.memoryUsageBytes).toBe(1024);
    });

    it("reset 清空所有计数", () => {
        const s = new StoreStatsCollector();
        s.recordHit();
        s.recordMiss();
        s.recordEvictions(1);
        s.setTotalEntries(7);
        s.setMemoryUsageBytes(999);
        s.reset();
        expect(s.snapshot()).toEqual({
            hits: 0,
            misses: 0,
            evictions: 0,
            totalEntries: 0,
            memoryUsageBytes: 0,
            hitRate: 0,
        });
    });
});
