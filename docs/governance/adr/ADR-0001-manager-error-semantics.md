# ADR-0001: Manager Error Semantics Unification

- Status: Accepted
- Date: 2026-04-11
- Owner: @sdk-core-b
- Related Task: T-Q1

## Context

The matrix-js-sdk had inconsistent error handling across different Manager classes:

- Some managers threw raw errors without classification
- Others swallowed errors and returned null/empty values
- Error types were not standardized, making it difficult for consumers to implement consistent retry strategies
- No unified mechanism for error recovery or logging

This inconsistency led to:

- Difficulty in debugging production issues
- Inconsistent behavior across the SDK
- Poor developer experience for SDK consumers

## Decision

Implement a unified error handling system through `BaseManager`:

1. **All Manager classes extend `BaseManager`**
    - Provides standardized error classification
    - Implements consistent retry logic
    - Enables structured logging

2. **Error Classification**
    - `MatrixError`: Base class for all Matrix-related errors
    - `ConnectionError`: Network-related failures
    - `ValidationError`: Input validation failures
    - `AuthorizationError`: Authentication/authorization failures

3. **Error Recovery**
    - Automatic retry for transient errors
    - Configurable retry policies
    - Graceful degradation patterns

## Consequences

### Positive Impact

- Consistent error behavior across all managers (99.0% coverage)
- Easier debugging with structured error information
- Better developer experience with predictable error types
- Simplified retry logic for consumers

### Negative Impact / Trade-offs

- Migration effort required for existing code
- Some edge cases may need explicit handling
- Internal class `RustBackupManager` remains exempt (inherits TypedEventEmitter)

## Compatibility Plan

- **Deprecated APIs**: Direct error throwing without classification
- **Migration path**: See [Migration Guide](../../MIGRATION_GUIDE.md#error-semantics-migration)
- **Removal target version**: v35.0.0

## Validation

- **Tests added/updated**:
    - Unit tests for BaseManager error handling
    - Integration tests for error propagation
    - Coverage: 99.0% of managers migrated (101/102)

- **Performance impact**: Minimal overhead from error classification

- **Security impact**: Improved error messages avoid leaking sensitive information
