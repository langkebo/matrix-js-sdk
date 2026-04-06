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

/**
 * LRU Cache with TTL support
 *
 * A Least Recently Used (LRU) cache implementation with time-to-live (TTL) expiration.
 * When the cache reaches its maximum size, the oldest entry is evicted.
 * Entries automatically expire after the specified TTL.
 */

interface CacheEntry<T> {
    value: T;
    timestamp: number;
}

export interface CacheStats {
    size: number;
    maxSize: number;
    hits: number;
    misses: number;
    hitRate: number;
}

/**
 * LRU Cache with TTL support
 *
 * @example
 * ```typescript
 * const cache = new LRUCache<User>(100, 5 * 60 * 1000); // 100 items, 5 min TTL
 * cache.set('user1', userData);
 * const user = cache.get('user1');
 * ```
 */
export class LRUCache<T> {
    private cache = new Map<string, CacheEntry<T>>();
    private readonly maxSize: number;
    private readonly ttl: number;
    private hits = 0;
    private misses = 0;

    /**
     * Create a new LRU cache
     *
     * @param maxSize - Maximum number of entries in the cache
     * @param ttl - Time-to-live in milliseconds for each entry
     */
    constructor(maxSize: number, ttl: number) {
        this.maxSize = maxSize;
        this.ttl = ttl;
    }

    /**
     * Get a value from the cache
     *
     * @param key - The cache key
     * @returns The cached value, or undefined if not found or expired
     */
    get(key: string): T | undefined {
        const entry = this.cache.get(key);
        if (!entry) {
            this.misses++;
            return undefined;
        }

        if (Date.now() - entry.timestamp > this.ttl) {
            this.cache.delete(key);
            this.misses++;
            return undefined;
        }

        this.hits++;
        // Move to end (most recently used)
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.value;
    }

    /**
     * Set a value in the cache
     *
     * @param key - The cache key
     * @param value - The value to cache
     */
    set(key: string, value: T): void {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            // Evict oldest entry (first in Map)
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
            }
        }

        this.cache.set(key, {
            value,
            timestamp: Date.now(),
        });
    }

    /**
     * Check if a key exists in the cache and is not expired
     *
     * @param key - The cache key
     * @returns true if the key exists and is not expired
     */
    has(key: string): boolean {
        const entry = this.cache.get(key);
        if (!entry) {
            return false;
        }

        if (Date.now() - entry.timestamp > this.ttl) {
            this.cache.delete(key);
            return false;
        }

        return true;
    }

    /**
     * Delete a key from the cache
     *
     * @param key - The cache key
     * @returns true if the key was deleted
     */
    delete(key: string): boolean {
        return this.cache.delete(key);
    }

    /**
     * Clear all entries from the cache
     */
    clear(): void {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
    }

    /**
     * Get the current number of entries in the cache
     *
     * @returns The number of entries
     */
    size(): number {
        return this.cache.size;
    }

    /**
     * Get all non-expired values from the cache
     *
     * @returns Array of cached values
     */
    values(): T[] {
        const now = Date.now();
        const result: T[] = [];
        for (const entry of this.cache.values()) {
            if (now - entry.timestamp <= this.ttl) {
                result.push(entry.value);
            }
        }
        return result;
    }

    /**
     * Get cache statistics
     *
     * @returns Cache statistics including hit rate
     */
    getStats(): CacheStats {
        const total = this.hits + this.misses;
        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            hits: this.hits,
            misses: this.misses,
            hitRate: total > 0 ? this.hits / total : 0,
        };
    }
}
