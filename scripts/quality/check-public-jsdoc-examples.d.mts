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
