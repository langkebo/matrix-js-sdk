import { KnipConfig } from "knip";

export default {
    entry: [
        "src/index.ts",
        "src/types.ts",
        "src/browser-index.ts",
        "src/indexeddb-worker.ts",
        "src/crypto-api/index.ts",
        "src/testing.ts",
        "src/matrix.ts",
        "src/utils.ts", // not really an entrypoint but we have deprecated `defer` there
        "scripts/**",
        "spec/**",
        // Manager extensions: dynamically imports `extendMatrixClient` from every manager index
        // (via `import("../<module>/index.js").then((m) => m?.extendMatrixClient())`).
        // Without this entry, knip reports every `extendMatrixClient` export as unused.
        "src/manager-extensions/index.ts",
        // Module index files that export extendMatrixClient but are not yet wired into
        // manager-extensions/index.ts (older modules pending migration). Treating them
        // as entry points prevents knip from reporting their extendMatrixClient as unused.
        "src/aggregations/index.ts",
        "src/beacon/index.ts",
        "src/captcha/index.ts",
        "src/crypto-encryption/index.ts",
        "src/crypto-store/index.ts",
        "src/device-keys/index.ts",
        "src/directory/index.ts",
        "src/ephemeral/index.ts",
        "src/event-processing/index.ts",
        "src/event-status/index.ts",
        "src/identity/index.ts",
        "src/invites/index.ts",
        "src/key-forwarding/index.ts",
        "src/lifecycle/index.ts",
        "src/media-quota/index.ts",
        "src/membership/index.ts",
        "src/pinned-messages/index.ts",
        "src/push-notifications/index.ts",
        "src/push-rules/index.ts",
        "src/reactions/index.ts",
        "src/retention/index.ts",
        "src/room-creation/index.ts",
        "src/room-events/index.ts",
        "src/room-joining/index.ts",
        "src/room-keys/index.ts",
        "src/room-member/index.ts",
        "src/room-state-management/index.ts",
        "src/room-upgrades/index.ts",
        "src/saml/index.ts",
        "src/scheduled-events/index.ts",
        "src/sending-queue/index.ts",
        "src/session/index.ts",
        "src/sessions/index.ts",
        "src/sync-accumulator/index.ts",
        "src/token-management/index.ts",
        "src/uploads/index.ts",
        "src/user-presence/index.ts",
        // Public package entry points (declared in package.json `exports`):
        // knip doesn't parse package.json exports, so list them explicitly.
        "src/core.ts",
        "src/advanced.ts",
        "src/legacy.ts",
        // Vitest configs invoked via CLI `--config` flag (not statically imported):
        "vitest.real-backend.config.ts",
        // XXX: these should be re-exported by one of the supported exports
        "src/sliding-sync.ts",
        "src/rendezvous/RendezvousChannel.ts",
    ],
    project: ["**/*.{js,ts}"],
    // Codegen outputs are validated by `pnpm contract:codegen:check`, not knip.
    // They are auto-regenerated from docs/api-contract/generated/ manifests.
    ignore: ["examples/**", "src/**/__generated__/**"],
    ignoreDependencies: [
        // Required for `action-validator`
        "@action-validator/*",
        // Used for git pre-commit hooks
        "husky",
        // Used in script which only runs in environment with `@octokit/rest` installed
        "@octokit/rest",
        // Used by `vitest`
        // ESLint plugins referenced in eslint.config.mjs (knip doesn't parse ESLint config):
        "@babel/eslint-parser",
        "@babel/eslint-plugin",
        "@stylistic/eslint-plugin",
        "@typescript-eslint/parser",
        // Type assertion library used in spec/ via `import { expectType } from "expect-type"`
        // (knip misses it because the import is side-effect-only in some test files)
        "expect-type",
        // CLI tool invoked by `pnpm quality:type-coverage` (not a runtime import)
        "type-coverage",
        // Used in eslint.config.mjs (ESLint globals preset)
        "globals",
    ],
    ignoreBinaries: [
        // Used when available by reusable workflow `.github/workflows/release-make.yml`
        "dist",
    ],
    ignoreExportsUsedInFile: true,
    includeEntryExports: false,
    exclude: ["enumMembers"],
} satisfies KnipConfig;
