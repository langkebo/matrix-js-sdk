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
    evictions: number;
    expiredPurges: number;
}

export type EvictionListener<T> = (key: string, value: T, reason: "capacity" | "expired" | "manual") => void;

export interface CacheConfig {
    maxSize: number;
    ttl: number;
    name?: string;
}

export interface AggregatedCacheStats {
    totalCaches: number;
    totalSize: number;
    totalMaxSize: number;
    totalHits: number;
    totalMisses: number;
    overallHitRate: number;
    totalEvictions: number;
    totalExpiredPurges: number;
    caches: Record<string, CacheStats>;
}

export class LRUCache<T> {
    private cache = new Map<string, CacheEntry<T>>();
    private readonly maxSize: number;
    private readonly ttl: number;
    private readonly name: string;
    private hits = 0;
    private misses = 0;
    private evictions = 0;
    private expiredPurges = 0;
    private evictionListener?: EvictionListener<T>;

    constructor(config: CacheConfig);
    constructor(maxSize: number, ttl: number);
    constructor(maxSizeOrConfig: number | CacheConfig, ttl?: number) {
        if (typeof maxSizeOrConfig === "object") {
            this.maxSize = maxSizeOrConfig.maxSize;
            this.ttl = maxSizeOrConfig.ttl;
            this.name = maxSizeOrConfig.name ?? `cache-${LRUCache.instanceCounter++}`;
        } else {
            this.maxSize = maxSizeOrConfig;
            this.ttl = ttl!;
            this.name = `cache-${LRUCache.instanceCounter++}`;
        }
    }

    private static instanceCounter = 0;

    getName(): string {
        return this.name;
    }

    getMaxSize(): number {
        return this.maxSize;
    }

    getTtl(): number {
        return this.ttl;
    }

    onEviction(listener: EvictionListener<T>): void {
        this.evictionListener = listener;
    }

    get(key: string): T | undefined {
        const entry = this.cache.get(key);
        if (!entry) {
            this.misses++;
            return undefined;
        }

        if (Date.now() - entry.timestamp > this.ttl) {
            this.cache.delete(key);
            this.expiredPurges++;
            this.evictionListener?.(key, entry.value, "expired");
            this.misses++;
            return undefined;
        }

        this.hits++;
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.value;
    }

    set(key: string, value: T): void {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                const evictedEntry = this.cache.get(firstKey);
                this.cache.delete(firstKey);
                this.evictions++;
                if (evictedEntry) {
                    this.evictionListener?.(firstKey, evictedEntry.value, "capacity");
                }
            }
        }

        this.cache.set(key, {
            value,
            timestamp: Date.now(),
        });
    }

    has(key: string): boolean {
        const entry = this.cache.get(key);
        if (!entry) {
            return false;
        }

        if (Date.now() - entry.timestamp > this.ttl) {
            this.cache.delete(key);
            this.expiredPurges++;
            this.evictionListener?.(key, entry.value, "expired");
            return false;
        }

        return true;
    }

    delete(key: string): boolean {
        const entry = this.cache.get(key);
        const deleted = this.cache.delete(key);
        if (deleted && entry) {
            this.evictionListener?.(key, entry.value, "manual");
        }
        return deleted;
    }

    clear(): void {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
        this.evictions = 0;
        this.expiredPurges = 0;
    }

    size(): number {
        return this.cache.size;
    }

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

    entries(): IterableIterator<[string, CacheEntry<T>]> {
        return this.cache.entries();
    }

    purgeExpired(): number {
        const now = Date.now();
        let purged = 0;
        for (const [key, entry] of this.cache) {
            if (now - entry.timestamp > this.ttl) {
                this.cache.delete(key);
                this.expiredPurges++;
                this.evictionListener?.(key, entry.value, "expired");
                purged++;
            }
        }
        return purged;
    }

    getStats(): CacheStats {
        const total = this.hits + this.misses;
        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            hits: this.hits,
            misses: this.misses,
            hitRate: total > 0 ? this.hits / total : 0,
            evictions: this.evictions,
            expiredPurges: this.expiredPurges,
        };
    }
}

export class CacheRegistry {
    private static instance: CacheRegistry | null = null;
    private caches = new Map<string, LRUCache<unknown>>();
    private purgeTimer: ReturnType<typeof setInterval> | null = null;
    private purgeIntervalMs: number;

    private constructor(purgeIntervalMs = 60_000) {
        this.purgeIntervalMs = purgeIntervalMs;
    }

    static getInstance(): CacheRegistry {
        if (!CacheRegistry.instance) {
            CacheRegistry.instance = new CacheRegistry();
        }
        return CacheRegistry.instance;
    }

    static resetInstance(): void {
        if (CacheRegistry.instance) {
            CacheRegistry.instance.stopPurgeTimer();
            CacheRegistry.instance.caches.clear();
            CacheRegistry.instance = null;
        }
    }

    register<T>(cache: LRUCache<T>): void {
        this.caches.set(cache.getName(), cache as LRUCache<unknown>);
    }

    unregister(name: string): void {
        this.caches.delete(name);
    }

    getCache(name: string): LRUCache<unknown> | undefined {
        return this.caches.get(name);
    }

    getCacheNames(): string[] {
        return Array.from(this.caches.keys());
    }

    getAggregatedStats(): AggregatedCacheStats {
        let totalSize = 0;
        let totalMaxSize = 0;
        let totalHits = 0;
        let totalMisses = 0;
        let totalEvictions = 0;
        let totalExpiredPurges = 0;
        const caches: Record<string, CacheStats> = {};

        for (const [name, cache] of this.caches) {
            const stats = cache.getStats();
            caches[name] = stats;
            totalSize += stats.size;
            totalMaxSize += stats.maxSize;
            totalHits += stats.hits;
            totalMisses += stats.misses;
            totalEvictions += stats.evictions;
            totalExpiredPurges += stats.expiredPurges;
        }

        const total = totalHits + totalMisses;
        return {
            totalCaches: this.caches.size,
            totalSize,
            totalMaxSize,
            totalHits,
            totalMisses,
            overallHitRate: total > 0 ? totalHits / total : 0,
            totalEvictions,
            totalExpiredPurges,
            caches,
        };
    }

    purgeAllExpired(): number {
        let totalPurged = 0;
        for (const cache of this.caches.values()) {
            totalPurged += cache.purgeExpired();
        }
        return totalPurged;
    }

    clearAll(): void {
        for (const cache of this.caches.values()) {
            cache.clear();
        }
    }

    startPurgeTimer(): void {
        if (this.purgeTimer) return;
        this.purgeTimer = setInterval(() => {
            this.purgeAllExpired();
        }, this.purgeIntervalMs);
    }

    stopPurgeTimer(): void {
        if (this.purgeTimer) {
            clearInterval(this.purgeTimer);
            this.purgeTimer = null;
        }
    }

    setPurgeInterval(ms: number): void {
        this.purgeIntervalMs = ms;
        if (this.purgeTimer) {
            this.stopPurgeTimer();
            this.startPurgeTimer();
        }
    }
}
