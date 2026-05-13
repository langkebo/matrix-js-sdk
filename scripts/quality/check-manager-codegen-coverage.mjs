#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const srcDir = path.join(projectRoot, "src");
const generatedIndexPath = path.join(projectRoot, "docs", "api-contract", "generated", "index.json");

const LEDGER_MODULE_ALIASES = {
    "account-data": "account_data",
    admin: "admin",
    "ai-connection": "ai_connection",
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
    openclaw: "openclaw",
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

        const hasRuntimeCalls = /withRetry\(|\.authedRequest\(|\.requestOtherUrl\(|\.request\(|http\.|this\.client\.\w+\(/g.test(
            content,
        );
        const endpointCount = (
            content.match(/withRetry\(|\.authedRequest\(|\.requestOtherUrl\(|\.request\(|this\.client\.\w+\(/g) || []
        ).length;

        for (const match of classMatches) {
            managers.set(match[1], {
                file: relativePath,
                hasRuntimeCalls,
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
            if (info.hasRuntimeCalls) return true;
        }
    }

    return false;
}

function main() {
    const generatedIndex = JSON.parse(fs.readFileSync(generatedIndexPath, "utf8"));
    const managers = findAllManagerClasses();
    const codegenDirs = findCodegenDirs();

    const summary = {
        totalManagerClasses: managers.size,
        codegenModules: Object.keys(codegenDirs).length,
        covered: 0,
        missing: 0,
        umbrella: [],
        missingModules: [],
        coveredModules: [],
    };

    console.log(`Total manager classes found: ${summary.totalManagerClasses}`);
    console.log(`\nCodegen modules: ${summary.codegenModules}`);
    console.log("\n=== Module Coverage Analysis ===");

    for (const [moduleName, moduleInfo] of Object.entries(generatedIndex.modules)) {
        const sdkDir = findSdkDirForModule(moduleName);
        const hasCodegen = codegenDirs[sdkDir] || 0;

        if (moduleName === "assembly") {
            summary.umbrella.push({ moduleName, routes: moduleInfo.entry_count });
            console.log(`  UMBRELLA: ${moduleName} (${moduleInfo.entry_count} routes) -> governed by umbrella docs/manager mapping`);
            continue;
        }

        const hasManager = hasSupportingManager(moduleName, sdkDir, managers);

        if (hasCodegen && hasManager) {
            summary.covered += 1;
            summary.coveredModules.push(moduleName);
            continue;
        }

        if (!hasCodegen) {
            summary.missing += 1;
            summary.missingModules.push({ moduleName, routes: moduleInfo.entry_count, reason: "NO_CODEGEN" });
            console.log(`  NO_CODEGEN: ${moduleName} (${moduleInfo.entry_count} routes)`);
            continue;
        }

        summary.missing += 1;
        summary.missingModules.push({
            moduleName,
            routes: moduleInfo.entry_count,
            reason: "MISSING_MANAGER",
            sdkDir,
            codegenRoutes: hasCodegen,
        });
        console.log(`  MISSING: ${moduleName} (${moduleInfo.entry_count} routes) -> codegen=${sdkDir} (${hasCodegen} endpoints)`);
    }

    const effectiveTotal = summary.covered + summary.missing;
    const coverageRate = effectiveTotal === 0 ? "100.0" : ((summary.covered / effectiveTotal) * 100).toFixed(1);

    console.log(`\nCovered: ${summary.covered}, Missing: ${summary.missing}`);
    console.log(`Coverage rate: ${coverageRate}%`);

    if (summary.missing > 0) {
        process.exitCode = 1;
    }
}

main();
