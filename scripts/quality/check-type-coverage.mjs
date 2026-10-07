import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawn } from "node:child_process";

const PROJECT_ROOT = process.cwd();
// 9 次 type-coverage 各自都是一次完整 TS 类型检查，串行跑要 85s+。
// 并发度默认 3：再高会让多个 tsc 进程同时吃内存（本机实测 4GB+），
// 在内存受限的 CI runner 上有 OOM 风险。需要压测时可用环境变量覆盖。
const CONCURRENCY = Math.max(1, Number(process.env.TYPE_COVERAGE_CONCURRENCY ?? 3) || 3);
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

export function collectTypeScriptFiles(rootDir, recursive = true) {
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

// 判定逻辑与串行版完全一致（同样 9 次调用、同样参数、同样阈值），只是并发执行。
// 用 gate-golden 对拍：capture（改前）→ 改造 → verify 必须逐字节一致。
function runTypeCoverage(label, files, threshold) {
    // type-coverage expects paths relative to the project root; absolute paths
    // cause it to silently return 0/0.
    const relativeFiles = files.map((f) => relative(PROJECT_ROOT, f));
    const args = relativeFiles.length > 0 ? [...COMMON_ARGS, "--", ...relativeFiles] : COMMON_ARGS;

    return new Promise((resolve, reject) => {
        const child = spawn("pnpm", args, { cwd: PROJECT_ROOT });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        child.on("error", reject);
        child.on("close", (status) => {
            if (status !== 0 && !stdout.trim()) {
                reject(new Error(`type-coverage failed for ${label}:\n${stderr}`));
                return;
            }
            try {
                const payload = JSON.parse(stdout);
                const percent = Number(payload.percent);
                resolve({
                    label,
                    percent,
                    correctCount: payload.correctCount,
                    totalCount: payload.totalCount,
                    threshold,
                    passed: percent >= threshold,
                });
            } catch (error) {
                reject(new Error(`type-coverage returned unparsable output for ${label}:\n${stdout}`));
            }
        });
    });
}

// 固定并发度的任务池：results 按入参顺序回填，因此 stdout 顺序与串行版相同
//（overall 先、modules 按 moduleTargets 原顺序），对拍才不会被顺序差异干扰。
async function runPool(tasks) {
    const results = new Array(tasks.length);
    let cursor = 0;
    const worker = async () => {
        while (cursor < tasks.length) {
            const index = cursor++;
            results[index] = await tasks[index]();
        }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, () => worker()));
    return results;
}

async function main() {
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

    const [overall, ...modules] = await runPool([
        () => runTypeCoverage("src", collectTypeScriptFiles(srcRoot), OVERALL_THRESHOLD),
        ...moduleTargets.map((target) => () => runTypeCoverage(target.label, target.files, MODULE_THRESHOLD)),
    ]);
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
}

// 仅在被直接执行时跑 main（原为顶层裸跑：import 会触发 9 次完整类型检查）
if (import.meta.url === `file://${process.argv[1]}`) {
    await main();
}
