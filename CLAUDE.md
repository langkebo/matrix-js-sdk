# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a fork of matrix-js-sdk customized for the TJG project (formerly HuLa), implementing the Matrix Client-Server protocol with additional features for friend management, direct messaging, spaces, and admin operations. The SDK supports both browser and Node.js environments and includes Rust-based end-to-end encryption via WebAssembly.

## Build and Development Commands

### Installation

```bash
pnpm install
```

### Build

```bash
pnpm build                 # Full build (clean + compile + types)
pnpm build:compile         # Compile TypeScript to JavaScript (Babel)
pnpm build:types          # Generate type declarations only
pnpm clean                # Remove lib/ directory
```

### Testing

```bash
pnpm test                                    # Run all unit/integration tests (excludes real-backend)
pnpm test:watch                              # Run tests in watch mode
pnpm coverage                                # Generate coverage report

# Run a single test file
npx vitest run spec/unit/matrix-client.spec.ts

# Real-backend tests (requires synapse-rust running at https://matrix.test + PostgreSQL)
pnpm test:real-backend                       # Full batch: smoke → setup → batch
pnpm test:real-backend:batch                 # Batch only (no setup)
pnpm test:real-backend:setup                 # Ensure test users exist
pnpm test:real-backend:verification          # Key verification tests only
pnpm test:real-backend:device                # Device management tests
pnpm run test:real-backend:tsx -- spec/integ/real-backend/step1-account.test.ts
pnpm run test:real-backend:batch -- spec/integ/real-backend/device-manager.spec.ts

# Performance tests
pnpm test:perf                               # Run performance benchmarks
pnpm perf:ci                                 # CI performance check
pnpm perf:baseline                           # Generate performance baseline
pnpm perf:compare                            # Compare against baseline

# IMPORTANT: Do NOT run vitest directly against spec/integ/real-backend/ —
# that tree contains both Vitest suites and standalone tsx scripts.
# Use test:real-backend or test:real-backend:batch instead.
```

### Linting

```bash
pnpm lint                  # All linters (types + js + workflows + quality gates)
pnpm lint:js              # ESLint + Prettier check
pnpm lint:js-fix          # Auto-fix linting issues
pnpm lint:types           # tsc --noEmit
pnpm lint:workflows       # Validate GitHub Actions workflows
```

### Contract & Quality Checks (CI gates)

```bash
pnpm contract:sync                    # Sync route manifests from docs/api-contract/generated/
pnpm contract:check                   # Verify contract docs are in sync
pnpm contract:codegen                 # Regenerate __generated__ route tables from contract manifests
pnpm contract:codegen:check           # Verify generated route tables match manifests (CI gate)
pnpm quality:contracts                # Run all 7 contract quality gates
pnpm quality:report                   # Full quality report
pnpm quality:type-coverage            # Check type coverage (no new `any` regressions)
pnpm quality:swallow-fallbacks        # Detect empty catch blocks
pnpm quality:debt-markers             # Scan for technical debt markers
```

### Documentation

```bash
pnpm gendoc               # Generate TypeDoc API documentation
cd docs && python -m http.server 8005  # Serve docs locally
```

## Architecture

### Contract-Driven SDK (Ledger System)

The SDK uses a **contract-driven architecture** where the backend's route manifest serves as the single source of truth:

1. **Backend ledger**: synapse-rust exports every `(method, path, registered_by)` tuple via `declared_route_manifest_for()`.
2. **Contract sync**: `scripts/contract-sync.mjs` reads the ledger and writes per-module machine manifests to `docs/api-contract/generated/modules/<module>.json`.
3. **Codegen**: `scripts/sdk-contract-codegen.mjs` reads those manifests and generates TypeScript route tables + DTOs into `src/<module>/__generated__/` (e.g. `src/admin/__generated__/route-table.ts`, `dto.ts`, `contract-assertions.ts`).
4. **Compile-time safety**: Managers import the generated route tables, making path/method strings literal-typed — a typo is a compile error, not a runtime 404.

The CI gate `contract:codegen:check` ensures generated files stay in sync with the manifests. When adding or changing API methods, run `pnpm contract:sync && pnpm contract:codegen` and commit the generated output.

### Client Architecture

**MatrixClient** (`src/client.ts`) is the main entry point. Its implementation has been decomposed into ~60+ focused modules under `src/client-*.ts`:

| Pattern                                       | Purpose                | Examples                                                                |
| --------------------------------------------- | ---------------------- | ----------------------------------------------------------------------- |
| `client-send-*.ts`                            | Event sending pipeline | `client-send-event.ts`, `client-send-message.ts`, `client-send-http.ts` |
| `client-*-requests.ts`                        | API request methods    | `client-room-management-requests.ts`, `client-profile-requests.ts`      |
| `client-*-core.ts`                            | Core logic             | `client-relations-core.ts`, `client-profile-core.ts`                    |
| `client-auth.ts`, `client-crypto-requests.ts` | Auth and crypto        |                                                                         |

**Manager infrastructure** lives in `src/client-infra/`:

- `manager-registry.ts` — centralized manager registration (104 managers)
- `request-context.ts` — shared request context types

### Manager Pattern

Domain-specific managers handle specialized operations. Each manager is registered on MatrixClient and accessible via `client.get<Name>Manager()`:

- `AdminManager`, `AuthManager`, `DirectMessageManager`, `FriendManager`, `SpaceManager`, `DeviceManager`, `KeyVerificationManager`, `PresenceManager`, `PushManager`
- `CasManager`, `ExternalServiceManager`, `DehydratedDeviceManager`, `EventReportManager`, `FeatureFlagManager`, `ModerationManager`

**Manager Extensions** (`src/manager-extensions/index.ts`): unified initialization entry point. Call `extendMatrixClientWithManagers()` to register all managers, or selectively with `ManagerExtensionsOptions`.

**Admin Sub-Managers** (`src/admin/sub-managers/`): the admin domain is further decomposed into focused sub-managers:

- `AdminUserManager`, `AdminRoomManager`, `AdminServerManager`, `AdminFederationManager`, `AdminMediaManager`, `AdminConfigManager`

### Module Organization and Entry Points

The SDK has multiple entry points defined in `package.json` exports:

- `matrix-js-sdk` — main entry (client, models, stores)
- `matrix-js-sdk/crypto` — cryptography API (Rust WASM)
- `matrix-js-sdk/friend` — friend management
- `matrix-js-sdk/dm` — direct messaging
- `matrix-js-sdk/space` — space hierarchy
- `matrix-js-sdk/admin` — admin operations
- `matrix-js-sdk/push` — push notifications
- `matrix-js-sdk/webrtc` — WebRTC calling
- `matrix-js-sdk/http-api` — HTTP client utilities
- `matrix-js-sdk/models` — core data models
- `matrix-js-sdk/store` — storage implementations

Each module may have an `__generated__/` directory containing codegen output (route tables, DTOs, contract assertions). Never hand-edit these files.

### Crypto Implementation

End-to-end encryption uses Rust crypto via `@matrix-org/matrix-sdk-crypto-wasm`:

```typescript
await matrixClient.initRustCrypto();
const crypto = matrixClient.getCrypto();
await crypto.bootstrapSecretStorage({ ... });
await crypto.bootstrapCrossSigning({ ... });
```

**Always use `initRustCrypto()`**. The legacy `initLegacyCrypto()` is deprecated.

### Storage

- **MemoryStore**: default in-memory (no persistence)
- **IndexedDBStore**: browser persistent storage
- **IndexedDBCryptoStore**: crypto data (browser)
- **LocalStorageCryptoStore**: fallback crypto storage
- **TTL & capacity**: `src/store/ttl.ts` (per-key deadline TTL, aligned with the backend's `CacheTtl`) and `src/store/capacity.ts` (unified capacity budget + `LruMap` eviction) govern bounded storage; `src/store/pending-events-cipher.ts` AES-GCM-encrypts the pending-event queue before persistence.

## Real Backend Testing

Real backend tests run against an actual synapse-rust server with PostgreSQL database verification.

**Prerequisites**: synapse-rust running at `https://matrix.test`, PostgreSQL accessible, SDK built.

**CA trust**: for self-signed certs, the test runner auto-injects trust from `NODE_EXTRA_CA_CERTS`, `MATRIX_REAL_BACKEND_CA_CERT`, the fetched leaf certificate, or local mkcert root CA.

Test config lives in `spec/integ/real-backend/TestConfig.ts`. See `docs/SDK真实服务器测试方案.md` for comprehensive documentation.

## Code Conventions

### TypeScript

- Target: ES2022, Module: preserve (ESM), Strict mode, Node.js v22+
- Avoid `any`. Use explicit interfaces and generics.
- Replace `Record<string, unknown>` with specific typed interfaces.
- Mark deprecated methods with `@deprecated` and provide migration paths. Keep deprecated methods working for at least 2 minor versions.

### Error Handling

- Never use empty catch blocks. Always log errors.
- Use typed errors: `ValidationError`, `AuthError`, `NotFoundError`, `ApiError`.
- Validate all user inputs with `AdminValidators` (user IDs, room IDs, limits).

### API Design

- Consistent camelCase naming, unified `PaginatedResponse<T>` pagination format.
- Add `@example` and `@throws` to all public methods.

### Generated Code

- `src/<module>/__generated__/` directories contain auto-generated route tables, DTOs, and contract assertions.
- Never hand-edit `__generated__` files — they are regenerated by `pnpm contract:codegen`.
- The CI gate `pnpm contract:codegen:check` ensures generated files match the contract manifests.

## Common Pitfalls

1. **Don't use legacy crypto**: always `initRustCrypto()`, never `initLegacyCrypto()`.
2. **Real backend tests excluded by default**: use `vitest.real-backend.config.ts` or the `test:real-backend` scripts.
3. **Multiple entrypoints**: import from the correct entry point (e.g. `matrix-js-sdk/admin`, not deep paths).
4. **Crypto is not thread-safe**: only one MatrixClient instance per IndexedDB.
5. **Don't hand-edit `__generated__/` files**: they're regenerated by `pnpm contract:codegen`.
6. **Run contract sync after API changes**: `pnpm contract:sync && pnpm contract:codegen`, then commit the generated output.
7. **Empty catch blocks are forbidden**: log errors explicitly — `quality:swallow-fallbacks` catches violations in CI.
8. **Async managers mount after `createClient`**: `createClient` returns synchronously; ~55 private managers register asynchronously. Await `client.whenManagerExtensionsReady()` before calling `get<Name>Manager()` on a non-core manager, or you'll hit `TypeError: not a function`.
9. **Private endpoints use the vendor prefix**: non-standard endpoints go under `/_matrix/vendor/v1` (`src/http-api/prefix.ts`, ISSUE-13); don't pollute `/_matrix/client/{r0,v1,v3}` with private routes — `check-vendor-prefix-migration.mjs` enforces the whitelist.

## API Contract Documentation

`docs/api-contract/` tracks API implementation status:

- `docs/api-contract/generated/modules/` — per-module machine manifests (auto-generated by contract-sync)
- `docs/api-contract/generated/route-manifest.default.json` — full route manifest
- Per-module docs: `auth.md`, `room.md`, `dm.md`, `friend.md`, `space.md`, `admin.md`, `sync.md`, `push.md`

## Testing Philosophy

- Unit tests mock external dependencies.
- Integration tests use mock servers (`matrix-mock-request`).
- Real backend tests verify against actual synapse-rust with database validation.
- Tests should verify both API responses AND database state for critical operations.
