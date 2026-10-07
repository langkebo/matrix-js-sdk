/**
 * `scripts/quality/lib/spec-import-graph.mjs` 的类型声明。
 *
 * 这是「源文件是否被测试触及」的单一真相源，`find-lowest-coverage-files` /
 * `find-lowest-coverage-modules` 都靠它判定；spec 直接 import 真实 `.mjs` 运行，
 * 本声明只给 `tsc` 走类型用。
 */

/** 某个文件是否是测试文件（Vitest 可识别后缀）。 */
export const isSpecFile: (f: string) => boolean;

/** 递归遍历目录，按**后缀**收集文件。 */
export function walk(dir: string, suffixes?: readonly string[]): string[];

/** 收集 src/ 下需要被测试覆盖的源文件（排除 `.d.ts` 与 in-src spec）。 */
export function collectSourceFiles(srcDir: string): string[];

/** 收集某个目录下的 spec 文件。 */
export function collectSpecFiles(specDir: string): string[];

/** 收集**全部** spec 文件：既包括 `spec/`，也包括 `src/**\/*.spec.ts`。 */
export function collectAllSpecFiles(specRoot: string, srcDir: string): string[];

/** 解析全部 spec 的相对 import，映射回 src/ 下的相对路径集合。 */
export function buildSpecImportSet(srcDir: string, specFiles: readonly string[]): Set<string>;

/** 源文件是否有"直接 spec"（镜像路径或扁平同名）。 */
export function hasDirectSpec(sourceFile: string, srcDir: string, specDir: string): boolean;

export interface CoverageSignals {
    sourceFiles: string[];
    specFiles: string[];
    importedBySpec: Set<string>;
    isTouched: (sourceFile: string) => boolean;
}

/** 建立「源文件相对路径 -> 是否被任何 spec 触及」的判定函数，并缓存 import 图。 */
export function createCoverageSignals(srcDir: string, specDir: string): CoverageSignals;

/** 模块级信号：`src/<module>/` 是否被任何 spec 触及。 */
export function moduleIsTouched(moduleName: string, srcDir: string, specDir: string, signals: CoverageSignals): boolean;
