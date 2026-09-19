import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
    buildDraftDocument,
    extractCanonicalPrompt,
    summarizeBackendSemanticDrift,
} from "../../scripts/contract-sync.mjs";

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

function fakeProfiles(entries, { commit = "0123456789abcdef0123456789abcdef01234567", generatedAt = "2026-05-02T00:00:00Z" } = {}) {
    return {
        all: {
            parsed: {
                schema_version: "4",
                state_profile: "all",
                entry_count: entries.length,
                synapse_rust_commit: commit,
                generated_at: generatedAt,
                entries,
            },
        },
    };
}

describe("contract-sync semantic backend check (方案 A)", () => {
    const entryA = { method: "GET", path: "/_synapse/admin/v1/rate-limit-status", registered_by: "admin::server" };
    const entryB = { method: "GET", path: "/_matrix/client/v3/foo", registered_by: "foo" };

    it("stamp-only differences are NOT drift (the 54/54 false-positive regression)", () => {
        const disk = fakeProfiles([entryA, entryB], { commit: "7cb39946ea4a92ef81809796f55af668d6c4cfd4" });
        const source = fakeProfiles([entryA, entryB], {
            commit: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
            generatedAt: "2099-01-01T00:00:00Z",
        });

        const summary = summarizeBackendSemanticDrift(disk, source);

        expect(summary.moduleDiffs).toEqual([]);
        expect(summary.sourceModuleCount).toBe(2);
        expect(summary.sourceEntryCount).toBe(2);
    });

    it("a route the backend has but the mirror lacks is reported as added", () => {
        const disk = fakeProfiles([entryB]);
        const source = fakeProfiles([entryA, entryB]);

        const summary = summarizeBackendSemanticDrift(disk, source);

        expect(summary.moduleDiffs).toHaveLength(1);
        expect(summary.moduleDiffs[0].moduleName).toBe("admin");
        expect(summary.moduleDiffs[0].added).toEqual([entryA]);
        expect(summary.moduleDiffs[0].removed).toEqual([]);
        expect(summary.moduleDiffs[0].modified).toEqual([]);
    });

    it("a route the mirror has but the backend removed is reported as removed", () => {
        const disk = fakeProfiles([entryA, entryB]);
        const source = fakeProfiles([entryB]);

        const summary = summarizeBackendSemanticDrift(disk, source);

        expect(summary.moduleDiffs).toHaveLength(1);
        expect(summary.moduleDiffs[0].moduleName).toBe("admin");
        expect(summary.moduleDiffs[0].removed).toEqual([entryA]);
    });

    it("same key with a changed entry payload (query_params) is reported as modified", () => {
        const changed = { ...entryB, query_params: ["since"] };
        const disk = fakeProfiles([entryB]);
        const source = fakeProfiles([changed]);

        const summary = summarizeBackendSemanticDrift(disk, source);

        expect(summary.moduleDiffs).toHaveLength(1);
        expect(summary.moduleDiffs[0].modified).toEqual([changed]);
    });

    it("registered_by moving a route between modules shows up in both modules", () => {
        const moved = { ...entryB, registered_by: "bar" };
        const disk = fakeProfiles([entryB]);
        const source = fakeProfiles([moved]);

        const summary = summarizeBackendSemanticDrift(disk, source);

        const names = summary.moduleDiffs.map((d) => d.moduleName).sort();
        expect(names).toEqual(["bar", "foo"]);
        expect(summary.moduleDiffs.find((d) => d.moduleName === "foo")?.removed).toEqual([entryB]);
        expect(summary.moduleDiffs.find((d) => d.moduleName === "bar")?.added).toEqual([moved]);
    });
});
