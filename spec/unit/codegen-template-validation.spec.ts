import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
    buildPromptTemplateFingerprint,
    extractCanonicalPrompt,
    validatePromptTemplate,
    validatePromptTemplateFile,
} from "../../src/codegen/validateTemplates";

const repoRoot = process.cwd();
const promptTemplatePath = path.join(repoRoot, "docs", "api-contract", "governance", "SDK_CODEGEN_PROMPT_TEMPLATE.md");
const promptTemplate = fs.readFileSync(promptTemplatePath, "utf8");

describe("codegen template validation", () => {
    it("matches the current template fingerprint snapshot", () => {
        expect(buildPromptTemplateFingerprint(promptTemplate)).toMatchSnapshot();
    });

    it("fails fast when a required placeholder disappears", () => {
        const canonicalPrompt = extractCanonicalPrompt(promptTemplate);
        const brokenCanonicalPrompt = canonicalPrompt.replace("{{ endpoint_diff_json }}", "{{ removed_field }}");
        const brokenTemplate = promptTemplate.replace(canonicalPrompt, brokenCanonicalPrompt);
        const report = validatePromptTemplate(brokenTemplate);

        expect(report.valid).toBe(false);
        expect(report.issues.some((issue) => issue.code === "missing-placeholder")).toBe(true);
    });

    it("reports malformed canonical prompt fences", () => {
        expect(() => extractCanonicalPrompt("## 1. Canonical prompt\nmissing fence")).toThrow(/起始代码块/);
        expect(() => extractCanonicalPrompt("## 1. Canonical prompt\n```\nmissing end fence")).toThrow(/结束代码块/);
    });

    it("reports missing sections and validates templates from disk", () => {
        const tempFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "matrix-js-sdk-template-")), "template.md");
        fs.writeFileSync(tempFile, promptTemplate);

        const reportFromDisk = validatePromptTemplateFile(tempFile);
        const brokenTemplate = promptTemplate.replace("## 5. Provenance", "## 5. Missing");
        const brokenReport = validatePromptTemplate(brokenTemplate);

        expect(reportFromDisk.valid).toBe(true);
        expect(brokenReport.valid).toBe(false);
        expect(brokenReport.issues.some((issue) => issue.code === "missing-section")).toBe(true);
    });
});
