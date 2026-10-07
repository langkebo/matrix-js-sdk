#!/usr/bin/env node
/**
 * check-docs-examples.mjs —— 文档示例「可编译性」门禁
 *
 * 为什么需要它
 * ------------
 * Quickstart 文档里的代码块最容易腐烂：方法改名、参数改类型、入口改路径，
 * 文档不会跟着报错。本门禁把文档里标注了 `title="..."` 的 TypeScript 代码块
 * 抽取成真实 .ts 文件并对本仓库源码跑一次 tsc，从而把「文档漂移」从
 * 「用户上线后踩坑」变成「CI 红」。
 *
 * 约定
 * ----
 * 只有带 title 的代码块会被抽取，例如：
 *
 *   ```typescript title="01a-messaging-hula.ts"
 *   ...
 *   ```
 *
 * 不带 title 的代码块被视为「片段」，不参与编译（片段缺少上下文，编译必然失败）。
 * 这条约定让「可执行」与「说明性」代码在源码层面就有区分，而不是靠人工判断。
 *
 * 用法
 * ----
 *   node scripts/quality/check-docs-examples.mjs            # 抽取 + 编译 + 报告
 *   node scripts/quality/check-docs-examples.mjs --json     # 输出 JSON
 *   node scripts/quality/check-docs-examples.mjs --keep     # 保留抽取产物便于排查
 *   node scripts/quality/check-docs-examples.mjs docs/guide # 指定扫描目录
 *
 * 退出码：0 通过；1 有编译错误或抽取数量低于下限（防「死门禁」）。
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = process.cwd();
const SCOPE_DIR = "docs/guide";
const GENERATED_DIR = path.join(PROJECT_ROOT, ".docs-examples");
const TSCONFIG_PATH = path.join(GENERATED_DIR, "tsconfig.json");

/**
 * 抽取数量下限（防「死门禁」）。
 *
 * 若有人改了围栏写法（例如去掉 title、换成 ```tsx），抽取数量会静默下降，
 * 于是这个门禁会通过却少检查了示例 —— 这正是"纸面门禁"的典型形态。
 * 因此这里设下限：抽取数量低于它直接失败。
 *
 * 注意：此值必须等于「当前实际抽取数量」，不能留出余量。
 * 曾经设为 5 而实际有 6 个示例，结果去掉一个 title 仍然通过 —— 被变异自证抓出来。
 *
 * 维护约定：新增示例后把此数字同步调高；有意删除示例时同步调低。
 */
export const MIN_EXTRACTED_BLOCKS = 6;

/** 需要映射到源码目录的子路径入口。新增文档示例用到的新入口时需在此登记。 */
export const SUBPATH_ENTRIES = {
    // 根入口：src/index.ts 汇聚了 MatrixClient / 事件枚举 / 类型
    "@langkebo/matrix-js-sdk": ["src/index.ts"],
    // crypto 子入口：decodeRecoveryKey / VerificationRequestEvent 等只在这里
    "@langkebo/matrix-js-sdk/crypto": ["src/crypto-api/index.ts"],
};

export function listMarkdownFiles(dir, root = PROJECT_ROOT) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) {
        console.error(`[docs-examples] 目录不存在: ${dir}`);
        process.exit(1);
    }
    const out = [];
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(".md")) {
            out.push(path.join(dir, entry.name));
        }
    }
    return out.sort();
}

/**
 * 抽取所有 ```typescript title="..." 围栏。
 *
 * 纯函数：不读文件、不写文件、不 exit —— 未闭合围栏作为 `unclosed` 返回，
 * 由调用方决定怎么报错。这样「围栏写法被改坏」这件事可以在 spec 里直接构造，
 * 不必真的往 docs/guide 里塞一个坏文件。
 */
export function parseBlocks(lines, markdownPath) {
    const blocks = [];
    let open = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const fence = line.match(/^```(?:typescript|ts)\s+title="([^"]+)"\s*$/);

        if (open === null && fence) {
            open = { title: fence[1], startLine: i + 1, body: [] };
            continue;
        }
        if (open !== null && /^```\s*$/.test(line)) {
            blocks.push({ ...open, body: open.body.join("\n"), markdownPath, fenceLine: open.startLine });
            open = null;
            continue;
        }
        if (open !== null) {
            open.body.push(line);
        }
    }

    return {
        blocks,
        unclosed: open === null ? null : { markdownPath, startLine: open.startLine },
    };
}

/** 读文件后抽取；未闭合围栏保留原先的「报错 + 置 exitCode」语义。 */
export function extractBlocks(markdownPath, root = PROJECT_ROOT) {
    const abs = path.join(root, markdownPath);
    const { blocks, unclosed } = parseBlocks(fs.readFileSync(abs, "utf8").split("\n"), markdownPath);

    if (unclosed) {
        console.error(`[docs-examples] ${unclosed.markdownPath}:${unclosed.startLine} 代码围栏未闭合`);
        process.exitCode = 1;
    }
    return blocks;
}

/**
 * 规划落盘目标。
 *
 * 两件必须守住的事：
 *   · title 只取 basename —— 否则 `title="../../etc/passwd"` 会写到仓外；
 *   · 非 .ts 结尾与重复 title 都是**错误**，收集起来由调用方统一报错，
 *     而不是遇到第一个就 return（那样后面的问题永远看不见）。
 */
export function planGenerated(blocks) {
    const planned = [];
    const errors = [];

    for (const block of blocks) {
        const fileName = path.basename(block.title);
        if (!fileName.endsWith(".ts")) {
            errors.push(`[docs-examples] ${block.markdownPath}:${block.fenceLine} title 必须以 .ts 结尾`);
            continue;
        }
        const duplicate = planned.find((w) => w.fileName === fileName);
        if (duplicate) {
            errors.push(
                `[docs-examples] 重复的 title="${block.title}"` +
                    `（${duplicate.markdownPath} 与 ${block.markdownPath}）`,
            );
            continue;
        }
        planned.push({ fileName, ...block });
    }

    return { planned, errors };
}

function writeGenerated(blocks) {
    fs.rmSync(GENERATED_DIR, { recursive: true, force: true });
    fs.mkdirSync(GENERATED_DIR, { recursive: true });

    const { planned, errors } = planGenerated(blocks);
    for (const message of errors) {
        console.error(message);
        process.exitCode = 1;
    }

    for (const block of planned) {
        fs.writeFileSync(path.join(GENERATED_DIR, block.fileName), `${block.body}\n`);
    }

    fs.writeFileSync(TSCONFIG_PATH, `${JSON.stringify(buildTsconfig(), null, 4)}\n`);
    return planned;
}

export function buildTsconfig() {
    return {
        compilerOptions: {
            target: "esnext",
            module: "esnext",
            moduleResolution: "bundler",
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            esModuleInterop: true,
            noImplicitAny: true,
            allowImportingTsExtensions: true,
            lib: ["esnext", "dom", "dom.iterable"],
            types: ["node"],
            // 示例从仓库根解析子路径入口
            baseUrl: "..",
            // 注意：paths 的每个 value 必须是数组，写成字符串会报 TS5063
            paths: structuredClone(SUBPATH_ENTRIES),
            // 增量缓存独立存放，避免与主 tsconfig 的 tsBuildInfo 互相污染
            incremental: true,
            tsBuildInfoFile: "./.tsbuildinfo",
        },
        include: ["./*.ts"],
    };
}

function runTsc() {
    try {
        const out = execFileSync(
            process.execPath,
            [path.join(PROJECT_ROOT, "node_modules/typescript/bin/tsc"), "-p", TSCONFIG_PATH, "--noEmit"],
            { cwd: PROJECT_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
        return { ok: true, output: out ?? "" };
    } catch (err) {
        return { ok: false, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
    }
}

function main() {
    const args = process.argv.slice(2);
    const jsonMode = args.includes("--json");
    const keep = args.includes("--keep");
    const dirArg = args.find((a) => !a.startsWith("--"));

    const scope = dirArg ?? SCOPE_DIR;
    const markdownFiles = listMarkdownFiles(scope);
    const blocks = markdownFiles.flatMap((file) => extractBlocks(file));
    const written = writeGenerated(blocks);

    if (process.exitCode === 1) {
        console.error("[docs-examples] 抽取阶段失败，未执行编译");
        process.exit(1);
    }

    // 防死门禁：抽取数量必须达到下限
    if (written.length < MIN_EXTRACTED_BLOCKS) {
        console.error(
            `[docs-examples] 只抽到 ${written.length} 个可编译示例，低于下限 ${MIN_EXTRACTED_BLOCKS}。` +
                `\n  这通常意味着围栏写法被改坏了（例如去掉了 title="..."），` +
                `\n  或者示例被删除了。若是有意减少示例，请同步调低 MIN_EXTRACTED_BLOCKS。`,
        );
        process.exit(1);
    }

    const tsc = runTsc();

    if (jsonMode) {
        console.log(
            JSON.stringify(
                {
                    scope,
                    markdownFiles,
                    extracted: written.map((w) => ({
                        title: w.title,
                        markdown: w.markdownPath,
                        fenceLine: w.fenceLine,
                        generated: path.relative(PROJECT_ROOT, path.join(GENERATED_DIR, w.fileName)),
                    })),
                    ok: tsc.ok,
                    output: tsc.output,
                },
                null,
                4,
            ),
        );
    } else {
        console.log(`[docs-examples] 扫描 ${markdownFiles.length} 个 markdown，抽取 ${written.length} 个可编译示例`);
        for (const w of written) {
            console.log(`  · ${w.markdownPath}:${w.fenceLine}  ->  ${w.title}`);
        }
        if (tsc.ok) {
            console.log(`[docs-examples] ✅ 全部示例通过 tsc 类型检查（对本仓库 src 真实类型）`);
        } else {
            console.error("[docs-examples] ❌ 示例编译失败。错误行号对应 .docs-examples/<file>，");
            console.error("   上方映射表可定位回 markdown 行号：");
            console.error(tsc.output.trim());
        }
    }

    if (!keep && tsc.ok) {
        fs.rmSync(GENERATED_DIR, { recursive: true, force: true });
    } else if (keep) {
        console.log(`[docs-examples] 产物保留在 ${path.relative(PROJECT_ROOT, GENERATED_DIR)}/`);
    }

    process.exit(tsc.ok ? 0 : 1);
}

// 顶层裸跑 main() 会让 `import` 这个模块的 spec 直接扫全仓并 process.exit(1)，
// 所以只在被当作脚本直接执行时才跑。
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
