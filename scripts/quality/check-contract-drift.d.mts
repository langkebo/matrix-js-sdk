export type DriftKind = "sdk-only" | "ledger-only";

export interface DriftItem {
    moduleName: string;
    sdkDir: string;
    kind: DriftKind;
    /** `METHOD path` */
    entry: string;
}

export interface ModuleDiff {
    /** 表里有、ledger 里没有。 */
    sdkOnly: string[];
    /** ledger 里有、表里没有。 */
    ledgerOnly: string[];
}

export interface ContractDriftRegistryEntry {
    key: string;
    module: string;
    kind: DriftKind;
    entry: string;
    reason: string;
    /** 过期即红；缺省视为不过期（不推荐）。 */
    expires?: string;
}

export interface DriftVerdict {
    ok: boolean;
    key: string;
    detail: string;
}

/** 读一个 SDK 模块的生成 route-table；没有表时返回 `null`（由覆盖门禁负责该模块）。 */
export function readRouteTable(sdkDir: string, root?: string): Set<string> | null;

/** 读一个 ledger 模块镜像（`docs/api-contract/generated/modules/<name>.json`）。 */
export function readLedgerManifest(moduleName: string, root?: string): Set<string> | null;

/** 计算一个模块的双向差集。 */
export function diffModule(sdkDir: string, ledgerEntries: Set<string>, tableEntries: Set<string>): ModuleDiff;

export function driftKey(moduleName: string, kind: DriftKind, entry: string): string;

export function readRegistry(filePath?: string): {
    entries: ContractDriftRegistryEntry[];
    generatedAt: string | null;
};

/**
 * 判定一处差集：未登记 / 缺 reason / 已过期都返回 `ok: false`。
 *
 * 登记表里存在但差集里已消失的条目由 `main()` 归入 stale 并让门禁失败（见脚本输出）。
 */
/** 判定只读 `key` / `reason` / `expires`，因此参数用最小形状，便于构造负向测试。 */
export function evaluateDrift(
    key: string,
    registry: { entries: { key: string; reason?: string; expires?: string }[] },
    today?: Date,
): DriftVerdict;
