/**
 * `check-coverage-critical-files.mjs` 的类型声明（只声明导出给 spec 用的纯函数）。
 *
 * 本仓惯例：vitest 走真实 .mjs、tsc 走本声明文件，两者必须同步。
 */

/** 一个"零覆盖 + 高危"的源文件：含 HTTP 调用且没有任何 spec 触及。 */
export interface CriticalFile {
    file: string;
    lines: number;
    httpCalls: number;
    evidence: string;
}

/** 台账里的一条登记。 */
export interface LedgerEntry extends Record<string, unknown> {
    file?: string;
    owner?: string;
    /** YYYY-MM-DD */
    deadline?: string;
    reason?: string;
}

/** 一条违规。 */
export interface LedgerViolation extends Record<string, unknown> {
    /** R1 新盲区 / R2 字段缺失或日期非法 / R3 过期 / R4 台账失效 */
    rule: "R1" | "R2" | "R3" | "R4";
    file: string;
    detail: string;
    fix: string;
}

/** 仍在期限内、被跟踪的条目。 */
export interface TrackedEntry extends LedgerEntry {
    /** 距 deadline 还有几天；到期当天为 0（不算过期） */
    daysLeft: number;
}

/**
 * R1–R4 的判定。
 *
 * `today` 显式入参：R3 随日期变化，不参数化的用例会自己腐烂。
 * 同一条台账记录最多报一条违规（缺字段后即 continue）。
 */
export function evaluateLedger(input: {
    critical: CriticalFile[];
    entries: LedgerEntry[];
    today: Date;
}): { violations: LedgerViolation[]; tracked: TrackedEntry[] };
