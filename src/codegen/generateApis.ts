import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validatePromptTemplate } from "./validateTemplates.ts";

export interface OpenApiParameter {
    in: "path" | "query" | "header" | "cookie";
    name: string;
    required: boolean;
}

export interface NormalizedApiOperation {
    auth: "none" | "user" | "admin" | "federation";
    errorStatuses: string[];
    examples: string[];
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    moduleName: string;
    operationId: string;
    parameters: OpenApiParameter[];
    path: string;
    requestBodyContentTypes: string[];
    responseStatuses: string[];
    summary: string;
}

export interface GeneratedApiArtifact {
    content: string;
    fileName: string;
    moduleName: string;
    operations: NormalizedApiOperation[];
}

export interface ExistingGeneratedArtifactAudit {
    generatedDir: string;
    hasAcceptanceSpec: boolean;
    hasContractAssertions: boolean;
    hasDto: boolean;
    hasRouteTable: boolean;
    moduleName: string;
}

interface OpenApiOperationRecord {
    "operationId"?: unknown;
    "parameters"?: unknown;
    "requestBody"?: unknown;
    "responses"?: unknown;
    "security"?: unknown;
    "summary"?: unknown;
    "tags"?: unknown;
    "x-codeSamples"?: unknown;
}

type UnknownRecord = Record<string, unknown>;

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

function asRecord(value: unknown): UnknownRecord {
    return typeof value === "object" && value !== null ? (value as UnknownRecord) : {};
}

function toCamelCase(value: string): string {
    const cleaned = value
        .replace(/[^A-Za-z0-9]+/g, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    return cleaned
        .map((part, index) =>
            index === 0 ? part.toLowerCase() : part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase(),
        )
        .join("");
}

function toPascalCase(value: string): string {
    const camelValue = toCamelCase(value);
    return camelValue.slice(0, 1).toUpperCase() + camelValue.slice(1);
}

function toConstantCase(value: string): string {
    return value
        .replace(/[^A-Za-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toUpperCase();
}

function inferModuleName(pathTemplate: string, tags: string[]): string {
    if (tags.length > 0) return toCamelCase(tags[0]);

    const firstNamedSegment = pathTemplate
        .split("/")
        .map((segment) => segment.trim())
        .find((segment) => segment.length > 0 && !segment.startsWith("{") && !segment.startsWith("_matrix"));

    return toCamelCase(firstNamedSegment ?? "generated-api");
}

function inferAuthMode(securityValue: unknown): NormalizedApiOperation["auth"] {
    if (!Array.isArray(securityValue) || securityValue.length === 0) {
        return "none";
    }

    const flattenedKeys = securityValue.flatMap((entry) =>
        Object.keys(asRecord(entry)).map((key) => key.toLowerCase()),
    );

    if (flattenedKeys.some((key) => key.includes("admin"))) return "admin";
    if (flattenedKeys.some((key) => key.includes("federation"))) return "federation";
    return "user";
}

function normalizeParameters(pathParameters: unknown, operationParameters: unknown): OpenApiParameter[] {
    const collected = [
        ...(Array.isArray(pathParameters) ? pathParameters : []),
        ...(Array.isArray(operationParameters) ? operationParameters : []),
    ];

    return collected
        .map((parameter) => asRecord(parameter))
        .filter((parameter) => typeof parameter["name"] === "string" && typeof parameter["in"] === "string")
        .map((parameter) => ({
            in: parameter["in"] as OpenApiParameter["in"],
            name: parameter["name"] as string,
            required: Boolean(parameter["required"]),
        }));
}

function extractResponseStatuses(responses: unknown): string[] {
    return Object.keys(asRecord(responses)).sort((left, right) => left.localeCompare(right));
}

function extractErrorStatuses(responseStatuses: string[]): string[] {
    return responseStatuses.filter((status) => /^[45]\d\d$/.test(status));
}

function extractRequestBodyContentTypes(requestBody: unknown): string[] {
    const content = asRecord(asRecord(requestBody)["content"]);
    return Object.keys(content).sort((left, right) => left.localeCompare(right));
}

function extractExamples(operation: OpenApiOperationRecord): string[] {
    const inlineSamples = Array.isArray(operation["x-codeSamples"])
        ? operation["x-codeSamples"]
              .map((entry) => asRecord(entry)["label"])
              .filter((value): value is string => typeof value === "string")
        : [];

    if (inlineSamples.length > 0) return inlineSamples;
    if (typeof operation.summary === "string" && operation.summary.trim().length > 0) {
        return [operation.summary.trim()];
    }

    return [];
}

/**
 * Parse a JSON OpenAPI or Swagger document.
 *
 * @param documentText - Raw document text.
 * @param sourceName - Friendly source name used in error messages.
 * @returns Parsed OpenAPI/Swagger object.
 * @throws {Error} If the document is not valid JSON or lacks an OpenAPI/Swagger version marker.
 *
 * @example
 * ```ts
 * const document = parseOpenApiDocument('{"openapi":"3.1.0","paths":{}}');
 * console.log(document.openapi);
 * ```
 */
export function parseOpenApiDocument(documentText: string, sourceName = "openapi.json"): UnknownRecord {
    let parsed: unknown;

    try {
        parsed = JSON.parse(documentText);
    } catch (error) {
        const message = error instanceof Error ? error.message : "unknown JSON parse failure";
        throw new Error(`${sourceName} 不是合法的 JSON OpenAPI/Swagger 文档: ${message}`);
    }

    const document = asRecord(parsed);
    if (typeof document["openapi"] !== "string" && typeof document["swagger"] !== "string") {
        throw new Error(`${sourceName} 缺少 openapi/swagger 版本字段，当前工具仅支持标准 OpenAPI/Swagger JSON`);
    }

    return document;
}

/**
 * Normalize OpenAPI operations into a compact repo-friendly shape that can be
 * rendered into side-effect-free TypeScript metadata files.
 *
 * @param document - Parsed OpenAPI or Swagger document.
 * @returns Flattened and normalized operations.
 *
 * @example
 * ```ts
 * const operations = normalizeOpenApiOperations(document);
 * console.log(operations[0]?.path);
 * ```
 */
export function normalizeOpenApiOperations(document: UnknownRecord): NormalizedApiOperation[] {
    const globalSecurity = document["security"];
    const paths = asRecord(document["paths"]);
    const operations: NormalizedApiOperation[] = [];

    for (const [pathTemplate, pathItemValue] of Object.entries(paths)) {
        const pathItem = asRecord(pathItemValue);
        const pathParameters = pathItem["parameters"];

        for (const method of HTTP_METHODS) {
            if (!(method in pathItem)) continue;

            const operation = asRecord(pathItem[method]) as OpenApiOperationRecord;
            const tags = Array.isArray(operation.tags)
                ? operation.tags.filter((entry): entry is string => typeof entry === "string")
                : [];

            const responseStatuses = extractResponseStatuses(operation.responses);
            const operationId =
                typeof operation.operationId === "string" && operation.operationId.trim().length > 0
                    ? operation.operationId.trim()
                    : `${method}_${pathTemplate}`;

            operations.push({
                auth: inferAuthMode(operation.security ?? globalSecurity),
                errorStatuses: extractErrorStatuses(responseStatuses),
                examples: extractExamples(operation),
                method: method.toUpperCase() as NormalizedApiOperation["method"],
                moduleName: inferModuleName(pathTemplate, tags),
                operationId,
                parameters: normalizeParameters(pathParameters, operation.parameters),
                path: pathTemplate,
                requestBodyContentTypes: extractRequestBodyContentTypes(operation.requestBody),
                responseStatuses,
                summary: typeof operation.summary === "string" ? operation.summary.trim() : operationId,
            });
        }
    }

    return operations.sort(
        (left, right) =>
            left.moduleName.localeCompare(right.moduleName) ||
            left.path.localeCompare(right.path) ||
            left.method.localeCompare(right.method),
    );
}

/**
 * Inspect the current repo's generated contract helper directories to spot
 * missing route tables, DTO files, assertions, or acceptance specs.
 *
 * @param repoRoot - Repository root directory.
 * @returns One audit row per generated module directory.
 *
 * @example
 * ```ts
 * const audit = auditExistingGeneratedArtifacts(process.cwd());
 * console.log(audit.every((item) => item.hasRouteTable));
 * ```
 */
export function auditExistingGeneratedArtifacts(repoRoot: string): ExistingGeneratedArtifactAudit[] {
    const srcDir = path.join(repoRoot, "src");
    const audits: ExistingGeneratedArtifactAudit[] = [];

    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const generatedDir = path.join(srcDir, entry.name, "__generated__");
        if (!fs.existsSync(generatedDir)) continue;

        audits.push({
            generatedDir,
            hasAcceptanceSpec: fs.existsSync(path.join(generatedDir, "acceptance.spec.ts")),
            hasContractAssertions: fs.existsSync(path.join(generatedDir, "contract-assertions.ts")),
            hasDto: fs.existsSync(path.join(generatedDir, "dto.ts")),
            hasRouteTable: fs.existsSync(path.join(generatedDir, "route-table.ts")),
            moduleName: entry.name,
        });
    }

    return audits.sort((left, right) => left.moduleName.localeCompare(right.moduleName));
}

/**
 * Render a side-effect-free metadata artifact for one normalized module.
 *
 * @param moduleName - Logical module name.
 * @param operations - Operations that belong to the module.
 * @returns TypeScript source code for the generated metadata artifact.
 *
 * @example
 * ```ts
 * const artifact = renderApiModuleArtifact("friend", operations);
 * console.log(artifact.includes("export const FRIEND_OPERATIONS"));
 * ```
 */
export function renderApiModuleArtifact(moduleName: string, operations: readonly NormalizedApiOperation[]): string {
    const typePrefix = toPascalCase(moduleName || "GeneratedApi");
    const constName = `${toConstantCase(moduleName || "generated_api")}_OPERATIONS`;

    const lines: string[] = [
        "/*",
        " * AUTO-GENERATED by src/codegen/generateApis.ts — DO NOT EDIT.",
        ` * Module: ${moduleName}`,
        " */",
        "",
        `export interface ${typePrefix}Parameter {`,
        '    in: "path" | "query" | "header" | "cookie";',
        "    name: string;",
        "    required: boolean;",
        "}",
        "",
        `export interface ${typePrefix}Operation {`,
        '    auth: "none" | "user" | "admin" | "federation";',
        "    errorStatuses: readonly string[];",
        "    examples: readonly string[];",
        '    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";',
        "    operationId: string;",
        `    parameters: readonly ${typePrefix}Parameter[];`,
        "    path: string;",
        "    requestBodyContentTypes: readonly string[];",
        "    responseStatuses: readonly string[];",
        "    summary: string;",
        "}",
        "",
        `export const ${constName} = [`,
    ];

    for (const operation of operations) {
        lines.push(
            `    ${JSON.stringify({
                auth: operation.auth,
                errorStatuses: operation.errorStatuses,
                examples: operation.examples,
                method: operation.method,
                operationId: operation.operationId,
                parameters: operation.parameters,
                path: operation.path,
                requestBodyContentTypes: operation.requestBodyContentTypes,
                responseStatuses: operation.responseStatuses,
                summary: operation.summary,
            })},`,
        );
    }

    lines.push(`] as const satisfies readonly ${typePrefix}Operation[];`);
    lines.push("");
    lines.push("/**");
    lines.push(` * Validate that all required parameters for \`${moduleName}\` are present.`);
    lines.push(" *");
    lines.push(" * @param operationId - Operation identifier defined by the source schema.");
    lines.push(" * @param providedParams - Runtime parameter bag keyed by parameter name.");
    lines.push(" * @returns The matching normalized operation metadata.");
    lines.push(" * @throws {Error} If the operation does not exist or a required parameter is missing.");
    lines.push(" *");
    lines.push(" * @example");
    lines.push(" * ```ts");
    lines.push(
        ` * const operation = validate${typePrefix}OperationInput("listItems", { roomId: "!room:example.com" });`,
    );
    lines.push(" * console.log(operation.path);");
    lines.push(" * ```");
    lines.push(" */");
    lines.push(
        `export function validate${typePrefix}OperationInput(operationId: string, providedParams: Record<string, unknown>): ${typePrefix}Operation {`,
    );
    lines.push(`    const operation = ${constName}.find((candidate) => candidate.operationId === operationId);`);
    lines.push("    if (!operation) {");
    lines.push(`        throw new Error(\`Unknown ${moduleName} operation: \${operationId}\`);`);
    lines.push("    }");
    lines.push("");
    lines.push("    for (const parameter of operation.parameters) {");
    lines.push("        if (!parameter.required) continue;");
    lines.push("        if (!(parameter.name in providedParams) || providedParams[parameter.name] == null) {");
    lines.push(
        `            throw new Error(\`Missing required \${parameter.in} parameter '\${parameter.name}' for ${moduleName} operation '\${operationId}'\`);`,
    );
    lines.push("        }");
    lines.push("    }");
    lines.push("");
    lines.push("    return operation;");
    lines.push("}");
    lines.push("");

    return lines.join("\n");
}

/**
 * Generate one metadata artifact per module from a JSON OpenAPI/Swagger
 * document.
 *
 * @param documentText - Raw OpenAPI/Swagger JSON text.
 * @param templateText - Governance template used to guard generator assumptions.
 * @param sourceName - Friendly source name used in error messages.
 * @returns Generated module artifacts grouped by normalized module name.
 * @throws {Error} If the prompt template is invalid.
 *
 * @example
 * ```ts
 * const artifacts = generateApisFromOpenApiDocument(openApiText, templateText);
 * console.log(artifacts.map((artifact) => artifact.fileName));
 * ```
 */
export function generateApisFromOpenApiDocument(
    documentText: string,
    templateText: string,
    sourceName = "openapi.json",
): GeneratedApiArtifact[] {
    const templateReport = validatePromptTemplate(templateText);
    if (!templateReport.valid) {
        throw new Error(templateReport.issues.map((issue) => issue.message).join("\n"));
    }

    const document = parseOpenApiDocument(documentText, sourceName);
    const operations = normalizeOpenApiOperations(document);
    const grouped = new Map<string, NormalizedApiOperation[]>();

    for (const operation of operations) {
        const moduleOperations = grouped.get(operation.moduleName) ?? [];
        moduleOperations.push(operation);
        grouped.set(operation.moduleName, moduleOperations);
    }

    return [...grouped.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([moduleName, moduleOperations]) => ({
            content: renderApiModuleArtifact(moduleName, moduleOperations),
            fileName: `${toCamelCase(moduleName)}Apis.ts`,
            moduleName,
            operations: moduleOperations,
        }));
}

interface GenerateApisCliOptions {
    inputPath: string;
    outputDir: string;
    templatePath: string;
}

/* v8 ignore start */
function writeStdout(value: string): void {
    process.stdout.write(`${value}\n`);
}

function writeStderr(value: string): void {
    process.stderr.write(`${value}\n`);
}

function parseGenerateApisCliArgs(argv: readonly string[]): GenerateApisCliOptions {
    let inputPath = "";
    let outputDir = path.resolve(process.cwd(), "src/codegen/generated");
    let templatePath = path.resolve(process.cwd(), "docs/api-contract/governance/SDK_CODEGEN_PROMPT_TEMPLATE.md");

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        const value = argv[index + 1];

        if (argument === "--input" && value) {
            inputPath = path.resolve(value);
            index += 1;
            continue;
        }

        if (argument === "--out-dir" && value) {
            outputDir = path.resolve(value);
            index += 1;
            continue;
        }

        if (argument === "--template" && value) {
            templatePath = path.resolve(value);
            index += 1;
        }
    }

    if (!inputPath) {
        throw new Error("缺少必填参数 --input <openapi.json>");
    }

    return {
        inputPath,
        outputDir,
        templatePath,
    };
}

function printGenerateApisUsage(): void {
    writeStderr(
        "Usage: node --experimental-strip-types src/codegen/generateApis.ts --input <openapi.json> [--template <template.md>] [--out-dir <dir>]",
    );
}

async function main(): Promise<void> {
    try {
        const options = parseGenerateApisCliArgs(process.argv.slice(2));
        const documentText = fs.readFileSync(options.inputPath, "utf8");
        const templateText = fs.readFileSync(options.templatePath, "utf8");
        const artifacts = generateApisFromOpenApiDocument(documentText, templateText, path.basename(options.inputPath));

        fs.mkdirSync(options.outputDir, { recursive: true });

        for (const artifact of artifacts) {
            fs.writeFileSync(path.join(options.outputDir, artifact.fileName), artifact.content);
        }

        writeStdout(
            JSON.stringify(
                {
                    inputPath: options.inputPath,
                    outputDir: options.outputDir,
                    templatePath: options.templatePath,
                    generatedFiles: artifacts.map((artifact) => ({
                        fileName: artifact.fileName,
                        moduleName: artifact.moduleName,
                        operationCount: artifact.operations.length,
                    })),
                },
                null,
                2,
            ),
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : "unknown codegen failure";
        printGenerateApisUsage();
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
