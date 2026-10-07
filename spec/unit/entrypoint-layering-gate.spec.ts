/*
 * `scripts/quality/check-entrypoint-layering.mjs` 的单元测试。
 *
 * 这个门禁守的是入口分层：`src/core.ts` 只能从核心白名单模块再导出、
 * 不能泄漏 `AdminManager` 这类 advanced-only 的 manager；`src/advanced.ts`
 * 只能从进阶白名单再导出。分层一旦被绕过，打包体积与循环依赖都会失控，
 * 而这类回退在 code review 里极难发现。
 *
 * 值得钉的口径：
 *
 *   · **只认「再导出」来源**：`export const a = 1` 是本地声明，不是来源。
 *     把它也算进来源清单，「core 只能从白名单再导出」就形同虚设。
 *   · **`export *` 不传递 `default`**：星号再导出按规范就不导出默认，
 *     收进来会让「core 泄漏了某个符号」的判定在只有星号链路时假绿。
 *   · **`export { a as b }` 取别名 `b`**：调用方看的是导出名。
 *   · **违规要全部列出**：只报第一条的话，一次只能修一个，
 *     而分层回退往往是一批一起进来的。
 *   · **真实仓库守卫**：对真实的 `src/core.ts` 跑一遍收集，确认 7 个 manager
 *     一个都不在导出符号里 —— 这是这个门禁真正要拦的东西，
 *     光测纯函数等于没测。
 */

import fs from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
    collectExportedSymbols,
    extractExportSpecifiers,
    findDisallowedExportFrom,
    findForbiddenExportedSymbols,
    findForbiddenPatterns,
    resolveRelativeModule,
} from "../../scripts/quality/check-entrypoint-layering.mjs";

const GATE_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../scripts/quality/check-entrypoint-layering.mjs");

const tmpDirs: string[] = [];

function makeTmp(): string {
    const dir = fs.mkdtempSync(join(os.tmpdir(), "entrypoint-layering-"));
    tmpDirs.push(dir);
    return dir;
}

function writeFile(filePath: string, content: string): void {
    fs.mkdirSync(dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
}

afterEach(() => {
    while (tmpDirs.length) {
        const dir = tmpDirs.pop();
        if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe("check-entrypoint-layering: 再导出来源抽取", () => {
    it("抽出 export * from 的来源", () => {
        expect(extractExportSpecifiers('export * from "./matrix";\n')).toEqual(["./matrix"]);
    });

    it("抽出 export { ... } from 的来源（含 type 修饰）", () => {
        expect(extractExportSpecifiers('export { a, b } from "./client";\n')).toEqual(["./client"]);
        expect(extractExportSpecifiers('export type { T } from "./errors";\n')).toEqual(["./errors"]);
    });

    it("本地声明不是「来源」，不能混进来源清单", () => {
        expect(extractExportSpecifiers("export const a = 1;\n")).toEqual([]);
        expect(extractExportSpecifiers("export class Foo {}\n")).toEqual([]);
        expect(extractExportSpecifiers("export function f() {}\n")).toEqual([]);
    });

    it("没有 from 的 export { } 不是来源", () => {
        expect(extractExportSpecifiers("export { a, b };\n")).toEqual([]);
    });

    it("多个来源按出现顺序全部抽出", () => {
        const source = ['export * from "./matrix";', 'export { x } from "./client";'].join("\n");
        expect(extractExportSpecifiers(source)).toEqual(["./matrix", "./client"]);
    });
});

describe("check-entrypoint-layering: 导出符号收集", () => {
    it("认各种具名声明", () => {
        const root = makeTmp();
        const file = join(root, "a.ts");
        writeFile(
            file,
            [
                "export class Foo {}",
                "export interface Bar {}",
                "export type Baz = string;",
                "export enum Qux { A }",
                "export function fn() {}",
                "export const value = 1;",
                "export declare abstract class AbstractFoo {}",
            ].join("\n"),
        );

        const symbols = collectExportedSymbols(file);
        expect([...symbols].sort()).toEqual(["AbstractFoo", "Bar", "Baz", "Foo", "Qux", "fn", "value"].sort());
    });

    it("export { a as b } 取别名 b —— 调用方看的是导出名", () => {
        const root = makeTmp();
        const file = join(root, "a.ts");
        writeFile(file, "const inner = 1;\nexport { inner as Public };\n");

        expect([...collectExportedSymbols(file)]).toEqual(["Public"]);
    });

    it("export { type X } 剥掉 type 修饰后仍记符号名", () => {
        const root = makeTmp();
        const file = join(root, "a.ts");
        writeFile(file, "export { type Internal as Exported } from './b';\n");

        expect([...collectExportedSymbols(file)]).toEqual(["Exported"]);
    });

    it("export * from 会递归展开", () => {
        const root = makeTmp();
        writeFile(join(root, "leaf.ts"), "export const leaf = 1;\n");
        writeFile(join(root, "mid.ts"), 'export * from "./leaf";\nexport const mid = 2;\n');
        writeFile(join(root, "top.ts"), 'export * from "./mid";\n');

        expect([...collectExportedSymbols(join(root, "top.ts"))].sort()).toEqual(["leaf", "mid"]);
    });

    it("export * from 不传递 default", () => {
        const root = makeTmp();
        writeFile(join(root, "b.ts"), "const x = 1;\nexport default x;\n");
        writeFile(join(root, "a.ts"), 'export { default } from "./b";\nexport const keep = 2;\n');
        writeFile(join(root, "top.ts"), 'export * from "./a";\n');

        const symbols = collectExportedSymbols(join(root, "top.ts"));
        expect(symbols.has("default")).toBe(false);
        expect(symbols.has("keep")).toBe(true);
    });

    it("循环再导出不会栈溢出", () => {
        const root = makeTmp();
        writeFile(join(root, "a.ts"), 'export * from "./b";\nexport const a = 1;\n');
        writeFile(join(root, "b.ts"), 'export * from "./a";\nexport const b = 2;\n');

        const symbols = collectExportedSymbols(join(root, "a.ts"));
        expect(symbols.has("a")).toBe(true);
        expect(symbols.has("b")).toBe(true);
    });

    it("文件不存在或不是文件时返回空集合", () => {
        const root = makeTmp();
        writeFile(join(root, "a.ts"), "export const a = 1;\n");

        expect(collectExportedSymbols(join(root, "nope.ts")).size).toBe(0);
        expect(collectExportedSymbols(root).size).toBe(0);
    });
});

describe("check-entrypoint-layering: 相对模块解析", () => {
    it("解析 .ts / .d.ts / index.ts / index.d.ts 四种候选", () => {
        const root = makeTmp();
        writeFile(join(root, "direct.ts"), "export const a = 1;\n");
        writeFile(join(root, "declared.d.ts"), "export const b = 1;\n");
        writeFile(join(root, "pkg", "index.ts"), "export const c = 1;\n");
        writeFile(join(root, "types", "index.d.ts"), "export const d = 1;\n");

        const from = join(root, "entry.ts");
        expect(resolveRelativeModule(from, "./direct")).toBe(join(root, "direct.ts"));
        expect(resolveRelativeModule(from, "./declared")).toBe(join(root, "declared.d.ts"));
        expect(resolveRelativeModule(from, "./pkg")).toBe(join(root, "pkg", "index.ts"));
        expect(resolveRelativeModule(from, "./types")).toBe(join(root, "types", "index.d.ts"));
    });

    it("非相对说明符返回 null（裸包名不参与分层判定）", () => {
        const root = makeTmp();
        expect(resolveRelativeModule(join(root, "a.ts"), "matrix-js-sdk")).toBeNull();
    });

    it("解析不到就返回 null", () => {
        const root = makeTmp();
        expect(resolveRelativeModule(join(root, "a.ts"), "./missing")).toBeNull();
    });
});

describe("check-entrypoint-layering: 违规判定", () => {
    it("禁用模式全部列出，不会只报第一条", () => {
        const hits = findForbiddenPatterns('export * from "./matrix";\nexport * from "./client";', [
            'export * from "./matrix"',
            'export * from "./client"',
        ]);
        expect(hits).toHaveLength(2);
    });

    it("白名单外的来源全部列出", () => {
        const violations = findDisallowedExportFrom(["./matrix", "./admin", "./dm"], new Set(["./matrix"]));
        expect(violations).toEqual(["./admin", "./dm"]);
    });

    it("命中禁用符号时按禁用清单的原顺序返回", () => {
        const hits = findForbiddenExportedSymbols(new Set(["PushManager", "AdminManager"]), [
            "AdminManager",
            "DirectMessageManager",
            "PushManager",
        ]);
        expect(hits).toEqual(["AdminManager", "PushManager"]);
    });
});

describe("check-entrypoint-layering: 真实仓库守卫", () => {
    it("src/core.ts 不得导出 advanced-only 的 manager", () => {
        const managers = [
            "AdminManager",
            "DirectMessageManager",
            "FriendManager",
            "PushManager",
            "SpaceManager",
            "RoomSummaryManager",
            "BeaconManager",
        ];

        const symbols = collectExportedSymbols(join(process.cwd(), "src", "core.ts"));
        expect(symbols.size).toBeGreaterThan(0);
        expect(findForbiddenExportedSymbols(symbols, managers)).toEqual([]);
    });

    it("src/legacy.ts 非空（空文件说明兼容层被误删）", () => {
        const legacy = fs.readFileSync(join(process.cwd(), "src", "legacy.ts"), "utf8");
        expect(legacy.trim().length).toBeGreaterThan(0);
    });
});

describe("check-entrypoint-layering: 模块入口", () => {
    it("import 时不跑 main —— 顶层裸跑会让 spec 一 import 就扫全仓并在违规时 exit", () => {
        const source = fs.readFileSync(GATE_PATH, "utf8");
        expect(source).toMatch(/if \(import\.meta\.url === `file:\/\/\$\{process\.argv\[1\]\}`\)/);
        expect(source).not.toMatch(/^main\(\);$/m);
    });
});
