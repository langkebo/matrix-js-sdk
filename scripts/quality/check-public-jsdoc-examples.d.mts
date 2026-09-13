export interface ContractPublicApiReference {
    owner: string;
    method: string;
    file: string;
    line: number;
}

export interface JSDocIndexEntry {
    file: string;
    owner: string;
    method: string;
    hasJSDoc: boolean;
    hasExample: boolean;
}

export function parseContractPublicApiReferences(docText: string, filePath?: string): ContractPublicApiReference[];

export function collectJSDocIndexFromSource(sourceText: string, filePath?: string): Map<string, JSDocIndexEntry>;

export function findMissingJSDocExamples(
    references: ContractPublicApiReference[],
    methodIndex: Map<string, JSDocIndexEntry>,
): Array<ContractPublicApiReference & { reason: string; implementationFile?: string }>;

export function filterIssuesByChangedFiles(issues: any[], changedFiles: Set<string> | null): any[];

/**
 * Resolve the diff scope for the gate.
 *
 * Returns `null` when there is nothing to diff against (no base ref) — and `null`
 * means "no filter", i.e. scan everything. Returning an empty Set instead made the
 * whole gate vacuous, which is the regression this export exists to make testable.
 */
export function collectChangedFiles(baseRef: string | undefined): Set<string> | null;
