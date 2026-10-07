/**
 * `gate-golden.mjs` 的类型声明。
 *
 * 本仓惯例（见 `check-swallow-fallbacks.d.mts` 等）：门禁 / 工具脚本导出函数供 spec 使用时，
 * **vitest 走运行时（真实 .mjs）、tsc 走本声明文件**。两者必须同步 —— 只改 .mjs 不改这里，
 * 单测可能绿而 `tsc --noEmit` 报 `TS2305 has no exported member`。
 */

/** 归因结论。 */
export const ATTRIBUTION: {
    /** base 绿 + 本轮绿 */
    readonly CLEAN: "CLEAN";
    /** base 绿 + 本轮红 —— 本轮把它改红了 */
    readonly INTRODUCED: "INTRODUCED";
    /** base 红 + 本轮绿 */
    readonly FIXED: "FIXED";
    /** 两侧同红，且失败集完全一致 —— 本来就红 */
    readonly PRE_EXISTING: "PRE_EXISTING";
    /** 两侧同红，但本轮又新增了失败 */
    readonly PRE_EXISTING_PLUS_NEW: "PRE_EXISTING_PLUS_NEW";
};

/** `classifyAttribution` 的输入。 */
export interface AttributionInput {
    /** base 世界的退出码（0 = 绿）。 */
    baseExit: number;
    /** 工作区的退出码（0 = 绿）。 */
    workExit: number;
    /** 只在 base 出现的行（改前有、改后没有）。 */
    onlyInBase: readonly string[];
    /** 只在本轮出现的行（改后新增）。 */
    onlyInWork: readonly string[];
}

/** `classifyAttribution` 的输出。 */
export interface AttributionResult {
    /** 见 `ATTRIBUTION`。 */
    kind: string;
    /** 是否算「本轮引入了问题」（INTRODUCED / PRE_EXISTING_PLUS_NEW）。 */
    bad: boolean;
    /** 中文人话描述。 */
    label: string;
    /** 展示用图标。 */
    emoji: string;
}

/** `normalizeForDiff` 的选项。 */
export interface NormalizeOptions {
    /** 需要统一成 `<ROOT>` 的绝对路径（通常是两个世界的仓库根），按长度倒序处理。 */
    roots?: readonly string[];
    /** 把 `file.ts:12:` 折叠成 `file.ts:<L>:` —— 避免行号平移被误报成新失败。 */
    collapseLineNumbers?: boolean;
    /** 折叠 ISO 时间戳为 `<TS>`（默认 true）。 */
    stripTimestamps?: boolean;
}

/** `parseArgs` 解析出的选项。 */
export interface GateGoldenOptions {
    script: string | null;
    node: string | null;
    cmd: string | null;
    base: string;
    timeout: number;
    raw: boolean;
    exactLines: boolean;
    maxDiff: number;
    json: boolean;
    noFail: boolean;
    keepWorktree: boolean;
}

/** `parseArgs` 的返回值。 */
export interface ParsedArgs {
    command: string | null;
    id: string | null;
    options: GateGoldenOptions;
    error: string | null;
    help: boolean;
}

/** 把 `<id>` 消毒成安全的文件名主干（去掉路径分隔符与 `..`）。 */
export function sanitizeGoldenId(raw: string): string;

/** 按行切分，并丢掉末尾因结尾换行产生的空串。 */
export function splitLines(text: string): string[];

/** 行级多重集差分（保留重数，不折叠重复行）。 */
export function multisetDiff(
    baseLines: readonly string[],
    workLines: readonly string[],
): { onlyInBase: string[]; onlyInWork: string[]; shared: string[] };

/** 由退出码 + 失败集差分判定归因。 */
export function classifyAttribution(input: AttributionInput): AttributionResult;

/** 归一化一段输出，使不同 cwd / 不同时刻的两次运行可比。 */
export function normalizeForDiff(text: string, options?: NormalizeOptions): string;

/** 解析 CLI argv（不含 node 与脚本路径）。 */
export function parseArgs(argv: readonly string[]): ParsedArgs;
