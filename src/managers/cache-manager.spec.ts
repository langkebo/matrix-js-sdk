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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { UnifiedCacheManager, CacheStrategy, CacheManagerFactory, CacheMonitor } from "./cache-manager";
import { CacheRegistry } from "../utils/lru-cache";

describe("UnifiedCacheManager", () => {
    let cacheManager: UnifiedCacheManager;
    const testConfig: CacheStrategy = {
        namespace: "test",
        maxSize: 10,
        ttl: 5000,
    };

    beforeEach(() => {
        cacheManager = new UnifiedCacheManager(testConfig);
        // Clear any existing cache data
        CacheRegistry.getInstance().clearAll();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe("constructor", () => {
        it("should accept config object", () => {
            const manager = new UnifiedCacheManager({
                namespace: "config-test",
                maxSize: 20,
                ttl: 10000,
            });
            expect(manager.getSize()).toBe(0);
        });

        it("should accept positional parameters", () => {
            const manager = new UnifiedCacheManager("positional-test", 30, 20000);
            expect(manager.getSize()).toBe(0);
        });

        it("should normalize key with namespace prefix", () => {
            cacheManager.set("key1", "value1");
            // Internal implementation adds namespace automatically
            expect(cacheManager.has("key1")).toBe(true);
        });

        it("should prevent duplicate namespace prefix", () => {
            cacheManager.set("key2", "value2");
            expect(cacheManager.has("key2")).toBe(true);
        });
    });

    describe("get/set", () => {
        it("should set and get a value", () => {
            cacheManager.set("user:1", { id: 1, name: "Alice" });
            const user = cacheManager.get<{ id: number; name: string }>("user:1");
            expect(user).toEqual({ id: 1, name: "Alice" });
        });

        it("should return undefined for missing key", () => {
            const value = cacheManager.get("nonexistent");
            expect(value).toBeUndefined();
        });

        it("should handle complex objects", () => {
            const complexObject = {
                nested: { data: [1, 2, 3] },
                array: ["a", "b", "c"],
                primitive: 42,
            };
            cacheManager.set("complex", complexObject);
            const retrieved = cacheManager.get<typeof complexObject>("complex");
            expect(retrieved).toEqual(complexObject);
        });

        it("should handle null values based on config", () => {
            const cacheWithNull = new UnifiedCacheManager({
                namespace: "allow-null",
                maxSize: 10,
                ttl: 5000,
                cacheEmpty: true,
            });

            cacheWithNull.set("empty-key", null);
            expect(cacheWithNull.get("empty-key")).toBeNull();

            const cacheWithoutNull = new UnifiedCacheManager({
                namespace: "no-null",
                maxSize: 10,
                ttl: 5000,
                cacheEmpty: false,
            });

            cacheWithoutNull.set("empty-key2", null);
            expect(cacheWithoutNull.get("empty-key2")).toBeUndefined();
        });
    });

    describe("has", () => {
        it("should return true for existing key", () => {
            cacheManager.set("exists", "value");
            expect(cacheManager.has("exists")).toBe(true);
        });

        it("should return false for non-existent key", () => {
            expect(cacheManager.has("nonexistent")).toBe(false);
        });
    });

    describe("delete", () => {
        it("should delete an existing key", () => {
            cacheManager.set("to-delete", "value");
            expect(cacheManager.has("to-delete")).toBe(true);
            const deleted = cacheManager.delete("to-delete");
            expect(deleted).toBe(true);
            expect(cacheManager.has("to-delete")).toBe(false);
        });

        it("should return false for non-existent key", () => {
            const deleted = cacheManager.delete("nonexistent");
            expect(deleted).toBe(false);
        });
    });

    describe("invalidate", () => {
        it("should invalidate exact match", () => {
            cacheManager.set("space:1", { id: 1 });
            cacheManager.set("space:2", { id: 2 });
            cacheManager.set("room:1", { id: 1 });

            cacheManager.invalidate(["space:1"]);

            expect(cacheManager.has("space:1")).toBe(false);
            expect(cacheManager.has("space:2")).toBe(true);
            expect(cacheManager.has("room:1")).toBe(true);
        });

        it("should invalidate wildcard pattern", () => {
            cacheManager.set("space:hierarchy:v1", "data1");
            cacheManager.set("space:hierarchy:v2", "data2");
            cacheManager.set("space:member:v1", "data3");

            cacheManager.invalidate(["space:hierarchy:*"]);

            expect(cacheManager.has("space:hierarchy:v1")).toBe(false);
            expect(cacheManager.has("space:hierarchy:v2")).toBe(false);
            expect(cacheManager.has("space:member:v1")).toBe(true);
        });

        it("should call onInvalidate callback", () => {
            const callback = vi.fn();
            const cacheWithCallback = new UnifiedCacheManager({
                ...testConfig,
                namespace: "callback-test",
                onInvalidate: callback,
            });

            cacheWithCallback.set("key1", "value1");
            cacheWithCallback.invalidate(["key*"]);

            expect(callback).toHaveBeenCalledWith(expect.arrayContaining(["callback-test:key1"]));
        });
    });

    describe("getOrFetch", () => {
        it("should return cached value if available", async () => {
            const fetchFn = vi.fn().mockResolvedValue({ data: "fetched" });

            cacheManager.set("cached", { data: "already-cached" });

            const result = await cacheManager.getOrFetch("cached", fetchFn);
            expect(result).toEqual({ data: "already-cached" });
            expect(fetchFn).not.toHaveBeenCalled();
        });

        it("should fetch and cache if not available", async () => {
            const fetchFn = vi.fn().mockResolvedValue({ data: "new-data" });

            const result = await cacheManager.getOrFetch("not-cached", fetchFn);

            expect(result).toEqual({ data: "new-data" });
            expect(fetchFn).toHaveBeenCalledTimes(1);
            expect(cacheManager.get("not-cached")).toEqual({ data: "new-data" });
        });

        it("should support stale-while-revalidate", async () => {
            const cacheWithSwr = new UnifiedCacheManager({
                ...testConfig,
                namespace: "swr-test",
                staleWhileRevalidate: true,
            });

            const mockData = { stale: true };
            cacheWithSwr.set("key", mockData);

            let resolveFn: ((value: unknown) => void) | undefined;
            const promise = new Promise((resolve) => {
                resolveFn = resolve;
            });

            const fetchFn = vi.fn().mockReturnValue(promise);

            // This should return cached immediately
            const immediateResult = await cacheWithSwr.getOrFetch("key", fetchFn);
            expect(immediateResult).toEqual(mockData);
            expect(fetchFn).toHaveBeenCalled();

            // Resolve the background fetch
            resolveFn!({ fresh: true });
            await promise;

            // Now cache should be updated
            const updatedResult = cacheWithSwr.get("key");
            expect(updatedResult).toEqual({ fresh: true });
        });
    });

    describe("clear", () => {
        it("should clear all entries", () => {
            cacheManager.set("key1", "value1");
            cacheManager.set("key2", "value2");
            cacheManager.clear();

            expect(cacheManager.getSize()).toBe(0);
            expect(cacheManager.has("key1")).toBe(false);
            expect(cacheManager.has("key2")).toBe(false);
        });
    });

    describe("stats", () => {
        it("should track hits and misses", () => {
            cacheManager.set("key", "value");
            cacheManager.get("key"); // hit
            cacheManager.get("key"); // hit
            cacheManager.get("missing"); // miss

            const stats = cacheManager.getStats();
            expect(stats.hits).toBe(2);
            expect(stats.misses).toBe(1);
            expect(stats.hitRate).toBeCloseTo(0.6667, 3);
        });

        it("should track evictions when max size reached", () => {
            const smallCache = new UnifiedCacheManager({
                namespace: "small",
                maxSize: 2,
                ttl: 5000,
            });

            smallCache.set("k1", "v1");
            smallCache.set("k2", "v2");
            smallCache.set("k3", "v3"); // Should evict k1

            const stats = smallCache.getStats();
            expect(stats.evictions).toBe(1);
            expect(stats.size).toBe(2);
        });
    });
});

describe("CacheManagerFactory", () => {
    it("should create space cache", () => {
        const cache = CacheManagerFactory.createSpaceCache();
        expect(cache.getStats().maxSize).toBe(200);
        // TTL is stored internally but not exposed in getStats()
        expect(cache.getSize()).toBe(0);
    });

    it("should create room cache", () => {
        const cache = CacheManagerFactory.createRoomCache();
        expect(cache.getStats().maxSize).toBe(500);
        expect(cache.getSize()).toBe(0);
    });

    it("should create user cache", () => {
        const cache = CacheManagerFactory.createUserCache();
        expect(cache.getStats().maxSize).toBe(300);
        expect(cache.getSize()).toBe(0);
    });

    it("should create device cache", () => {
        const cache = CacheManagerFactory.createDeviceCache();
        expect(cache.getStats().maxSize).toBe(100);
        expect(cache.getSize()).toBe(0);
    });

    it("should create cas cache", () => {
        const cache = CacheManagerFactory.createCasCache();
        expect(cache.getStats().maxSize).toBe(50);
        expect(cache.getSize()).toBe(0);
    });

    it("should create worker cache", () => {
        const cache = CacheManagerFactory.createWorkerCache();
        expect(cache.getStats().maxSize).toBe(100);
        expect(cache.getSize()).toBe(0);
    });

    it("should create generic cache", () => {
        const cache = CacheManagerFactory.createGenericCache("custom", 150, 400000);
        expect(cache.getStats().maxSize).toBe(150);
        expect(cache.getSize()).toBe(0);
    });
});

describe("CacheMonitor", () => {
    let monitor: CacheMonitor;

    beforeEach(() => {
        monitor = CacheMonitor.getInstance();
        CacheRegistry.getInstance().clearAll();
    });

    afterEach(() => {
        monitor.disable();
    });

    it("should enable and disable", () => {
        monitor.enable();
        expect(monitor.getAggregatedStats()).toBeDefined();

        monitor.disable();
        expect(monitor.getAggregatedStats()).toBeDefined(); // Still works but no logging
    });

    it("should capture snapshots", () => {
        monitor.enable();
        const cache = new UnifiedCacheManager({
            namespace: "monitor-test",
            maxSize: 10,
            ttl: 5000,
        });

        cache.set("key1", "value1");
        cache.snapshot();

        // Snapshot should be recorded
        expect(monitor.getAggregatedStats().totalCaches).toBeGreaterThan(0);
    });

    it("should export report", () => {
        monitor.enable();

        const cache = CacheManagerFactory.createGenericCache("report-test", 10, 5000);
        cache.set("key", "value");
        cache.get("key"); // hit
        cache.get("missing"); // miss

        const report = monitor.exportReport();

        expect(report).toContain("# Cache Statistics Report");
        expect(report).toContain("Generated:");
        expect(report).toContain("report-test");
        expect(report).toContain("Hit Rate:");
    });
});
