export type TimerKind = "interval" | "stored-timeout";

export interface TimerSite {
    /** 相对仓库根的路径，正斜杠。 */
    file: string;
    kind: TimerKind;
    /** 承接定时器句柄的变量/属性表达式；`null` = 返回值被丢弃（一次性语义）。 */
    handle: string | null;
    line: number;
    snippet: string;
    /** 同一文件内同一 `kind#handle` 的第几处（避免同句柄多赋值导致键冲突）。 */
    ordinal: number;
}

export type TimerDisposition = "paired" | "owned" | "waived";

export interface TimerRegistryEntry {
    key: string;
    disposition: TimerDisposition;
    /** `owned` 时指定清理发生的文件；缺省表示与站点同文件。 */
    clearedIn?: string;
    /** `owned` 时清理语句里用的句柄（可与站点句柄不同名，例如继承字段）。 */
    clearedHandle?: string;
    /** `owned` 且由集合统一清理时，填集合名（门禁核对集合名 + clear* 调用同时出现）。 */
    clearCollection?: string;
    reason?: string;
    /** 仅 `waived` 需要；过期即红。 */
    expires?: string;
}

export interface TimerPairingVerdict {
    ok: boolean;
    key: string;
    detail: string;
}

/** 枚举一个文件里的定时器站点（不含 `public setInterval(` 这类声明）。 */
export function collectTimerSites(source: string, filePath: string): TimerSite[];

/** 返回值被丢弃的 `setTimeout` 数量（一次性语义，只统计）。 */
export function countDiscardedTimeouts(source: string): number;

export function siteKey(site: Pick<TimerSite, "file" | "kind" | "handle" | "ordinal">): string;

/**
 * 该文件里是否有清理这个句柄的语句。
 *
 * 容忍 `globalThis.clearTimeout(...)`、`clearTimeout(x as NodeJS.Timeout)` 等写法。
 */
export function fileClearsHandle(content: string, kind: TimerKind, handle: string): boolean;

/** 句柄是否被某个集合统一清理。 */
export function fileClearsCollection(content: string, kind: TimerKind, collection: string): boolean;

export function readRegistry(filePath?: string): {
    sites: TimerRegistryEntry[];
    generatedAt: string | null;
};

/**
 * 判定单个站点；`ok === false` 会让门禁失败。
 *
 * `paired` / `owned` 都会真的去 grep 清理语句，登记表说谎同样会红。
 */
export function evaluateSite(
    site: TimerSite,
    registry: { sites: TimerRegistryEntry[] },
    today?: Date,
): TimerPairingVerdict;
