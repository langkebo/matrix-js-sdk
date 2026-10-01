#!/usr/bin/env node
/**
 * check-msc-changes.mjs - MSC 编号变更检测门禁
 *
 * 用法:
 *   node scripts/quality/check-msc-changes.mjs           # 正常模式：对比当前 vs baseline
 *   node scripts/quality/check-msc-changes.mjs --strict  # 严格模式：新增未文档化的 MSC 报错
 *   node scripts/quality/check-msc-changes.mjs --update-baseline  # 更新基线（需在 docs/MSC_SDK_MAPPING.md 更新后）
 *
 * 原理:
 *   1. 从 SDK 源码提取所有 MSC[0-9]{4} 引用
 *   2. 对比 msc-reference-baseline.json
 *   3. 检查 docs/MSC_SDK_MAPPING.md 是否覆盖所有编号
 *   4. 输出差异并决定 exit code
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "../..");

const BASELINE_PATH = join(__dirname, "msc-reference-baseline.json");
const DOC_PATH = join(ROOT, "docs/MSC_SDK_MAPPING.md");

function walkDir(dir, callback) {
    for (const file of readdirSync(dir)) {
        const full = join(dir, file);
        const st = statSync(full);
        if (st.isDirectory() && !file.startsWith(".")) {
            walkDir(full, callback);
        } else if (file.endsWith(".ts") && !file.endsWith(".d.ts")) {
            callback(full);
        }
    }
}

function extractMSCsFromSource() {
    const mscMap = new Map(); // number -> Set<file>
    walkDir(join(ROOT, "src"), (fullPath) => {
        const content = readFileSync(fullPath, "utf8");
        const relPath = relative(ROOT, fullPath);
        const matches = content.match(/\bMSC(\d{4})\b/g) || [];
        for (const m of matches) {
            const num = m.slice(3);
            if (!mscMap.has(num)) mscMap.set(num, new Set());
            mscMap.get(num).add(relPath);
        }
    });
    return mscMap;
}

function loadBaseline() {
    try {
        return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    } catch (err) {
        console.error(`❌ Cannot load baseline: ${BASELINE_PATH}`);
        process.exit(1);
    }
}

function loadDoc() {
    return readFileSync(DOC_PATH, "utf8");
}

function formatDiff(current, baseline) {
    const added = [];
    const removed = [];
    const moved = [];

    const currKeys = new Set(current.keys());
    const baseKeys = new Set(Object.keys(baseline.entries || {}));

    // New MSCs
    for (const num of currKeys) {
        if (!baseKeys.has(num)) {
            added.push({ num, files: [...current.get(num)].sort() });
        }
    }

    // Removed MSCs
    for (const num of baseKeys) {
        if (!currKeys.has(num)) {
            removed.push({ num, files: baseline.entries[num] });
        }
    }

    // Moved MSCs (files changed)
    for (const num of currKeys) {
        if (baseKeys.has(String(num))) {
            const currFiles = new Set(current.get(num));
            const baseFiles = new Set(baseline.entries[String(num)]);
            if (![...currFiles].every(f => baseFiles.has(f)) ||
                ![...baseFiles].every(f => currFiles.has(f))) {
                moved.push({
                    num,
                    oldFiles: baseline.entries[String(num)],
                    newFiles: [...currFiles].sort()
                });
            }
        }
    }

    return { added, removed, moved };
}

function main() {
    const args = process.argv.slice(2);
    const mode = args.includes("--strict") ? "strict" : "normal";
    const updateBaseline = args.includes("--update-baseline");

    const current = extractMSCsFromSource();
    const baseline = loadBaseline();
    const doc = loadDoc();

    console.log(`\n🔍 MSC 变更检测 (mode=${mode})`);
    console.log(`   Current MSC count: ${current.size}`);
    console.log(`   Baseline count:    ${baseline.total}`);

    // Check doc coverage
    const uncovered = [];
    for (const [num] of current) {
        if (!doc.includes("MSC" + num)) {
            uncovered.push("MSC" + num);
        }
    }

    if (uncovered.length > 0) {
        console.error(`\n❌ 文档未覆盖 (${uncovered.length}条):\n   ${uncovered.join(", ")}`);
        console.error("\n💡 请在 docs/MSC_SDK_MAPPING.md 中添加这些 MSC 的条目");
        process.exit(1);
    }

    console.log(`\n✅ 文档覆盖率：100% (${current.size}/0 uncovered)`);

    if (updateBaseline) {
        const newBaseline = {
            generatedAt: new Date().toISOString(),
            note: baseline.note,
            total: current.size,
            entries: Object.fromEntries(
                [...current.entries()].sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
                    .map(([num, files]) => [num, [...files].sort()])
            )
        };
        writeFileSync(BASELINE_PATH, JSON.stringify(newBaseline, null, 4) + "\n");
        console.log(`\n✅ Baseline updated: ${BASELINE_PATH}`);
        console.log(`   Total MSC entries: ${current.size}`);
        return;
    }

    // Compute diff
    const diff = formatDiff(current, baseline);

    if (diff.added.length === 0 && diff.removed.length === 0 && diff.moved.length === 0) {
        console.log("\n✅ No MSC changes detected.");
        return;
    }

    let hasError = false;

    if (diff.added.length > 0) {
        console.log(`\n📈 Added (${diff.added.length}):`);
        for (const item of diff.added) {
            console.log(`   - MSC${item.num}: ${item.files.join(", ")}`);
        }
        if (mode === "strict") {
            console.error("\n❌ Strict mode: newly added MSCs must be documented first.");
            hasError = true;
        }
    }

    if (diff.removed.length > 0) {
        console.log(`\n📉 Removed (${diff.removed.length}):`);
        for (const item of diff.removed) {
            console.log(`   - MSC${item.num}: ${item.files.join(", ")}`);
        }
    }

    if (diff.moved.length > 0) {
        console.log(`\n🔄 Moved (${diff.moved.length}):`);
        for (const item of diff.moved) {
            console.log(`   - MSC${item.num}:`);
            console.log(`      Old: ${item.oldFiles.join(", ")}`);
            console.log(`      New: ${item.newFiles.join(", ")}`);
        }
    }

    if (hasError) {
        console.error("\n💡 Run 'node scripts/quality/check-msc-changes.mjs --update-baseline' after documenting new MSCs in docs/MSC_SDK_MAPPING.md");
        process.exit(1);
    }

    console.log("\n💡 Warning: MSC drift detected but not blocking (non-strict mode).");
    console.log("   Consider updating baseline: node scripts/quality/check-msc-changes.mjs --update-baseline");
}

main();
