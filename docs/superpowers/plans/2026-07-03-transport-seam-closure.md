# Architecture Deepening — Transport Seam + Test Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the transport seam across all 77 remaining files, propagate ManagerOpts to all 63 managers, backfill test coverage for top 10 untested managers, and eliminate 2 shallow modules.

**Architecture:** Three-phase execution per the architecture review's top recommendation: Phase 1 — propagate `ManagerOpts` to every manager constructor (enabler, one-line-per-file). Phase 2 — migrate all remaining `this.client.http.authedRequest()` calls to `this.request()`. Phase 3 — backfill unit tests for the largest untested managers using `FakeTransport`. Quick wins (HttpManager deletion, stray declaration fix) folded in.

**Tech Stack:** TypeScript 5.x, Vitest, pnpm, Node.js v22+

## Global Constraints

- `pnpm lint:types` must pass with zero new errors after every task
- `pnpm test` must pass after every task (no regressions)
- `pnpm lint:js` must pass after every task
- All manager constructors must accept `opts?: ManagerOpts` and forward to `super(client, opts)`
- All HTTP calls in managers must use `this.request()`, never `this.client.http.authedRequest()`
- New tests must use `FakeTransport` from `spec/test-utils/FakeTransport.ts`
- Manager names must match the `ManagerName` union in `src/client-infra/manager-registry.ts`

---

### Task 1: Propagate ManagerOpts to all 63 manager constructors

**Files:**
- Modify: ~63 manager `index.ts` files under `src/*/`

**Interfaces:**
- Consumes: `ManagerOpts` from `src/managers/base-manager.ts`
- Produces: Every manager constructor signature: `constructor(client: MatrixClient, opts?: ManagerOpts)` with `super(client, opts)` call

Currently only the admin family (7 files) accepts `ManagerOpts`. All other managers hard-code `constructor(client: MatrixClient)` with no `opts` parameter, making `FakeTransport` injection impossible. Add `opts?: ManagerOpts` to every constructor and forward to `super()`.

The mechanical change for each file:

```typescript
// BEFORE:
constructor(client: MatrixClient) {
    super(client);
}

// AFTER:
constructor(client: MatrixClient, opts?: ManagerOpts) {
    super(client, opts);
}
```

Some constructors have additional parameters (e.g., `GuestManager` takes `homeserverUrl`, `TelemetryManager` takes `config`). For those, append `opts?: ManagerOpts` as the last parameter and forward it.

- [ ] **Step 1: Write script to add ManagerOpts to all constructors**

Create and run a script that:
1. Finds all `constructor(client: MatrixClient)` patterns in `src/*/index.ts` files (excluding already-migrated admin family)
2. Changes signature to `constructor(client: MatrixClient, opts?: ManagerOpts)`
3. Changes `super(client)` to `super(client, opts)`
4. Adds `import type { ManagerOpts } from "../managers/base-manager"` if not already present

```bash
cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk

# Find files NOT already migrated (exclude admin family)
for f in $(grep -rl "extends BaseManager" src/ --include="*.ts" | grep -v "admin/"); do
  # Check if already has opts parameter
  if grep -q "constructor(client: MatrixClient, opts" "$f"; then
    echo "SKIP (already migrated): $f"
    continue
  fi
  
  # Add opts parameter to constructor
  sed -i '' 's/constructor(client: MatrixClient)/constructor(client: MatrixClient, opts?: ManagerOpts)/g' "$f"
  
  # Update super call
  sed -i '' 's/super(client);/super(client, opts);/g' "$f"
  
  echo "MIGRATED: $f"
done
```

- [ ] **Step 2: Add ManagerOpts import to files that need it**

For files that don't already import `ManagerOpts`:

```bash
for f in $(grep -rl "opts?: ManagerOpts" src/ --include="*.ts" | grep -v "admin/"); do
  if ! grep -q "import.*ManagerOpts.*from.*base-manager" "$f"; then
    # Add import after existing base-manager import, or after MatrixClient import
    sed -i '' 's|import { BaseManager } from "\.\./managers/base-manager";|import { BaseManager, type ManagerOpts } from "../managers/base-manager";|' "$f"
    sed -i '' 's|import { BaseManager } from "\.\./\.\./managers/base-manager";|import { BaseManager, type ManagerOpts } from "../../managers/base-manager";|' "$f"
    # Handle deeper paths similarly
  fi
done
```

- [ ] **Step 3: Handle special cases manually**

Files with extra constructor params need manual handling:
- `src/guest/index.ts`: `constructor(client: MatrixClient, homeserverUrl: string)` → add `opts?: ManagerOpts` as 3rd param
- `src/telemetry/index.ts`: `constructor(client: MatrixClient, config?: Partial<TelemetryConfig>)` → add `opts?: ManagerOpts` as 3rd param
- `src/burn-after-read/index.ts`: check constructor signature
- `src/rendezvous/RendezvousManager.ts`: check constructor signature
- `src/oidc/manager.ts`: check constructor signature

Read each file and add `opts?: ManagerOpts` as the last parameter, forwarding to `super(client, opts)`.

- [ ] **Step 4: Verify types compile**

Run: `pnpm lint:types`
Expected: No new errors (pre-existing errors in sync.ts, web-rtc/call.ts, etc. are expected)

- [ ] **Step 5: Run tests**

Run: `pnpm test`
Expected: All tests pass (ManagerOpts is optional, no behavioral change)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: propagate ManagerOpts to all manager constructors

Add opts?: ManagerOpts parameter to all 63 manager constructors so
FakeTransport can be injected everywhere. One-line mechanical change
per file. All existing behavior preserved (opts is optional).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Delete HttpManager — shallow passthrough with zero internal consumers

**Files:**
- Remove: `src/http/index.ts` (92 lines)
- Modify: `src/matrix-client-extensions.ts` (remove 1 declaration)
- Modify: `src/manager-extensions/index.ts` (regenerate or remove 1 import block)
- Modify: `scripts/generate-manager-extensions.mjs` (remove http entry)

**Interfaces:**
- Produces: HttpManager module deleted; callers use `this.client.http` directly

HttpManager has 6 methods, all pure delegation to `this.client.*`. Zero internal callers of `getHttpManager()` exist in `src/`. The deletion test passes cleanly.

- [ ] **Step 1: Remove HttpManager**

```bash
rm src/http/index.ts
```

- [ ] **Step 2: Remove from type declarations**

In `src/matrix-client-extensions.ts`, remove:
```typescript
getHttpManager(): import("./http/index").HttpManager;
```

- [ ] **Step 3: Remove from manager-extensions**

In `scripts/generate-manager-extensions.mjs`, remove the `"http"` entry from MODULE_DEFS. Then regenerate:

```bash
node scripts/generate-manager-extensions.mjs
```

- [ ] **Step 4: Remove from ManagerName and ManagerTypeMap**

In `src/client-infra/manager-registry.ts`:
- Remove `| "http"` from the `ManagerName` union
- Remove `http: import("../http/index").HttpManager;` from `ManagerTypeMap`

- [ ] **Step 5: Remove from package.json exports (if present)**

Check `package.json` exports for any `./http` entry and remove it.

- [ ] **Step 6: Verify**

Run: `pnpm lint:types && pnpm test`
Expected: PASS — zero importers of HttpManager

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: remove shallow HttpManager module

6 methods, all pure delegation to this.client.*. Zero internal consumers.
Deletion test passes cleanly. 92 lines removed.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Migrate top 10 largest files from authedRequest to this.request()

**Files:**
- Modify: 10 files (see list below)

**Interfaces:**
- Consumes: `this.request()` from `BaseManager` (Task 1 enables ManagerOpts propagation)
- Produces: All HTTP calls in these 10 files use `this.request()` transport seam

Target the 10 highest-volume files identified in the architecture review:

| File | Direct HTTP calls |
|---|---|
| `src/event-report/index.ts` | ~21 |
| `src/app-service/index.ts` | ~21 |
| `src/widget/index.ts` | ~18 |
| `src/e2ee/index.ts` | ~14 |
| `src/burn-after-read/index.ts` | ~10 |
| `src/auth/index.ts` | ~9 |
| `src/account-data/index.ts` | ~7 |
| `src/reporting/index.ts` | ~5 |
| `src/room-member/index.ts` | ~5 |
| `src/account/index.ts` | ~5 |

Pattern to apply for each call:

```typescript
// BEFORE:
const response = await this.client.http.authedRequest<Type>(
    Method.Post,
    "/path",
    queryParams,
    body,
    { prefix: ClientPrefix.V3 },
);

// AFTER:
const response = await this.request<Type>({
    method: Method.Post,
    path: "/path",
    queryParams,
    body,
    prefix: ClientPrefix.V3,
});
```

Also remove `try { ... } catch (error) { throw this.normalizeError(error, "methodName") }` wrappers — `this.request()` handles error normalization internally.

- [ ] **Step 1: Migrate event-report/index.ts (~21 calls)**

Read the file, convert each `this.client.http.authedRequest` call to `this.request()`. Remove normalizeError wrappers.

- [ ] **Step 2: Migrate app-service/index.ts (~21 calls)**

Same pattern.

- [ ] **Step 3: Migrate widget/index.ts (~18 calls)**

Same pattern.

- [ ] **Step 4: Migrate e2ee/index.ts (~14 calls)**

Same pattern.

- [ ] **Step 5: Migrate burn-after-read/index.ts (~10 calls)**

Same pattern.

- [ ] **Step 6: Migrate auth/index.ts (~9 calls)**

Same pattern. Note: auth has a mix of `this.request()` and `this.client.http.request()` — migrate the remaining direct calls.

- [ ] **Step 7: Migrate account-data, reporting, room-member, account (~22 calls combined)**

Batch the 4 smaller files.

- [ ] **Step 8: Verify types and tests**

Run: `pnpm lint:types && pnpm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/event-report/ src/app-service/ src/widget/ src/e2ee/ src/burn-after-read/ src/auth/ src/account-data/ src/reporting/ src/room-member/ src/account/
git commit -m "refactor: migrate top 10 files from authedRequest to this.request()

~115 direct HTTP calls migrated to transport seam. Removed manual
normalizeError wrappers. Event-report (21), app-service (21), widget (18),
e2ee (14), burn-after-read (10), auth (9), and 4 others.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Fix stray declare module + cross-domain util import

**Files:**
- Modify: `src/models/MSC3089TreeSpace.ts`
- Modify: `src/matrix-client-extensions.ts`
- Create: `src/common/pagination.ts`
- Modify: `src/module/index.ts`
- Modify: `src/admin/utils.ts`

**Interfaces:**
- Produces: Zero stray `declare module` blocks outside authorized files; `buildPaginationParams` lives in `src/common/pagination.ts`

- [ ] **Step 1: Move stray declare module**

Read `src/models/MSC3089TreeSpace.ts` line 81. Find the `declare module "../@types/media"` block. Move the `FileContent` augmentation into `src/matrix-client-extensions.ts` (where all other type augmentations live). Remove the block from `MSC3089TreeSpace.ts`.

- [ ] **Step 2: Extract buildPaginationParams to common**

Create `src/common/pagination.ts`:

```typescript
export function buildPaginationParams(limit?: number, from?: string, to?: string, dir?: string): Record<string, string> {
    const params: Record<string, string> = {};
    if (limit !== undefined) params.limit = String(limit);
    if (from !== undefined) params.from = from;
    if (to !== undefined) params.to = to;
    if (dir !== undefined) params.dir = dir;
    return params;
}
```

Update `src/admin/utils.ts` to re-export from common:
```typescript
export { buildPaginationParams } from "../../common/pagination";
```

Update `src/module/index.ts` to import from common:
```typescript
import { buildPaginationParams } from "../common/pagination";
```

- [ ] **Step 3: Verify**

Run: `pnpm lint:types && pnpm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/models/MSC3089TreeSpace.ts src/matrix-client-extensions.ts src/common/pagination.ts src/module/index.ts src/admin/utils.ts
git commit -m "refactor: fix stray declare module and cross-domain util import

Move the last remaining declare module block from MSC3089TreeSpace.ts to
matrix-client-extensions.ts. Extract buildPaginationParams to
src/common/pagination.ts to break admin→module cross-domain dependency.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Backfill tests for top 5 untested managers using FakeTransport

**Files:**
- Create: `spec/unit/room-manager.spec.ts`
- Create: `spec/unit/threading.spec.ts`
- Create: `spec/unit/e2ee.spec.ts`
- Create: `spec/unit/media.spec.ts`
- Create: `spec/unit/oidc.spec.ts`

**Interfaces:**
- Consumes: `FakeTransport` from `spec/test-utils/FakeTransport.ts`, `ManagerOpts` from Task 1
- Produces: Test coverage for 5 largest untested managers

Each test file follows the same pattern established in `admin.spec.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { FakeTransport } from "../test-utils/FakeTransport";
import { RoomManager } from "../../src/room/index";

describe("RoomManager", () => {
    let transport: FakeTransport;
    let manager: RoomManager;

    beforeEach(() => {
        transport = new FakeTransport();
        manager = new RoomManager({} as any, { transport });
    });

    it("returns room list", async () => {
        transport.respondWith({ rooms: [] });
        const result = await manager.getRooms();
        expect(result).toEqual({ rooms: [] });
        transport.expectCalledWith("GET", "/_synapse/admin/v1/rooms");
    });
});
```

- [ ] **Step 1: Write RoomManager tests**

Target: 10+ tests covering `getRooms`, `getRoom`, `createRoom`, `joinRoom`, `leaveRoom`, `inviteUser`.

- [ ] **Step 2: Write ThreadingManager tests**

Target: 8+ tests covering `getThreads`, `getThread`, `createThread`, `getThreadMessages`.

- [ ] **Step 3: Write E2EEManager tests**

Target: 8+ tests covering `enableEncryption`, `disableEncryption`, `getEncryptionStatus`, `rotateKeys`.

- [ ] **Step 4: Write MediaManager tests**

Target: 6+ tests covering `uploadMedia`, `downloadMedia`, `getThumbnail`, `getMediaConfig`.

- [ ] **Step 5: Write OidcManager tests**

Target: 6+ tests covering `getOidcConfig`, `startOidcLogin`, `completeOidcLogin`, `refreshToken`.

- [ ] **Step 6: Verify all tests pass**

Run: `npx vitest run spec/unit/room-manager.spec.ts spec/unit/threading.spec.ts spec/unit/e2ee.spec.ts spec/unit/media.spec.ts spec/unit/oidc.spec.ts`
Expected: All 40+ tests pass

- [ ] **Step 7: Commit**

```bash
git add spec/unit/room-manager.spec.ts spec/unit/threading.spec.ts spec/unit/e2ee.spec.ts spec/unit/media.spec.ts spec/unit/oidc.spec.ts
git commit -m "test: add unit tests for RoomManager, ThreadingManager, E2EEManager, MediaManager, OidcManager

40+ new tests using FakeTransport. Backfill coverage for the 5 largest
previously-untested managers (~3,200 lines of production code now covered).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: Migrate remaining 67 files from authedRequest to this.request()

**Files:**
- Modify: ~67 files across `src/`

**Interfaces:**
- Consumes: `this.request()` from BaseManager (enabled by Task 1)
- Produces: Zero direct `this.client.http.authedRequest()` calls in any manager

After Task 3 migrates the top 10 files, ~67 smaller files remain (1-4 calls each). Batch-migrate them with a script.

- [ ] **Step 1: Script-assisted migration of remaining files**

Run a script to find and convert remaining `this.client.http.authedRequest` calls.

- [ ] **Step 2: Manual review of tricky cases**

Some files have complex patterns (multi-line calls, dynamic prefixes, error handling). Review each manually.

- [ ] **Step 3: Verify**

Run: `pnpm lint:types && pnpm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: migrate remaining 67 files from authedRequest to this.request()

Complete Candidate #1: zero direct HTTP calls remain in any manager.
All 77 files now use the this.request() transport seam.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Execution Order

Tasks are ordered for dependency chain:

1. **Task 1** — ManagerOpts propagation (enabler for Tasks 3, 5, 6)
2. **Task 2** — HttpManager deletion (independent quick win)
3. **Task 3** — Top 10 HTTP migration (depends on Task 1 for transport injection)
4. **Task 4** — Stray declaration fix (independent quick win)
5. **Task 5** — Test backfill (depends on Tasks 1, 3 for FakeTransport injectability)
6. **Task 6** — Remaining 67 files (depends on Task 1)
