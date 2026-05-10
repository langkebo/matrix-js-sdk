import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface GeneratedSnippetBundle {
    acceptanceSpec?: string;
    contractAssertions?: string;
    dto?: string;
    routeTable?: string;
}

function trimSnippet(snippet: string, maxLines: number): string {
    const lines = snippet.trim().split(/\r?\n/);
    if (lines.length <= maxLines) return lines.join("\n");
    return `${lines.slice(0, maxLines).join("\n")}\n// ... truncated (${lines.length - maxLines} more lines)`;
}

function renderSnippetSection(label: string, fileName: string, code: string): string {
    return [`### ${label}`, "", `- 来源文件: \`${fileName}\``, "", "```ts", code, "```", ""].join("\n");
}

/**
 * Render a markdown section that mirrors the latest generated code snippets
 * for one contract module.
 *
 * @param moduleName - Human-readable module name.
 * @param snippets - Generated TypeScript snippets keyed by artifact role.
 * @param maxSnippetLines - Maximum number of lines to include per snippet.
 * @returns A standalone `## 代码生成产物` markdown section.
 * @throws {Error} If no snippet content is provided.
 *
 * @example
 * ```ts
 * const section = buildGeneratedCodeSection("friend", {
 *     routeTable: "export const FRIEND_ROUTES = [];",
 * });
 * console.log(section.includes("## 代码生成产物"));
 * ```
 */
export function buildGeneratedCodeSection(
    moduleName: string,
    snippets: GeneratedSnippetBundle,
    maxSnippetLines = 20,
): string {
    const entries = [
        ["Route Table", "route-table.ts", snippets.routeTable],
        ["DTO", "dto.ts", snippets.dto],
        ["Contract Assertions", "contract-assertions.ts", snippets.contractAssertions],
        ["Acceptance Spec", "acceptance.spec.ts", snippets.acceptanceSpec],
    ].filter((entry): entry is [string, string, string] => typeof entry[2] === "string" && entry[2].trim().length > 0);

    if (entries.length === 0) {
        throw new Error(`模块 ${moduleName} 没有可同步的生成代码片段`);
    }

    const body = [
        "## 代码生成产物",
        "",
        `> 以下片段由 codegen 产物同步得到，用于快速比对 \`${moduleName}\` 的契约实现与文档示例。`,
        "",
    ];

    for (const [label, fileName, snippet] of entries) {
        body.push(renderSnippetSection(label, fileName, trimSnippet(snippet, maxSnippetLines)));
    }

    return body.join("\n").trimEnd();
}

/**
 * Upsert a markdown section by second-level heading.
 *
 * @param markdown - Original markdown document.
 * @param sectionHeading - Full second-level heading, for example `## 代码生成产物`.
 * @param sectionBody - Replacement body, including the heading itself.
 * @returns Updated markdown with the section inserted or replaced.
 *
 * @example
 * ```ts
 * const updated = upsertMarkdownSection("# Title\n", "## 代码生成产物", "## 代码生成产物\n\ncontent");
 * console.log(updated.includes("content"));
 * ```
 */
export function upsertMarkdownSection(markdown: string, sectionHeading: string, sectionBody: string): string {
    const escapedHeading = sectionHeading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sectionPattern = new RegExp(`${escapedHeading}[\\s\\S]*?(?=\\n##\\s|$)`);

    if (sectionPattern.test(markdown)) {
        return markdown.replace(sectionPattern, sectionBody.trimEnd());
    }

    return `${markdown.trimEnd()}\n\n${sectionBody.trimEnd()}\n`;
}

/**
 * Synchronize generated code snippets back into a contract markdown page.
 *
 * @param markdown - Original contract markdown.
 * @param moduleName - Human-readable module name.
 * @param snippets - Generated TypeScript snippets keyed by artifact role.
 * @param maxSnippetLines - Maximum number of lines to include per snippet.
 * @returns Markdown with an updated `## 代码生成产物` section.
 *
 * @example
 * ```ts
 * const synced = syncContractDoc("# Friend\n", "friend", {
 *     routeTable: "export const FRIEND_ROUTES = [];",
 * });
 * console.log(synced.includes("FRIEND_ROUTES"));
 * ```
 */
export function syncContractDoc(
    markdown: string,
    moduleName: string,
    snippets: GeneratedSnippetBundle,
    maxSnippetLines = 20,
): string {
    const generatedSection = buildGeneratedCodeSection(moduleName, snippets, maxSnippetLines);
    return upsertMarkdownSection(markdown, "## 代码生成产物", generatedSection);
}

interface SyncDocsCliOptions {
    docsDir: string;
    maxSnippetLines: number;
    modules: string[];
    repoRoot: string;
}

/* v8 ignore start */
function writeStdout(value: string): void {
    process.stdout.write(`${value}\n`);
}

function writeStderr(value: string): void {
    process.stderr.write(`${value}\n`);
}

function parsePositiveInteger(value: string, optionName: string): number {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${optionName} 必须是正整数，收到: ${value}`);
    }
    return parsed;
}

function parseSyncDocsCliArgs(argv: readonly string[]): SyncDocsCliOptions {
    let repoRoot = process.cwd();
    let docsDir = path.resolve(repoRoot, "docs/api-contract");
    let maxSnippetLines = 20;
    let modules: string[] = [];

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        const value = argv[index + 1];

        if (argument === "--repo-root" && value) {
            repoRoot = path.resolve(value);
            docsDir = path.resolve(repoRoot, "docs/api-contract");
            index += 1;
            continue;
        }

        if (argument === "--docs-dir" && value) {
            docsDir = path.resolve(value);
            index += 1;
            continue;
        }

        if (argument === "--modules" && value) {
            modules = value
                .split(",")
                .map((entry) => entry.trim())
                .filter(Boolean);
            index += 1;
            continue;
        }

        if (argument === "--max-lines" && value) {
            maxSnippetLines = parsePositiveInteger(value, "--max-lines");
            index += 1;
        }
    }

    return {
        docsDir,
        maxSnippetLines,
        modules,
        repoRoot,
    };
}

function printSyncDocsUsage(): void {
    writeStderr(
        "Usage: node --experimental-strip-types src/codegen/syncDocs.ts [--repo-root <repo>] [--docs-dir <dir>] [--modules <a,b>] [--max-lines <n>]",
    );
}

function readSnippetBundle(generatedDir: string): GeneratedSnippetBundle {
    const readIfPresent = (fileName: string): string | undefined => {
        const filePath = path.join(generatedDir, fileName);
        return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : undefined;
    };

    return {
        acceptanceSpec: readIfPresent("acceptance.spec.ts"),
        contractAssertions: readIfPresent("contract-assertions.ts"),
        dto: readIfPresent("dto.ts"),
        routeTable: readIfPresent("route-table.ts"),
    };
}

function collectTargetModules(repoRoot: string, requestedModules: readonly string[]): string[] {
    if (requestedModules.length > 0) {
        return [...requestedModules];
    }

    const srcDir = path.join(repoRoot, "src");
    return fs
        .readdirSync(srcDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(srcDir, entry.name, "__generated__")))
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));
}

async function main(): Promise<void> {
    try {
        const options = parseSyncDocsCliArgs(process.argv.slice(2));
        const targetModules = collectTargetModules(options.repoRoot, options.modules);
        const updates: Array<{ changed: boolean; docPath: string; moduleName: string }> = [];

        for (const moduleName of targetModules) {
            const generatedDir = path.join(options.repoRoot, "src", moduleName, "__generated__");
            const docPath = path.join(options.docsDir, `${moduleName}.md`);

            if (!fs.existsSync(generatedDir) || !fs.existsSync(docPath)) {
                continue;
            }

            const snippets = readSnippetBundle(generatedDir);
            if (!snippets.routeTable && !snippets.dto && !snippets.contractAssertions && !snippets.acceptanceSpec) {
                continue;
            }

            const originalMarkdown = fs.readFileSync(docPath, "utf8");
            const syncedMarkdown = syncContractDoc(originalMarkdown, moduleName, snippets, options.maxSnippetLines);
            const changed = syncedMarkdown !== originalMarkdown;

            if (changed) {
                fs.writeFileSync(docPath, syncedMarkdown);
            }

            updates.push({
                changed,
                docPath,
                moduleName,
            });
        }

        writeStdout(
            JSON.stringify(
                {
                    docsDir: options.docsDir,
                    maxSnippetLines: options.maxSnippetLines,
                    updatedDocuments: updates,
                },
                null,
                2,
            ),
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : "unknown sync failure";
        printSyncDocsUsage();
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
