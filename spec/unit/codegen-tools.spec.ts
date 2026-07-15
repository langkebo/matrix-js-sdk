import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
    auditExistingGeneratedArtifacts,
    generateApisFromOpenApiDocument,
    normalizeOpenApiOperations,
    parseOpenApiDocument,
} from "../../src/code-gen/generateApis";
import { buildGeneratedCodeSection, syncContractDoc, upsertMarkdownSection } from "../../src/code-gen/syncDocs";
import { extractCanonicalPrompt, validatePromptTemplate } from "../../src/code-gen/validateTemplates";

const repoRoot = process.cwd();
const promptTemplatePath = path.join(repoRoot, "docs", "api-contract", "governance", "SDK_CODEGEN_PROMPT_TEMPLATE.md");
const promptTemplate = fs.readFileSync(promptTemplatePath, "utf8");

const openApiFixture = JSON.stringify(
    {
        openapi: "3.1.0",
        security: [{ bearerAuth: [] }],
        paths: {
            "/friends": {
                get: {
                    operationId: "listFriends",
                    summary: "List friends",
                    responses: {
                        200: { description: "ok" },
                        401: { description: "unauthorized" },
                    },
                    tags: ["friend"],
                },
            },
            "/friends/{userId}": {
                parameters: [{ in: "path", name: "userId", required: true }],
                delete: {
                    operationId: "removeFriend",
                    summary: "Remove friend",
                    responses: {
                        200: { description: "removed" },
                        404: { description: "not found" },
                    },
                    tags: ["friend"],
                },
            },
            "/admin/feature-flags/{flagName}": {
                parameters: [{ in: "path", name: "flagName", required: true }],
                put: {
                    operationId: "updateFeatureFlag",
                    requestBody: {
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                },
                            },
                        },
                    },
                    responses: {
                        200: { description: "updated" },
                        400: { description: "invalid" },
                    },
                    security: [{ adminToken: [] }],
                    summary: "Update feature flag",
                    tags: ["feature-flags"],
                },
            },
        },
    },
    null,
    2,
);

describe("codegen tools", () => {
    it("validates the live governance prompt template", () => {
        const report = validatePromptTemplate(promptTemplate);

        expect(report.valid).toBe(true);
        expect(report.issues).toHaveLength(0);
    });

    it("parses JSON OpenAPI documents and rejects malformed input", () => {
        const document = parseOpenApiDocument(openApiFixture, "fixture.json");

        expect(document["openapi"]).toBe("3.1.0");
        expect(() => parseOpenApiDocument("not-json", "broken.json")).toThrow(
            /broken\.json 不是合法的 JSON OpenAPI\/Swagger 文档/,
        );
        expect(() => parseOpenApiDocument('{"paths":{}}', "missing-version.json")).toThrow(
            /missing-version\.json 缺少 openapi\/swagger 版本字段/,
        );
    });

    it("generates module artifacts with typed metadata and runtime validators", () => {
        const artifacts = generateApisFromOpenApiDocument(openApiFixture, promptTemplate, "fixture.json");
        const friendArtifact = artifacts.find((artifact) => artifact.moduleName === "friend");
        const featureFlagArtifact = artifacts.find((artifact) => artifact.moduleName === "featureFlags");

        expect(artifacts).toHaveLength(2);
        expect(friendArtifact?.fileName).toBe("friendApis.ts");
        expect(friendArtifact?.content).toContain("export const FRIEND_OPERATIONS");
        expect(friendArtifact?.content).toContain("validateFriendOperationInput");
        expect(friendArtifact?.content).toContain('"operationId":"removeFriend"');
        expect(featureFlagArtifact?.content).toContain('"auth":"admin"');
    });

    it("normalizes fallback operation metadata across auth modes and examples", () => {
        const document = parseOpenApiDocument(
            JSON.stringify({
                swagger: "2.0",
                paths: {
                    "/_matrix/federation/v1/event/{eventId}": {
                        parameters: [{ in: "path", name: "eventId", required: true }],
                        get: {
                            responses: {
                                200: { description: "ok" },
                                500: { description: "failure" },
                            },
                            security: [{ federationAuth: [] }],
                            "x-codeSamples": [{ label: "Fetch event" }],
                        },
                    },
                    "/public/info": {
                        get: {
                            responses: {
                                204: { description: "empty" },
                            },
                            summary: "Read public info",
                        },
                    },
                },
            }),
            "normalize.json",
        );

        const operations = normalizeOpenApiOperations(document);
        const federationOperation = operations.find((operation) => operation.path.includes("/federation/"));
        const publicOperation = operations.find((operation) => operation.path === "/public/info");

        expect(federationOperation).toMatchObject({
            auth: "federation",
            errorStatuses: ["500"],
            moduleName: "federation",
            operationId: "get_/_matrix/federation/v1/event/{eventId}",
            requestBodyContentTypes: [],
        });
        expect(federationOperation?.examples).toEqual(["Fetch event"]);
        expect(publicOperation).toMatchObject({
            auth: "none",
            moduleName: "public",
            operationId: "get_/public/info",
            responseStatuses: ["204"],
            summary: "Read public info",
        });
    });

    it("audits the existing generated artifact directories", () => {
        const audits = auditExistingGeneratedArtifacts(repoRoot);
        const adminAudit = audits.find((audit) => audit.moduleName === "admin");
        const friendAudit = audits.find((audit) => audit.moduleName === "friend");

        expect(audits.length).toBeGreaterThan(10);
        // `friend` is a fully-codegen'd module: all four artifacts present.
        expect(friendAudit).toMatchObject({
            hasAcceptanceSpec: true,
            hasContractAssertions: true,
            hasDto: true,
            hasRouteTable: true,
        });
        // `admin` is in SKIP_ROUTE_TABLE_MODULES (scripts/sdk-contract-codegen.mjs):
        // only dto.ts is generated, route-table/contract-assertions/acceptance-spec are skipped.
        expect(adminAudit).toMatchObject({
            hasAcceptanceSpec: false,
            hasContractAssertions: false,
            hasDto: true,
            hasRouteTable: false,
        });
    });

    it("reports partial generated artifact directories in temporary repos", () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-js-sdk-codegen-"));
        const partialGeneratedDir = path.join(tempRoot, "src", "partial", "__generated__");
        fs.mkdirSync(partialGeneratedDir, { recursive: true });
        fs.writeFileSync(path.join(partialGeneratedDir, "route-table.ts"), "export const ROUTES = [];");

        const audits = auditExistingGeneratedArtifacts(tempRoot);

        expect(audits).toEqual([
            {
                generatedDir: partialGeneratedDir,
                hasAcceptanceSpec: false,
                hasContractAssertions: false,
                hasDto: false,
                hasRouteTable: true,
                moduleName: "partial",
            },
        ]);
    });

    it("upserts generated code sections back into markdown docs", () => {
        const original = "# Friend\n\n## 概述\n\n原始内容。\n";
        const synced = syncContractDoc(original, "friend", {
            routeTable: "export const FRIEND_ROUTES = [];",
            dto: "export interface FriendDto { id: string; }",
        });
        const replaced = upsertMarkdownSection(synced, "## 代码生成产物", "## 代码生成产物\n\n替换后的内容\n");

        expect(synced).toContain("## 代码生成产物");
        expect(synced).toContain("FRIEND_ROUTES");
        expect(replaced).toContain("替换后的内容");
        expect(replaced).not.toContain("FriendDto");
    });

    it("truncates long snippets and rejects empty doc-sync payloads", () => {
        const section = buildGeneratedCodeSection(
            "friend",
            {
                routeTable: "line1\nline2\nline3",
            },
            2,
        );

        expect(section).toContain("truncated (1 more lines)");
        expect(() => buildGeneratedCodeSection("empty", {})).toThrow(/没有可同步的生成代码片段/);
    });

    it("flags missing canonical prompt requirements and invalid template inputs", () => {
        const canonicalPrompt = extractCanonicalPrompt(promptTemplate);
        const brokenCanonicalPrompt = canonicalPrompt.replace("@example", "@sample");
        const brokenTemplate = promptTemplate
            .replace(canonicalPrompt, brokenCanonicalPrompt)
            .replace("### 2.6 CHANGELOG", "### 2.6 Missing")
            .replace("Rendered prompt total length", "Prompt size");
        const report = validatePromptTemplate(brokenTemplate);

        expect(report.valid).toBe(false);
        expect(report.issues.some((issue) => issue.code === "missing-prompt-requirement")).toBe(true);
        expect(report.issues.some((issue) => issue.code === "missing-checklist-heading")).toBe(true);
        expect(report.issues.some((issue) => issue.code === "missing-input-bound")).toBe(true);
    });

    it("rejects invalid prompt templates before generating artifacts", () => {
        const canonicalPrompt = extractCanonicalPrompt(promptTemplate);
        const invalidCanonicalPrompt = canonicalPrompt.replace(
            "{{ current_sdk_snippet }}",
            "{{ removed_sdk_snippet }}",
        );
        const invalidTemplate = promptTemplate.replace(canonicalPrompt, invalidCanonicalPrompt);

        expect(() => generateApisFromOpenApiDocument(openApiFixture, invalidTemplate, "fixture.json")).toThrow(
            /canonical prompt 缺少占位符/,
        );
    });
});
