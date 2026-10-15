/**
 * `scripts/quality/lib/granular-coverage.mjs` 的类型声明。
 *
 * 这是 18 个 `check-*-granular-coverage.mjs` 共用的判定引擎，spec 直接 import 真实
 * `.mjs` 运行；本声明只给 `tsc` 走类型用（tsc 不解析 `.mjs` 的 JSDoc 到 TS 侧）。
 */

export interface GranularGroup {
    name: string;
    /**
     * 单文件 owner。与 `ownerFiles` 二选一：给了 `ownerFiles` 时本字段被忽略。
     * 旧数据都只有本字段，保持必填以免调用方两边都不给。
     */
    ownerFile?: string;
    /**
     * owner 集合。manager 拆成 sub-manager 后同一职责面会跨多个文件
     * （如 SpaceManager 的 24 个端点分布在 5 个 `space/sub-managers/*.ts`），
     * 此时必须声明集合而不是把 `ownerFile` 指向已不持有实现的旧文件。
     */
    ownerFiles?: string[];
    methods: string[];
    testFiles: string[];
}

export interface GranularModuleCheck {
    module: string;
    groups: GranularGroup[];
}

export interface GranularFailure {
    module: string;
    group: string;
    /** 单 owner 时为该路径；多 owner 时为 `null`（看 `ownerFiles`）。 */
    ownerFile: string | null;
    /** 归一化后的 owner 集合（单 owner 组为长度 1 的数组）。 */
    ownerFiles: string[];
    missingMethods: string[];
    methodsWithoutTests: string[];
}

export interface GranularResult {
    failures: GranularFailure[];
    totalGroups: number;
    passedGroups: number;
}

export interface GranularEvaluateOptions {
    rootDir?: string;
    readFile?: (file: string) => string;
}

export function readRelative(rootDir: string, file: string): string;

export function escapeRegex(value: string): string;

export function hasMethod(content: string, method: string): boolean;

export function hasTestHit(content: string, method: string): boolean;

export function collectMissing<T>(items: readonly T[], predicate: (item: T) => boolean): T[];

/** 把一个 group 归一化成 owner 文件集合（`ownerFiles` 优先，退回 `[ownerFile]`）。 */
export function ownerFilesOf(group: GranularGroup): string[];

export function evaluateGranularCoverage(
    checks: readonly GranularModuleCheck[],
    opts?: GranularEvaluateOptions,
): GranularResult;

export function runGranularCoverage(cfg: {
    title: string;
    checks: readonly GranularModuleCheck[];
    rootDir?: string;
}): GranularResult;
