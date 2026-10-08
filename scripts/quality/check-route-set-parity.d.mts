/**
 * `check-route-set-parity.mjs` 的类型声明（只声明导出给 spec 用的纯函数）。
 *
 * 本仓惯例：vitest 走真实 .mjs、tsc 走本声明文件，两者必须同步。
 */

/** route-table 里的一条声明。 */
export interface RouteTableEntry {
    method: string;
    path: string;
}

/** 带来源的一条条目（`file` / `module` 由收集器补上）。 */
export interface SourcedRouteTableEntry extends RouteTableEntry {
    file: string;
    module: string;
    key?: string;
}

/** 一条豁免登记。 */
export interface RouteSetWaiver {
    method: string;
    path: string;
    module?: string;
    reason?: string;
    /** YYYY-MM-DD */
    expires?: string;
    detail?: string;
}

/** 对账结果。 */
export interface RouteSetDiff {
    /** 契约有、ledger 没有、且未被豁免的路径（违规）。 */
    uncovered: SourcedRouteTableEntry[];
    /** 缺 `expires` / 格式非法 / 已过期的豁免。 */
    expiredWaivers: RouteSetWaiver[];
    /** 指向的路径已不在任何 route-table 里的豁免（台账腐烂）。 */
    unusedWaivers: RouteSetWaiver[];
}

/** 抽出 route-table 里的 `(method, path)`；抽不到时返回空数组，调用方必须自行判空。 */
export function parseRouteTableEntries(source: string): RouteTableEntry[];

/** `METHOD /path` —— 本门禁的比对键（不做版本/命名空间归一）。 */
export function routeKey(method: string, routePath: string): string;

/** 对账判据：`today` 显式入参，避免到期判定随机器时钟漂移。 */
export function diffRouteSet(input: {
    entries: SourcedRouteTableEntry[];
    ledgerKeys: Set<string>;
    waivers: RouteSetWaiver[];
    today: string;
}): RouteSetDiff;
