# ADR-0003: Client.ts Modularization Strategy

- Status: Accepted
- Date: 2026-04-11
- Owner: @sdk-core-a
- Related Task: T-Q4

## Context

The `client.ts` file had grown to 9044 lines with significant issues:

- High cognitive complexity (max 46 branches)
- Multiple responsibilities mixed in one file
- Difficult to navigate and maintain
- High regression risk for any changes
- Poor test isolation

The file contained:

- Core client initialization
- Event sending/receiving
- Room management
- User management
- Crypto operations
- Sync logic
- And many more responsibilities

## Decision

Implement a modularization strategy focusing on high-risk subdomains:

1. **Extract helper modules**
    - `client-internals.ts`: Internal utilities
    - `client-delayed-events.ts`: Delayed event handling
    - `client-send-paths.ts`: Event sending paths
    - `client-thread-relations.ts`: Thread relation handling
    - `client-auth.ts`: Authentication helpers
    - `client-receipts.ts`: Receipt handling
    - `client-membership.ts`: Membership operations
    - `client-timeline-requests.ts`: Timeline request building

2. **Maintain backward compatibility**
    - All public APIs remain unchanged
    - Internal delegation to helper modules
    - No breaking changes for consumers

3. **Focus on complexity reduction**
    - Target: 30%+ complexity reduction
    - Measured by branch count and cyclomatic complexity

## Consequences

### Positive Impact

- Line count reduced: 9044 → 6669 (-26%)
- Max complexity reduced: 46 → 20 (-57%)
- Better code organization and navigation
- Lower regression risk
- Improved test isolation

### Negative Impact / Trade-offs

- More files to navigate
- Need to maintain delegation patterns
- Some internal refactoring required

## Compatibility Plan

- **Deprecated APIs**: None (internal refactoring only)
- **Migration path**: N/A (no public API changes)
- **Removal target version**: N/A

## Validation

- **Tests added/updated**:
    - 9/9 targeted regression tests pass
    - `client-relations-core.spec.ts`
    - `client-account-data-core.spec.ts`
    - `client-profile-core.spec.ts`

- **Performance impact**: No measurable change (delegation overhead negligible)

- **Security impact**: No change (same code paths, different organization)
