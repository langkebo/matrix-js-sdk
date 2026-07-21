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
        // Manager extension module index files (from MANAGER_EXTENSION_MODULES in
        // manager-extensions/index.ts). These are dynamically imported via
        // `import("../<module>/index.js").then((m) => m?.extendMatrixClient())`
        // which knip cannot trace. Adding them as entry points prevents knip from
        // reporting ALL their exports (types, interfaces, functions) as unused.
        "src/admin/index.ts",
        "src/account/index.ts",
        "src/account-data/index.ts",
        "src/auth/index.ts",
        "src/capabilities/index.ts",
        "src/crypto-keys/index.ts",
        "src/key-verification/index.ts",
        "src/device-trust/index.ts",
        "src/discovery/index.ts",
        // global-logout is dynamically imported as `../auth/global-logout.js` (not `../global-logout/index.js`)
        "src/auth/global-logout.ts",
        "src/dm/index.ts",
        "src/guest/index.ts",
        "src/invite-blocklist/index.ts",
        "src/media/index.ts",
        "src/push/index.ts",
        "src/qr-login/index.ts",
        "src/room/index.ts",
        "src/room-key-sharing/index.ts",
        "src/room-summary/index.ts",
        "src/room-list/index.ts",
        "src/security/index.ts",
        "src/sticky-event/index.ts",
        "src/friend/index.ts",
        "src/space/index.ts",
        "src/sending/index.ts",
        "src/presence/index.ts",
        "src/federation/index.ts",
        "src/device/index.ts",
        "src/profile/index.ts",
        "src/secure-backup/index.ts",
        // Module name in MANAGER_EXTENSION_MODULES is "thirdparty" but the actual
        // directory is `third-party` (dynamic import: `../third-party/index.js`)
        "src/third-party/index.ts",
        "src/oidc/index.ts",
        "src/telemetry/index.ts",
        "src/rendezvous/index.ts",
        "src/typing/index.ts",
        "src/user/index.ts",
        "src/user-report/index.ts",
        // Module name in MANAGER_EXTENSION_MODULES is "threepids" but the actual
        // directory is `three-pids` (dynamic import: `../three-pids/index.js`)
        "src/three-pids/index.ts",
        "src/identity-server/index.ts",
        "src/password-reset/index.ts",
        "src/threading/index.ts",
        "src/state-send/index.ts",
        "src/relations/index.ts",
        "src/timeline/index.ts",
        "src/moderation/index.ts",
        "src/key-rotation/index.ts",
        "src/key-backup/index.ts",
        "src/feature-flags/index.ts",
        "src/event-report/index.ts",
        "src/burn-after-read/index.ts",
        "src/verification/index.ts",
        "src/e2ee/index.ts",
        "src/worker-body/index.ts",
        "src/ai-connection/index.ts",
        // Module name in MANAGER_EXTENSION_MODULES is "openclaw" but the actual
        // directory is `open-claw` (dynamic import: `../open-claw/index.js`)
        "src/open-claw/index.ts",
        "src/voice/index.ts",
        "src/cas/index.ts",
        "src/external-service/index.ts",
        "src/dehydrated-device/index.ts",
        "src/thread/index.ts",
        "src/widget/index.ts",
        "src/server-capabilities/index.ts",
        "src/sync-management/index.ts",
        "src/filter/index.ts",
        "src/to-device/index.ts",
        "src/turn-server/index.ts",
        "src/search/index.ts",
        "src/reporting/index.ts",
        "src/read-receipts/index.ts",
        "src/notifications/index.ts",
        "src/crypto-backup/index.ts",
        "src/tags-management/index.ts",
        "src/secret-storage/index.ts",
        "src/cross-signing/index.ts",
        "src/room-settings/index.ts",
        "src/room-state/index.ts",
        "src/server-time/index.ts",
        "src/voip-calls/index.ts",
        "src/room-account-data/index.ts",
        "src/background-update/index.ts",
        "src/user-directory/index.ts",
        // Additional manager modules with extendMatrixClient but not yet wired
        // into manager-extensions/index.ts MANAGER_EXTENSION_MODULES list:
        "src/event/index.ts",
        "src/invite-list/index.ts",
        "src/widgets/index.ts",
        // Public API modules consumed externally (by hula frontend) but not
        // dynamically imported; knip can't trace external usage:
        "src/error/index.ts",
        // Non-module files with public API exports not consumed internally:
        "src/@types/errors.ts",
        "src/@types/extensible_events.ts",
        "src/@types/synapse.ts",
        "src/admin/admin-base-manager.ts",
        "src/admin/sub-managers/admin-user-types.ts",
        "src/admin/sub-managers/admin-config-types.ts",
        "src/admin/sub-managers/admin-server-types.ts",
        "src/admin/utils.ts",
        "src/client-crypto-requests.ts",
        "src/client-profile-requests.ts",
        "src/client-room-access.ts",
        "src/client-room-discovery-requests.ts",
        "src/client-send-message.ts",
        "src/event/EventManager.ts",
        "src/matrix-client-extensions.ts",
        "src/web-rtc/groupCall.ts",
        "src/web-rtc/stats/media/mediaTrackStats.ts",
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
        // Used by `vitest` (referenced as string in vitest.config.ts reporters array)
        "vitest-sonar-reporter",
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
