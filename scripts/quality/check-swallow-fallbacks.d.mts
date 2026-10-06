export interface SwallowWhitelist {
    owner: string;
    expires: string;
}

/** Brace-balanced range of one `catch (...) {…}` body inside the masked source. */
export interface SwallowCatchBlock {
    catchStart: number;
    bodyStart: number;
    bodyEnd: number;
}

export interface SwallowFinding {
    /** Stable identity: `<filePath>#<16 hex>`, deliberately NOT the line number. */
    id: string;
    file: string;
    line: number;
    /** 1-based index of this exact snippet within the file; keeps duplicate sites distinct. */
    ordinal: number;
    snippet: string;
    whitelist: SwallowWhitelist | null;
}

/**
 * Blank out the *contents* of comments and string literals while preserving every newline and
 * character offset, so brace balancing is not confused by prose. Length and line count are
 * invariant, which is what lets line numbers still be resolved from the original source.
 */
export function maskNonCode(source: string): string;

/** Locate every `catch (...) {…}` body by brace balancing. Nested catches are all returned. */
export function findCatchBlocks(masked: string): SwallowCatchBlock[];

/** Locate a `// @swallow-error { owner, expires }` tag belonging to one catch block. */
export function findWhitelist(source: string, catchStart: number, bodyEnd: number): SwallowWhitelist | null;

/** Detect swallowing catches in a source string (pure; touches no filesystem). */
export function collectFindingsFromSource(source: string, relPath: string): SwallowFinding[];

/**
 * `false` when the tag is missing or malformed, `"expired"` when `expires` is in the past,
 * otherwise `"valid"`.
 */
export function validateWhitelist(finding: SwallowFinding): false | "valid" | "expired";
