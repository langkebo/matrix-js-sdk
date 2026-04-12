# Architecture Decision Records (ADR) Index

> Last Updated: 2026-04-11

## Overview

Architecture Decision Records (ADRs) capture important architectural decisions made in the matrix-js-sdk project. Each ADR describes:

- The context and problem being addressed
- The decision made and rationale
- Consequences and trade-offs
- Compatibility and migration plans

## ADR Process

### When to Create an ADR

An ADR is required for PRs that involve:

1. **Public API Changes**
    - New public API additions
    - Breaking changes to existing APIs
    - Deprecation of existing APIs

2. **Architectural Changes**
    - Changes to module structure
    - New dependency introductions
    - Changes to extension mechanisms
    - Manager migration patterns

3. **Performance-Critical Changes**
    - Changes to hot paths
    - Caching strategy changes
    - Memory management changes

4. **Security-Related Changes**
    - Authentication/authorization changes
    - Data handling changes
    - Encryption-related changes

### ADR Workflow

```
1. Create ADR (Status: Proposed)
   └── Use template: docs/governance/ADR_TEMPLATE.md
   └── Name: ADR-NNNN-short-title.md

2. PR Review & Discussion
   └── Link ADR in PR description
   └── Update ADR based on feedback

3. Approval & Merge
   └── Status: Accepted
   └── Add to INDEX.md

4. Implementation
   └── Reference ADR in code comments where applicable

5. Deprecation (if superseded)
   └── Status: Deprecated/Superseded
   └── Link to new ADR
```

### Naming Convention

```
ADR-NNNN-short-kebab-case-title.md

Examples:
ADR-0001-manager-error-semantics.md
ADR-0002-cache-governance-framework.md
ADR-0003-client-ts-modularization.md
```

## ADR Status Definitions

| Status     | Description                            |
| ---------- | -------------------------------------- |
| Proposed   | Under review, not yet approved         |
| Accepted   | Approved and ready for implementation  |
| Deprecated | No longer recommended, but still valid |
| Superseded | Replaced by a newer ADR                |

## ADR List

### 2026 Q2

| ADR      | Title                               | Status   | Date       | Related Task |
| -------- | ----------------------------------- | -------- | ---------- | ------------ |
| ADR-0001 | Manager Error Semantics Unification | Accepted | 2026-04-11 | T-Q1         |
| ADR-0002 | Cache Governance Framework          | Accepted | 2026-04-11 | T-P1         |
| ADR-0003 | Client.ts Modularization Strategy   | Accepted | 2026-04-11 | T-Q4         |
| ADR-0004 | Extension Mechanism Final State     | Accepted | 2026-04-11 | T-A2         |

## Quick Links

- [ADR Template](../ADR_TEMPLATE.md)
- [Risk Register](../RISK_REGISTER.md)
- [Execution Taskboard](../../SYSTEMIC_REFACTOR_EXECUTION_TASKBOARD_2026Q2.md)
- [Migration Guide](../../MIGRATION_GUIDE.md)

## Creating a New ADR

1. Copy the template:

    ```bash
    cp docs/governance/ADR_TEMPLATE.md docs/governance/adr/ADR-NNNN-your-title.md
    ```

2. Fill in the sections:
    - Status: Start with "Proposed"
    - Date: Current date
    - Owner: Your GitHub username
    - Related Task: Task ID from execution taskboard

3. Submit with your PR:
    - Link the ADR in the PR description
    - Ensure the "Architecture Decision Record" section is filled

4. After approval:
    - Update status to "Accepted"
    - Add entry to this INDEX.md
