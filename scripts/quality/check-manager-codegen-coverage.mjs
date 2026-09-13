#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const srcDir = path.join(projectRoot, "src");
const generatedIndexPath = path.join(projectRoot, "docs", "api-contract", "generated", "index.json");

const LEDGER_MODULE_ALIASES = {
    "account-data": "account_data",
    admin: "admin",
    appservice: "app_service",
    "background-update": "background_update",
    "burn-after-read": "burn_after_read",
    captcha: "captcha",
    cas: "cas",
    device: "device",
    dm: "dm",
    e2ee: "e2ee_routes",
    ephemeral: "ephemeral",
    "event-report": "event_report",
    "external-service": "external_service",
    "feature-flags": "feature_flags",
    federation: "federation",
    friend: "friend_room",
    guest: "guest",
    "key-backup": "key_backup",
    "key-rotation": "key_rotation",
    media: "media",
    moderation: "moderation",
    module: "module",
    notifications: "push_notification",
    oidc: "oidc",
    presence: "presence",
    push: "push",
    reactions: "reactions",
    relations: "relations",
    rendezvous: "rendezvous",
    room: "room",
    "room-summary": "room_summary",
    saml: "saml",
    search: "search",
    "sliding-sync": "sliding_sync",
    space: "space",
    sync: "sync",
    tags: "tags",
    telemetry: "telemetry",
    thirdparty: "thirdparty",
    thread: "thread",
    typing: "typing",
    verification: "verification_routes",
    voice: "voice",
    widget: "widget",
    "worker-admin": "worker",
    "worker-body": "worker_body",
};

/**
 * Ledger module name → SDK directory overrides.
 *
 * `LEDGER_MODULE_ALIASES` is keyed by SDK directory, so it cannot express either
 * "two ledger modules share one SDK directory" or "the ledger name differs from the
 * directory". Without these, `thirdparty` / `msc4108_rendezvous` / `background_update`
 * resolved to non-existent directories and were reported as NO_CODEGEN even though the
 * SDK does ship their route tables — 3 of the 14 reported gaps were this bug.
 */
const LEDGER_MODULE_TO_SDK_DIR = {
    background_update: "background-update",
    msc4108_rendezvous: "rendezvous",
    thirdparty: "third-party",
};

/**
 * Modules that intentionally have no generated route table.
 *
 * These managers do not consume one (verified: no `__generated__/route-table` import
 * and their HTTP paths are built by hand), so generating a table would only add dead
 * code — that is why codegen lists most of them in `SKIP_ROUTE_TABLE_MODULES`. They are
 * recorded here so the gate reports "known non-consumer" instead of silently inflating
 * the gap, and so an *unexpected* new gap still fails the build. Every entry needs a
 * reason and an expiry date.
 */
const WAIVED_MODULES = {
    admin: { reason: "no route-table consumer; codegen intentionally skips it", expires: "2026-12-31" },
    app_service: { reason: "no route-table consumer; codegen intentionally skips it", expires: "2026-12-31" },
    dm: { reason: "no route-table consumer; codegen intentionally skips it", expires: "2026-12-31" },
    feature_flags: { reason: "no route-table consumer; codegen intentionally skips it", expires: "2026-12-31" },
    federation: { reason: "no route-table consumer; codegen intentionally skips it", expires: "2026-12-31" },
    key_rotation: { reason: "no route-table consumer; codegen intentionally skips it", expires: "2026-12-31" },
    moderation: { reason: "no route-table consumer; codegen intentionally skips it", expires: "2026-12-31" },
    reactions: { reason: "no route-table consumer; codegen intentionally skips it", expires: "2026-12-31" },
    voice: { reason: "no route-table consumer; codegen intentionally skips it", expires: "2026-12-31" },
    delayed_events: {
        reason: "1 route; manager gates on an unstable feature and needs no table",
        expires: "2026-12-31",
    },
    vendor: {
        reason: "private /_matrix/vendor/v1 routes owned by the friend/room managers, not a module of their own",
        expires: "2026-12-31",
    },
};

/** The pre-existing heuristic for "this file talks to the server". */
const RUNTIME_CALL_RE = /withRetry\(|\.authedRequest\(|\.requestOtherUrl\(|\.request\(|http\.|this\.client\.\w+\(/;

function walk(dir, predicate = () => true, acc = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(fullPath, predicate, acc);
        } else if (predicate(fullPath)) {
            acc.push(fullPath);
        }
    }
    return acc;
}

function findSdkDirForModule(moduleName) {
    if (LEDGER_MODULE_TO_SDK_DIR[moduleName]) return LEDGER_MODULE_TO_SDK_DIR[moduleName];
    for (const [sdkDir, ledgerModule] of Object.entries(LEDGER_MODULE_ALIASES)) {
        if (ledgerModule === moduleName) return sdkDir;
    }
    return moduleName;
}

function moduleSourceFiles(sdkDir, srcRoot) {
    const files = [];
    const dir = path.join(srcRoot, sdkDir);
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        files.push(
            ...walk(
                dir,
                (filePath) =>
                    filePath.endsWith(".ts") &&
                    !filePath.endsWith(".d.ts") &&
                    !filePath.includes(`${path.sep}__generated__${path.sep}`),
            ),
        );
    }
    // Flat modules keep their implementation as a sibling FILE (`src/sliding-sync.ts`),
    // not a directory — the route table still lives in `src/sliding-sync/__generated__/`.
    for (const flat of [`${sdkDir}.ts`, `${sdkDir}.tsx`]) {
        const flatPath = path.join(srcRoot, flat);
        if (fs.existsSync(flatPath)) files.push(flatPath);
    }
    return files;
}

/**
 * Collect consumer evidence for one module directory.
 *
 * The previous rule matched manager CLASS NAMES against the module name with
 * `needle.includes(bareManagerName)`, so `sliding_sync` counted as "covered" because
 * `SyncManager` (`"slidingsync".includes("sync")`) lives in `src/sync-management/` — a
 * different module entirely. Name collisions of that kind silently authorise a module with
 * no consumer at all, so the decision is now based on evidence inside the module:
 *
 *   strong — a file in the module consumes its generated `__generated__/route-table`;
 *   weak   — a file in the module makes HTTP calls (it may consume the table through a
 *            helper, so this still counts, but it is reported separately).
 */
export function collectCodegenConsumers(sdkDir, srcRoot = srcDir) {
    const strong = [];
    const weak = [];

    for (const filePath of moduleSourceFiles(sdkDir, srcRoot)) {
        const content = fs.readFileSync(filePath, "utf8");
        const relativePath = path.relative(srcRoot, filePath);
        if (/__generated__\/route-table/.test(content)) {
            strong.push(relativePath);
            continue;
        }
        if (RUNTIME_CALL_RE.test(content)) weak.push(relativePath);
    }

    return { strong, weak };
}

/** Route count of a module's generated table (0 = no table generated). */
export function countRouteTableEntries(sdkDir, srcRoot = srcDir) {
    const routeTablePath = path.join(srcRoot, sdkDir, "__generated__", "route-table.ts");
    if (!fs.existsSync(routeTablePath)) return 0;
    return (fs.readFileSync(routeTablePath, "utf8").match(/\{\s*method:\s*"/g) || []).length;
}

/**
 * Classify one ledger module's codegen coverage.
 *
 * Exported so the allowlist + expiry rules can be unit-tested without running the gate.
 * `hasCodegen` is the generated route count (`0` = no table); `consumers` comes from
 * `collectCodegenConsumers`. `missing` is the only status that fails the build; `waived`
 * requires a live waiver, so an expired entry turns back into a failure instead of rotting
 * silently.
 */
export function classifyModuleCoverage(
    moduleName,
    { hasCodegen, consumers = { strong: [], weak: [] }, today = new Date() },
) {
    const waiver = WAIVED_MODULES[moduleName];
    const hasConsumer = consumers.strong.length > 0 || consumers.weak.length > 0;

    if (hasCodegen > 0 && hasConsumer) {
        return { status: "covered", evidence: consumers.strong.length > 0 ? "route-table-import" : "runtime-calls" };
    }

    if (waiver) {
        if (new Date(waiver.expires) >= today) return { status: "waived", waiver };
        return { status: "missing", reason: "EXPIRED_WAIVER", waiver };
    }

    return { status: "missing", reason: hasCodegen > 0 ? "NO_CONSUMER" : "NO_CODEGEN" };
}

function main() {
    const generatedIndex = JSON.parse(fs.readFileSync(generatedIndexPath, "utf8"));

    const summary = {
        codegenModules: 0,
        covered: 0,
        strong: [],
        weak: [],
        waived: 0,
        missing: 0,
        umbrella: [],
        missingModules: [],
        coveredModules: [],
        waivedModules: [],
    };

    console.log("\n=== Module Coverage Analysis ===");

    const today = new Date();
    const usedWaivers = new Set();

    for (const [moduleName, moduleInfo] of Object.entries(generatedIndex.modules)) {
        const sdkDir = findSdkDirForModule(moduleName);
        const hasCodegen = countRouteTableEntries(sdkDir);
        if (hasCodegen > 0) summary.codegenModules += 1;

        if (moduleName === "assembly") {
            summary.umbrella.push({ moduleName, routes: moduleInfo.entry_count });
            console.log(
                `  UMBRELLA: ${moduleName} (${moduleInfo.entry_count} routes) -> governed by umbrella docs/manager mapping`,
            );
            continue;
        }

        const consumers = collectCodegenConsumers(sdkDir);
        const verdict = classifyModuleCoverage(moduleName, { hasCodegen, consumers, today });

        if (verdict.status === "covered") {
            summary.covered += 1;
            summary.coveredModules.push(moduleName);
            if (verdict.evidence === "route-table-import") summary.strong.push(moduleName);
            else summary.weak.push(moduleName);
            continue;
        }

        if (verdict.status === "waived") {
            summary.waived += 1;
            summary.waivedModules.push(moduleName);
            usedWaivers.add(moduleName);
            console.log(
                `  WAIVED: ${moduleName} (${moduleInfo.entry_count} routes) -> ${verdict.waiver.reason}; expires ${verdict.waiver.expires}`,
            );
            continue;
        }

        summary.missing += 1;
        summary.missingModules.push({
            moduleName,
            routes: moduleInfo.entry_count,
            reason: verdict.reason,
            sdkDir,
            codegenRoutes: hasCodegen,
        });
        if (verdict.reason === "EXPIRED_WAIVER") {
            console.log(
                `  EXPIRED_WAIVER: ${moduleName} (${moduleInfo.entry_count} routes) -> expired ${verdict.waiver.expires} (${verdict.waiver.reason})`,
            );
        } else if (verdict.reason === "NO_CONSUMER") {
            console.log(
                `  NO_CONSUMER: ${moduleName} (${moduleInfo.entry_count} routes) -> generated ${sdkDir}/__generated__/route-table.ts (${hasCodegen} endpoints) has no consumer in src/${sdkDir}`,
            );
        } else {
            console.log(`  NO_CODEGEN: ${moduleName} (${moduleInfo.entry_count} routes)`);
        }
    }

    // A waiver that is no longer needed is debt of its own: the module either gained real
    // coverage (delete the entry) or was renamed (the waiver now protects nothing).
    const unusedWaivers = Object.keys(WAIVED_MODULES).filter((name) => !usedWaivers.has(name));

    const effectiveTotal = summary.covered + summary.missing;
    const coverageRate = effectiveTotal === 0 ? "100.0" : ((summary.covered / effectiveTotal) * 100).toFixed(1);

    console.log(`\nCOVERED (route-table import, ${summary.strong.length}): ${summary.strong.join(", ")}`);
    console.log(`COVERED (runtime calls only, ${summary.weak.length}): ${summary.weak.join(", ")}`);
    console.log(`Covered: ${summary.covered}, Waived: ${summary.waived}, Missing: ${summary.missing}`);
    console.log(
        `Coverage rate: ${coverageRate}% (${summary.covered}/${effectiveTotal} modules consume codegen; ` +
            `${summary.waived} documented non-consumer(s))`,
    );

    if (unusedWaivers.length > 0) {
        console.error(`\nUnused waiver(s) in WAIVED_MODULES — delete them: ${unusedWaivers.join(", ")}`);
    }

    if (summary.missing > 0 || unusedWaivers.length > 0) {
        process.exitCode = 1;
    }
}

// Guarded so the module can be imported by tests (which exercise the exported helpers)
// without running the gate and mutating `process.exitCode`.
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
