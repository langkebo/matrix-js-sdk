/*
 * `scripts/quality/lib/write-json.mjs` 的单元测试 + 一条仓级静态守卫。
 *
 * ## 为什么需要
 *
 * 门禁/基线的落盘方式有个隐蔽的坑：`JSON.stringify(payload, null, 4)` 会把**放得下的数组
 * 展开成多行**，而 prettier 会折叠回一行。于是「门禁自己印出来的修复指令」每跑一次就把
 * `pnpm lint:js` 弄红 —— 用户照做反而得到一个红的工作区。
 *
 *   · 2026-10-07 在 `msc-reference-baseline.json` 上实测过一次并单独修过；
 *   · 2026-10-08 又踩在 `admin-response-contract-ledger.json` 上（`--refresh` 后 lint 直接红）。
 *
 * 所以这里做两件事：① 测共享实现本身；② 用**静态守卫**把"别再绕过它"变成可执行的判据 ——
 * 光有共享库挡不住下一个人继续写 `fs.writeFileSync(path, JSON.stringify(...))`。
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { writeJsonFormatted } from "../../scripts/quality/lib/write-json.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const QUALITY_DIR = path.join(projectRoot, "scripts", "quality");
/** 真 prettier CLI —— 不自己实现格式规则。 */
const PRETTIER_BIN = createRequire(import.meta.url).resolve("prettier/bin/prettier.cjs");

/** 落盘后必须能被 `prettier --check` 接受 —— 用真 prettier CLI 验。 */
function prettierCheckPasses(file: string): boolean {
    try {
        execFileSync(process.execPath, [PRETTIER_BIN, "--check", file], { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

describe("writeJsonFormatted", () => {
    it("写出的文件直接通过 `prettier --check`（这正是 bug 的复发点）", () => {
        const probe = path.join(QUALITY_DIR, "__write-json-probe.json");
        try {
            writeJsonFormatted(probe, { a: [1, 2, 3], b: { c: ["x"] } });
            expect(prettierCheckPasses(probe)).toBe(true);
            // 反证：裸 `JSON.stringify(_, null, 4)` 的形态确实**不**通过（否则这条测试什么也没证）
            writeFileSync(probe, `${JSON.stringify({ a: [1, 2, 3], b: { c: ["x"] } }, null, 4)}\n`);
            expect(prettierCheckPasses(probe)).toBe(false);
        } finally {
            unlinkSync(probe);
        }
    });

    it("幂等：同一 payload 写两次，字节相同", () => {
        const probe = path.join(QUALITY_DIR, "__write-json-probe.json");
        try {
            const payload = { list: [1], nested: { deep: ["x"] } };
            writeJsonFormatted(probe, payload);
            const first = readFileSync(probe, "utf8");
            writeJsonFormatted(probe, payload);
            expect(readFileSync(probe, "utf8")).toBe(first);
        } finally {
            unlinkSync(probe);
        }
    });
});

describe("仓级静态守卫：不得绕过 writeJsonFormatted 写台账", () => {
    /*
     * 判据：`scripts/quality/**` 里不允许出现
     *   `writeFileSync(<目标>, `${JSON.stringify(...)}\n`)`
     * 这一形态（lib/write-json.mjs 自身除外）。
     *
     * 唯一豁免：`check-docs-examples.mjs` 写的是 `.docs-examples/tsconfig.json` ——
     * 那是**生成产物**、在 `.prettierignore` 里（`/.docs-examples/`），不是被 prettier 管的台账。
     * 豁免按「目标表达式含 GENERATED_DIR / TSCONFIG_PATH」判定，而不是按文件名放行。
     */
    const files = readdirSync(QUALITY_DIR)
        .filter((f) => f.endsWith(".mjs"))
        .filter((f) => f !== "write-json.mjs");
    // lib/ 下的共享库同样受管（除了 helper 自己）
    const libFiles = readdirSync(path.join(QUALITY_DIR, "lib"))
        .filter((f) => f.endsWith(".mjs") && f !== "write-json.mjs")
        .map((f) => path.join("lib", f));

    const RAW_WRITE = /writeFileSync\(\s*[^,]+,\s*`\$\{JSON\.stringify\(/;

    it("被扫描的文件数 > 0（防止路径写错导致空跑）", () => {
        expect(files.length).toBeGreaterThan(10);
    });

    it.each([...files, ...libFiles])("%s 里没有裸 JSON 写盘", (rel) => {
        const full = path.join(QUALITY_DIR, rel);
        const offenders = readFileSync(full, "utf8")
            .split(/\r?\n/)
            .filter((line) => RAW_WRITE.test(line))
            .filter((line) => !/GENERATED_DIR|TSCONFIG_PATH/.test(line));
        expect(offenders).toEqual([]);
    });

    it("豁免确实只发生在 prettier 忽略目录（`.docs-examples/`）里", () => {
        const src = readFileSync(path.join(QUALITY_DIR, "check-docs-examples.mjs"), "utf8");
        expect(src).toMatch(/GENERATED_DIR\s*=\s*path\.join\([^)]*\.docs-examples/);
    });
});
