/**
 * `check-docs-examples.mjs` 的类型声明（只声明导出给 spec 用的纯函数）。
 *
 * 本仓惯例：vitest 走真实 .mjs、tsc 走本声明文件，两者必须同步。
 */

/** 从 markdown 里抽出的一个可编译示例。 */
export interface DocsExampleBlock {
    title: string;
    startLine: number;
    fenceLine: number;
    body: string;
    markdownPath: string;
}

/** 抽取结果；`unclosed` 表示有围栏没闭合。 */
export interface ParseBlocksResult {
    blocks: DocsExampleBlock[];
    unclosed: { markdownPath: string; startLine: number } | null;
}

/** 落盘规划；`errors` 是要原样打印的消息。 */
export interface PlanGeneratedResult {
    planned: Array<DocsExampleBlock & { fileName: string }>;
    errors: string[];
}

/** 抽取数量下限（防「死门禁」）。 */
export const MIN_EXTRACTED_BLOCKS: number;

/** 子路径入口到源码的映射。 */
export const SUBPATH_ENTRIES: Record<string, string[]>;

/** 列出目录下的 .md 文件（相对仓根的路径，已排序）。 */
export function listMarkdownFiles(dir: string, root?: string): string[];

/** 从行数组里抽取带 title 的 typescript/ts 围栏。纯函数。 */
export function parseBlocks(lines: string[], markdownPath: string): ParseBlocksResult;

/** 读文件并抽取；未闭合围栏会报错并置 exitCode。 */
export function extractBlocks(markdownPath: string, root?: string): DocsExampleBlock[];

/** 规划落盘目标：只取 basename，非 .ts / 重复 title 记为 error。纯函数。 */
export function planGenerated(blocks: DocsExampleBlock[]): PlanGeneratedResult;

/** 生成给抽取产物用的 tsconfig。纯函数。 */
export function buildTsconfig(): Record<string, unknown>;
