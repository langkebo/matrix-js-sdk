# matrix-js-sdk Migration Guide

## 2026Q2 systemic refactor track

This guide captures compatibility-preserving migrations introduced by the 2026Q2 systemic refactor workstream.

## Entrypoint layering

New entrypoints are available to align imports with the refactor layering goals:

| Entrypoint               | When to use                                                         |
| ------------------------ | ------------------------------------------------------------------- |
| `matrix-js-sdk/core`     | Default recommendation for new integrations (curated export set)    |
| `matrix-js-sdk/advanced` | Explicit opt-in for feature-heavy integrations (curated export set) |
| `matrix-js-sdk/legacy`   | Compatibility entrypoint for deprecated shims                       |

## Scenario-based onboarding (max 3 paths)

Use a single primary entrypoint per integration and choose from the three paths below:

| Integration scenario                        | Primary entrypoint       | Typical imports                                                                       |
| ------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------- |
| Basic client lifecycle and event handling   | `matrix-js-sdk/core`     | `createClient`, `MatrixClient`, `ClientEvent`, `MatrixError`                          |
| Feature-heavy integrations (admin/dm/space) | `matrix-js-sdk/advanced` | `AdminManager`, `DirectMessageManager`, `SpaceManager`, `RoomSummaryManager`          |
| Legacy migration shim only                  | `matrix-js-sdk/legacy`   | `LegacyFilterManager`, `LegacyFilterEvent`, `IFilterManagerDefinition`, `IFilterInfo` |

### Recommended import policy

1. Prefer `matrix-js-sdk/core` for all new integrations.
2. Upgrade to `matrix-js-sdk/advanced` only when manager-heavy domains are required.
3. Keep `matrix-js-sdk/legacy` temporary and migration-scoped.
4. Run `pnpm quality:contracts` after import-path migration to verify export contract consistency.

### Quick examples

Core path:

```ts
import { ClientEvent, createClient } from "matrix-js-sdk/core";
```

Advanced path:

```ts
import { DirectMessageManager, createClient } from "matrix-js-sdk/advanced";
```

Legacy path:

```ts
import { LegacyFilterManager } from "matrix-js-sdk/legacy";
```

### Module-level migration examples

| Module/use case             | Before migration                   | Recommended import       |
| --------------------------- | ---------------------------------- | ------------------------ |
| Base client bootstrap       | `matrix-js-sdk`                    | `matrix-js-sdk/core`     |
| Direct messaging manager    | `matrix-js-sdk/dm`                 | `matrix-js-sdk/advanced` |
| Friend relationship manager | `matrix-js-sdk/friend`             | `matrix-js-sdk/advanced` |
| Space hierarchy manager     | `matrix-js-sdk/space`              | `matrix-js-sdk/advanced` |
| Admin operations manager    | `matrix-js-sdk/admin`              | `matrix-js-sdk/advanced` |
| Legacy filter compatibility | `matrix-js-sdk/src/filter-manager` | `matrix-js-sdk/legacy`   |

Core-focused integration:

```ts
import { ClientEvent, MatrixClient, createClient } from "matrix-js-sdk/core";
```

Advanced manager integration:

```ts
import { DirectMessageManager, FriendManager, SpaceManager, createClient } from "matrix-js-sdk/advanced";
```

Legacy shim migration:

```ts
import { LegacyFilterEvent, LegacyFilterManager } from "matrix-js-sdk/legacy";
```

## Legacy filter manager path

The `filter-manager` path is now a deprecated compatibility layer. The canonical implementation lives in `filter/index.ts` and is re-exported from the main SDK entrypoint.

| Legacy import                                                    | Recommended import                                | Compatibility note                                                         |
| ---------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------- |
| `matrix-js-sdk/src/filter-manager` -> `FilterManager`            | `matrix-js-sdk` -> `FilterManager`                | Canonical manager, long-term supported                                     |
| `matrix-js-sdk/src/filter-manager` -> `FilterManager`            | `matrix-js-sdk` -> `LegacyFilterManager`          | Transitional alias for consumers that still need the legacy helper surface |
| `matrix-js-sdk/src/filter-manager` -> `IFilterManagerDefinition` | `matrix-js-sdk/src/filter` -> `IFilterDefinition` | Type-only rename; payload shape is unchanged                               |
| `matrix-js-sdk/src/filter-manager` -> `createFilterDefinition()` | inline `IFilterDefinition` object                 | Helper remains available but is deprecated                                 |

### Behavioral notes

- `LegacyFilterManager#getFilter()` now returns `null` only for `404 / M_NOT_FOUND`.
- Non-404 failures now throw normalized SDK errors instead of being silently swallowed.
- `LegacyFilterManager` remains available for at least the current refactor cycle and should be treated as a migration shim, not a long-term API.

## Main entrypoint aliases

The main entrypoint now exposes:

- `FilterManager`: canonical implementation from `src/filter/index.ts`
- `LegacyFilterManager`: deprecated compatibility wrapper from `src/filter-manager/index.ts`

### Main entrypoint alias mapping

| Deprecated entrypoint export                  | Recommended replacement                                                     | Notes                                                |
| --------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------- |
| `matrix-js-sdk` -> `LegacyFilterManager`      | `matrix-js-sdk` -> `FilterManager`                                          | Prefer the canonical implementation for all new code |
| `matrix-js-sdk` -> `IFilterManagerDefinition` | `matrix-js-sdk/src/filter` -> `IFilterDefinition`                           | Type-only rename; runtime shape is unchanged         |
| `matrix-js-sdk` -> `IFilterInfo`              | `matrix-js-sdk` -> `LegacyFilterManager` return types only during migration | Keep only while migrating legacy cache helpers       |
| `matrix-js-sdk` -> `IFilterManagerResponse`   | `matrix-js-sdk` -> `FilterManager#createFilter()` return shape              | Use the canonical manager contract going forward     |
| `matrix-js-sdk` -> `LegacyFilterEvent`        | `matrix-js-sdk/src/filter-manager` -> `FilterEvent`                         | Legacy event enum remains for staged migration only  |
| `matrix-js-sdk` -> `createFilterDefinition()` | inline `IFilterDefinition` object                                           | Preferred for new code; helper is deprecated         |

### Code examples

Replace deprecated main-entrypoint aliases:

```ts
import { LegacyFilterManager, createFilterDefinition, type IFilterManagerDefinition } from "matrix-js-sdk";
```

with:

```ts
import { FilterManager } from "matrix-js-sdk";
import type { IFilterDefinition } from "matrix-js-sdk/src/filter";

const definition: IFilterDefinition = {
    room: {
        timeline: {
            limit: 50,
        },
    },
};
```

Replace legacy path imports:

```ts
import { FilterManager } from "matrix-js-sdk/src/filter-manager";
```

with:

```ts
import { FilterManager } from "matrix-js-sdk";
```

## Recommended migration steps

1. Replace legacy imports with `FilterManager` from the main SDK entrypoint.
2. Replace `IFilterManagerDefinition` with `IFilterDefinition`.
3. Remove reliance on non-404 fallback behavior from `LegacyFilterManager#getFilter()`.
4. Keep legacy aliases only where staged migration is required.

## Error semantics migration

Manager APIs are now aligned on `BaseManager` error normalization semantics.

### Normalized error classes

- `AuthError`: authentication/authorization failures (`401`, `M_UNKNOWN_TOKEN`)
- `NotFoundError`: resource not found (`404`, `M_NOT_FOUND`)
- `RetryableError`: retryable transport/server/rate-limit failures (`429`, `5xx`, network transient)
- `ApiError`: all other API failures with stable `code` + `statusCode`

### Consumer migration checklist

1. Catch `SdkError` subclasses instead of parsing raw HTTP payloads.
2. Replace ad-hoc status-code branching with class-based branching (`instanceof`).
3. Treat `RetryableError` as unified retry signal across managers.
4. Keep fallback handling only for explicitly documented internal-only managers.

### Example

```ts
import { ApiError, AuthError, NotFoundError, RetryableError } from "matrix-js-sdk";

try {
    await client.getToDeviceManager().sendToDevice(eventType, messages);
} catch (error) {
    if (error instanceof AuthError) {
    } else if (error instanceof RetryableError) {
    } else if (error instanceof NotFoundError) {
    } else if (error instanceof ApiError) {
    } else {
        throw error;
    }
}
```

## Manager extensions lifecycle contract

The manager extension system now supports a stable runtime contract for dynamic initialization.

### Initialization mode

- Default mode: `createClient()` and `createRoomWidgetClient()` auto-initialize manager extensions.
- Opt-out mode: pass `disableDynamicExtensions: true` in `ICreateClientOpts` to skip dynamic extension initialization.

```ts
import { createClient } from "matrix-js-sdk";

const client = createClient({
    baseUrl: "https://example.com",
    accessToken: "token",
    userId: "@alice:example.com",
    disableDynamicExtensions: true,
});
```

### Lifecycle events

The main entrypoint exports lifecycle subscription APIs:

- `onManagerExtensionsLifecycle(listener)`
- `offManagerExtensionsLifecycle(listener)`

Event shape:

- `phase`: `register | init | start | stop`
- `status`: `begin | success | error`
- `modules`: enabled manager extension module names
- `error`: populated when `status === "error"`

```ts
import { onManagerExtensionsLifecycle, createClient } from "matrix-js-sdk";

const unsubscribe = onManagerExtensionsLifecycle((event) => {
    if (event.phase === "init" && event.status === "error") {
        throw event.error;
    }
});

createClient({
    baseUrl: "https://example.com",
    accessToken: "token",
    userId: "@alice:example.com",
});

unsubscribe();
```
