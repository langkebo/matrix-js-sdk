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

const MANAGER_NAME_ALIASES = {
    appservice: ["applicationservice"],
    featureflags: ["featureflag"],
    module: ["admin"],
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

function findAllManagerClasses() {
    const managers = new Map();
    const tsFiles = walk(srcDir, (filePath) => filePath.endsWith(".ts") && !filePath.endsWith(".d.ts"));

    for (const filePath of tsFiles) {
        const relativePath = path.relative(srcDir, filePath);
        const content = fs.readFileSync(filePath, "utf8");
        const classMatches = [...content.matchAll(/export\s+(?:default\s+)?class\s+(\w*Manager)\b/g)];
        if (classMatches.length === 0) continue;

        const hasRuntimeCalls =
            /withRetry\(|\.authedRequest\(|\.requestOtherUrl\(|\.request\(|http\.|this\.client\.\w+\(/g.test(content);
        const endpointCount = (
            content.match(/withRetry\(|\.authedRequest\(|\.requestOtherUrl\(|\.request\(|this\.client\.\w+\(/g) || []
        ).length;
        // A manager can consume the generated contract at the TYPE level (e.g.
        // `src/background-update` constrains its path helper with
        // `BackgroundUpdatePathPattern`) without containing any of the HTTP-call syntax
        // above. The old heuristic missed that and reported a false gap.
        const importsRouteTable = /__generated__\/route-table/.test(content);

        for (const match of classMatches) {
            managers.set(match[1], {
                file: relativePath,
                hasRuntimeCalls,
                importsRouteTable,
                consumesCodegen: hasRuntimeCalls || importsRouteTable,
                endpointCount,
            });
        }
    }

    return managers;
}

function findCodegenDirs() {
    const result = {};
    const topDirs = fs
        .readdirSync(srcDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.startsWith("__"))
        .map((entry) => entry.name);

    for (const dir of topDirs) {
        const routeTablePath = path.join(srcDir, dir, "__generated__", "route-table.ts");
        if (!fs.existsSync(routeTablePath)) continue;
        const content = fs.readFileSync(routeTablePath, "utf8");
        result[dir] = (content.match(/\{\s*method:\s*"/g) || []).length;
    }

    return result;
}

function findSdkDirForModule(moduleName) {
    if (LEDGER_MODULE_TO_SDK_DIR[moduleName]) return LEDGER_MODULE_TO_SDK_DIR[moduleName];
    for (const [sdkDir, ledgerModule] of Object.entries(LEDGER_MODULE_ALIASES)) {
        if (ledgerModule === moduleName) return sdkDir;
    }
    return moduleName;
}

function hasSupportingManager(moduleName, sdkDir, managers) {
    const normalizedSdkDir = sdkDir.toLowerCase().replace(/-/g, "");
    const needles = new Set([
        moduleName.toLowerCase(),
        normalizedSdkDir,
        ...(MANAGER_NAME_ALIASES[normalizedSdkDir] || []),
    ]);

    for (const [managerName, info] of managers) {
        const lowerManagerName = managerName.toLowerCase();
        const bareManagerName = lowerManagerName.replace(/manager$/, "");
        if ([...needles].some((needle) => lowerManagerName.includes(needle) || needle.includes(bareManagerName))) {
            if (info.consumesCodegen) return true;
        }
    }

    return false;
}

/**
 * Classify one ledger module's codegen coverage.
 *
 * Exported so the allowlist + expiry rules can be unit-tested without running the gate.
 * `hasCodegen` is the generated route count (`0` = no table), `missing` is the only
 * status that fails the build; `waived` requires a live waiver, so an expired entry
 * turns back into a failure instead of rotting silently.
 */
export function classifyModuleCoverage(moduleName, { hasCodegen, hasManager, today = new Date() }) {
    if (hasCodegen && hasManager) return { status: "covered" };

    const waiver = WAIVED_MODULES[moduleName];
    if (waiver) {
        if (new Date(waiver.expires) >= today) return { status: "waived", waiver };
        return { status: "missing", reason: "EXPIRED_WAIVER", waiver };
    }
    return { status: "missing", reason: hasCodegen ? "MISSING_MANAGER" : "NO_CODEGEN" };
}

function main() {
    const generatedIndex = JSON.parse(fs.readFileSync(generatedIndexPath, "utf8"));
    const managers = findAllManagerClasses();
    const codegenDirs = findCodegenDirs();

    const summary = {
        totalManagerClasses: managers.size,
        codegenModules: Object.keys(codegenDirs).length,
        covered: 0,
        waived: 0,
        missing: 0,
        umbrella: [],
        missingModules: [],
        coveredModules: [],
        waivedModules: [],
    };

    console.log(`Total manager classes found: ${summary.totalManagerClasses}`);
    console.log(`\nCodegen modules: ${summary.codegenModules}`);
    console.log("\n=== Module Coverage Analysis ===");

    const today = new Date();

    for (const [moduleName, moduleInfo] of Object.entries(generatedIndex.modules)) {
        const sdkDir = findSdkDirForModule(moduleName);
        const hasCodegen = codegenDirs[sdkDir] || 0;

        if (moduleName === "assembly") {
            summary.umbrella.push({ moduleName, routes: moduleInfo.entry_count });
            console.log(
                `  UMBRELLA: ${moduleName} (${moduleInfo.entry_count} routes) -> governed by umbrella docs/manager mapping`,
            );
            continue;
        }

        const hasManager = hasSupportingManager(moduleName, sdkDir, managers);
        const verdict = classifyModuleCoverage(moduleName, { hasCodegen, hasManager, today });

        if (verdict.status === "covered") {
            summary.covered += 1;
            summary.coveredModules.push(moduleName);
            continue;
        }

        if (verdict.status === "waived") {
            summary.waived += 1;
            summary.waivedModules.push(moduleName);
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
        } else if (verdict.reason === "MISSING_MANAGER") {
            console.log(
                `  MISSING: ${moduleName} (${moduleInfo.entry_count} routes) -> codegen=${sdkDir} (${hasCodegen} endpoints)`,
            );
        } else {
            console.log(`  NO_CODEGEN: ${moduleName} (${moduleInfo.entry_count} routes)`);
        }
    }

    const effectiveTotal = summary.covered + summary.missing;
    const coverageRate = effectiveTotal === 0 ? "100.0" : ((summary.covered / effectiveTotal) * 100).toFixed(1);

    console.log(`\nCovered: ${summary.covered}, Waived: ${summary.waived}, Missing: ${summary.missing}`);
    console.log(
        `Coverage rate: ${coverageRate}% (${summary.covered}/${effectiveTotal} modules consume codegen; ` +
            `${summary.waived} documented non-consumer(s))`,
    );

    if (summary.missing > 0) {
        process.exitCode = 1;
    }
}

// Guarded so the module can be imported by tests (which exercise
// `classifyModuleCoverage`) without running the gate and mutating `process.exitCode`.
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
