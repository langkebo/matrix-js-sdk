import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildDraftDocument, extractCanonicalPrompt } from "../../scripts/contract-sync.mjs";

const repoRoot = path.resolve(__dirname, "../..");
const promptTemplate = fs.readFileSync(
    path.join(repoRoot, "docs", "api-contract", "governance", "SDK_CODEGEN_PROMPT_TEMPLATE.md"),
    "utf8",
);

describe("contract-sync draft rendering", () => {
    it("extracts only the canonical prompt body from the template", () => {
        const promptBody = extractCanonicalPrompt(promptTemplate);

        expect(promptBody).toContain("## 变更类型：{{ change_type }}");
        expect(promptBody).toContain("## 受影响端点");
        expect(promptBody).not.toContain("## 0. How this template is used");
        expect(promptBody).not.toContain("## 2. Reviewer checklist");
    });

    it("renders a normal draft with provenance and prompt body", () => {
        const promptBody = extractCanonicalPrompt(promptTemplate);
        const draft = buildDraftDocument({
            promptBody,
            moduleName: "dm",
            changeType: "added",
            entries: [
                {
                    method: "POST",
                    path: "/_matrix/client/unstable/io.element/dm/synthetic_probe",
                    registered_by: "dm",
                    feature_gate: null,
                    path_params: [],
                    query_params: [],
                    auth: "user",
                    diff_kind: "added",
                },
            ],
            sdkSnippet: "export function probe() {\n    return true;\n}\n",
            synapseRustCommit: "0123456789abcdef0123456789abcdef01234567",
            timestampFilePart: "2026-05-02T00-00-00Z",
            chunkIndex: 0,
        });

        expect(draft.isOverflow).toBe(false);
        expect(draft.rendered).toContain("# Contract Draft");
        expect(draft.rendered).toContain("## Provenance");
        expect(draft.rendered).toContain(
            "contract-prompt: docs/api-contract/drafts/2026-05-02T00-00-00Z-dm-added-01.md",
        );
        expect(draft.rendered).toContain("ledger-commit:   synapse-rust@0123456789abcdef0123456789abcdef01234567");
        expect(draft.rendered).toContain("## Prompt");
        expect(draft.rendered).toContain("## 变更类型：added");
        expect(draft.rendered).not.toContain("## 0. How this template is used");
    });

    it("falls back to an overflow stub when the hard cap is exceeded", () => {
        const promptBody = extractCanonicalPrompt(promptTemplate);
        const hugeSnippet = `${"const x = 1;\n".repeat(520)}`;
        const draft = buildDraftDocument({
            promptBody,
            moduleName: "dm",
            changeType: "modified",
            entries: [
                {
                    method: "PUT",
                    path: "/_matrix/client/unstable/io.element/dm/synthetic_probe",
                    registered_by: "dm",
                    feature_gate: null,
                    path_params: [],
                    query_params: [],
                    auth: "user",
                    diff_kind: "modified",
                },
            ],
            sdkSnippet: hugeSnippet,
            synapseRustCommit: "0123456789abcdef0123456789abcdef01234567",
            timestampFilePart: "2026-05-02T00-00-00Z",
            chunkIndex: 0,
        });

        expect(draft.isOverflow).toBe(true);
        expect(draft.rendered).toContain("# Contract Draft Overflow");
        expect(draft.rendered).toContain("reason: current_sdk_snippet exceeds hard cap");
        expect(draft.rendered).toContain(
            "contract-prompt: docs/api-contract/drafts/2026-05-02T00-00-00Z-dm-modified-01.md",
        );
        expect(draft.rendered).not.toContain("## Prompt");
    });
});
