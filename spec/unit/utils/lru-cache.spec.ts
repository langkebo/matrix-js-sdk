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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { LRUCache } from "../../../src/utils/lru-cache.ts";

describe("LRUCache", () => {
    let cache: LRUCache<string>;

    beforeEach(() => {
        cache = new LRUCache<string>(3, 1000); // maxSize=3, ttl=1000ms
    });

    describe("Basic operations", () => {
        it("should set and get values", () => {
            cache.set("key1", "value1");
            expect(cache.get("key1")).toBe("value1");
        });

        it("should return undefined for non-existent keys", () => {
            expect(cache.get("nonexistent")).toBeUndefined();
        });

        it("should check if key exists", () => {
            cache.set("key1", "value1");
            expect(cache.has("key1")).toBe(true);
            expect(cache.has("key2")).toBe(false);
        });

        it("should delete keys", () => {
            cache.set("key1", "value1");
            expect(cache.delete("key1")).toBe(true);
            expect(cache.get("key1")).toBeUndefined();
            expect(cache.delete("key1")).toBe(false);
        });

        it("should clear all entries", () => {
            cache.set("key1", "value1");
            cache.set("key2", "value2");
            cache.clear();
            expect(cache.size()).toBe(0);
            expect(cache.get("key1")).toBeUndefined();
        });

        it("should return correct size", () => {
            expect(cache.size()).toBe(0);
            cache.set("key1", "value1");
            expect(cache.size()).toBe(1);
            cache.set("key2", "value2");
            expect(cache.size()).toBe(2);
        });
    });

    describe("LRU eviction", () => {
        it("should evict oldest entry when max size is reached", () => {
            cache.set("key1", "value1");
            cache.set("key2", "value2");
            cache.set("key3", "value3");
            cache.set("key4", "value4"); // Should evict key1

            expect(cache.get("key1")).toBeUndefined();
            expect(cache.get("key2")).toBe("value2");
            expect(cache.get("key3")).toBe("value3");
            expect(cache.get("key4")).toBe("value4");
            expect(cache.size()).toBe(3);
        });

        it("should update LRU order on get", () => {
            cache.set("key1", "value1");
            cache.set("key2", "value2");
            cache.set("key3", "value3");

            // Access key1 to make it most recently used
            cache.get("key1");

            // Add key4, should evict key2 (oldest)
            cache.set("key4", "value4");

            expect(cache.get("key1")).toBe("value1");
            expect(cache.get("key2")).toBeUndefined();
            expect(cache.get("key3")).toBe("value3");
            expect(cache.get("key4")).toBe("value4");
        });

        it("should update LRU order on set of existing key", () => {
            cache.set("key1", "value1");
            cache.set("key2", "value2");
            cache.set("key3", "value3");

            // Update key1 to make it most recently used
            cache.set("key1", "updated1");

            // Add key4, should evict key2 (oldest)
            cache.set("key4", "value4");

            expect(cache.get("key1")).toBe("updated1");
            expect(cache.get("key2")).toBeUndefined();
            expect(cache.get("key3")).toBe("value3");
            expect(cache.get("key4")).toBe("value4");
        });
    });

    describe("TTL expiration", () => {
        it("should expire entries after TTL", async () => {
            const shortCache = new LRUCache<string>(10, 100); // 100ms TTL
            shortCache.set("key1", "value1");

            expect(shortCache.get("key1")).toBe("value1");

            // Wait for TTL to expire
            await new Promise(resolve => setTimeout(resolve, 150));

            expect(shortCache.get("key1")).toBeUndefined();
        });

        it("should return false for has() on expired entries", async () => {
            const shortCache = new LRUCache<string>(10, 100);
            shortCache.set("key1", "value1");

            expect(shortCache.has("key1")).toBe(true);

            await new Promise(resolve => setTimeout(resolve, 150));

            expect(shortCache.has("key1")).toBe(false);
        });

        it("should not return expired entries in values()", async () => {
            const shortCache = new LRUCache<string>(10, 100);
            shortCache.set("key1", "value1");
            shortCache.set("key2", "value2");

            expect(shortCache.values()).toEqual(["value1", "value2"]);

            await new Promise(resolve => setTimeout(resolve, 150));

            expect(shortCache.values()).toEqual([]);
        });
    });

    describe("Statistics", () => {
        it("should track cache hits and misses", () => {
            cache.set("key1", "value1");

            cache.get("key1"); // hit
            cache.get("key2"); // miss
            cache.get("key1"); // hit
            cache.get("key3"); // miss

            const stats = cache.getStats();
            expect(stats.hits).toBe(2);
            expect(stats.misses).toBe(2);
            expect(stats.hitRate).toBe(0.5);
        });

        it("should reset stats on clear", () => {
            cache.set("key1", "value1");
            cache.get("key1");
            cache.get("key2");

            cache.clear();

            const stats = cache.getStats();
            expect(stats.hits).toBe(0);
            expect(stats.misses).toBe(0);
            expect(stats.hitRate).toBe(0);
        });

        it("should return correct size in stats", () => {
            cache.set("key1", "value1");
            cache.set("key2", "value2");

            const stats = cache.getStats();
            expect(stats.size).toBe(2);
            expect(stats.maxSize).toBe(3);
        });

        it("should handle zero total accesses", () => {
            const stats = cache.getStats();
            expect(stats.hitRate).toBe(0);
        });
    });

    describe("values()", () => {
        it("should return all non-expired values", () => {
            cache.set("key1", "value1");
            cache.set("key2", "value2");
            cache.set("key3", "value3");

            const values = cache.values();
            expect(values).toHaveLength(3);
            expect(values).toContain("value1");
            expect(values).toContain("value2");
            expect(values).toContain("value3");
        });

        it("should return empty array when cache is empty", () => {
            expect(cache.values()).toEqual([]);
        });
    });

    describe("Edge cases", () => {
        it("should handle cache with size 1", () => {
            const tinyCache = new LRUCache<string>(1, 1000);
            tinyCache.set("key1", "value1");
            tinyCache.set("key2", "value2");

            expect(tinyCache.get("key1")).toBeUndefined();
            expect(tinyCache.get("key2")).toBe("value2");
            expect(tinyCache.size()).toBe(1);
        });

        it("should handle complex objects as values", () => {
            const objCache = new LRUCache<{ name: string; age: number }>(3, 1000);
            const obj1 = { name: "Alice", age: 30 };
            const obj2 = { name: "Bob", age: 25 };

            objCache.set("user1", obj1);
            objCache.set("user2", obj2);

            expect(objCache.get("user1")).toEqual(obj1);
            expect(objCache.get("user2")).toEqual(obj2);
        });

        it("should handle updating existing keys", () => {
            cache.set("key1", "value1");
            cache.set("key1", "updated");

            expect(cache.get("key1")).toBe("updated");
            expect(cache.size()).toBe(1);
        });
    });
});
