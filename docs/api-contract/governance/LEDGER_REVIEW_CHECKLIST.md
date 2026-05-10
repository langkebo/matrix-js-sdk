# Ledger Review Checklist

> Reviewer checklist for Phase-E ledger-driven SDK updates.
> Canonical prompt body lives in
> `docs/api-contract/governance/SDK_CODEGEN_PROMPT_TEMPLATE.md`.
> This file extracts the reviewer gate into a standalone document so PRs,
> issue templates, and workflow notes can reference one stable checklist.
> Status sync: the final contract backfill tranche is already complete
> (`49/49` theoretical completeness). Section 7 remains as reusable
> guidance for any future bounded backfill or catch-up batch, not as an
> indicator of unfinished current work.
> Documentation closeout note: this checklist has no remaining
> documentation-only backlog. Any still-open work lives outside this file
> and is limited to the **2 non-blocking deferred engineering items**
> tracked in
> `docs/api-contract/LEDGER_DRIVEN_SDK_PLAN_2026-05-02.md`.

## 1. Route fidelity

> All unchecked boxes below are **run-per-review checklist items**. They
> are intentionally left unchecked in the template and do not represent
> outstanding repository tasks.

- [ ] Every URL path matches the ledger entry verbatim.
- [ ] Path parameters keep the same order as the ledger path.
- [ ] Query parameters cover the full documented set; any extra query string has a cited backend source.
- [ ] Auth posture matches the ledger or the backend handler contract.

## 2. DTO fidelity

- [ ] Every request and response field has a concrete source in backend code, SDK types, or existing tests.
- [ ] No `any`, `unknown`, or `Record<string, unknown>` placeholders are introduced without an explicit follow-up.
- [ ] Enum string values match Matrix or backend spec strings exactly.

## 3. Style consistency

- [ ] Imports use existing SDK aliases and layout conventions.
- [ ] Manager methods keep the repo's naming and typed-error patterns.
- [ ] Added or changed public APIs carry JSDoc with purpose, params, return value, error semantics, and at least one `@example` usage example.
- [ ] Missing `@example` is treated as a hard failure, not a documentation nit; the SDK CI gate rejects it.
- [ ] Pure generated route metadata stays under `src/<module>/__generated__/`.
- [ ] Hand-authored logic stays in non-generated source files.

## 4. Deprecations

- [ ] Deprecated APIs point to a concrete replacement.
- [ ] Removal timing is documented and consistent with contract-version policy.
- [ ] Module-page status fields reflect the deprecation plan.

## 5. Tests

- [ ] Added or modified endpoints have executable tests next to the owning module, not placeholder stubs.
- [ ] Coverage includes the happy path, at least one auth or validation failure path, and one typed-error branch when applicable.
- [ ] Tests import generated route constants instead of repeating literal URLs where possible.

## 6. Changelog and provenance

- [ ] CHANGELOG text explains endpoint-level impact, not just "regen".
- [ ] Breaking changes are called out explicitly.
- [ ] Commit message or PR description carries provenance lines:

```text
contract-prompt: docs/api-contract/drafts/<timestamp>.md
ledger-commit:   synapse-rust@<40-hex>
ledger-profile:  <profile>
change-type:     <added|modified|deprecated>
module:          <module>
```

For workflow-generated mirror-sync PRs, `contract-prompt:` may point to
`artifact://contract-drafts-<sha>` and `change-type:` / `module:` may
be comma-separated aggregate values.

## 7. Final backfill batching

- [ ] Any future bounded backfill tranche is reviewed in one bounded session per batch, not spread across multiple partial sessions.
- [ ] Each future backfill batch covers `7-12` remaining contract pages; if more remain, the surplus is deferred to the next session.
- [ ] Review notes, provenance, codegen reruns, and acceptance results all map to the same batch scope.

## 8. Reject immediately when

- [ ] The patch invents request or response fields not found in backend code.
- [ ] The patch widens DTOs with `any` or similar catch-all shapes.
- [ ] The patch rewrites canonical ledger paths.
- [ ] The patch deletes compat aliases without an upstream ledger removal.
- [ ] The patch touches unrelated modules outside the prompt payload.
