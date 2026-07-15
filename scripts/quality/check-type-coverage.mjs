import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const PROJECT_ROOT = process.cwd();
const OVERALL_THRESHOLD = 98;
const MODULE_THRESHOLD = 95;
const COMMON_ARGS = [
    "exec",
    "type-coverage",
    "--strict",
    "--ignore-catch",
    "--ignore-non-null-assertion",
    "--json-output",
];

function collectTypeScriptFiles(rootDir, recursive = true) {
    const files = [];

    for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
        const fullPath = join(rootDir, entry.name);
        if (entry.isDirectory()) {
            if (recursive) {
                files.push(...collectTypeScriptFiles(fullPath, true));
            }
            continue;
        }

        if (
            (entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) &&
            !entry.name.endsWith(".test-d.ts") &&
            !fullPath.includes(`${join("src", "@types")}.map`)
        ) {
            files.push(fullPath);
        }
    }

    return files.sort();
}

function runTypeCoverage(label, files, threshold) {
    const args = files.length > 0 ? [...COMMON_ARGS, "--", ...files] : COMMON_ARGS;
    const result = spawnSync("pnpm", args, {
        cwd: PROJECT_ROOT,
        encoding: "utf8",
    });

    if (result.status !== 0 && !result.stdout.trim()) {
        throw new Error(`type-coverage failed for ${label}:\n${result.stderr}`);
    }

    const payload = JSON.parse(result.stdout);
    const percent = Number(payload.percent);
    const passed = percent >= threshold;

    return {
        label,
        percent,
        correctCount: payload.correctCount,
        totalCount: payload.totalCount,
        threshold,
        passed,
    };
}

const srcRoot = join(PROJECT_ROOT, "src");
const moduleTargets = [
    { label: "src/root", files: collectTypeScriptFiles(srcRoot, false) },
    { label: "src/@types", files: collectTypeScriptFiles(join(srcRoot, "@types")) },
    { label: "src/models", files: collectTypeScriptFiles(join(srcRoot, "models")) },
    { label: "src/store", files: collectTypeScriptFiles(join(srcRoot, "store")) },
    { label: "src/web-rtc", files: collectTypeScriptFiles(join(srcRoot, "web-rtc")) },
    { label: "src/matrix-rtc", files: collectTypeScriptFiles(join(srcRoot, "matrix-rtc")) },
    { label: "src/rust-crypto", files: collectTypeScriptFiles(join(srcRoot, "rust-crypto")) },
    { label: "src/runtime-schemas", files: collectTypeScriptFiles(join(srcRoot, "runtime-schemas")) },
].filter(
    (target) =>
        target.files.length > 0 &&
        existsSync(join(PROJECT_ROOT, target.label)) &&
        statSync(join(PROJECT_ROOT, target.label)).isDirectory(),
);

const overall = runTypeCoverage("src", collectTypeScriptFiles(srcRoot), OVERALL_THRESHOLD);
const modules = moduleTargets.map((target) => runTypeCoverage(target.label, target.files, MODULE_THRESHOLD));
const failures = [overall, ...modules].filter((entry) => !entry.passed);

for (const result of [overall, ...modules]) {
    console.log(
        `${result.label}: ${result.percent.toFixed(2)}% (${result.correctCount}/${result.totalCount}) target >= ${result.threshold}%`,
    );
}

if (failures.length > 0) {
    console.error("\nType coverage threshold failures:");
    for (const failure of failures) {
        console.error(`- ${failure.label}: ${failure.percent.toFixed(2)}% < ${failure.threshold}%`);
    }
    process.exitCode = 1;
}
