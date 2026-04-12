# ADR-0004: Extension Mechanism Final State

- Status: Accepted
- Date: 2026-04-11
- Owner: @sdk-arch
- Related Task: T-A2

## Context

The matrix-js-sdk had a dual-track extension mechanism:

- Static exports from `matrix.ts`
- Dynamic extensions via `manager-extensions`

This created confusion:

- Unclear which mechanism to use
- Potential for inconsistent behavior
- Documentation drift from actual implementation
- No clear lifecycle for extensions

## Decision

Define a clear final state for the extension mechanism:

1. **Automatic initialization**
    - `createClient()` and `createRoomWidgetClient()` automatically initialize extensions
    - Extensions are ready to use immediately after client creation

2. **Soft-disable option**
    - `disableDynamicExtensions` option to disable automatic initialization
    - Useful for testing or custom initialization scenarios

3. **Lifecycle events**
    - `register`: Extension is registered
    - `init`: Extension is initialized
    - `start`: Extension is started
    - `stop`: Extension is stopped

4. **Static exports as primary**
    - All managers available via static imports
    - Dynamic extensions for advanced use cases only

## Consequences

### Positive Impact

- Clear, predictable extension behavior
- Better developer experience with automatic initialization
- Flexible for advanced use cases
- Documented lifecycle for debugging

### Negative Impact / Trade-offs

- Slight overhead from automatic initialization
- Need to document both patterns
- Migration for code expecting manual initialization

## Compatibility Plan

- **Deprecated APIs**: Manual extension initialization
- **Migration path**: See [Migration Guide](../../MIGRATION_GUIDE.md#extension-lifecycle)
- **Removal target version**: v35.0.0

## Validation

- **Tests added/updated**:
    - Unit tests for automatic initialization
    - Unit tests for lifecycle events
    - Tests for `disableDynamicExtensions` option

- **Performance impact**: Minimal (initialization happens once)

- **Security impact**: No change (same extension code)
