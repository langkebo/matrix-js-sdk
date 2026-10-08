/**
 * `check-contract-entrypoint.mjs` 的类型声明（只声明导出给 spec 用的纯函数）。
 *
 * 本仓惯例：vitest 走真实 .mjs、tsc 走本声明文件，两者必须同步。
 */

/** 聚合出口里 `SDK_CONTRACT_ROUTE_TABLES` 的一个条目。 */
export interface EntrypointModuleKey {
    module: string;
    constant: string;
}

/** 聚合出口里对某个 route-table 的命名导入。 */
export interface EntrypointImport {
    constant: string;
    specifier: string;
    module: string;
}

/** 磁盘上的一张 route-table。 */
export interface DiskRouteTableModule {
    module: string;
    tablePath: string;
}

/** 一条契约路由。 */
export interface ContractRoute {
    method: string;
    path: string;
}

/** 单个模块的路由集合。 */
export interface ModuleRoutes {
    module: string;
    routes: ContractRoute[];
}

/** 重复路由：出现次数 > 1 的 `(method, path)`。 */
export interface DuplicateRoute {
    key: string;
    count: number;
    owners: string[];
}

/** 键与 import 常量不匹配。 */
export interface ConstantMismatch {
    module: string;
    reason: string;
}

/** 五类问题的集合；任一非空即门禁失败。 */
export interface ContractEntrypointResult {
    diskModuleCount: number;
    declaredModuleCount: number;
    importModuleCount: number;
    routeCount: number;
    missingInEntrypoint: string[];
    extraInEntrypoint: string[];
    constantMismatches: ConstantMismatch[];
    duplicateRoutes: DuplicateRoute[];
    exportIssues: string[];
}

/** 解析 `SDK_CONTRACT_ROUTE_TABLES = { ... }` 的键集合；注释里的举例不会被误收。 */
export function parseEntrypointModuleKeys(source: string): EntrypointModuleKey[];

/** 解析对 `../<module>/__generated__/route-table` 的命名导入。 */
export function parseEntrypointImports(source: string): EntrypointImport[];

/** 枚举 `src/<mod>/__generated__/route-table.ts`，按模块名排序。 */
export function discoverRouteTableModules(srcDir: string): DiskRouteTableModule[];

/** 抽取 route-table 里的路由条目。 */
export function collectRoutesFromTable(tablePath: string): ContractRoute[];

/** 找出重复的 `(method, path)`，给出出现次数与来源模块。 */
export function findDuplicateRoutes(moduleRoutes: ModuleRoutes[]): DuplicateRoute[];

/**
 * 核心判定。纯函数：不读文件、不写文件、不 exit，便于用夹具构造真实用例。
 */
export function evaluateContractEntrypoint(params: {
    entrypointSource: string;
    diskModules: DiskRouteTableModule[];
    moduleRoutes: ModuleRoutes[];
    pkgExports: Record<string, unknown> | undefined;
}): ContractEntrypointResult;

/** 任一判据命中即为失败。 */
export function hasContractEntrypointFailure(result: ContractEntrypointResult): boolean;

/** 把判定结果渲染成人读的失败说明。 */
export function renderContractEntrypointFailure(result: ContractEntrypointResult): string;
