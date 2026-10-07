/*
 * `scripts/quality/check-docs-examples.mjs` 的单元测试。
 *
 * 这个门禁把 Quickstart 文档里带 `title="..."` 的 TypeScript 代码块抽成真实 .ts，
 * 再对本仓 src 跑一次 tsc —— 目的只有一个：**让文档示例腐烂时 CI 红**。
 * 所以这里钉的是「抽不抽得到」和「抽出来往哪写」这两个环节，
 * 编译本身交给门禁自己跑（单次约 45s，不适合进单测）。
 *
 * 值得钉的口径：
 *
 *   · **只有带 title 的围栏参与编译**：不带 title 的是说明性片段，缺上下文必然编译失败。
 *     放宽成「所有 typescript 围栏都抽」会让门禁直接红得没有意义。
 *   · **未闭合围栏要报出来**：它属于「围栏写法被改坏」，静默跳过等于少检查一个示例。
 *   · **title 只取 basename**：`title="../../etc/passwd"` 必须写不到仓外去。
 *   · **错误全部收集，不 early return**：第一个坏 title 就 return 的话，后面的坏 title
 *     永远看不见，一次只能修一个。
 *   · **防死门禁的下限必须等于实际抽取数**（现在 6）：留余量就等于允许示例静默消失——
 *     这条是被变异自证抓出来的（曾经设 5 而实际 6，去掉一个 title 仍然通过）。
 */

import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
    MIN_EXTRACTED_BLOCKS,
    SUBPATH_ENTRIES,
    buildTsconfig,
    extractBlocks,
    listMarkdownFiles,
    parseBlocks,
    planGenerated,
} from "../../scripts/quality/check-docs-examples.mjs";

const GATE_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../scripts/quality/check-docs-examples.mjs");
const SCOPE_DIR = "docs/guide";

describe("check-docs-examples: 围栏抽取", () => {
    it("抽取带 title 的 typescript 围栏，记下 fenceLine 与正文", () => {
        const lines = ["# 标题", "", '```typescript title="01a-demo.ts"', "const a = 1;", "```", ""];
        const { blocks, unclosed } = parseBlocks(lines, "docs/guide/01.md");

        expect(unclosed).toBeNull();
        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toMatchObject({
            title: "01a-demo.ts",
            fenceLine: 3,
            markdownPath: "docs/guide/01.md",
            body: "const a = 1;",
        });
    });

    it("`ts` 简写同样参与抽取", () => {
        const lines = ['```ts title="x.ts"', "export const x = 1;", "```"];
        expect(parseBlocks(lines, "a.md").blocks).toHaveLength(1);
    });

    it("不带 title 的围栏是说明性片段，不参与编译", () => {
        const lines = ["```typescript", "const fragment = 1;", "```"];
        expect(parseBlocks(lines, "a.md").blocks).toEqual([]);
    });

    it("`typescript` 后没有 title 也只算片段", () => {
        const lines = ["```typescript ", "const fragment = 1;", "```"];
        expect(parseBlocks(lines, "a.md").blocks).toEqual([]);
    });

    it("多个围栏都会被抽到", () => {
        const lines = [
            '```typescript title="a.ts"',
            "const a = 1;",
            "```",
            "中间说明",
            '```typescript title="b.ts"',
            "const b = 2;",
            "```",
        ];
        const { blocks } = parseBlocks(lines, "a.md");
        expect(blocks.map((b) => b.title)).toEqual(["a.ts", "b.ts"]);
        expect(blocks[1].fenceLine).toBe(5);
    });

    it("未闭合围栏要报出来，而不是静默少抽一个", () => {
        const lines = ['```typescript title="a.ts"', "const a = 1;"];
        const { blocks, unclosed } = parseBlocks(lines, "a.md");

        expect(blocks).toEqual([]);
        expect(unclosed).toEqual({ markdownPath: "a.md", startLine: 1 });
    });

    it("未闭合围栏之前那些正常围栏仍然抽得到", () => {
        const lines = [
            '```typescript title="a.ts"',
            "const a = 1;",
            "```",
            '```typescript title="b.ts"',
            "const b = 2;",
        ];
        const { blocks, unclosed } = parseBlocks(lines, "a.md");

        expect(blocks.map((b) => b.title)).toEqual(["a.ts"]);
        expect(unclosed?.startLine).toBe(4);
    });
});

describe("check-docs-examples: 落盘规划", () => {
    const block = (title: string, markdownPath = "a.md") => ({
        title,
        startLine: 1,
        fenceLine: 1,
        body: "const a = 1;",
        markdownPath,
    });

    it("title 只取 basename —— 写不到仓外去", () => {
        const { planned, errors } = planGenerated([block("../../etc/passwd.ts")]);
        expect(errors).toEqual([]);
        expect(planned[0].fileName).toBe("passwd.ts");
    });

    it("title 不是 .ts 结尾就是错误", () => {
        const { planned, errors } = planGenerated([block("01a-demo.md")]);
        expect(planned).toEqual([]);
        expect(errors).toEqual(["[docs-examples] a.md:1 title 必须以 .ts 结尾"]);
    });

    it("重复 title 是错误，并点出两份文档", () => {
        const { planned, errors } = planGenerated([
            block("01a-demo.ts", "docs/guide/01.md"),
            block("01a-demo.ts", "docs/guide/02.md"),
        ]);

        expect(planned).toHaveLength(1);
        expect(errors).toEqual(['[docs-examples] 重复的 title="01a-demo.ts"（docs/guide/01.md 与 docs/guide/02.md）']);
    });

    it("错误全部收集，不会遇到第一个就停", () => {
        const { planned, errors } = planGenerated([block("a.md"), block("b.js"), block("c.ts")]);
        expect(errors).toHaveLength(2);
        expect(planned.map((p) => p.fileName)).toEqual(["c.ts"]);
    });

    it("path 穿越但 basename 相同的两个 title 也按重复处理", () => {
        const { planned, errors } = planGenerated([block("sub/../x.ts"), block("x.ts")]);
        expect(planned).toHaveLength(1);
        expect(errors).toHaveLength(1);
    });
});

describe("check-docs-examples: 生成的 tsconfig", () => {
    it("paths 的 value 必须是数组（写成字符串会报 TS5063）", () => {
        const tsconfig = buildTsconfig();
        const paths = (tsconfig.compilerOptions as Record<string, unknown>).paths as Record<string, unknown>;

        for (const [key, value] of Object.entries(paths)) {
            expect(Array.isArray(value), `${key} 的 paths value 必须是数组`).toBe(true);
        }
        expect(paths).toEqual(SUBPATH_ENTRIES);
    });

    it("paths 是 SUBPATH_ENTRIES 的副本，改结果不会污染常量", () => {
        const tsconfig = buildTsconfig();
        const paths = (tsconfig.compilerOptions as Record<string, unknown>).paths as Record<string, unknown>;
        (paths["@langkebo/matrix-js-sdk"] as string[]).push("src/evil.ts");

        expect(SUBPATH_ENTRIES["@langkebo/matrix-js-sdk"]).toEqual(["src/index.ts"]);
    });

    it("只编译抽出来的 .ts，且增量缓存不落在主 tsconfig 上", () => {
        const tsconfig = buildTsconfig();
        expect(tsconfig.include).toEqual(["./*.ts"]);
        expect((tsconfig.compilerOptions as Record<string, unknown>).noEmit).toBe(true);
        expect((tsconfig.compilerOptions as Record<string, unknown>).tsBuildInfoFile).toBe("./.tsbuildinfo");
    });
});

describe("check-docs-examples: 防死门禁", () => {
    it("下限必须等于真实抽取数 —— 留余量就等于允许示例静默消失", () => {
        const files = listMarkdownFiles(SCOPE_DIR);
        const blocks = files.flatMap((file) => extractBlocks(file));
        const { planned, errors } = planGenerated(blocks);

        expect(errors).toEqual([]);
        expect(planned.length).toBe(MIN_EXTRACTED_BLOCKS);
    });

    it("真实文档里每个被抽的示例都有合法 title", () => {
        const files = listMarkdownFiles(SCOPE_DIR);
        const blocks = files.flatMap((file) => extractBlocks(file));

        expect(blocks.length).toBeGreaterThan(0);
        for (const b of blocks) {
            expect(b.title.endsWith(".ts")).toBe(true);
            expect(b.body.trim().length).toBeGreaterThan(0);
        }
    });
});

describe("check-docs-examples: 模块入口", () => {
    it("import 时不跑 main —— 顶层裸跑会让 spec 一 import 就抽示例并跑 tsc / exit", () => {
        const source = fs.readFileSync(GATE_PATH, "utf8");
        expect(source).toMatch(/if \(import\.meta\.url === `file:\/\/\$\{process\.argv\[1\]\}`\)/);
        expect(source).not.toMatch(/^main\(\);$/m);
    });
});
