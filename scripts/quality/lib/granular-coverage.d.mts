/**
 * `scripts/quality/lib/granular-coverage.mjs` 的类型声明。
 *
 * 这是 18 个 `check-*-granular-coverage.mjs` 共用的判定引擎，spec 直接 import 真实
 * `.mjs` 运行；本声明只给 `tsc` 走类型用（tsc 不解析 `.mjs` 的 JSDoc 到 TS 侧）。
 */

export interface GranularGroup {
    name: string;
    ownerFile: string;
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
    ownerFile: string;
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

export function evaluateGranularCoverage(
    checks: readonly GranularModuleCheck[],
    opts?: GranularEvaluateOptions,
): GranularResult;

export function runGranularCoverage(cfg: {
    title: string;
    checks: readonly GranularModuleCheck[];
    rootDir?: string;
}): GranularResult;
