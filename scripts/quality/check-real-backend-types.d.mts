export interface RealBackendDiagnostic {
    /** Repo-relative, forward-slashed path as printed by `tsc`. */
    filePath: string;
    line: number;
    column: number;
    /** `TS2339` and friends. */
    code: string;
    message: string;
}

export interface RealBackendTypesBaseline {
    generatedAt: string | null;
    total: number;
    ids: string[];
}

/** Parse `tsc --pretty false` output into diagnostics (ignores every other line). */
export function parseDiagnostics(output: string): RealBackendDiagnostic[];

/**
 * Stable identity for one diagnostic: file + TS code + message, deliberately NOT the line
 * number, so inserting a line above an existing error cannot fabricate a new one.
 */
export function diagnosticId(diagnostic: RealBackendDiagnostic): string;

/** Ids reported now that the baseline does not list — the only thing that fails the gate. */
export function selectNewIds(currentIds: string[], baselineIds: string[]): string[];

/** Ids the baseline still lists but the project no longer reports (debt paid down). */
export function selectResolvedIds(currentIds: string[], baselineIds: string[]): string[];

export function readBaseline(filePath?: string): RealBackendTypesBaseline;
