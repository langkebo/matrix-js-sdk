/**
 * `check-exports-docs.mjs` 的类型声明（只声明导出给 spec 用的纯函数）。
 *
 * 本仓惯例：vitest 走真实 .mjs、tsc 走本声明文件，两者必须同步。
 */

/** exports.md 里解析出的一行：三列分别是导出键 / 白名单范围 / 关键导出。 */
export interface ExportDocRow {
    exportKey: string;
    whitelistScope: string;
    keyExports: string;
}

/** 文档声明了、但源码没导出的符号。 */
export interface SymbolMismatch {
    key: string;
    reason: string;
    missing: string[];
}

/** 六类问题的集合；任一非空即门禁失败。 */
export interface ExportsDocsResult {
    missingInDocs: string[];
    extraInDocs: string[];
    duplicateDocKeys: string[];
    rowsMissingScope: string[];
    rowsMissingMandatoryKeyExports: string[];
    symbolMismatches: SymbolMismatch[];
}

/**
 * 比对 package.json#exports 与 exports.md。
 * 纯函数：不读文件、不写文件、不 exit，便于用临时目录构造真实用例。
 */
export function evaluateExportsDocs(params: {
    exportKeys: string[];
    docRows: ExportDocRow[];
    pkgExports: Record<string, unknown>;
    root: string;
}): ExportsDocsResult;

/** 六类问题任一非空即为失败。 */
export function hasExportsDocsFailure(result: ExportsDocsResult): boolean;

/** 解析 markdown 表格行；首列必须是整格反引号包裹，否则整行跳过。 */
export function parseExportRows(markdown: string): ExportDocRow[];

/** 只返回重复项，已排序去重。 */
export function findDuplicates(items: string[]): string[];

/** 解析 Key Exports 列：`-` 视为未填写；优先取 inline code，否则按逗号切分。 */
export function parseRequiredSymbols(keyExportsCell: string): string[];

/** `./lib/x.js` → `src/x.ts` / `src/x.d.ts` / `src/x/index.ts`；非 `./lib/` 前缀返回 null。 */
export function resolveSourceFile(root: string, exportEntry: unknown): string | null;

/** 收集文件导出的符号集合；`export * from` 会递归展开但不传递 `default`。 */
export function collectExportedSymbols(filePath: string, visited: Set<string>): Set<string>;

/** 解析相对 import 说明符为真实文件；非相对路径返回 null。 */
export function resolveRelativeModule(fromFile: string, importSpecifier: string): string | null;
