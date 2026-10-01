export interface LcovRecord {
    linesFound: number;
    linesHit: number;
    /** `linesHit / linesFound * 100`; 0 when the record has no LF lines. */
    ratio: number;
}

/** One entry of `scripts/quality/critical-modules.json`. */
export interface CriticalModuleTarget {
    path: string;
    floorPercent?: number;
}

export interface CriticalCoverageEvaluation {
    /** Human-readable failure lines; non-empty means the gate must exit 1. */
    failures: string[];
    /** Modules that met their floor. */
    checked: { path: string; ratio: number; required: number }[];
}

/** Parse an lcov tracefile into `path -> record` (paths normalized to forward slashes). */
export function parseLcov(content: string): Map<string, LcovRecord>;

/**
 * Check every critical module against its ratchet floor.
 *
 * `records` keys may be repo-relative (`src/...`, what lcov writes) or absolute; both are
 * accepted, which is the behaviour that was missing when the gate was permanently red.
 */
export function evaluateCriticalCoverage(options: {
    records: Map<string, LcovRecord>;
    targets: CriticalModuleTarget[];
    required: (entry: CriticalModuleTarget) => number;
    projectRoot: string;
}): CriticalCoverageEvaluation;
