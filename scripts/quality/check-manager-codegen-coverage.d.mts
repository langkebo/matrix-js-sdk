export type ModuleCoverageStatus = "covered" | "waived" | "missing";

export type ModuleCoverageReason = "NO_CODEGEN" | "MISSING_MANAGER" | "EXPIRED_WAIVER";

export interface ModuleCoverageVerdict {
    status: ModuleCoverageStatus;
    /** Only set when `status === "missing"`. */
    reason?: ModuleCoverageReason;
    /** Only set for waived / expired-waiver modules. */
    waiver?: { reason: string; expires: string };
}

/**
 * Classify one ledger module's codegen coverage.
 *
 * `hasCodegen` is the route count found in the module's generated route table, not a
 * boolean: `0` (or a missing dir) means no table was generated, which is the signal the
 * gate keys on. Keeping the count lets the caller distinguish "no table" from "empty
 * table" without a second lookup.
 *
 * `missing` is the only status that fails the gate, so an unknown module without a
 * route-table (or without a manager consuming one) still breaks the build.
 */
export function classifyModuleCoverage(
    moduleName: string,
    opts: { hasCodegen: number; hasManager: boolean; today?: Date },
): ModuleCoverageVerdict;
