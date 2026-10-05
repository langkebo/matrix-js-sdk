#!/usr/bin/env node
/**
 * run-granular-coverage-gates.mjs —— granular 覆盖门禁的统一入口
 *
 * 背景:
 *   仓里有 18 个 `scripts/quality/check-*-granular-coverage.mjs`，各自声明某个模块
 *   的一组方法"必须存在且必须有测试命中"。它们**都是会失败的判定门禁**
 *   （`process.exitCode = 1`），但此前**没有任何 CI workflow 或 lint 链调用它们**
 *   —— 属于"看起来有门禁、实际从不执行"的形态。
 *
 *   本脚本按 package.json 自动发现这些门禁（不硬编码清单，避免新增门禁被漏掉），
 *   逐个执行并汇总。任何一个失败 => 整体 exit 1。
 *
 * @discovers-gates: scripts/quality/check-*-granular-coverage.mjs
 *   ↑ 这一行是给 `check-gate-reachability.mjs`（死门禁门禁）看的机器可读标记：
 *     闭包算法看不到"按 package.json 动态发现"的成员，只做静态引用分析会把
 *     下面这 18 个门禁全部误报为死门禁。任何新增的聚合入口都应写同样的标记。
 *
 * 用法:
 *   node scripts/quality/run-granular-coverage-gates.mjs          # 全量
 *   node scripts/quality/run-granular-coverage-gates.mjs --quiet  # 只打印汇总与失败详情
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..", "..");

const quiet = process.argv.includes("--quiet");

const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));

/** 自动发现所有 granular 覆盖门禁：脚本名形如 scripts/quality/check-*-granular-coverage.mjs */
const gates = Object.entries(pkg.scripts)
    .filter(([, cmd]) => /scripts\/quality\/check-[a-z0-9-]*-granular-coverage\.mjs/.test(cmd))
    .map(([name, cmd]) => ({ name, script: cmd.replace(/^node\s+/, "").trim() }))
    .sort((a, b) => a.name.localeCompare(b.name));

if (gates.length === 0) {
    console.error("[granular-coverage] 没有发现任何 granular 覆盖门禁，疑似发现逻辑失效");
    process.exit(1);
}

const failures = [];

console.log("=".repeat(72));
console.log(`[granular-coverage] 执行 ${gates.length} 个 granular 覆盖门禁`);
console.log("=".repeat(72));

for (const gate of gates) {
    const scriptPath = path.join(projectRoot, gate.script);
    if (!fs.existsSync(scriptPath)) {
        failures.push({ name: gate.name, reason: `脚本不存在: ${gate.script}` });
        console.error(`✗ ${gate.name}  (脚本缺失: ${gate.script})`);
        continue;
    }
    try {
        const out = execFileSync(process.execPath, [scriptPath], {
            cwd: projectRoot,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
        });
        if (!quiet) console.log(out.trim());
        const summary = (out.match(/Groups passed: \d+\/\d+/) || [""])[0];
        console.log(`✓ ${gate.name.padEnd(44)} ${summary}`);
    } catch (e) {
        const out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
        // 门禁自身失败：把它的输出原样打出来，便于定位是哪一组方法缺实现/缺测试
        if (!quiet && out.trim()) console.log(out.trim());
        const detail = out
            .split("\n")
            .filter((l) => /FAIL:|missing methods|without test hits/.test(l))
            .slice(0, 6)
            .join("\n      ");
        failures.push({ name: gate.name, reason: detail || `exit ${e.status ?? "?"}` });
        const summary = (out.match(/Groups passed: \d+\/\d+/) || [""])[0];
        console.error(`✗ ${gate.name.padEnd(44)} ${summary}`);
    }
}

console.log("=".repeat(72));
if (failures.length) {
    console.error(`[granular-coverage] FAILED: ${failures.length}/${gates.length} 个门禁未通过\n`);
    for (const f of failures) {
        console.error(`  ✗ ${f.name}`);
        console.error(`      ${f.reason}`);
    }
    process.exit(1);
}
console.log(`[granular-coverage] ✅ 全部 ${gates.length} 个门禁通过`);
