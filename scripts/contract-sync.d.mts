export interface DraftDocumentOptions {
    promptBody: string;
    moduleName: string;
    changeType: string;
    entries: unknown[];
    sdkSnippet: string;
    synapseRustCommit?: string | null;
    timestampFilePart: string;
    chunkIndex: number;
    ledgerProfile?: string;
}

export interface DraftDocumentResult {
    fileName: string;
    rendered: string;
    provenanceLines: string[];
    snippetLines: number;
    approxTokenCount: number;
    overflowReasons: string[];
    isOverflow: boolean;
}

export function extractCanonicalPrompt(template: string): string;

export function wrapRenderedPrompt(args: { renderedPrompt: string; provenanceLines: string[] }): string;

export function renderOverflowStub(args: {
    moduleName: string;
    changeType: string;
    reason: string;
    provenanceLines: string[];
}): string;

export function buildDraftDocument(options: DraftDocumentOptions): DraftDocumentResult;
