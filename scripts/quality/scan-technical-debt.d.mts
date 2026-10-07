/**
 * `scan-technical-debt.mjs` 的类型声明（只声明导出给 spec 用的纯函数）。
 *
 * 本仓惯例：vitest 走真实 .mjs、tsc 走本声明文件，两者必须同步。
 */

/** 统一成 `/` 分隔：同一条债在任何 OS 上都要算出同一个指纹。 */
export function normalizePath(value: string): string;

/** CSV 字段转义：含 `,` `"` 或换行时整体加引号，内部 `"` 翻倍。 */
export function escapeCsvField(value: unknown): string;

/** 指纹 = sha1(`路径|类型|片段`)，40 位十六进制。片段变了就是一条新债。 */
export function fingerprintFor(filePath: string, markerType: string, snippet: string): string;

/** FIXME → Critical，TODO/HACK → Major，其余 → Minor。 */
export function inferSeverity(markerType: string): "Critical" | "Major" | "Minor";

/** FIXME → P0，TODO → P1，HACK → P2，其余 → P3。 */
export function inferPriority(markerType: string): "P0" | "P1" | "P2" | "P3";

/** P0 → 4.6，P1 → 3.8，P2 → 3.2，其余 → 2.6。 */
export function scoreFromPriority(priority: string): number;

/** 从注释文本里提取的元信息；取不到时为空串，status 默认 "Open"。 */
export interface DebtMeta {
    owner: string;
    createdAt: string;
    dueDate: string;
    jiraKey: string;
    status: string;
}

/** 提取 owner（`owner: x` 或 `@x`）/ 日期 / jira key / 状态。 */
export function parseMeta(rawText: string): DebtMeta;
