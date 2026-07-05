# Split src/utils.ts into Domain-Coherent Utility Modules

> **For agentic workers:** Execute tasks sequentially in this session. Each task is independently testable with `pnpm build:types && pnpm test`.

**Goal:** Split the 775-line `src/utils.ts` (44 exported symbols) into 5 domain-coherent modules under `src/common/`, delete 3 dead exports, and update ~98 importers.

**Architecture:** Extract functions grouped by responsibility — async primitives, string manipulation, collection utilities, safety/type guards. HTTP functions move into existing `src/http-api/utils.ts`. `src/utils.ts` becomes a backward-compatible re-export barrel during migration.

**Tech Stack:** TypeScript, Vitest, pnpm

## Global Constraints

- `pnpm build:types` must pass with zero errors after each task
- `pnpm test` must pass with zero failures after each task
- `pnpm lint:js` must pass (no new warnings)
- All existing re-export paths in `src/utils.ts` remain working throughout migration
- `src/common/` directory already exists with `errors.ts`, `pagination.ts`, `validators.ts`

---

## File Structure

| New file | Contents | ~Importers |
|---|---|---|
| `src/common/async.ts` | `sleep`, `logDuration`, `logDurationSync`, `promiseMapSeries`, `promiseTry`, `simpleRetryOperation` | 60+ (sleep alone has 26) |
| `src/common/strings.ts` | `internaliseString`, `escapeRegExp`, `globToRegexp`, `removeHiddenChars`, `removeDirectionOverrideChars`, `normalize`, `DEFAULT_ALPHABET`, `alphabetPad`, `baseToString`, `stringToBase`, `averageBetweenStrings`, `nextString`, `prevString`, `lexicographicCompare` | 10+ |
| `src/common/collections.ts` | `removeElement`, `deepCopy`, `deepCompare`, `deepSortedObjectEntries`, `recursiveMapToObject`, `mapsEqual`, `MapWithDefault` (class) | 15+ |
| `src/common/safety.ts` | `checkObjectHasKeys`, `safeSet`, `unsafeProp`, `noUnsafeEventProps`, `isNullOrUndefined`, `isNumber`, `isSupportedReceiptType`, `sortEventsByLatestContentTimestamp`, `recursivelyAssign` | 10+ |
| Merge into `src/http-api/utils.ts` | `encodeParams`, `encodeUri`, `replaceParam`, `ensureNoTrailingSlash`, `QueryDict` (type) | 40+ |

**Dead exports to delete:** `decodeParams`, `isFunction`, `chunkPromises`

**`src/utils.ts`** becomes a pure re-export barrel.

---

### Task 1: Create src/common/async.ts

**Files:**
- Create: `src/common/async.ts`
- Modify: `src/utils.ts` (add re-exports from common/async)
- Test: `spec/unit/utils.spec.ts` (no changes needed — tests use `import * as utils`)

**Interfaces:**
- Produces: `sleep(ms, value?)`, `logDuration(logger, name, block)`, `logDurationSync(logger, name, block)`, `promiseMapSeries(promises, fn)`, `promiseTry(fn)`, `simpleRetryOperation(promiseFn, shouldRetry?)`

- [ ] **Step 1: Create `src/common/async.ts`**

Extract from `src/utils.ts` lines 21-25 (imports), 397-490 (functions). Copy the functions and their imports:

```typescript
import promiseRetry from "p-retry";
import { type BaseLogger } from "../logger";

export function sleep<T>(ms: number, value?: T): Promise<T> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms, value);
    });
}

export async function logDuration<T>(logger: BaseLogger, name: string, block: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
        return await block();
    } finally {
        const end = Date.now();
        logger.debug(`[Perf]: ${name} took ${end - start}ms`);
    }
}

export function logDurationSync<T>(logger: BaseLogger, name: string, block: () => T): T {
    const start = Date.now();
    try {
        return block();
    } finally {
        const end = Date.now();
        logger.debug(`[Perf]: ${name} took ${end - start}ms`);
    }
}

export async function promiseMapSeries<T>(
    promises: Array<T | Promise<T>>,
    fn: (t: T) => Promise<unknown> | undefined,
): Promise<void> {
    for (const o of promises) {
        await fn(await o);
    }
}

export function promiseTry<T>(fn: () => T | Promise<T>): Promise<T> {
    return Promise.resolve(fn());
}

export function simpleRetryOperation<T>(
    promiseFn: (attempt: number) => Promise<T>,
    shouldRetry?: (e: unknown) => boolean,
): Promise<T> {
    return promiseRetry(
        (attempt: number) => {
            return promiseFn(attempt);
        },
        {
            retries: Infinity,
            shouldRetry: shouldRetry ? ({ error }): boolean => shouldRetry(error) : undefined,
            factor: 2,
            minTimeout: 3000,
            maxTimeout: 15000,
        },
    );
}
```

- [ ] **Step 2: Update `src/utils.ts` to re-export from common/async**

Remove the extracted functions from `src/utils.ts` (lines 21-25 import section stays, but remove `p-retry` and `BaseLogger` if no longer needed). Add re-export:

```typescript
export { sleep, logDuration, logDurationSync, promiseMapSeries, promiseTry, simpleRetryOperation } from "./common/async";
```

Keep `p-retry` import and `BaseLogger` import in utils.ts for now — other functions may depend on them.

- [ ] **Step 3: Verify build and tests**

```bash
pnpm build:types && pnpm test -- --reporter=verbose 2>&1 | tail -20
```

- [ ] **Step 4: Commit**

```bash
git add src/common/async.ts src/utils.ts
git commit -m "refactor: extract async utilities to src/common/async.ts"
```

---

### Task 2: Create src/common/strings.ts

**Files:**
- Create: `src/common/strings.ts`
- Modify: `src/utils.ts` (add re-exports)

**Interfaces:**
- Produces: `internaliseString`, `escapeRegExp`, `globToRegexp`, `removeHiddenChars`, `removeDirectionOverrideChars`, `normalize`, `DEFAULT_ALPHABET`, `alphabetPad`, `baseToString`, `stringToBase`, `averageBetweenStrings`, `nextString`, `prevString`, `lexicographicCompare`

- [ ] **Step 1: Create `src/common/strings.ts`**

Extract from `src/utils.ts` lines 27-657 (interns map through lexicographicCompare). Include the `interns` module-level Map and `removeHiddenCharsRegex` constant.

- [ ] **Step 2: Update `src/utils.ts` to re-export from common/strings**

Remove extracted code. Add re-export line.

- [ ] **Step 3: Verify build and tests**

```bash
pnpm build:types && pnpm test -- --reporter=verbose 2>&1 | tail -20
```

- [ ] **Step 4: Commit**

```bash
git add src/common/strings.ts src/utils.ts
git commit -m "refactor: extract string utilities to src/common/strings.ts"
```

---

### Task 3: Create src/common/collections.ts

**Files:**
- Create: `src/common/collections.ts`
- Modify: `src/utils.ts` (add re-exports)

**Interfaces:**
- Produces: `removeElement`, `deepCopy`, `deepCompare`, `deepSortedObjectEntries`, `recursiveMapToObject`, `mapsEqual`, `MapWithDefault` (class)

- [ ] **Step 1: Create `src/common/collections.ts`**

Extract from `src/utils.ts` lines 139-157, 189-311, 697-775.

- [ ] **Step 2: Update `src/utils.ts` to re-export from common/collections**

Remove extracted code. Add re-export line.

- [ ] **Step 3: Verify build and tests**

```bash
pnpm build:types && pnpm test -- --reporter=verbose 2>&1 | tail -20
```

- [ ] **Step 4: Commit**

```bash
git add src/common/collections.ts src/utils.ts
git commit -m "refactor: extract collection utilities to src/common/collections.ts"
```

---

### Task 4: Create src/common/safety.ts

**Files:**
- Create: `src/common/safety.ts`
- Modify: `src/utils.ts` (add re-exports)

**Interfaces:**
- Produces: `checkObjectHasKeys`, `safeSet`, `unsafeProp`, `noUnsafeEventProps`, `isNullOrUndefined`, `isNumber`, `isSupportedReceiptType`, `sortEventsByLatestContentTimestamp`, `recursivelyAssign`

- [ ] **Step 1: Create `src/common/safety.ts`**

Extract from `src/utils.ts` lines 174-181, 319-322, 437-439, 665-756. Add imports for `MatrixEvent`, `IEvent`, `ReceiptType` from their modules.

- [ ] **Step 2: Update `src/utils.ts` to re-export from common/safety**

Remove extracted code. Add re-export line.

- [ ] **Step 3: Verify build and tests**

```bash
pnpm build:types && pnpm test -- --reporter=verbose 2>&1 | tail -20
```

- [ ] **Step 4: Commit**

```bash
git add src/common/safety.ts src/utils.ts
git commit -m "refactor: extract safety/type-guard utilities to src/common/safety.ts"
```

---

### Task 5: Move HTTP functions to src/http-api/utils.ts + delete dead code

**Files:**
- Modify: `src/http-api/utils.ts` (add encodeParams, encodeUri, replaceParam, ensureNoTrailingSlash, QueryDict)
- Modify: `src/utils.ts` (remove HTTP functions, remove dead exports, add re-exports)

**Interfaces:**
- Produces: `encodeParams`, `encodeUri`, `replaceParam`, `ensureNoTrailingSlash`, `QueryDict` (now exported from http-api/utils.ts)

- [ ] **Step 1: Add HTTP functions to `src/http-api/utils.ts`**

Append `encodeParams`, `QueryDict` type, `replaceParam`, `encodeUri`, `ensureNoTrailingSlash` to the end of `src/http-api/utils.ts`. Update the internal `sleep` import — it already imports `sleep` from `../utils`, which will still re-export it.

- [ ] **Step 2: Remove 3 dead exports from `src/utils.ts`**

Delete `decodeParams` (lines 97-105), `isFunction` (lines 164-166), `chunkPromises` (lines 455-461).

- [ ] **Step 3: Update `src/utils.ts` to re-export HTTP functions from http-api/utils**

Add re-export line.

- [ ] **Step 4: Verify build and tests**

```bash
pnpm build:types && pnpm test -- --reporter=verbose 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git add src/http-api/utils.ts src/utils.ts
git commit -m "refactor: move HTTP utilities to http-api/utils.ts, remove 3 dead exports"
```

---

### Task 6: Update ~98 importers to use new module paths

**Files:**
- Modify: 58 files importing from `../utils`
- Modify: 40 files importing from `./utils`

**Strategy:** Run a script to rewrite imports. Each `import { X } from "Y/utils"` becomes `import { X } from "Y/common/async"` etc. based on which functions are imported.

- [ ] **Step 1: Run import migration script**

For each file importing from `../utils` or `./utils`, parse the import statement, classify each imported symbol into its new module, and rewrite into multiple imports.

- [ ] **Step 2: Update `src/http-api/utils.ts` internal import**

Change `import { sleep } from "../utils"` → `import { sleep } from "../common/async"`.

- [ ] **Step 3: Verify build and tests**

```bash
pnpm build:types && pnpm test -- --reporter=verbose 2>&1 | tail -20
```

- [ ] **Step 4: Update spec/unit/utils.spec.ts imports**

Update to import from new module locations.

- [ ] **Step 5: Final verification**

```bash
pnpm build:types && pnpm test && pnpm lint:js
```

- [ ] **Step 6: Commit**

```bash
git add src/ spec/
git commit -m "refactor: update all importers to use domain-specific utility modules"
```
