# SDK Optimization Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix quality gate failures, reduce technical debt, and fill implementation gaps in the matrix-js-sdk to bring it into full alignment with the synapse-rust Ledger contract.

**Architecture:** Five-phase approach — Phase 1 fixes all failing CI quality gates (quick wins). Phase 2 reduces `any`/`Record<string, unknown>` usage. Phase 3 cleans up the 100 deprecated API items. Phase 4 fills implementation gaps (missing manager methods, empty stubs, missing exports). Phase 5 addresses structural issues (large files, test stability).

**Tech Stack:** TypeScript (ES2022, ESM, strict mode), Node.js v22+, pnpm, Vitest, ESLint

## Global Constraints

- All quality gates must pass: `pnpm lint` (types + js + workflows) + `pnpm quality:contracts` (7 gates)
- No new `any` types introduced; `Record<string, unknown>` only where truly dynamic
- Deprecated methods kept working for 2 minor versions before removal
- Never hand-edit `__generated__/` files — regenerate via `pnpm contract:codegen`
- Generated DTO strictness baseline must not regress
- All contracts must stay in sync: `pnpm contract:check` must pass
- Must align with HuLa project compatibility (Tauri v2, Vue 3, Web Worker context)

---

## Phase 1: Quality Gate Fixes

### Task 1.1: Fix 19 swallow-fallback violations

**Files:**

- Modify: `src/account-data/index.ts:187`
- Modify: `src/admin/sub-managers/admin-federation-manager.ts:105`
- Modify: `src/admin/sub-managers/admin-room-manager.ts:144`
- Modify: `src/admin/sub-managers/admin-user-manager.ts:429,445`
- Modify: `src/app-service/index.ts:347,370,387`
- Modify: `src/crypto/store/indexeddb-crypto-store-backend.ts:261,408`
- Modify: `src/guest/index.ts:301,344`
- Modify: `src/media-quota/index.ts:217`
- Modify: `src/push/index.ts:327,442`
- Modify: `src/room-summary/sub-managers/room-stats-manager.ts:84`
- Modify: `src/rust-crypto/backup.ts:252`
- Modify: `src/security/index.ts:70,115`
- Modify: `src/store/memory.ts:259`

**Produces:** All `pnpm quality:swallow-fallbacks` checks passing.

Each violation has a catch block that either is empty (`catch {}`) or conditionally swallows without a `@swallow-error` annotation. Fix pattern: add `logger.warn("context", error)` inside each empty catch block, or add the `@swallow-error` comment with justification if the swallow is intentional.

- [ ] **Step 1: Audit each violation**

For each of the 19 violations, read the surrounding code to understand whether:

- A) The catch should properly log the error (add `logger.warn(...)`)
- B) The swallow is intentional/necessary (add `@swallow-error` annotation with reason)

- [ ] **Step 2: Apply fixes in batches by module**

Fix one module at a time, starting with the files that have the most violations:

**Batch A — `src/app-service/index.ts` (3 violations at lines 347, 370, 387):**

```typescript
// Line ~347 — replace empty catch with logged error
try {
    // existing code
} catch (error) {
    logger.warn("Failed to ... in app-service", error);
}
```

**Batch B — `src/admin/sub-managers/admin-user-manager.ts` (2 violations at 429, 445):**

```typescript
try {
    // existing code
} catch (error) {
    logger.warn("Admin user operation failed", error);
}
```

**Batch C — remaining 14 violations across 10 files:**
Apply the same pattern — read context, add `logger.warn(...)` with a meaningful message.

- [ ] **Step 3: Run quality check after each batch**

```bash
pnpm quality:swallow-fallbacks
```

Expected: exit 0, no violations reported.

- [ ] **Step 4: Commit after all fixes**

```bash
git add src/
git commit -m "fix: eliminate 19 swallow-fallback violations across 12 files"
```

---

### Task 1.2: Fix type-coverage script crash (webrtc → web-rtc)

**Files:**

- Modify: `scripts/quality/check-type-coverage.mjs`

**Produces:** `pnpm quality:type-coverage` runs without ENOENT crash.

The script attempts to `scandir` on `src/webrtc` but the actual directory is `src/web-rtc/`. Additionally, it may reference `src/webrtc/` in other places — search and replace all occurrences.

- [ ] **Step 1: Find all `webrtc` references in the script**

```bash
grep -n "webrtc" scripts/quality/check-type-coverage.mjs
```

- [ ] **Step 2: Replace `src/webrtc` with `src/web-rtc`**

Use `replace_all` to change every `src/webrtc` to `src/web-rtc` in the file.

- [ ] **Step 3: Verify the fix**

```bash
pnpm quality:type-coverage
```

Expected: script runs and outputs a type coverage report (may report existing `any` usage as violations — that's expected and addressed in Phase 2).

- [ ] **Step 4: Commit**

```bash
git add scripts/quality/check-type-coverage.mjs
git commit -m "fix(quality): correct webrtc path to web-rtc in type-coverage check"
```

---

### Task 1.3: Fix the 1 ESLint error (unused variable)

**Files:**

- Modify: `spec/integ/matrix-client-syncing-errors.spec.ts:39`

**Produces:** `pnpm lint:js` passes with 0 errors.

The variable `authorizationEndpoint` at line 39 is assigned but never used.

- [ ] **Step 1: Read the file and understand the context**

- [ ] **Step 2: Remove the unused variable assignment or add a usage assertion**

If the variable is genuinely unused, remove the assignment line. If it should be used in a test assertion, add it.

- [ ] **Step 3: Run ESLint to verify**

```bash
pnpm lint:js
```

Expected: 0 errors (warnings are OK for now — addressed in Phase 2).

- [ ] **Step 4: Commit**

```bash
git add spec/integ/matrix-client-syncing-errors.spec.ts
git commit -m "fix: remove unused authorizationEndpoint variable in sync errors spec"
```

---

### Task 1.4: Clean up duplicate empty stub directories

**Files:**

- Remove: `src/appservice/` (only contains `__generated__/`)
- Remove: `src/openclaw/` (only contains `__generated__/`)
- Remove: `src/thirdparty/` (only contains `__generated__/`)

**Produces:** No duplicate hyphen-less directories; all modules use consistent naming.

These three directories are duplicates of `src/app-service/`, `src/open-claw/`, and `src/third-party/`. They contain only `__generated__/` codegen output with no source code. The SDK codegen script (`sdk-contract-codegen.mjs`) has a `SDK_DIR_ALIASES` map that maps these to the correct hyphenated directories.

- [ ] **Step 1: Verify no imports reference the old paths**

```bash
grep -r "from.*src/appservice" src/ spec/ || echo "No references found"
grep -r "from.*src/openclaw" src/ spec/ || echo "No references found"
grep -r "from.*src/thirdparty" src/ spec/ || echo "No references found"
```

- [ ] **Step 2: Check if the aliases are in SDK_DIR_ALIASES**

```bash
grep "appservice\|openclaw\|thirdparty" scripts/sdk-contract-codegen.mjs
```

- [ ] **Step 3: Remove the duplicate directories**

```bash
rm -rf src/appservice src/openclaw src/thirdparty
```

- [ ] **Step 4: Run codegen and verify it regenerates to the correct paths**

```bash
pnpm contract:codegen
```

Expected: no errors; `__generated__/` files in `src/app-service/`, `src/open-claw/`, `src/third-party/` are updated.

- [ ] **Step 5: Run full contract check**

```bash
pnpm contract:check
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove duplicate empty stub directories (appservice, openclaw, thirdparty)"
```

---

### Task 1.5: Fix OidcManager export from entry point

**Files:**

- Modify: `src/oidc/index.ts`

**Produces:** `OidcManager` class is importable via `matrix-js-sdk/oidc`.

`OidcManager` exists in `src/oidc/manager.ts` but `src/oidc/index.ts` does not re-export it.

- [ ] **Step 1: Read `src/oidc/index.ts` and `src/oidc/manager.ts`**

- [ ] **Step 2: Add export to `src/oidc/index.ts`**

```typescript
export { OidcManager } from "./manager";
```

- [ ] **Step 3: Verify types compile**

```bash
pnpm lint:types
```

- [ ] **Step 4: Commit**

```bash
git add src/oidc/index.ts
git commit -m "fix(oidc): export OidcManager from module entry point"
```

---

## Phase 2: Reduce Any/Unknown Type Usage

### Task 2.1: Reduce ESLint `any` warnings by 50%+

**Files:** `src/**/*.ts` (files with `@typescript-eslint/no-explicit-any` warnings)

**Produces:** ESLint warning count reduced from ~1027 to < 500.

The 1027 warnings span both source and spec files. Focus on source files first (spec files can use `any` more liberally). Priority: admin module > crypto > models > remaining.

- [ ] **Step 1: Get the top 20 source files with the most `any` warnings**

```bash
pnpm lint:js 2>&1 | grep "@typescript-eslint/no-explicit-any" | grep -v "spec/" | awk -F: '{print $1}' | sort | uniq -c | sort -rn | head -20
```

- [ ] **Step 2: Fix admin module first (highest impact)**

For each `any` in `src/admin/` files:

- Replace with the correct concrete type from `src/admin/types.ts` or generate an appropriate interface
- For truly dynamic values, use `unknown` instead of `any` (it's stricter and forces type narrowing)

- [ ] **Step 3: Fix crypto module**

For each `any` in `src/rust-crypto/` and `src/crypto-api/`:

- Import and use types from `@matrix-org/matrix-sdk-crypto-wasm` where available
- Define local interfaces for crypto callback parameters

- [ ] **Step 4: Fix models and remaining source files**

- [ ] **Step 5: Run lint check after each batch**

```bash
pnpm lint:js 2>&1 | grep -c "@typescript-eslint/no-explicit-any"
```

- [ ] **Step 6: Commit by module**

```bash
git add src/admin/
git commit -m "refactor(admin): replace any types with concrete interfaces"
# Repeat for each module batch
```

---

### Task 2.2: Reduce non-generated `Record<string, unknown>` to < 30

**Files:** 40 files with 51 remaining `Record<string, unknown>` instances (see audit)

**Produces:** Non-generated `Record<string, unknown>` count ≤ 30; remaining instances annotated with `/* Dynamic: reason */`.

- [ ] **Step 1: Replace with specific interfaces where the shape is known**

Focus on files with the most instances:

- `src/oidc/validate.ts` (7) — define `OidcMetadata` interface
- `src/errors.ts` (7) — define `ErrorContext` interface
- `src/external-service/index.ts` (5) — define request/response types
- `src/client-to-device.ts` (4) — define `ToDeviceMessage` type
- `src/models/room.ts` (4) — define `TagContent`, `ReceiptContent` types
- `src/client-receipt-requests.ts` (3) — define receipt data types

- [ ] **Step 2: For the 12-15 that must remain (truly dynamic data) — ensure `/* Dynamic: ... */` annotation**

- [ ] **Step 3: Run quality check**

```bash
pnpm quality:generated-dto-strictness
pnpm lint:types
```

- [ ] **Step 4: Commit by file batch**

---

## Phase 3: Deprecation Cleanup

### Task 3.1: Remove 30+ deprecated items from client.ts

**Files:**

- Modify: `src/client.ts`
- Modify: Callers that still use the deprecated methods (in `src/` and `spec/`)

**Produces:** client.ts `@deprecated` count reduced from 64 to ≤ 34.

Many of the 64 deprecated methods in `client.ts` are simple delegations to manager methods. The delegation pattern is already in place — `client.sendReadReceipt()` delegates to `this.readReceiptsManager.sendReadReceipt()`. For methods where the manager equivalent is fully functional, the deprecated client method can be removed (or at least cleaned up).

- [ ] **Step 1: Identify candidates for removal**

For each of the 64 deprecated methods, check:

- Does it have a manager replacement that's been stable for ≥ 2 minor versions?
- Are there still callers in `src/` or `spec/` that use the deprecated path?

- [ ] **Step 2: Migrate internal callers to the manager methods**

For each deprecated client method that will be removed, update all callers in `src/` to use the manager equivalent directly.

- [ ] **Step 3: Remove the deprecated methods from client.ts**

Target: Remove at least 30 methods that have stable manager equivalents.

- [ ] **Step 4: Remove 20+ deprecated items from other files**

Focus on:

- `src/module/index.ts` (6 deprecated items)
- `src/oidc/discovery.ts`, `src/oidc/manager.ts`
- `src/matrix-rtc/` (3 files)
- `src/models/` (4 files)
- `src/logger.ts` (2 items)

- [ ] **Step 5: Run full test suite**

```bash
pnpm test
```

Expected: all tests pass (update spec references if needed).

- [ ] **Step 6: Commit**

```bash
git add src/ spec/
git commit -m "refactor: remove 50+ deprecated API items, migrate callers to manager methods"
```

---

## Phase 4: Implementation Gaps

### Task 4.1: Implement 12 federation manager methods for uncovered routes

**Files:**

- Modify: `src/federation/index.ts`
- Modify: `src/federation/__generated__/route-table.ts` (regenerated)

**Produces:** FederationManager covers ≥ 75% of federation Ledger routes (up from ~52%).

Implement methods for the highest-priority uncovered routes:

- [ ] **Step 1: Write failing tests**

```typescript
// spec/unit/federation-manager.spec.ts (add to existing or create)
describe("FederationManager - backfill", () => {
    it("GET /_matrix/federation/v1/backfill/{room_id}", async () => {
        const result = await manager.backfillRoom("@room:example.com", { limit: 10 });
        expect(result).toHaveProperty("events");
        expect(result).toHaveProperty("origin");
    });
});
```

- [ ] **Step 2: Implement the methods in FederationManager**

Implement these 12 methods:

| Method               | Route                                     |
| -------------------- | ----------------------------------------- |
| `backfillRoom()`     | `GET /backfill/{room_id}`                 |
| `getEvent()`         | `GET /event/{event_id}`                   |
| `getMissingEvents()` | `POST /get_missing_events/{room_id}`      |
| `inviteUser()`       | `PUT /invite/{room_id}/{event_id}` (v1)   |
| `inviteUserV2()`     | `PUT /v2/invite/{room_id}/{event_id}`     |
| `makeJoin()`         | `GET /make_join/{room_id}/{user_id}`      |
| `makeLeave()`        | `GET /make_leave/{room_id}/{user_id}`     |
| `getMembers()`       | `GET /members/{room_id}`                  |
| `getJoinedMembers()` | `GET /members/{room_id}/joined`           |
| `getState()`         | `GET /state/{room_id}`                    |
| `getStateIds()`      | `GET /state_ids/{room_id}`                |
| `sendJoinV2()`       | `PUT /v2/send_join/{room_id}/{event_id}`  |
| `sendLeaveV2()`      | `PUT /v2/send_leave/{room_id}/{event_id}` |

- [ ] **Step 3: Run tests**

```bash
npx vitest run spec/unit/federation-manager.spec.ts
```

- [ ] **Step 4: Run contract sync and codegen to ensure route table alignment**

```bash
pnpm contract:sync && pnpm contract:codegen
pnpm contract:check
```

- [ ] **Step 5: Commit**

```bash
git add src/federation/ spec/unit/federation-manager.spec.ts
git commit -m "feat(federation): add 12 federation manager methods for uncovered routes"
```

---

### Task 4.2: Add source implementations for 4 empty stub modules

**Files:**

- Create: `src/sliding-sync/index.ts`
- Create: `src/sync/index.ts`
- Create: `src/thread/index.ts`
- Create: `src/widget/index.ts`
- Modify: `src/matrix-client-extensions.ts` (register new managers)
- Modify: `src/manager-extensions/index.ts` (add to ManagerExtensionsOptions)

**Produces:** All 4 modules have manager classes with at least the basic CRUD methods matching their route tables.

- [ ] **Step 1: Create `src/sliding-sync/index.ts`** (3 routes per Ledger)

```typescript
import { SlidingSyncContract } from "./__generated__/route-table";

export class SlidingSyncManager {
  constructor(private client: MatrixClient) {}

  // GET /_matrix/client/unstable/org.matrix.simplified.msc3575/sync
  async sync() { ... }

  // PUT /_matrix/client/unstable/org.matrix.simplified.msc3575/sync
  async updateSubscription() { ... }
}
```

- [ ] **Step 2: Create `src/sync/index.ts`** (7 routes per Ledger)

- [ ] **Step 3: Create `src/thread/index.ts`** (21 routes per Ledger)

- [ ] **Step 4: Create `src/widget/index.ts`** (18 routes per Ledger)

- [ ] **Step 5: Register all new managers**

In `src/matrix-client-extensions.ts`:

```typescript
getSlidingSyncManager(): SlidingSyncManager;
getSyncManager(): SyncManager;
getThreadManager(): ThreadManager;
getWidgetManager(): WidgetManager;
```

In `src/manager-extensions/index.ts`:

```typescript
includeSlidingSync?: boolean;
includeSync?: boolean;
includeThread?: boolean;
includeWidget?: boolean;
```

- [ ] **Step 6: Run tests and type check**

```bash
pnpm lint:types
pnpm test
```

- [ ] **Step 7: Commit per module**

```bash
git add src/sliding-sync/
git commit -m "feat(sliding-sync): add SlidingSyncManager with Ledger route coverage"
# Repeat for each module
```

---

### Task 4.3: Fill Admin DTO with actual types

**Files:**

- Modify: `src/admin/__generated__/dto.ts` (regenerated via codegen template improvement)
- Modify: `scripts/sdk-contract-codegen.mjs` (improve DTO generation template)

**Produces:** `src/admin/__generated__/dto.ts` contains actual type definitions instead of `AdminContractDtoPlaceholder = never`.

The admin module's generated DTO is an empty placeholder, unlike other modules (e.g., `oidc/__generated__/dto.ts` which has well-defined types). This indicates the codegen template cannot parse the admin contract's request/response schemas.

- [ ] **Step 1: Investigate why admin DTO generation produces empty output**

Check the admin module contract JSON for schema definitions:

```bash
python3 -c "
import json
with open('docs/api-contract/generated/modules/admin.json') as f:
    data = json.load(f)
# Check if entries have request/response schema info
for e in data['entries'][:5]:
    print(e.get('request_body'), e.get('response_schema'))
"
```

- [ ] **Step 2: Enhance codegen to handle admin contract schemas**

Improve the DTO generation logic in `scripts/sdk-contract-codegen.mjs` to parse the admin module's schemas and generate corresponding TypeScript interfaces.

- [ ] **Step 3: Regenerate and verify**

```bash
pnpm contract:codegen
pnpm contract:codegen:check
pnpm lint:types
```

- [ ] **Step 4: Commit**

```bash
git add scripts/sdk-contract-codegen.mjs src/admin/__generated__/dto.ts
git commit -m "fix(codegen): generate Admin DTO types from contract schemas"
```

---

### Task 4.4: Add missing package.json exports for 10+ modules

**Files:**

- Modify: `package.json`

**Produces:** At least 10 additional modules have public entry points in `package.json` exports.

Currently only 15 of ~52 `__generated__` modules are exported. Add exports for the modules that have both `__generated__/` route tables AND source code implementations.

- [ ] **Step 1: Identify modules with both source code AND route tables but no export**

```bash
for dir in src/*/; do
  name=$(basename "$dir")
  has_src=$(ls "$dir"*.ts 2>/dev/null | grep -v __generated__ | head -1)
  has_gen=$(ls "$dir"__generated__/ 2>/dev/null)
  if [ -n "$has_src" ] && [ -n "$has_gen" ]; then
    grep -q "\"./$name\"" package.json || echo "MISSING EXPORT: $name"
  fi
done
```

- [ ] **Step 2: Add exports for high-priority modules**

Priority modules to export:

- `./federation` — FederationManager
- `./room` — RoomManager + sub-managers
- `./room-summary` — RoomSummaryManager
- `./presence` — PresenceManager
- `./verification` — KeyVerificationManager
- `./e2ee` — E2EEManager
- `./oidc` — OidcManager
- `./media` — MediaManager
- `./external-service` — ExternalServiceManager
- `./feature-flags` — FeatureFlagManager

Each export follows the pattern:

```json
"./federation": {
  "import": "./lib/federation/index.js",
  "types": "./lib/federation/index.d.ts"
}
```

- [ ] **Step 3: Verify exports work**

```bash
pnpm build:types
pnpm quality:exports
```

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "feat: add package.json exports for 10 previously unexported modules"
```

---

## Phase 5: Structural Improvements

### Task 5.1: Split `src/admin/types.ts` (1,122 lines) into sub-module type files

**Files:**

- Create: `src/admin/sub-managers/admin-user-types.ts`
- Create: `src/admin/sub-managers/admin-room-types.ts`
- Create: `src/admin/sub-managers/admin-server-types.ts`
- Create: `src/admin/sub-managers/admin-federation-types.ts`
- Create: `src/admin/sub-managers/admin-config-types.ts`
- Modify: `src/admin/types.ts` (re-export only)

**Produces:** Admin types organized by sub-manager domain; no file over 500 lines in admin module.

- [ ] **Step 1: Extract user-related types to `admin-user-types.ts`**

- [ ] **Step 2: Extract room-related types to `admin-room-types.ts`**

- [ ] **Step 3: Extract server types, federation types, config types**

- [ ] **Step 4: Rewrite `src/admin/types.ts` as barrel re-export**

```typescript
export * from "./sub-managers/admin-user-types";
export * from "./sub-managers/admin-room-types";
export * from "./sub-managers/admin-server-types";
export * from "./sub-managers/admin-federation-types";
export * from "./sub-managers/admin-config-types";
```

- [ ] **Step 5: Verify all imports still work**

```bash
pnpm lint:types
pnpm test
```

- [ ] **Step 6: Commit**

```bash
git add src/admin/
git commit -m "refactor(admin): split types.ts into per-sub-manager type files"
```

---

### Task 5.2: Fix test OOM issue

**Files:**

- Modify: `vitest.config.ts`

**Produces:** Full test suite runs without worker OOM errors.

The test suite has one worker that hits out-of-memory. This is a resource configuration issue, not a code bug.

- [ ] **Step 1: Increase Vitest worker memory limit**

```typescript
// vitest.config.ts
export default defineConfig({
    test: {
        pool: "forks",
        poolOptions: {
            forks: {
                execArgv: ["--max-old-space-size=4096"],
            },
        },
    },
});
```

- [ ] **Step 2: Reduce parallel workers if needed**

If increasing memory doesn't help, reduce `maxConcurrency` or use `--pool=forks --poolOptions.forks.singleFork=true` for the large test suites.

- [ ] **Step 3: Run full test suite twice to confirm stability**

```bash
pnpm test
pnpm test
```

Expected: both runs pass with 0 failures, 0 OOM errors.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts
git commit -m "fix(ci): increase Vitest worker memory to prevent OOM errors"
```

---

### Task 5.3: Decompose `src/friend/index.ts` (1,395 lines) into sub-managers

**Files:**

- Create: `src/friend/sub-managers/friend-request-manager.ts`
- Create: `src/friend/sub-managers/friend-list-manager.ts`
- Create: `src/friend/sub-managers/friend-block-manager.ts`
- Modify: `src/friend/index.ts`

**Produces:** Friend module follows the same sub-manager pattern as admin; no standalone file over 500 lines in the friend module.

- [ ] **Step 1: Identify logical domain boundaries in FriendManager**

Group methods by: friend requests (send/accept/reject/cancel), friend list (list/search/sync), block management (block/unblock/blocklist).

- [ ] **Step 2: Extract `FriendRequestManager` class**

- [ ] **Step 3: Extract `FriendListManager` class**

- [ ] **Step 4: Extract `FriendBlockManager` class**

- [ ] **Step 5: Rewrite `FriendManager` as orchestrator delegating to sub-managers**

```typescript
export class FriendManager {
    public readonly requests: FriendRequestManager;
    public readonly list: FriendListManager;
    public readonly blocks: FriendBlockManager;

    constructor(client: MatrixClient) {
        this.requests = new FriendRequestManager(client);
        this.list = new FriendListManager(client);
        this.blocks = new FriendBlockManager(client);
    }
}
```

- [ ] **Step 6: Run tests and type check**

```bash
pnpm lint:types
pnpm test
```

- [ ] **Step 7: Commit**

```bash
git add src/friend/
git commit -m "refactor(friend): decompose FriendManager into sub-managers"
```

---

## Acceptance Checklist

- [ ] `pnpm quality:swallow-fallbacks` → exit 0
- [ ] `pnpm quality:type-coverage` → runs without crash
- [ ] `pnpm lint:js` → 0 errors, < 500 warnings
- [ ] `pnpm lint:types` → exit 0
- [ ] `pnpm test` → all pass, no OOM
- [ ] `pnpm contract:check` → exit 0
- [ ] `pnpm contract:codegen:check` → exit 0
- [ ] `pnpm quality:contracts` → exit 0 (all 7 gates)
- [ ] `@deprecated` count in `src/client.ts` ≤ 34
- [ ] Non-generated `Record<string, unknown>` count ≤ 30
- [ ] FederationManager route coverage ≥ 75%
- [ ] 0 empty stub modules (all have source code)
- [ ] Admin DTO contains actual types
- [ ] No files > 2,000 lines in `src/` (except client.ts at < 4,000, room.ts at < 3,500 as stretch target)
- [ ] `package.json` exports ≥ 25 modules
