# SDK Codegen Prompt Template — Ledger-Driven SDK Contract Pipeline

> Referenced as **D7** in
> `docs/api-contract/LEDGER_DRIVEN_SDK_PLAN_2026-05-02.md`.
> Status: the template is shipped, and `scripts/contract-sync.mjs` now
> renders git-ignored draft prompts under `docs/api-contract/drafts/`.
> Human-reviewed adoption is still iterative. PR-description provenance
> enforcement is shipped; commit-message enforcement remains follow-up work.
> Final-backfill governance status: **complete**. The contract corpus has
> reached **49/49 theoretical completeness**; any batching guidance below
> is retained as a reusable review rule for future bounded backfill waves,
> not as evidence of remaining tranche work.
> Documentation closeout note: there are **no remaining documentation-only
> tasks** in this template. The only residual open items are the **2
> non-blocking engineering deferrals** tracked in
> `docs/api-contract/LEDGER_DRIVEN_SDK_PLAN_2026-05-02.md`
> (`query_params/auth` ledger-schema enrichment, and cross-module
> `key-backup` ↔ `e2ee_routes` binding).

## 0. How this template is used

Current Phase-E behavior: `contract-sync.mjs` renders the template
below into a concrete prompt by
substituting:

- `{{ change_type }}` — one of `added` / `modified` / `deprecated`.
  When a single delta covers multiple categories, emit one rendered
  prompt per category.
- `{{ endpoint_diff_json }}` — the relevant subset of the ledger diff
  in the §5.1 schema of the plan (array of `LedgerEntry` objects plus a
  `diff_kind` field per entry).
- `{{ current_sdk_snippet }}` — handcrafted excerpt glued by
  `contract-sync`: the manager file for the module, the nearest type
  declarations in `src/@types/`, and any existing test file. Trimmed
  to ≤ 400 lines so the model sees authoritative context, not
  unrelated scrollback.

The rendered prompt is **never auto-executed**. A reviewer launches the
LLM with the prompt, reviews the diff it produces, and lands the
resulting commit through the normal PR path.
The rendered file is expected to live under
`docs/api-contract/drafts/` and be git-ignored after the patch lands.

This workflow is an **LLM-assisted drafting step**, not the
deterministic codegen stage. Deterministic reproducibility is owned by
`contract-sync.mjs` and `sdk-contract-codegen.mjs`; the prompt-driven
step is reviewer-gated and therefore cannot be used as evidence for
"100% one-click reproducibility". If the programme insists on a
`100%` one-click-regenerate acceptance bar, the human-LLM step must be
replaced by a deterministic generator rather than re-labelled.

The standalone reviewer gate is mirrored in
`docs/api-contract/governance/LEDGER_REVIEW_CHECKLIST.md`.

For any future bounded backfill tranche, one drafting / review session
should own exactly one batch of remaining module pages. Target batch
size is `7-12` contract pages per session. If the remaining scope
exceeds `12` pages, split it into another session rather than
stretching one prompt run beyond reviewable bounds.

## 1. Canonical prompt

```
你是一位 Matrix SDK 维护专家。请根据以下后端 API 契约变更，生成 SDK 的增量更新代码。

## 变更类型：{{ change_type }}   <!-- added / modified / deprecated -->

## 受影响端点
{{ endpoint_diff_json }}

## 当前 SDK 代码（相关部分）
{{ current_sdk_snippet }}

## 生成要求
1. 保持与现有 SDK 风格一致（命名规范、错误处理、异步模式）
2. 新增端点必须包含：类型安全的请求/响应结构体、路径参数验证、查询参数构建
3. 每个新增/变更 API 都要补充 JSDoc，且必须带 `@example` 示例；至少包含用途、参数、返回值、异常语义和一个可执行示例
4. 修改端点标注 `@since backend-api-X.Y.Z`
5. 废弃端点添加 `@deprecated` 并指向替代方案
6. 生成可执行的单元测试，而不是只有测试桩；至少覆盖 happy path、1 个 auth/validation 失败路径、1 个 typed-error 分支

## 输出格式
- 完整文件路径
- 变更 diff（Unified diff 格式）
- 变更说明（用于 CHANGELOG）
```

## 2. Reviewer checklist (run against every model output)

> The unchecked boxes in this section are **procedural review gates** for
> future prompt outputs. They are not a repository task backlog and should
> not be interpreted as currently unfinished documentation work.

Before landing a patch produced from this prompt, confirm each item:

### 2.1 Route fidelity

- [ ] Every `path` in the patch matches the ledger entry verbatim —
      no invented path segments, no `_` vs `-` swaps, no missing
      curly-brace placeholders.
- [ ] Path parameters appear in the same order as
      `LedgerEntry.path_params`.
- [ ] Query parameters in the generated request builder cover the
      full `LedgerEntry.query_params` set; any extra query string the
      model added must have a documented backend source.
- [ ] Auth posture in the generated code matches
      `LedgerEntry.auth` (`user` → authenticated client, `admin` →
      admin-scoped client, `optional` → nullable auth, `federation` →
      server-signing path, `none` → unauthenticated).

### 2.2 DTO fidelity

- [ ] Every request / response field has a concrete source — either
      the handler's `struct`/`Json<…>` type in synapse-rust or an
      existing typed interface in `src/@types/`. Reviewer pastes the
      source into the PR description when an interface is new.
- [ ] No `any` or `unknown` placeholders. If the response shape is
      genuinely unknown, the reviewer marks the module page row with
      `response_dto: Unknown` and opens a follow-up.
- [ ] Enums mirror Matrix C-S spec strings (e.g.
      `m.megolm_backup.v1.curve25519-aes-sha2`) — no paraphrasing.

### 2.3 Style consistency

- [ ] Imports use the repo's existing aliases
      (`@types`, `utils`, etc.) rather than deep relative paths.
- [ ] Manager methods follow `verbNoun` naming
      (`createBackupVersion`, `uploadKeysToLatest`) and return
      promises that throw typed errors.
- [ ] Every added / changed public API carries JSDoc that documents
      purpose, params, return value, error semantics, and one concrete
      `@example` usage example. Missing the example is a hard reject and
      will fail the SDK-side CI gate.
- [ ] New files land under `src/<module>/__generated__/` only if
      they are pure route/DTO tables. Hand-authored code stays in
      `src/<module>/index.ts`.
- [ ] `@since backend-api-X.Y.Z` tags use the `contract-version.yml`
      module version, bumped per the plan's semver policy (MAJOR for
      removals, MINOR for additions, PATCH for doc-only).

### 2.4 Deprecations

- [ ] `#[deprecated]` (TS: `@deprecated` JSDoc + runtime warn-once)
      points at a concrete replacement by method name.
- [ ] Deprecation stays in the surface for at least one MAJOR
      contract version; deletion requires a separate follow-up PR.
- [ ] Module page `status` for the deprecated entry is
      `covered-alias` with `alias_of:` or `excluded` with
      `excluded_reason: deprecated since <date>, removal planned <date>`.

### 2.5 Tests

- [ ] Every added / modified endpoint has an executable test next to
      the manager (`spec/unit/` or the repo's existing convention),
      not just a placeholder stub.
- [ ] Tests cover the happy path, one 4xx path (auth or validation),
      and — if the handler emits a typed error — at least one error
      branch.
- [ ] Stubs import the path constant from
      `src/<module>/__generated__/route-table.ts` rather than
      repeating the literal URL.

### 2.6 CHANGELOG

- [ ] Human-readable summary per endpoint, not just "regen".
- [ ] Breaking-change entries flagged prominently (see plan §5.3
      `breakingChanges:` list in `contract-version.yml`).
- [ ] The synapse-rust commit SHA that triggered the update is
      referenced.

## 3. Anti-patterns to reject outright

The reviewer rejects a patch (does not try to salvage it) when any of
the following appear:

- **Hallucinated fields.** Request/response keys that do not appear
  in any handler, DTO, or existing test.
- **Silent DTO widening.** Model replaces a typed interface with
  `Record<string, unknown>` or `any` to "cover all cases".
- **Path rewriting.** Model "normalises" `{room_id}` to `:roomId`
  or similar. The ledger path is canonical; the SDK can alias in
  TypeScript names but not in the URL string.
- **Compat alias churn.** Model deletes a legacy path because it
  "looks unused". Compat aliases stay unless
  `LedgerEntry.registered_by` removed them upstream.
- **Cross-module leak.** Patch touches a module not listed in
  `{{ endpoint_diff_json }}`. Each module has its own prompt/run.

## 4. Input bounds

The rendered prompt should stay under these bounds to keep reviews
tractable:

| Field                                     | Soft cap     | Hard cap      | Action on overflow                                                            |
| ----------------------------------------- | ------------ | ------------- | ----------------------------------------------------------------------------- |
| `endpoint_diff_json` entries              | 10           | 25            | Split into multiple prompts, one per functional area                          |
| `current_sdk_snippet` lines               | 300          | 500           | `contract-sync` trims oldest-first, retains type declarations                 |
| Rendered prompt total length              | 6 000 tokens | 10 000 tokens | Trim `current_sdk_snippet` further; if still over, escalate to split          |
| Future bounded backfill pages per session | 7            | 12            | Stop the batch at 12 pages and open the next review session for the remainder |

`contract-sync` refuses to emit a draft that exceeds the hard caps;
it writes a stub file instead and logs the overflow reason.

For any future bounded backfill wave, prefer a single rendered prompt /
review thread per batch. Do not mix two backfill batches into one
review session, because provenance, checklist sign-off, and acceptance
reruns need to stay attributable to one bounded tranche.

## 5. Provenance

Every rendered prompt and every patch derived from it carries a
provenance block in its commit message or PR description:

```
contract-prompt: docs/api-contract/drafts/2026-05-02T14-03-00Z.md
ledger-commit:   synapse-rust@<40-hex>
ledger-profile:  default
change-type:     added
module:          key_backup
```

For workflow-generated mirror-sync PRs where the draft files are
attached as an artifact rather than committed, `contract-prompt:` MAY
use an artifact URI such as `artifact://contract-drafts-<sha>`, and
`change-type:` / `module:` MAY contain comma-separated aggregate values.

The provenance lets a reader trace back from any SDK commit to the
exact ledger entry and prompt run that produced it. Grep for the
`ledger-commit:` line if you are debugging a DTO mismatch — the
shasum pins the backend revision the SDK was aligned against.

## 6. Change log for this template

| Date       | Change                                                                                                    | Author            |
| ---------- | --------------------------------------------------------------------------------------------------------- | ----------------- |
| 2026-05-02 | Initial version. Canonical prompt frozen at schema_version:1.                                             | plan rollout      |
| 2026-05-03 | Added final-backfill batching guidance: one session per batch, target `7-12` module pages.                | governance update |
| 2026-05-03 | Synced status after closeout: final backfill complete, guidance retained for future bounded batches only. | governance update |
