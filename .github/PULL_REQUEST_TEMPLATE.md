<!-- Thanks for submitting a PR! Please ensure the following requirements are met in order for us to review your PR -->

## Task Information

**Task ID**: <!-- e.g., T-Q1, T-P2, from execution taskboard -->
**Related Issue**: <!-- Link to related issue if applicable -->

## Architecture Decision Record (ADR)

- [ ] **This PR involves architecture changes**: Check if this PR introduces significant architectural decisions
    - New public API additions or changes
    - Breaking changes to existing APIs
    - Changes to module structure or dependencies
    - Performance-critical path modifications
    - Security-related changes

**ADR Document**: <!-- If checked above, link to ADR document: docs/governance/adr/ADR-XXXX.md -->
**ADR Status**: <!-- Proposed | Accepted | N/A -->

> **Note**: Architecture changes require an ADR document. See [ADR Template](../docs/governance/ADR_TEMPLATE.md) and [ADR Index](../docs/governance/adr/INDEX.md) for details.

## Changes Summary

<!-- Brief description of what this PR changes and why -->

## Test Evidence

- [ ] **Unit Tests**: Added/updated unit tests for new functionality
- [ ] **Integration Tests**: Verified integration test coverage
- [ ] **Performance Tests**: Ran `pnpm test:perf` if applicable

**Test Commands Run**:

```bash
# Example:
pnpm test --run
pnpm lint
```

## Risk Assessment

**Risk Level**: <!-- P0 / P1 / P2 -->

| Level | Criteria                                                 |
| ----- | -------------------------------------------------------- |
| P0    | Critical - May cause breaking changes or security issues |
| P1    | High - Significant changes affecting multiple modules    |
| P2    | Medium - Localized changes with minimal impact           |

**Risk Mitigation**: <!-- Describe any risk mitigation measures -->

## Migration Impact

- [ ] **Breaking Change**: This PR introduces breaking changes
- [ ] **Deprecation**: This PR deprecates existing APIs
- [ ] **No Breaking Change**: Backward compatible

**Migration Notes**:

<!-- If breaking, describe migration path for consumers -->

## Checklist

- [ ] Tests written for new code (and old code if feasible).
- [ ] New or updated `public`/`exported` symbols have accurate [TSDoc](https://tsdoc.org/) documentation.
- [ ] Linter and other CI checks pass.
- [ ] Sign-off given on the changes (see [CONTRIBUTING.md](https://github.com/matrix-org/matrix-js-sdk/blob/develop/CONTRIBUTING.md)).
- [ ] Quality Gate passes: `pnpm quality:contracts`

## Review Requirements

<!-- For P0/P1 changes, ensure proper review sign-offs -->

- [ ] Tech Lead approval (for P0/P1 changes)
- [ ] QA verification (for P0 changes)
- [ ] Security review (for security-related changes)
