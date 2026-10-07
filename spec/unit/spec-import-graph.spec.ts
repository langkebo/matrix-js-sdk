/*
 * `scripts/quality/lib/spec-import-graph.mjs` 的单元测试。
 *
 * 这个模块是「源文件到底有没有被测试触及」的**单一真相源**，
 * `find-lowest-coverage-files` 与 `find-lowest-coverage-modules` 都靠它出结论。
 * 它零 spec，意味着下面这些已经真实发生过的误报随时可以复现：
 *
 *   1. `path.extname("foo.spec.ts")` 返回 `".ts"`，所以 `exts.includes(path.extname(name))`
 *      用 `[".spec.ts"]` 永远为 false ⇒ **扫到 0 个 spec** ⇒ 全仓源文件被判"无测试"。
 *      这就是 COVERAGE_WEAK_FILES.md「471 源文件 / 0 测试文件」的根因。
 *      修法是 walk() 里改用 `name.endsWith(suffix)`。
 *   2. 本仓 spec 与源文件**不同名**（`src/client.ts` ← `matrix-client.spec.ts`、
 *      `src/three-pids/` ← `threepids.spec.ts`），任何"按 basename 猜"的实现
 *      都会产出大量假阳性 ⇒ 必须有 import 图这条兜底信号。
 *   3. 有 in-src 测试（`src/client/worker/worker.spec.ts`、`src/managers/cache-manager.spec.ts`），
 *      只扫 `spec/` 会把它们的被测源文件误判成"零测试"。
 *   4. `src/**\/__generated__/acceptance.spec.ts` 是**生成出来的测试**，
 *      它本身在 src 下，必须排除出"待覆盖源文件"，否则自造假阳性。
 *
 * 覆盖台账是用来排优先级的：它说"这个文件零测试"，工程师就会去补。
 * 假阳性直接等于把人力投到错的地方 —— 所以这里的断言按"历史上真踩过"来写。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
    buildSpecImportSet,
    collectAllSpecFiles,
    collectSourceFiles,
    collectSpecFiles,
    createCoverageSignals,
    hasDirectSpec,
    isSpecFile,
    moduleIsTouched,
    walk,
} from "../../scripts/quality/lib/spec-import-graph.mjs";

/** 迷你仓库的绝对路径。 */
let ROOT: string;
let SRC: string;
let SPEC: string;

function write(relPath: string, content = "") {
    const abs = path.join(ROOT, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
}

/** 转成仓库内相对路径（正斜杠），便于断言。 */
function rel(absPath: string): string {
    return path.relative(ROOT, absPath).split(path.sep).join("/");
}

beforeAll(() => {
    ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "spec-import-graph-"));
    SRC = path.join(ROOT, "src");
    SPEC = path.join(ROOT, "spec");

    // ── 源文件 ────────────────────────────────────────────────────────────
    write("src/client.ts", "export const client = 1;");
    write("src/foo/index.ts", "export const foo = 1;");
    write("src/foo/bar.ts", "export const bar = 1;");
    write("src/three-pids/index.ts", "export const threePids = 1;");
    write("src/orphan.ts", "export const orphan = 1;"); // 无任何 spec 触及
    write("src/types.d.ts", "declare const x: number;"); // 类型声明，不算源文件
    // 生成出来的测试：它自己是 spec，但放在 src 下，不能算"待覆盖源文件"
    write("src/__generated__/acceptance.spec.ts", "it('x', () => {});");
    // in-src 测试：与被测文件同级，Vitest 默认 include 会跑它
    write("src/worker/worker.ts", "export const w = 1;");
    write("src/worker/worker.spec.ts", 'import { w } from "./worker.js";');

    // ── spec ─────────────────────────────────────────────────────────────
    // 不同名对应：靠 import 图才能认出 src/client.ts 有测试
    write("spec/unit/matrix-client.spec.ts", 'import { client } from "../../src/client.js";');
    // index 特例：src/foo/index.ts ← spec/unit/foo.spec.ts
    write("spec/unit/foo.spec.ts", 'import { foo } from "../../src/foo/index.js";');
    // 模块名与 spec 名不同：three-pids ← threepids
    write("spec/unit/threepids.spec.ts", 'import { threePids } from "../../src/three-pids/index.js";');
    // 非相对说明符：必须被忽略（映射不到仓内文件）
    write("spec/unit/barrel.spec.ts", 'import { foo } from "@app/foo";');
});

afterAll(() => {
    fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("isSpecFile", () => {
    it("认三种后缀", () => {
        expect(isSpecFile("a.spec.ts")).toBe(true);
        expect(isSpecFile("a.spec.test.ts")).toBe(true);
        expect(isSpecFile("a.test.ts")).toBe(true);
    });

    it("不认普通源文件", () => {
        expect(isSpecFile("a.ts")).toBe(false);
        expect(isSpecFile("aspec.ts")).toBe(false);
        expect(isSpecFile("a.d.ts")).toBe(false);
    });
});

describe("walk", () => {
    it("默认收 .ts", () => {
        const files = walk(SRC).map(rel);
        expect(files).toContain("src/client.ts");
        expect(files).toContain("src/types.d.ts");
    });

    it("⚠️ 传 ['.spec.ts'] 必须能扫到 —— 用 path.extname 判等会恒为空（历史坑 1）", () => {
        // path.extname("worker.spec.ts") === ".ts"，永远不等于 ".spec.ts"
        const files = walk(SRC, [".spec.ts"]).map(rel);
        expect(files).toContain("src/worker/worker.spec.ts");
        expect(files).toContain("src/__generated__/acceptance.spec.ts");
        expect(files.length).toBeGreaterThan(0);
    });

    it("目录不存在时返回空数组，不抛", () => {
        expect(walk(path.join(ROOT, "no-such-dir"))).toEqual([]);
    });
});

describe("collectSourceFiles", () => {
    it("排除 .d.ts", () => {
        expect(collectSourceFiles(SRC).map(rel)).not.toContain("src/types.d.ts");
    });

    it("⚠️ 排除 src 下的 spec（含 __generated__ 生成的测试，历史坑 4）", () => {
        const files = collectSourceFiles(SRC).map(rel);
        expect(files).not.toContain("src/__generated__/acceptance.spec.ts");
        expect(files).not.toContain("src/worker/worker.spec.ts");
    });

    it("普通源文件照收", () => {
        const files = collectSourceFiles(SRC).map(rel);
        expect(files).toContain("src/client.ts");
        expect(files).toContain("src/worker/worker.ts");
        expect(files).toContain("src/orphan.ts");
    });
});

describe("collectSpecFiles / collectAllSpecFiles", () => {
    it("collectSpecFiles 只收一个目录", () => {
        expect(collectSpecFiles(SPEC).map(rel).sort()).toEqual([
            "spec/unit/barrel.spec.ts",
            "spec/unit/foo.spec.ts",
            "spec/unit/matrix-client.spec.ts",
            "spec/unit/threepids.spec.ts",
        ]);
    });

    it("⚠️ collectAllSpecFiles 必须带上 in-src spec（历史坑 3）", () => {
        const all = collectAllSpecFiles(SPEC, SRC).map(rel);
        expect(all).toContain("src/worker/worker.spec.ts");
        expect(all).toContain("src/__generated__/acceptance.spec.ts");
        // spec/ 下的也还在
        expect(all).toContain("spec/unit/foo.spec.ts");
    });

    it("结果已排序（跨多次运行输出稳定）", () => {
        const all = collectAllSpecFiles(SPEC, SRC);
        expect(all).toEqual([...all].sort());
    });
});

describe("buildSpecImportSet", () => {
    it("把 `.js` 说明符映射回 `.ts` 源文件", () => {
        const specs = [path.join(SPEC, "unit/matrix-client.spec.ts")];
        expect(buildSpecImportSet(SRC, specs).has("client.ts")).toBe(true);
    });

    it("目录说明符映射到 index.ts", () => {
        const specs = [path.join(SPEC, "unit/foo.spec.ts")].map((p) => p);
        const set = buildSpecImportSet(SRC, [...specs, ...[path.join(ROOT, "spec/unit/foo.spec.ts")]]);
        expect(set.has(path.join("foo", "index.ts"))).toBe(true);
    });

    it("忽略非相对说明符（映射不到仓内文件）", () => {
        const set = buildSpecImportSet(SRC, [path.join(SPEC, "unit/barrel.spec.ts")]);
        expect(set.size).toBe(0);
    });

    it("⚠️ 仓外目标不入库（rel 以 .. 开头）", () => {
        // 必须让仓外目标**真实存在**：否则 existsSync 为 false，集合本就是空的，
        // 断言会恒真（这个坑在第一次变异自证里就骗过一轮）。
        const outsideFile = path.join(ROOT, "..", "outside-thing.ts");
        const escapeSpec = path.join(SPEC, "unit/escape.spec.ts");
        fs.writeFileSync(outsideFile, "export const x = 1;");
        fs.writeFileSync(escapeSpec, 'import { x } from "../../../outside-thing.js";');
        try {
            const set = buildSpecImportSet(SRC, [escapeSpec]);
            expect([...set]).toEqual([]);
        } finally {
            fs.rmSync(outsideFile);
            fs.rmSync(escapeSpec);
        }
    });

    it("目标文件不存在时不入库", () => {
        const ghost = path.join(SPEC, "unit/ghost.spec.ts");
        fs.writeFileSync(ghost, 'import { nope } from "../../src/nope.js";');
        expect(buildSpecImportSet(SRC, [ghost]).has("nope.ts")).toBe(false);
        fs.rmSync(ghost);
    });
});

describe("hasDirectSpec", () => {
    it("扁平同名：src/client.ts ← spec/unit/client.spec.ts", () => {
        fs.writeFileSync(path.join(SPEC, "unit/client.spec.ts"), "");
        expect(hasDirectSpec(path.join(SRC, "client.ts"), SRC, SPEC)).toBe(true);
        fs.rmSync(path.join(SPEC, "unit/client.spec.ts"));
    });

    it("⚠️ index 特例：src/foo/index.ts ← spec/unit/foo.spec.ts", () => {
        expect(hasDirectSpec(path.join(SRC, "foo/index.ts"), SRC, SPEC)).toBe(true);
    });

    it("镜像路径：src/foo/bar.ts ← spec/unit/foo/bar.spec.ts", () => {
        fs.mkdirSync(path.join(SPEC, "unit/foo"), { recursive: true });
        fs.writeFileSync(path.join(SPEC, "unit/foo/bar.spec.ts"), "");
        expect(hasDirectSpec(path.join(SRC, "foo/bar.ts"), SRC, SPEC)).toBe(true);
        fs.rmSync(path.join(SPEC, "unit/foo"), { recursive: true, force: true });
    });

    it("没有对应 spec 时返回 false（哪怕名字很像）", () => {
        expect(hasDirectSpec(path.join(SRC, "orphan.ts"), SRC, SPEC)).toBe(false);
        // src/client.ts 只有不同名的 matrix-client.spec.ts，不是"直接 spec"
        expect(hasDirectSpec(path.join(SRC, "client.ts"), SRC, SPEC)).toBe(false);
    });
});

describe("createCoverageSignals", () => {
    it("⚠️ 不同名对应靠 import 图认出（历史坑 2）", () => {
        const signals = createCoverageSignals(SRC, SPEC);
        // src/client.ts 没有 client.spec.ts，只有 import 它的 matrix-client.spec.ts
        expect(signals.isTouched(path.join(SRC, "client.ts"))).toBe(true);
        expect(hasDirectSpec(path.join(SRC, "client.ts"), SRC, SPEC)).toBe(false);
    });

    it("in-src spec 也能证明被测文件被触及", () => {
        const signals = createCoverageSignals(SRC, SPEC);
        expect(signals.isTouched(path.join(SRC, "worker/worker.ts"))).toBe(true);
    });

    it("真正的孤儿文件判为未触及", () => {
        const signals = createCoverageSignals(SRC, SPEC);
        expect(signals.isTouched(path.join(SRC, "orphan.ts"))).toBe(false);
    });

    it("sourceFiles 不含 .d.ts 与 in-src spec", () => {
        const { sourceFiles } = createCoverageSignals(SRC, SPEC);
        const rels = sourceFiles.map(rel);
        expect(rels).not.toContain("src/types.d.ts");
        expect(rels).not.toContain("src/worker/worker.spec.ts");
    });

    it("specFiles 含 in-src spec", () => {
        const { specFiles } = createCoverageSignals(SRC, SPEC);
        expect(specFiles.map(rel)).toContain("src/worker/worker.spec.ts");
    });
});

describe("moduleIsTouched", () => {
    it("⚠️ 模块名与 spec 名不同也能认出（three-pids ← threepids.spec.ts）", () => {
        const signals = createCoverageSignals(SRC, SPEC);
        expect(moduleIsTouched("three-pids", SRC, SPEC, signals)).toBe(true);
    });

    it("src 下不存在的模块返回 false，不抛", () => {
        const signals = createCoverageSignals(SRC, SPEC);
        expect(moduleIsTouched("no-such-module", SRC, SPEC, signals)).toBe(false);
    });

    it("未被任何 spec 触及的模块返回 false", () => {
        fs.mkdirSync(path.join(SRC, "lonely"), { recursive: true });
        fs.writeFileSync(path.join(SRC, "lonely/thing.ts"), "export const t = 1;");
        const signals = createCoverageSignals(SRC, SPEC);
        expect(moduleIsTouched("lonely", SRC, SPEC, signals)).toBe(false);
        fs.rmSync(path.join(SRC, "lonely"), { recursive: true, force: true });
    });
});
