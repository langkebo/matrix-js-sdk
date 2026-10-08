/*
 * `scripts/quality/check-exports-docs.mjs` 的单元测试。
 *
 * 这个门禁比对 `package.json#exports` 与 `docs/api-contract/exports.md` —— 后者是手写的、
 * 与 codegen 无关，所以会自行漂移。本仓真实事故是文档里写的子路径是 `./notification`
 * 而实际是 `./notifications`；那次是 exports 那一侧抓到的，这里钉的是它的**对偶**：
 * 子路径改名后文档没跟着改（`extraInDocs`）。
 *
 * 值得钉的口径：
 *
 *   · **六类问题互不遮蔽**：某一类命中就 `continue` 掉后续检查的写法会让后面的
 *     问题永远看不见。这里每条用例只制造一类问题，确认它单独可见。
 *   · **`extraInDocs`**：文档里有、package.json 里没有的行 —— 改名/删入口后残留。
 *   · **核心入口必须填 Key Exports**：`.`/`./core`/`./advanced`/`./legacy`/`./client`
 *     留空就等于文档没说清这个入口导出什么，等于没写。
 *   · **`export * from` 不传递 `default`**：星号再导出按规范就是不导出默认，
 *     收进来会让"文档说有 default"在只有星号再导出的入口上假绿。
 *   · **`export { a as b }` 取别名 `b`**：调用方看的是导出名，不是源名。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
    collectExportedSymbols,
    evaluateExportsDocs,
    findDuplicates,
    hasExportsDocsFailure,
    parseExportRows,
    parseRequiredSymbols,
    resolveSourceFile,
} from "../../scripts/quality/check-exports-docs.mjs";

function makeTmp(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "exports-docs-"));
}

function writeFile(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
}

/** 造一份 exports.md：rows 为 [首列, 白名单范围, 关键导出] 三元组。 */
function makeDoc(rows: string[][]): string {
    return [
        "| Export | Whitelist Scope | Key Exports |",
        "| --- | --- | --- |",
        ...rows.map((cells) => `| ${cells[0]} | ${cells[1]} | ${cells[2]} |`),
    ].join("\n");
}

describe("parseExportRows（决定哪些行算一条导出记录）", () => {
    it("解析三列，并跳过分隔行与表头", () => {
        const rows = parseExportRows(makeDoc([["`./core`", "internal", "`MatrixClient`"]]));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual({
            exportKey: "./core",
            whitelistScope: "internal",
            keyExports: "`MatrixClient`",
        });
    });

    it("首列不是纯反引号包裹时整行跳过（避免把散文当成导出记录）", () => {
        const rows = parseExportRows(makeDoc([["see `./core` for details", "x", "y"]]));
        expect(rows).toHaveLength(0);
    });

    it("列数不足时补空串，不抛异常", () => {
        const rows = parseExportRows("| `.` |");
        expect(rows[0].whitelistScope).toBe("");
        expect(rows[0].keyExports).toBe("");
    });
});

describe("parseRequiredSymbols（文档里的 Key Exports 列）", () => {
    it("`-` 与反引号包裹的 `-` 都视为未填写", () => {
        expect(parseRequiredSymbols("-")).toEqual([]);
        expect(parseRequiredSymbols("`-`")).toEqual([]);
        expect(parseRequiredSymbols("  ")).toEqual([]);
    });

    it("优先按 inline code 取，并去重", () => {
        expect(parseRequiredSymbols("`A`, `B`, `A`")).toEqual(["A", "B"]);
    });

    it("没有 inline code 时按逗号切分", () => {
        expect(parseRequiredSymbols("A, B ,C")).toEqual(["A", "B", "C"]);
    });
});

describe("resolveSourceFile（package.json 的导出映射 → 真实源文件）", () => {
    it("只接受 ./lib/ 前缀，其它形态一律返回 null", () => {
        const root = makeTmp();
        expect(resolveSourceFile(root, "./dist/index.js")).toBeNull();
        expect(resolveSourceFile(root, "./src/index.ts")).toBeNull();
        expect(resolveSourceFile(root, { import: "./dist/index.js" })).toBeNull();
    });

    it("依次尝试 x.ts / x.d.ts / x/index.ts", () => {
        const root = makeTmp();
        expect(resolveSourceFile(root, "./lib/foo.js")).toBeNull();

        writeFile(path.join(root, "src", "foo.d.ts"), "");
        expect(resolveSourceFile(root, "./lib/foo.js")).toBe(path.join(root, "src", "foo.d.ts"));

        writeFile(path.join(root, "src", "foo.ts"), "");
        expect(resolveSourceFile(root, "./lib/foo.js")).toBe(path.join(root, "src", "foo.ts"));
    });

    it("目录形态落到 index.ts", () => {
        const root = makeTmp();
        writeFile(path.join(root, "src", "room", "index.ts"), "");
        expect(resolveSourceFile(root, "./lib/room/index.js")).toBe(path.join(root, "src", "room", "index.ts"));
    });
});

describe("collectExportedSymbols（源码实际导出了什么）", () => {
    it("收集命名声明与 export default", () => {
        const root = makeTmp();
        const file = path.join(root, "a.ts");
        writeFile(file, "export class Foo {}\nexport const BAR = 1;\nexport default function f() {}\n");
        const symbols = collectExportedSymbols(file, new Set());
        expect(symbols.has("Foo")).toBe(true);
        expect(symbols.has("BAR")).toBe(true);
        expect(symbols.has("default")).toBe(true);
    });

    it("`export { a as b }` 取别名 b，并剥离 type 前缀", () => {
        const root = makeTmp();
        const file = path.join(root, "a.ts");
        writeFile(file, "export { internalThing as PublicThing, type SomeType as T };\n");
        const symbols = collectExportedSymbols(file, new Set());
        expect(symbols.has("PublicThing")).toBe(true);
        expect(symbols.has("internalThing")).toBe(false);
        expect(symbols.has("T")).toBe(true);
    });

    it("`export * from` 递归展开，但不传递 default", () => {
        const root = makeTmp();
        writeFile(path.join(root, "dep.ts"), "export const Deep = 1;\nexport default function d() {}\n");
        const file = path.join(root, "a.ts");
        writeFile(file, 'export * from "./dep";\n');
        const symbols = collectExportedSymbols(file, new Set());
        expect(symbols.has("Deep")).toBe(true);
        expect(symbols.has("default")).toBe(false);
    });

    it("循环再导出不会无限递归", () => {
        const root = makeTmp();
        writeFile(path.join(root, "a.ts"), 'export * from "./b";\nexport const A = 1;\n');
        writeFile(path.join(root, "b.ts"), 'export * from "./a";\nexport const B = 1;\n');
        const symbols = collectExportedSymbols(path.join(root, "a.ts"), new Set());
        expect(symbols.has("A")).toBe(true);
        expect(symbols.has("B")).toBe(true);
    });
});

describe("evaluateExportsDocs（六类问题各自可见）", () => {
    function cleanFixture() {
        const root = makeTmp();
        writeFile(path.join(root, "src", "index.ts"), "export class MatrixClient {}\n");
        return {
            root,
            exportKeys: ["."],
            pkgExports: { ".": "./lib/index.js" },
            docRows: parseExportRows(makeDoc([["`.`", "internal", "`MatrixClient`"]])),
        };
    }

    it("完全一致时六类均为空", () => {
        const f = cleanFixture();
        const result = evaluateExportsDocs(f);
        expect(hasExportsDocsFailure(result)).toBe(false);
        expect(result.symbolMismatches).toEqual([]);
    });

    it("missingInDocs：package.json 有、文档没写", () => {
        const f = cleanFixture();
        const result = evaluateExportsDocs({ ...f, exportKeys: [".", "./core"] });
        expect(result.missingInDocs).toEqual(["./core"]);
        expect(result.extraInDocs).toEqual([]);
    });

    it("extraInDocs：文档里有、package.json 没有（改名后文档没跟着改）", () => {
        const f = cleanFixture();
        const result = evaluateExportsDocs({
            ...f,
            docRows: parseExportRows(
                makeDoc([
                    ["`.`", "internal", "`MatrixClient`"],
                    ["`./notification`", "x", "y"],
                ]),
            ),
        });
        expect(result.extraInDocs).toEqual(["./notification"]);
    });

    it("duplicateDocKeys：同一 key 出现两次", () => {
        const f = cleanFixture();
        const result = evaluateExportsDocs({
            ...f,
            docRows: parseExportRows(
                makeDoc([
                    ["`.`", "a", "b"],
                    ["`.`", "c", "d"],
                ]),
            ),
        });
        expect(result.duplicateDocKeys).toEqual(["."]);
    });

    it("rowsMissingScope：Whitelist Scope 留空", () => {
        const f = cleanFixture();
        const result = evaluateExportsDocs({
            ...f,
            docRows: parseExportRows(makeDoc([["`.`", "   ", "`MatrixClient`"]])),
        });
        expect(result.rowsMissingScope).toEqual(["."]);
    });

    it("rowsMissingMandatoryKeyExports：核心入口的 Key Exports 留空", () => {
        const f = cleanFixture();
        const result = evaluateExportsDocs({
            ...f,
            docRows: parseExportRows(makeDoc([["`.`", "internal", "-"]])),
        });
        expect(result.rowsMissingMandatoryKeyExports).toEqual(["."]);
    });

    it("非核心入口的 Key Exports 留空不算问题", () => {
        const f = cleanFixture();
        const result = evaluateExportsDocs({
            ...f,
            exportKeys: ["./utils"],
            pkgExports: { "./utils": "./lib/index.js" },
            docRows: parseExportRows(makeDoc([["`./utils`", "internal", "-"]])),
        });
        expect(result.rowsMissingMandatoryKeyExports).toEqual([]);
    });

    it("symbolMismatches：文档声明了源码没导出的符号", () => {
        const f = cleanFixture();
        const result = evaluateExportsDocs({
            ...f,
            docRows: parseExportRows(makeDoc([["`.`", "internal", "`MatrixClient`, `Ghost`"]])),
        });
        expect(result.symbolMismatches).toHaveLength(1);
        expect(result.symbolMismatches[0].key).toBe(".");
        expect(result.symbolMismatches[0].missing).toEqual(["Ghost"]);
    });

    it("导出映射指向不存在的源文件 → 记为不可解析，而不是静默通过", () => {
        const f = cleanFixture();
        const result = evaluateExportsDocs({ ...f, pkgExports: { ".": "./lib/ghost.js" } });
        expect(result.symbolMismatches[0].reason).toContain("cannot be resolved");
    });

    it("extraInDocs 排序稳定（输出顺序不依赖文档行序）", () => {
        const f = cleanFixture();
        const result = evaluateExportsDocs({
            ...f,
            docRows: parseExportRows(
                makeDoc([
                    ["`./zzz`", "a", "b"],
                    ["`./aaa`", "a", "b"],
                    ["`.`", "a", "`MatrixClient`"],
                ]),
            ),
        });
        expect(result.extraInDocs).toEqual(["./aaa", "./zzz"]);
    });
});

describe("findDuplicates", () => {
    it("只报重复项，且已排序去重", () => {
        expect(findDuplicates(["a", "b", "a", "b", "c"])).toEqual(["a", "b"]);
        expect(findDuplicates(["a"])).toEqual([]);
    });
});

describe("hasExportsDocsFailure", () => {
    it("任意一类非空即为失败", () => {
        const empty = {
            missingInDocs: [],
            extraInDocs: [],
            duplicateDocKeys: [],
            rowsMissingScope: [],
            rowsMissingMandatoryKeyExports: [],
            symbolMismatches: [],
        };
        expect(hasExportsDocsFailure(empty)).toBe(false);
        expect(hasExportsDocsFailure({ ...empty, extraInDocs: ["./x"] })).toBe(true);
    });
});
