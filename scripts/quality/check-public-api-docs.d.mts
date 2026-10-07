/**
 * `check-public-api-docs.mjs` 的类型声明（只声明导出给 spec 用的纯函数）。
 *
 * 本仓惯例：vitest 走真实 .mjs、tsc 走本声明文件，两者必须同步。
 */

/** 下划线开头的方法视为内部实现（sub-manager 回引方法，如 `_setParent`）。 */
export function isConventionInternal(methodName: string): boolean;

/** 纳入统计的类：`*Manager` 或核心客户端 `MatrixClient`。 */
export function isTrackedClassName(name: string): boolean;

/** `package.json` 声明的一条导出入口。 */
export interface ResolvedPackageExport {
    /** exports 里的子路径键（顶层入口字段形如 `<main>`） */
    key: string;
    /** package.json 中写的目标路径 */
    target: string;
    /** 映射到的 src 源文件绝对路径 */
    srcFile: string;
}

/** 映射不到真实 src 文件的入口（R0 要拦的"导出面撒谎"）。 */
export interface BrokenPackageExport {
    key: string;
    target: string;
    /** 期望存在、但实际不存在的相对路径 */
    expected: string;
}

/**
 * `package.json` 声明的包入口 -> 真实存在的 src 文件。
 * 只跟踪 `./lib/` 前缀；解析不到的进 `broken`。
 */
export function resolvePackageExports(): {
    entries: ResolvedPackageExport[];
    broken: BrokenPackageExport[];
};

/**
 * 收集相对说明符：`from "./x"`、`export ... from "../y"`、`import("../z/index.js")`。
 * 裸包名（`rxjs`、`node:fs`）不收。
 */
export function relativeSpecifiers(text: string): Set<string>;

/** 把相对说明符解析成磁盘上的 .ts/.tsx 文件（含 `.js`→`.ts`、目录→`index.ts`）；解析不到返回 null。 */
export function resolveSpecifier(fromFile: string, spec: string): string | null;

/** 从若干根文件出发，沿**相对**导入做传递闭包，得到"包入口可达"的源文件集合。 */
export function computeReachableFiles(rootFiles: string[]): Set<string>;

/**
 * 模块根：`src/manager-extensions/index.ts` 以字符串参数动态 import 各模块，
 * 静态分析追不到，因此从生成物里读 `module` 名映射为 `src/<module>/index.ts`。
 */
export function managerModuleRoots(): string[];
