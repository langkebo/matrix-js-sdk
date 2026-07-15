#!/usr/bin/env node

/**
 * Codegen script that generates src/manager-extensions/index.ts
 * from hardcoded module-to-path mappings.
 *
 * Usage: node scripts/generate-manager-extensions.mjs
 *
 * This eliminates ~737 lines of repetitive hand-maintained code.
 * When adding a new manager extension:
 *   1. Add an entry to MODULE_DEFS below
 *   2. If the import path is non-standard, specify `path`
 *   3. If the module is lifecycle-only (no separate import block), set `standalone: false`
 *   4. Run: node scripts/generate-manager-extensions.mjs
 *   5. Verify: pnpm lint:types && pnpm test
 */

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(__dirname, "..", "src", "manager-extensions", "index.ts");

// ─── Module Definitions ─────────────────────────────────────────────
//
// Each entry defines one row in MANAGER_EXTENSION_MODULES.
//
// Fields:
//   option    — key in ManagerExtensionsOptions (e.g. "includeAdmin")
//   module    — module name for lifecycle tracking (e.g. "admin")
//   path      — import path relative to src/ (e.g. "admin/index.js")
//               If omitted, defaults to `${module}/index.js`
//               Set to null for lifecycle-only modules (no standalone import block)
//   standalone — whether this option has its own if-block in extendMatrixClientWithManagers
//                (defaults true; set false for modules loaded as part of another block)
//   adminExtra — if true, this import is an extra loaded by the includeAdmin block
//                and does NOT get its own option field/row
//
// Admin extras (loaded when includeAdmin is true, no separate option):
//   - background-update (also has standalone includeBackgroundUpdate)
//   - worker-admin
//   - worker-body (has includeWorkerBody for lifecycle tracking but no standalone import)
//
// Lifecycle-only entries (in MANAGER_EXTENSION_MODULES for tracking only):
//   - includeWorkerBody
//   - includeSamlAuth

const MODULE_DEFS = [
    // ── Group 1: core modules ──────────────────────────────────────
    {
        option: "includeAdmin",
        module: "admin",
        path: "admin/index.js",
        adminExtras: ["background-update/index.js", "worker-admin/index.js", "worker-body/index.js"],
    },
    { option: "includeAccount", module: "account" },
    { option: "includeAccountData", module: "account-data" },
    { option: "includeAuth", module: "auth" },
    { option: "includeCapabilities", module: "capabilities" },
    { option: "includeCryptoKeys", module: "crypto-keys" },
    { option: "includeKeyVerification", module: "key-verification" },
    { option: "includeDeviceTrust", module: "device-trust" },
    { option: "includeDiscovery", module: "discovery" },
    { option: "includeGlobalLogout", module: "global-logout", path: "auth/global-logout.js" },
    { option: "includeDm", module: "dm" },
    { option: "includeGuest", module: "guest" },
    { option: "includeInviteBlocklist", module: "invite-blocklist" },
    { option: "includeMedia", module: "media" },
    { option: "includePush", module: "push" },
    { option: "includeQrLogin", module: "qr-login" },
    { option: "includeRoom", module: "room" },
    { option: "includeRoomKeySharing", module: "room-key-sharing" },
    { option: "includeRoomSummary", module: "room-summary" },
    { option: "includeRoomList", module: "room-list" },
    { option: "includeSecurity", module: "security" },
    { option: "includeStickyEvent", module: "sticky-event" },
    { option: "includeFriend", module: "friend" },
    { option: "includeSpace", module: "space" },
    { option: "includeSending", module: "sending" },
    { option: "includePresence", module: "presence" },
    { option: "includeFederation", module: "federation" },
    { option: "includeDevice", module: "device" },
    { option: "includeProfile", module: "profile" },
    { option: "includeSecureBackup", module: "secure-backup" },
    { option: "includeThirdParty", module: "thirdparty", path: "third-party/index.js" },
    { option: "includeOidc", module: "oidc", path: "oidc/manager.js" },
    { option: "includeTelemetry", module: "telemetry" },
    { option: "includeRendezvous", module: "rendezvous", path: "rendezvous/RendezvousManager.js" },
    { option: "includeTyping", module: "typing" },
    { option: "includeUser", module: "user" },
    { option: "includeUserReport", module: "user-report" },
    { option: "includeThreePids", module: "threepids", path: "three-pids/index.js" },
    { option: "includeIdentityServer", module: "identity-server" },
    { option: "includePasswordReset", module: "password-reset" },
    { option: "includeThreading", module: "threading" },
    { option: "includeStateSend", module: "state-send" },
    { option: "includeRelations", module: "relations" },
    { option: "includeTimeline", module: "timeline" },
    { option: "includeModeration", module: "moderation" },
    { option: "includeKeyRotation", module: "key-rotation" },
    { option: "includeKeyBackup", module: "key-backup" },
    { option: "includeFeatureFlag", module: "feature-flags" },
    { option: "includeEventReport", module: "event-report" },
    { option: "includeBurnAfterRead", module: "burn-after-read" },
    { option: "includeVerification", module: "verification" },
    { option: "includeE2EE", module: "e2ee" },
    { option: "includeWorkerBody", module: "worker-body", standalone: false },
    { option: "includeAiConnection", module: "ai-connection" },
    { option: "includeOpenClaw", module: "openclaw", path: "open-claw/index.js" },
    { option: "includeVoice", module: "voice" },
    { option: "includeSamlAuth", module: "saml", standalone: false },
    { option: "includeCredentials", module: "credentials" },
    { option: "includeCas", module: "cas" },
    { option: "includeExternalService", module: "external-service" },
    { option: "includeDehydratedDevice", module: "dehydrated-device" },
    { option: "includeThread", module: "thread" },
    { option: "includeWidget", module: "widget" },

    // ── Group 2: additional modules ────────────────────────────────
    { option: "includeServerCapabilities", module: "server-capabilities" },
    { option: "includeSyncManagement", module: "sync-management" },
    { option: "includeFilter", module: "filter" },
    { option: "includeToDevice", module: "to-device" },
    { option: "includeTurnServer", module: "turn-server" },
    { option: "includeSearch", module: "search" },
    { option: "includeReporting", module: "reporting" },
    { option: "includeReadReceipts", module: "read-receipts" },
    { option: "includeNotifications", module: "notifications" },
    { option: "includeCryptoBackup", module: "crypto-backup" },
    { option: "includeTagsManagement", module: "tags-management" },
    { option: "includeSecretStorage", module: "secret-storage" },
    { option: "includeCrossSigning", module: "cross-signing" },
    { option: "includeRoomSettings", module: "room-settings" },
    { option: "includeRoomState", module: "room-state" },
    { option: "includeServerTime", module: "server-time" },
    { option: "includeVoipCalls", module: "voip-calls" },
    { option: "includeRoomAccountData", module: "room-account-data" },
    { option: "includeBackgroundUpdate", module: "background-update" },
    { option: "includeUserDirectory", module: "user-directory" },
];

// ─── Helpers ────────────────────────────────────────────────────────

/** Derive the import path for a module entry. */
function importPath(entry) {
    if (entry.path !== undefined) return entry.path;
    return `${entry.module}/index.js`;
}

/** Whether this entry has its own standalone if-block. */
function hasStandalone(entry) {
    return entry.standalone !== false;
}

/** The option name -> ManagerExtensionsOptions key. */
function optionName(entry) {
    return entry.option;
}

// ─── Code Generation ────────────────────────────────────────────────

function generate() {
    const lines = [];

    // Header
    lines.push(`/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/**
 * Manager Extensions - 统一的 Manager 初始化入口
 *
 * 提供统一的接口来初始化所有或部分的 Manager 扩展
 * 使用方式：
 *
 * @example
 * // 初始化所有核心 Manager
 * import { extendMatrixClientWithManagers } from "./manager-extensions";
 * extendMatrixClientWithManagers();
 *
 * const client = createClient({ ... });
 * const admin = client.getAdminManager();
 * const dm = client.getDirectMessageManager();
 *
 * THIS FILE IS AUTO-GENERATED by scripts/generate-manager-extensions.mjs.
 * DO NOT EDIT MANUALLY. To add a new manager extension, edit the script instead.
 */

import type { ManagerExtensionsOptions, ManagerExtensionsLifecycleEvent, ManagerExtensionsLifecycleListener } from "./types.js";
`);

    // MANAGER_EXTENSION_MODULES array
    lines.push(`const MANAGER_EXTENSION_MODULES: Array<{
    option: Exclude<keyof ManagerExtensionsOptions, "includeAll">;
    module: string;
}> = [`);

    for (let i = 0; i < MODULE_DEFS.length; i++) {
        const entry = MODULE_DEFS[i];
        const isLast = i === MODULE_DEFS.length - 1;
        const groupGap = i === 62 || i === 63 ? "" : null; // gap before group 2

        // Insert blank line between group 1 and group 2 (after index 62 = includeWidget)
        if (i === 63) {
            lines.push("");
        }

        lines.push(`    { option: "${optionName(entry)}", module: "${entry.module}" },`);
    }

    lines.push(`];`);
    lines.push("");

    // DEFAULT_CORE_EXTENSIONS
    lines.push(`const DEFAULT_CORE_EXTENSIONS: ManagerExtensionsOptions = {`);
    for (let i = 0; i < MODULE_DEFS.length; i++) {
        const entry = MODULE_DEFS[i];

        // Insert blank line between group 1 and group 2 (after includeWidget)
        if (i === 63) {
            lines.push("");
        }

        lines.push(`    ${optionName(entry)}: true,`);
    }
    lines.push(`};`);
    lines.push("");

    // State variables
    lines.push(`let isInitialized = false;`);
    lines.push(`let currentOptions: ManagerExtensionsOptions = {};`);
    lines.push(`let initializationPromise: Promise<void> | null = null;`);
    lines.push(`const lifecycleListeners = new Set<ManagerExtensionsLifecycleListener>();`);
    lines.push("");

    // emitLifecycleEvent
    lines.push(`function emitLifecycleEvent(event: ManagerExtensionsLifecycleEvent): void {
    for (const listener of lifecycleListeners) {
        try {
            listener(event);
        } catch {
            continue;
        }
    }
}
`);

    // safeDynamicImport
    lines.push(`/**
 * Wraps a dynamic import promise to gracefully handle EnvironmentTeardownError
 * that can occur when Vitest tears down the test environment before the import
 * resolves. Returns undefined instead of throwing in that case.
 */
function safeDynamicImport<T>(importPromise: Promise<T>): Promise<T | undefined> {
    return importPromise.catch((error: unknown) => {
        if (error instanceof Error && error.name === "EnvironmentTeardownError") {
            return undefined;
        }
        throw error;
    });
}
`);

    // getEnabledModules
    lines.push(`function getEnabledModules(options: ManagerExtensionsOptions): string[] {
    const all = options.includeAll ?? false;
    return MANAGER_EXTENSION_MODULES.filter(({ option }) => all || options[option]).map(({ module }) => module);
}
`);

    // onManagerExtensionsLifecycle
    lines.push(`export function onManagerExtensionsLifecycle(listener: ManagerExtensionsLifecycleListener): () => void {
    lifecycleListeners.add(listener);
    return () => offManagerExtensionsLifecycle(listener);
}
`);

    // offManagerExtensionsLifecycle
    lines.push(`export function offManagerExtensionsLifecycle(listener: ManagerExtensionsLifecycleListener): void {
    lifecycleListeners.delete(listener);
}
`);

    // extendMatrixClientWithManagers
    lines.push(`export async function extendMatrixClientWithManagers(
    options: ManagerExtensionsOptions = DEFAULT_CORE_EXTENSIONS,
): Promise<void> {
    if (isInitialized) {
        return;
    }
    if (initializationPromise) {
        return initializationPromise;
    }

    initializationPromise = (async (): Promise<void> => {
        currentOptions = { ...DEFAULT_CORE_EXTENSIONS, ...options };
        const all = currentOptions.includeAll ?? false;
        const enabledModules = getEnabledModules(currentOptions);
        emitLifecycleEvent({ phase: "register", status: "success", modules: enabledModules });
        emitLifecycleEvent({ phase: "init", status: "begin", modules: enabledModules });

        const promises: Promise<void | undefined>[] = [];

        try {
            // manager() accessor — must load first so the prototype method exists
            // before any registerManagerClass calls from other extendMatrixClient functions
            promises.push(safeDynamicImport(import("../client-infra/manager-accessor.js").then((m) => m?.extendMatrixClient())));
`);

    // Generate import blocks for each standalone entry
    let isFirstBlock = true;
    for (const entry of MODULE_DEFS) {
        if (!hasStandalone(entry)) continue;

        const opt = optionName(entry);
        const ipath = importPath(entry);

        if (isFirstBlock) {
            isFirstBlock = false;
        } else {
            lines.push("");
        }
        lines.push(`            if (currentOptions.${opt} || all) {`);
        lines.push(
            `                promises.push(safeDynamicImport(import("../${ipath}").then((m) => m?.extendMatrixClient())));`,
        );

        // Admin extra imports
        if (entry.adminExtras) {
            for (const extraPath of entry.adminExtras) {
                lines.push(
                    `                promises.push(safeDynamicImport(import("../${extraPath}").then((m) => m?.extendMatrixClient())));`,
                );
            }
        }

        lines.push(`            }`);
    }

    // Close the function
    lines.push(`
            await Promise.all(promises);
            emitLifecycleEvent({ phase: "init", status: "success", modules: enabledModules });
            isInitialized = true;
            emitLifecycleEvent({ phase: "start", status: "success", modules: enabledModules });
        } catch (error) {
            emitLifecycleEvent({ phase: "init", status: "error", modules: enabledModules, error });
            throw error;
        }
    })();

    try {
        await initializationPromise;
    } finally {
        if (!isInitialized) {
            initializationPromise = null;
        }
    }
}
`);

    // isManagerExtensionsInitialized
    lines.push(`export function isManagerExtensionsInitialized(): boolean {
    return isInitialized;
}
`);

    // resetManagerExtensions
    lines.push(`export function resetManagerExtensions(): void {
    const enabledModules = getEnabledModules(currentOptions);
    emitLifecycleEvent({ phase: "stop", status: "success", modules: enabledModules });
    isInitialized = false;
    currentOptions = {};
    initializationPromise = null;
}
`);

    // Export DEFAULT_CORE_EXTENSIONS
    lines.push(`export { DEFAULT_CORE_EXTENSIONS };`);
    lines.push("");

    // Re-export types from types.ts for backward compatibility
    lines.push(`export type {`);
    lines.push(`    ManagerExtensionsOptions,`);
    lines.push(`    ManagerExtensionsLifecyclePhase,`);
    lines.push(`    ManagerExtensionsLifecycleStatus,`);
    lines.push(`    ManagerExtensionsLifecycleEvent,`);
    lines.push(`    ManagerExtensionsLifecycleListener,`);
    lines.push(`} from "./types.js";`);

    return lines.join("\n") + "\n";
}

// ─── Main ───────────────────────────────────────────────────────────

const output = generate();
writeFileSync(OUTPUT, output, "utf-8");
console.log(`Generated ${OUTPUT} (${MODULE_DEFS.length} module entries)`);
