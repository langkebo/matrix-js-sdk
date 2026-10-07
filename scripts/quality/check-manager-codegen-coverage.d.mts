export type ModuleCoverageStatus = "covered" | "waived" | "missing";

export type ModuleCoverageReason = "NO_CODEGEN" | "NO_CONSUMER" | "EXPIRED_WAIVER";

/** `route-table-import` = 强证据；`table-without-consumer` = 有表但没人读；`no-table` = 本来就没生成表。 */
export type ModuleCoverageEvidence = "route-table-import" | "table-without-consumer" | "no-consumer" | "no-table";

export interface ModuleCoverageVerdict {
    status: ModuleCoverageStatus;
    /** `covered` 时恒为 `route-table-import`；`waived`/`missing` 时说明证据强度。 */
    evidence?: ModuleCoverageEvidence;
    /** Only set when `status === "missing"`. */
    reason?: ModuleCoverageReason;
    /** Only set for waived / expired-waiver modules. */
    waiver?: { reason: string; expires: string };
}

/**
 * Ledger 模块名 → SDK 目录。差集门禁与 codegen 都必须用它，避免"一个说 A 目录、一个写 B 目录"。
 */
export function findSdkDirForModule(moduleName: string): string;

/**
 * 白名单模块 → `{ reason, expires }`。**导出是给 spec 用的**：断言从这张表里取样本，
 * 表变了断言自动跟着走，不会再出现"waiver 已移除、spec 还硬写着模块名"的长期红灯。
 */
export const WAIVED_MODULES: Record<string, { reason: string; expires: string }>;

export interface CodegenConsumers {
    /** src 下导入了本模块 `__generated__/route-table` 的文件（跨模块也算）。 */
    strong: string[];
    /** 只有模块自己在发 HTTP 请求、没人导入它的表时的那些文件。 */
    weak: string[];
}

/**
 * 强证据：src 下任何文件（不含该模块自己的 `__generated__/`）导入本模块的
 * `<sdkDir>/__generated__/route-table`，按 import 说明符**解析后的落点**比对。
 *
 * 内部按 `srcRoot` 缓存「文件 → 落点」索引：首次调用扫一次盘，此后每个模块只查表。
 * 原先每次调用都重扫 `src/` 全量文件（49 模块 × 625 文件 ≈ 3 万次读取 ⇒ 单项门禁 ≈28 分钟）。
 */
export function findStrongConsumers(sdkDir: string, srcRoot?: string): string[];

/** 该文件是否含运行时 HTTP 调用（弱证据判据）。 */
export function fileMakesHttpCalls(content: string): boolean;

/**
 * 收集一个模块的消费证据。
 *
 * 只有弱证据时 `classifyModuleCoverage` **不会**判为 covered —— 生成表没有消费者，
 * 要么迁移成显式 import，要么进白名单（带 reason + 到期日）。
 */
export function collectCodegenConsumers(sdkDir: string, srcRoot?: string): CodegenConsumers;

/** Number of `{ method: "..." }` entries in the module's generated route table (0 = none). */
export function countRouteTableEntries(sdkDir: string, srcRoot?: string): number;

/**
 * Classify one ledger module's codegen coverage.
 *
 * `hasCodegen` is the route count found in the module's generated route table, not a
 * boolean: `0` (or a missing dir) means no table was generated.
 *
 * `missing` is the only status that fails the gate.
 */
export function classifyModuleCoverage(
    moduleName: string,
    opts: { hasCodegen: number; consumers?: CodegenConsumers; today?: Date },
): ModuleCoverageVerdict;
