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

export interface LedgerProfileBundle {
    parsed: {
        schema_version?: string;
        state_profile?: string;
        entry_count?: number;
        synapse_rust_commit?: string | null;
        generated_at?: string | null;
        entries: {
            method: string;
            path: string;
            registered_by: string;
            [key: string]: unknown;
        }[];
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

export interface BackendSemanticModuleDiff {
    moduleName: string;
    added: Record<string, unknown>[];
    removed: Record<string, unknown>[];
    modified: Record<string, unknown>[];
}

export interface BackendSemanticDriftSummary {
    moduleDiffs: BackendSemanticModuleDiff[];
    diskModuleCount: number;
    sourceModuleCount: number;
    sourceEntryCount: number;
}

export function summarizeBackendSemanticDrift(
    diskProfiles: { all: LedgerProfileBundle },
    sourceProfiles: { all: LedgerProfileBundle },
): BackendSemanticDriftSummary;
