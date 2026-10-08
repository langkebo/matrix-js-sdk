/**
 * `check-waiver-expiry.mjs` 的类型声明（只声明导出给 spec 用的纯函数）。
 *
 * 本仓惯例：vitest 走真实 .mjs、tsc 走本声明文件，两者必须同步。
 */

/** 豁免到期状态。 */
export const EXPIRY: {
    /** 已过期（剩余天数 < 0） */
    readonly EXPIRED: "EXPIRED";
    /** 即将到期（0 ≤ 剩余天数 ≤ EXPIRING_SOON_DAYS） */
    readonly EXPIRING_SOON: "EXPIRING_SOON";
    /** 仍然有效 */
    readonly VALID: "VALID";
};

/** "即将到期"窗口天数。 */
export const EXPIRING_SOON_DAYS: number;

/** 归本门禁管的台账清单（name 必须在 `collectExpirables` 里有形状解析）。 */
export const LEDGER_SOURCES: readonly { name: string; file: string }[];

/** 拍平后的一条"带 expires 的白名单条目"。 */
export interface ExpirableEntry {
    /** 台账名（`path-contract` / `swallow-fallback`）。 */
    ledger: string;
    /** 条目标识（path-contract 用 sdkCall/path；swallow 用 `file:line`）。 */
    id: string;
    file: string | null;
    expires: unknown;
    reason: string;
}

/**
 * 把各台账里「带 `expires` 的条目」拍平成统一形状。
 *
 * 遇到 `LEDGER_SOURCES` 里未登记形状的 `name` 会**抛错**（不是静默跳过）：
 * 静默跳过 = 某本台账悄悄脱离到期纪律，正是本门禁要防的病。
 */
export function collectExpirables(ledgerDocs: Array<{ name: string; doc: unknown }>): ExpirableEntry[];

/** 距离到期还有几天（自然日；不可解析返回 NaN）。 */
export function daysLeftUntil(expires: string, today: Date): number;

/** 给一条豁免定级。 */
export function classifyExpiry(
    expires: string,
    today: Date,
): {
    /** 到期状态；日期不可解析时为 null */
    status: "EXPIRED" | "EXPIRING_SOON" | "VALID" | null;
    /** 剩余天数 */
    daysLeft: number;
};

/**
 * 按**本地**日历格式化 `YYYY-MM-DD`（报告头用）。
 *
 * 不能用 `d.toISOString().slice(0, 10)`：`today` 是本地自然日零点，而
 * `toISOString()` 输出 UTC —— 东八区的 `2026-10-07 00:00` 在 UTC 是
 * `2026-10-06T16:00Z`，报告头会打印成前一天。
 */
export function formatLocalDate(d: Date): string;
