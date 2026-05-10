import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface TemplateValidationIssue {
    code:
        | "missing-section"
        | "missing-placeholder"
        | "missing-checklist-heading"
        | "missing-input-bound"
        | "missing-prompt-requirement";
    message: string;
}

export interface PromptTemplateFingerprint {
    canonicalPromptSha256: string;
    checklistHeadings: string[];
    inputBoundFields: string[];
    placeholders: string[];
    sectionHeadings: string[];
}

export interface PromptTemplateValidationReport {
    fingerprint: PromptTemplateFingerprint;
    issues: TemplateValidationIssue[];
    valid: boolean;
}

const REQUIRED_SECTION_HEADINGS = [
    "## 0. How this template is used",
    "## 1. Canonical prompt",
    "## 2. Reviewer checklist (run against every model output)",
    "## 3. Anti-patterns to reject outright",
    "## 4. Input bounds",
    "## 5. Provenance",
    "## 6. Change log for this template",
] as const;

const REQUIRED_PLACEHOLDERS = ["{{ change_type }}", "{{ endpoint_diff_json }}", "{{ current_sdk_snippet }}"] as const;

const REQUIRED_CHECKLIST_HEADINGS = [
    "### 2.1 Route fidelity",
    "### 2.2 DTO fidelity",
    "### 2.3 Style consistency",
    "### 2.4 Deprecations",
    "### 2.5 Tests",
    "### 2.6 CHANGELOG",
] as const;

const REQUIRED_PROMPT_REQUIREMENTS = [
    "类型安全的请求/响应结构体",
    "@example",
    "@since backend-api-X.Y.Z",
    "@deprecated",
    "happy path",
    "typed-error",
] as const;

const REQUIRED_INPUT_BOUND_FIELDS = [
    "`endpoint_diff_json` entries",
    "`current_sdk_snippet` lines",
    "Rendered prompt total length",
    "Future bounded backfill pages per session",
] as const;

function extractHeadings(templateText: string, prefix: "## " | "### "): string[] {
    const headings: string[] = [];
    let inCodeFence = false;

    for (const line of templateText.split(/\r?\n/)) {
        if (line.startsWith("```")) {
            inCodeFence = !inCodeFence;
            continue;
        }
        if (!inCodeFence && line.startsWith(prefix)) {
            headings.push(line.trim());
        }
    }

    return headings;
}

function extractInputBoundFields(templateText: string): string[] {
    const match = templateText.match(/## 4\. Input bounds[\s\S]*?\n## 5\./);
    if (!match) return [];
    return match[0]
        .split(/\r?\n/)
        .filter((line) => line.trim().startsWith("|"))
        .map((line) => line.split("|")[1]?.trim() ?? "")
        .filter(Boolean)
        .filter((field) => field !== "Field" && !/^[-:]+$/.test(field.replace(/\s+/g, "")));
}

/**
 * Extract the canonical fenced prompt body from the governance template.
 *
 * @param templateText - Full markdown template text.
 * @returns The raw canonical prompt body, without surrounding markdown headings.
 * @throws {Error} If the canonical prompt section or code fence is missing.
 *
 * @example
 * ```ts
 * const prompt = extractCanonicalPrompt(templateText);
 * console.log(prompt.includes("{{ change_type }}"));
 * ```
 */
export function extractCanonicalPrompt(templateText: string): string {
    const heading = "## 1. Canonical prompt";
    const headingIndex = templateText.indexOf(heading);
    if (headingIndex < 0) {
        throw new Error("模板缺少 `## 1. Canonical prompt` 段落");
    }

    const fenceStart = templateText.indexOf("```\n", headingIndex);
    if (fenceStart < 0) {
        throw new Error("模板缺少 canonical prompt 的起始代码块");
    }

    const contentStart = fenceStart + "```\n".length;
    const fenceEnd = templateText.indexOf("\n```", contentStart);
    if (fenceEnd < 0) {
        throw new Error("模板缺少 canonical prompt 的结束代码块");
    }

    return templateText.slice(contentStart, fenceEnd);
}

/**
 * Build a snapshot-friendly fingerprint for the current prompt template.
 *
 * @param templateText - Full markdown template text.
 * @returns A stable summary that can be used by snapshot tests.
 *
 * @example
 * ```ts
 * const fingerprint = buildPromptTemplateFingerprint(templateText);
 * console.log(fingerprint.canonicalPromptSha256);
 * ```
 */
export function buildPromptTemplateFingerprint(templateText: string): PromptTemplateFingerprint {
    const canonicalPrompt = extractCanonicalPrompt(templateText);
    const placeholders = REQUIRED_PLACEHOLDERS.filter((placeholder) => canonicalPrompt.includes(placeholder));

    return {
        canonicalPromptSha256: crypto.createHash("sha256").update(canonicalPrompt).digest("hex"),
        checklistHeadings: extractHeadings(templateText, "### "),
        inputBoundFields: extractInputBoundFields(templateText),
        placeholders: [...placeholders],
        sectionHeadings: extractHeadings(templateText, "## "),
    };
}

/**
 * Validate that the governance prompt template still contains the required
 * fields, reviewer checkpoints, and input-bound metadata.
 *
 * @param templateText - Full markdown template text.
 * @returns Validation result with a fingerprint and any discovered issues.
 *
 * @example
 * ```ts
 * const report = validatePromptTemplate(templateText);
 * if (!report.valid) {
 *     throw new Error(report.issues.map((issue) => issue.message).join("\\n"));
 * }
 * ```
 */
export function validatePromptTemplate(templateText: string): PromptTemplateValidationReport {
    const fingerprint = buildPromptTemplateFingerprint(templateText);
    const canonicalPrompt = extractCanonicalPrompt(templateText);
    const issues: TemplateValidationIssue[] = [];

    for (const heading of REQUIRED_SECTION_HEADINGS) {
        if (!fingerprint.sectionHeadings.includes(heading)) {
            issues.push({
                code: "missing-section",
                message: `模板缺少段落: ${heading}`,
            });
        }
    }

    for (const placeholder of REQUIRED_PLACEHOLDERS) {
        if (!canonicalPrompt.includes(placeholder)) {
            issues.push({
                code: "missing-placeholder",
                message: `canonical prompt 缺少占位符: ${placeholder}`,
            });
        }
    }

    for (const heading of REQUIRED_CHECKLIST_HEADINGS) {
        if (!fingerprint.checklistHeadings.includes(heading)) {
            issues.push({
                code: "missing-checklist-heading",
                message: `Reviewer checklist 缺少子标题: ${heading}`,
            });
        }
    }

    for (const requirement of REQUIRED_PROMPT_REQUIREMENTS) {
        if (!canonicalPrompt.includes(requirement)) {
            issues.push({
                code: "missing-prompt-requirement",
                message: `canonical prompt 缺少生成要求关键词: ${requirement}`,
            });
        }
    }

    for (const field of REQUIRED_INPUT_BOUND_FIELDS) {
        if (!fingerprint.inputBoundFields.includes(field)) {
            issues.push({
                code: "missing-input-bound",
                message: `Input bounds 缺少字段: ${field}`,
            });
        }
    }

    return {
        fingerprint,
        issues,
        valid: issues.length === 0,
    };
}

/**
 * Validate a template file from disk.
 *
 * @param filePath - Absolute or repo-relative path to the markdown template.
 * @returns Validation report for the file contents.
 * @throws {Error} If the file cannot be read.
 *
 * @example
 * ```ts
 * const report = validatePromptTemplateFile("docs/api-contract/governance/SDK_CODEGEN_PROMPT_TEMPLATE.md");
 * console.log(report.valid);
 * ```
 */
export function validatePromptTemplateFile(filePath: string): PromptTemplateValidationReport {
    return validatePromptTemplate(fs.readFileSync(filePath, "utf8"));
}

/* v8 ignore start */
function writeStdout(value: string): void {
    process.stdout.write(`${value}\n`);
}

function writeStderr(value: string): void {
    process.stderr.write(`${value}\n`);
}

function printValidationUsage(): void {
    writeStderr("Usage: node --experimental-strip-types src/codegen/validateTemplates.ts [template-file]");
}

async function main(): Promise<void> {
    const templateFileArg = process.argv[2];
    const resolvedPath = templateFileArg
        ? path.resolve(templateFileArg)
        : path.resolve(process.cwd(), "docs/api-contract/governance/SDK_CODEGEN_PROMPT_TEMPLATE.md");

    try {
        const report = validatePromptTemplateFile(resolvedPath);
        writeStdout(
            JSON.stringify(
                {
                    file: resolvedPath,
                    ...report,
                },
                null,
                2,
            ),
        );

        if (!report.valid) {
            process.exitCode = 1;
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : "unknown validation failure";
        printValidationUsage();
        writeStderr(message);
        process.exitCode = 1;
    }
}

const currentFilePath = fileURLToPath(import.meta.url);
const invokedFilePath = process.argv[1] ? path.resolve(process.argv[1]) : "";

if (currentFilePath === invokedFilePath) {
    void main();
}
/* v8 ignore stop */
