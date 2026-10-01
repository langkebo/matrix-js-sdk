export type DriftKind = "sdk-only" | "ledger-only";

export interface DriftItem {
    /** 比对单位是 SDK 目录（映射多对一，同目录的兄弟 ledger 模块取并集）。 */
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
    /** SDK 目录名（与 `driftKey` 的第一段一致）。 */
    dir: string;
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

/**
 * 该目录的模块文档是否声明 `umbrella: true`。
 *
 * umbrella 聚合页（`auth`/`README`）不参与 1:1 ledger pin，其路由表是跨模块聚合，
 * 因此不适用孤立表检查。
 */
export function isUmbrellaDoc(sdkDir: string, root?: string): boolean;

export interface OrphanTable {
    sdkDir: string;
    /** 表内既不属本目录 ledger 映射、也不在全局 ledger 中的条目数。 */
    unbacked: number;
}

export interface ObservedDrift {
    observed: DriftItem[];
    /** 目录已无任何 ledger 模块映射、且含无背书条目的表。 */
    orphanTables: OrphanTable[];
    ledgerModuleNames: string[];
}

/**
 * 收集仓库当前的全部差集（含孤立表），门禁与负向测试共用同一实现。
 *
 * 从**磁盘上存在的 route-table 目录**出发，因此"后端整模块被删除"也能被捕获
 * （只从 ledger 模块反查目录会静默跳过该目录）。
 */
export function collectObservedDrift(root?: string): ObservedDrift;

/** 计算一个模块的双向差集。 */
export function diffModule(sdkDir: string, ledgerEntries: Set<string>, tableEntries: Set<string>): ModuleDiff;

export function driftKey(sdkDir: string, kind: DriftKind, entry: string): string;

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
