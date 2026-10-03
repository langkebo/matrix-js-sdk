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

import { LRUCache, CacheConfig, CacheStats, CacheRegistry } from "../utils/lru-cache";
import { logger } from "../logger";

/**
 * 缓存策略配置
 *
 * 定义了不同场景下的缓存策略，统一管理所有 Manager 的缓存行为
 */
export interface CacheStrategy {
    /**
     * 缓存命名空间（用于隔离不同模块的缓存）
     */
    namespace: string;

    /**
     * 最大缓存条目数
     */
    maxSize: number;

    /**
     * TTL（毫秒），超过此时间的缓存将被视为过期
     */
    ttl: number;

    /**
     * 是否启用 stale-while-revalidate 模式
     * true = 返回旧数据同时后台刷新
     */
    staleWhileRevalidate?: boolean;

    /**
     * 是否允许缓存 null/undefined 值
     * true = 缓存空结果以避免重复请求
     */
    cacheEmpty?: boolean;

    /**
     * 缓存失效事件监听器
     */
    onInvalidate?: (keys: string[]) => void;
}

/**
 * 缓存键构建器
 * 支持通配符和参数化键名
 */
export type CacheKeyBuilder = (params: Record<string, unknown>) => string;

/**
 * 缓存操作结果
 */
export interface CacheOperationResult<T> {
    /**
     * 是否命中缓存
     */
    hit: boolean;

    /**
     * 数据值（如果命中）
     */
    value?: T;

    /**
     * 是否需要重新验证
     */
    stale?: boolean;
}

/**
 * 统一缓存管理器
 *
 * 提供标准化的缓存操作 API，支持：
 * - 按命名空间隔离
 * - 统一的 TTL 策略
 * - 批量无效化
 * - 统计信息聚合
 *
 * 使用示例：
 * ```typescript
 * const cacheManager = new UnifiedCacheManager({
 *     namespace: "space",
 *     maxSize: 100,
 *     ttl: 5 * 60 * 1000 // 5 minutes
 * });
 *
 * // 获取缓存
 * const spaceData = await cacheManager.getOrFetch(
 *     "space:hierarchy",
 *     () => fetchSpaceHierarchy()
 * );
 *
 * // 无效化缓存
 * cacheManager.invalidate(["space:*"]);
 * ```
 */
export class UnifiedCacheManager {
    private cache: LRUCache<unknown>;
    private readonly config: CacheStrategy;
    private readonly registry: CacheRegistry;

    constructor(config: CacheStrategy);
    constructor(namespace: string, maxSize: number, ttl: number);
    constructor(configOrNamespace: CacheStrategy | string, maxSize?: number, ttl?: number) {
        if (typeof configOrNamespace === "object") {
            this.config = configOrNamespace;
            this.cache = new LRUCache<unknown>({
                maxSize: configOrNamespace.maxSize,
                ttl: configOrNamespace.ttl,
                name: configOrNamespace.namespace,
            });
        } else {
            this.config = {
                namespace: configOrNamespace,
                maxSize: maxSize!,
                ttl: ttl!,
            };
            this.cache = new LRUCache<unknown>({
                maxSize: maxSize!,
                ttl: ttl!,
                name: configOrNamespace,
            });
        }

        this.registry = CacheRegistry.getInstance();
        this.registry.register(this.cache);
    }

    /**
     * 获取缓存键的标准格式
     * 自动处理重复前缀
     */
    private normalizeKey(key: string): string {
        const prefix = `${this.config.namespace}:`;
        if (key.startsWith(prefix)) {
            return key;
        }
        return `${prefix}${key}`;
    }

    /**
     * 从缓存获取数据
     * @param key 缓存键
     * @returns 缓存的值，如果不存在或已过期则返回 undefined
     */
    get<T>(key: string): T | undefined {
        const normalizedKey = this.normalizeKey(key);
        return this.cache.get(normalizedKey) as T | undefined;
    }

    /**
     * 设置缓存
     * @param key 缓存键
     * @param value 缓存值
     */
    set<T>(key: string, value: T): void {
        if (!value && !this.config.cacheEmpty) {
            return;
        }
        const normalizedKey = this.normalizeKey(key);
        this.cache.set(normalizedKey, value);
    }

    /**
     * 检查缓存是否存在
     * @param key 缓存键
     * @returns 是否存在有效缓存
     */
    has(key: string): boolean {
        const normalizedKey = this.normalizeKey(key);
        return this.cache.has(normalizedKey);
    }

    /**
     * 删除缓存
     * @param key 缓存键
     * @returns 是否成功删除
     */
    delete(key: string): boolean {
        const normalizedKey = this.normalizeKey(key);
        return this.cache.delete(normalizedKey);
    }

    /**
     * 获取或计算缓存值
     * @param key 缓存键
     * @param fetchFn 获取数据的函数
     * @returns 缓存数据或新获取的数据
     */
    async getOrFetch<T>(key: string, fetchFn: () => Promise<T>): Promise<T> {
        const cached = this.get<T>(key);

        if (cached !== undefined) {
            if (this.config.staleWhileRevalidate) {
                // 后台刷新
                fetchFn()
                    .then((result) => this.set(key, result))
                    .catch((error) => logger.error("stale-while-revalidate refresh failed", error));
                return cached;
            }
            return cached;
        }

        const value = await fetchFn();
        this.set(key, value);
        return value;
    }

    /**
     * 批量无效化缓存（支持通配符）
     * @param patterns 缓存键模式，支持 "*" 通配符
     */
    invalidate(patterns: string[]): void {
        const keysToDelete: string[] = [];
        const prefix = `${this.config.namespace}:`;

        for (const pattern of patterns) {
            // Pattern 可能已包含或不包含前缀，统一加上前缀进行匹配
            const fullPattern = pattern.startsWith(`${this.config.namespace}:`)
                ? pattern
                : `${this.config.namespace}:${pattern}`;

            const regexPattern = fullPattern.replace(/\*/g, ".*");
            const regex = new RegExp(`^${regexPattern}$`);

            for (const [key] of this.cache.entries()) {
                if (regex.test(key)) {
                    keysToDelete.push(key);
                }
            }
        }

        for (const key of keysToDelete) {
            this.cache.delete(key);
        }

        this.config.onInvalidate?.(keysToDelete);
    }

    /**
     * 清空所有缓存
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * 获取缓存统计信息
     */
    getStats(): CacheStats {
        return this.cache.getStats();
    }

    /**
     * 获取缓存大小
     */
    getSize(): number {
        return this.cache.size();
    }

    /**
     * 获取缓存快照
     */
    snapshot(): Map<string, any> {
        return new Map(this.cache.entries());
    }
}

/**
 * 缓存管理器工厂
 * 为不同类型的 Manager 提供预配置的缓存实例
 */
export class CacheManagerFactory {
    /**
     * 创建空间相关的缓存管理器
     */
    static createSpaceCache(): UnifiedCacheManager {
        return new UnifiedCacheManager({
            namespace: "space",
            maxSize: 200,
            ttl: 5 * 60 * 1000, // 5 minutes
            staleWhileRevalidate: true,
        });
    }

    /**
     * 创建房间相关的缓存管理器
     */
    static createRoomCache(): UnifiedCacheManager {
        return new UnifiedCacheManager({
            namespace: "room",
            maxSize: 500,
            ttl: 2 * 60 * 1000, // 2 minutes
        });
    }

    /**
     * 创建用户相关的缓存管理器
     */
    static createUserCache(): UnifiedCacheManager {
        return new UnifiedCacheManager({
            namespace: "user",
            maxSize: 300,
            ttl: 10 * 60 * 1000, // 10 minutes
        });
    }

    /**
     * 创建设备相关的缓存管理器
     */
    static createDeviceCache(): UnifiedCacheManager {
        return new UnifiedCacheManager({
            namespace: "device",
            maxSize: 100,
            ttl: 30 * 60 * 1000, // 30 minutes
        });
    }

    /**
     * 创建 CAS 相关的缓存管理器
     */
    static createCasCache(): UnifiedCacheManager {
        return new UnifiedCacheManager({
            namespace: "cas",
            maxSize: 50,
            ttl: 15 * 60 * 1000, // 15 minutes
        });
    }

    /**
     * 创建 Worker 相关的缓存管理器
     */
    static createWorkerCache(): UnifiedCacheManager {
        return new UnifiedCacheManager({
            namespace: "worker",
            maxSize: 100,
            ttl: 5 * 60 * 1000, // 5 minutes
        });
    }

    /**
     * 创建通用缓存管理器
     */
    static createGenericCache(
        namespace: string,
        maxSize: number = 100,
        ttl: number = 5 * 60 * 1000,
    ): UnifiedCacheManager {
        return new UnifiedCacheManager({
            namespace,
            maxSize,
            ttl,
        });
    }
}

/**
 * 全局缓存监控
 * 可以在开发环境中启用以监控缓存使用情况
 */
export class CacheMonitor {
    private static instance: CacheMonitor | null = null;
    private enabled: boolean = false;
    private statsLog: Array<{ timestamp: number; stats: any }> = [];

    static getInstance(): CacheMonitor {
        if (!CacheMonitor.instance) {
            CacheMonitor.instance = new CacheMonitor();
        }
        return CacheMonitor.instance;
    }

    enable(): void {
        this.enabled = true;
        logger.info("[CacheMonitor] Enabled");
    }

    disable(): void {
        this.enabled = false;
        logger.info("[CacheMonitor] Disabled");
    }

    /**
     * 记录缓存统计快照
     */
    snapshot(): void {
        if (!this.enabled) return;

        const registry = CacheRegistry.getInstance();
        const aggregatedStats = registry.getAggregatedStats();

        this.statsLog.push({
            timestamp: Date.now(),
            stats: aggregatedStats,
        });

        // 只保留最近的日志
        if (this.statsLog.length > 100) {
            this.statsLog.shift();
        }
    }

    /**
     * 获取所有缓存的聚合统计
     */
    getAggregatedStats() {
        const registry = CacheRegistry.getInstance();
        return registry.getAggregatedStats();
    }

    /**
     * 导出缓存统计报告
     */
    exportReport(): string {
        const aggregated = this.getAggregatedStats();
        const lines: string[] = [
            "# Cache Statistics Report",
            "",
            `Generated: ${new Date().toISOString()}`,
            "",
            "## Overall Statistics",
            `- Total Caches: ${aggregated.totalCaches}`,
            `- Total Size: ${aggregated.totalSize} / ${aggregated.totalMaxSize}`,
            `- Hit Rate: ${(aggregated.overallHitRate * 100).toFixed(2)}%`,
            `- Total Hits: ${aggregated.totalHits}`,
            `- Total Misses: ${aggregated.totalMisses}`,
            `- Total Evictions: ${aggregated.totalEvictions}`,
            `- Expired Purges: ${aggregated.totalExpiredPurges}`,
            "",
            "## Per-Cache Statistics",
            "",
        ];

        for (const [name, stats] of Object.entries(aggregated.caches)) {
            lines.push(`### ${name}`);
            lines.push(`- Size: ${stats.size} / ${stats.maxSize}`);
            lines.push(`- Hit Rate: ${(stats.hitRate * 100).toFixed(2)}%`);
            lines.push(`- Hits: ${stats.hits}`);
            lines.push(`- Misses: ${stats.misses}`);
            lines.push(`- Evictions: ${stats.evictions}`);
            lines.push("");
        }

        return lines.join("\n");
    }
}

// 导出类型
export { LRUCache, CacheConfig, CacheStats, CacheRegistry } from "../utils/lru-cache";
