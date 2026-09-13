export type ModuleCoverageStatus = "covered" | "waived" | "missing";

export type ModuleCoverageReason = "NO_CODEGEN" | "NO_CONSUMER" | "EXPIRED_WAIVER";

export type ModuleCoverageEvidence = "route-table-import" | "runtime-calls";

export interface ModuleCoverageVerdict {
    status: ModuleCoverageStatus;
    /** Only set when `status === "covered"`. */
    evidence?: ModuleCoverageEvidence;
    /** Only set when `status === "missing"`. */
    reason?: ModuleCoverageReason;
    /** Only set for waived / expired-waiver modules. */
    waiver?: { reason: string; expires: string };
}

export interface CodegenConsumers {
    /** Files in the module that import its generated `__generated__/route-table`. */
    strong: string[];
    /** Files in the module that make HTTP calls (they may use the table via a helper). */
    weak: string[];
}

/**
 * Collect consumer evidence for one module directory.
 *
 * Evidence is taken from files INSIDE the module (plus its flat sibling file), never from
 * class-name similarity: the old name-matching rule let `SyncManager` mark `sliding_sync` as
 * covered because `"slidingsync".includes("sync")`.
 */
export function collectCodegenConsumers(sdkDir: string, srcRoot?: string): CodegenConsumers;

/** Number of `{ method: "..." }` entries in the module's generated route table (0 = none). */
export function countRouteTableEntries(sdkDir: string, srcRoot?: string): number;

/**
 * Classify one ledger module's codegen coverage.
 *
 * `hasCodegen` is the route count found in the module's generated route table, not a
 * boolean: `0` (or a missing dir) means no table was generated, which is the signal the
 * gate keys on. Keeping the count lets the caller distinguish "no table" from "empty
 * table" without a second lookup.
 *
 * `missing` is the only status that fails the gate.
 */
export function classifyModuleCoverage(
    moduleName: string,
    opts: { hasCodegen: number; consumers?: CodegenConsumers; today?: Date },
): ModuleCoverageVerdict;
