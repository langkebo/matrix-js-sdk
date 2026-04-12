# ADR-0002: Cache Governance Framework

- Status: Accepted
- Date: 2026-04-11
- Owner: @sdk-core-a
- Related Task: T-P1

## Context

The matrix-js-sdk had multiple independent cache implementations:

- 31 LRUCache instances across different modules
- 14 inline LRUCache duplicates with varying implementations
- 17 Map-based caches without TTL support
- No unified configuration or monitoring
- Inconsistent eviction policies and TTL values

This led to:

- Unpredictable memory usage
- No visibility into cache hit/miss rates
- Difficulty in debugging cache-related issues
- Potential memory leaks from improper cache management

## Decision

Implement a unified cache governance framework:

1. **Enhanced `LRUCache` class**
    - Configurable via `CacheConfig` interface (maxSize, ttl, name)
    - Eviction callbacks for monitoring
    - Proactive expiration with `purgeExpired()`
    - Extended statistics (hits, misses, evictions, expiredPurges)

2. **`CacheRegistry` singleton**
    - Centralized registration of all cache instances
    - Aggregated statistics across all caches
    - Global purge capabilities
    - Optional periodic cleanup timer

3. **Elimination of inline duplicates**
    - All 14 inline LRUCache copies replaced with shared implementation
    - Consistent behavior across all modules

## Consequences

### Positive Impact

- Unified cache behavior across the SDK
- Observable cache metrics (hit rate, eviction count)
- Proactive memory management
- Reduced code duplication (14 inline copies eliminated)
- 37 unit tests for cache functionality

### Negative Impact / Trade-offs

- Migration effort for existing cache usage
- Slight overhead from statistics tracking
- Need to update existing cache configurations

## Compatibility Plan

- **Deprecated APIs**: Inline LRUCache implementations
- **Migration path**: Use `new LRUCache<T>({ maxSize, ttl, name })` format
- **Removal target version**: N/A (backward compatible)

## Validation

- **Tests added/updated**:
    - 37 new unit tests in `spec/unit/utils/lru-cache.spec.ts`
    - Tests for CacheConfig, eviction tracking, purgeExpired, CacheRegistry

- **Performance impact**: Minimal overhead from statistics; improved memory predictability

- **Security impact**: Better control over cached sensitive data with TTL
