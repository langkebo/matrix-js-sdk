#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const projectRoot = process.cwd();
const eventPath = process.env.GITHUB_EVENT_PATH;
const fallbackBaseRef = process.env.GITHUB_BASE_SHA || "origin/develop";
const generatedPrefix = "docs/api-contract/generated/";

/** `route-manifest.<profile>.json` —— 每个 profile 的镜像正文。 */
const PROFILE_MANIFEST_RE = /^docs\/api-contract\/generated\/route-manifest\.(all|default|worker)\.json$/;
/** `modules/<module>.json` —— 按模块切分的镜像。 */
const MODULE_FILE_RE = /^docs\/api-contract\/generated\/modules\/([^/]+)\.json$/;
/** 镜像目录里**记录后端 commit 的文件**（manifest 三个 profile + index.json）。 */
const MIRROR_COMMIT_FILES = [
    "docs/api-contract/generated/index.json",
    "docs/api-contract/generated/route-manifest.all.json",
    "docs/api-contract/generated/route-manifest.default.json",
    "docs/api-contract/generated/route-manifest.worker.json",
];
const ZERO_SHA = /^0{40}$/;

function runGit(args) {
    return execFileSync("git", args, {
        cwd: projectRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}

function readEventPayload() {
    if (!eventPath || !fs.existsSync(eventPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(eventPath, "utf8"));
    } catch {
        return null;
    }
}

function getChangedFiles(baseRef, headRef = "HEAD") {
    const raw = runGit(["diff", "--name-only", `${baseRef}...${headRef}`]);
    return raw ? raw.split(/\r?\n/).filter(Boolean) : [];
}

function getChangedFilesInRange(before, after) {
    const raw = runGit(["diff", "--name-only", before, after]);
    return raw ? raw.split(/\r?\n/).filter(Boolean) : [];
}

function readPullRequestBody(payload) {
    return payload?.pull_request?.body ?? null;
}

function hasMatch(body, pattern) {
    return pattern.test(body);
}

/**
 * PR body / commit message 里必须带齐的 provenance 字段。
 *
 * 抽成纯函数的原因：这些正则都是**多行锚定**（`^...$` + `m` flag），
 * 手工改一处就很容易把"整块匹配"变成"子串匹配"，从而让随便一行注释也能
 * 满足要求 —— 那样门禁就形同虚设了。
 *
 * ⚠️ 本函数只判**字段存在与形态**；"声明是否与实际生成物相符"由
 * `auditProvenance()` 负责（见下）。两者必须都过才算合规。
 */
export function missingProvenanceFields(body) {
    const requiredPatterns = [
        {
            label: "contract-prompt",
            pattern: /^\s*contract-prompt:\s+(docs\/api-contract\/drafts\/\S+|artifact:\/\/contract-drafts-\S+)\s*$/m,
        },
        {
            label: "ledger-commit",
            pattern: /^\s*ledger-commit:\s+synapse-rust@\S+\s*$/m,
        },
        {
            label: "ledger-profile",
            pattern: /^\s*ledger-profile:\s+\S+\s*$/m,
        },
        {
            label: "change-type",
            pattern: /^\s*change-type:\s+\S.*$/m,
        },
        {
            label: "module",
            pattern: /^\s*module:\s+\S.*$/m,
        },
    ];

    return requiredPatterns.filter(({ pattern }) => !hasMatch(body ?? "", pattern)).map(({ label }) => label);
}

/** 从载体文本（PR body / commit message）里解析 provenance 块为结构化字段。 */
export function parseProvenanceBlock(carrierText) {
    const text = carrierText ?? "";
    const grab = (label) => {
        const match = text.match(new RegExp(`^\\s*${label}:\\s*(.*?)\\s*$`, "m"));
        return match ? match[1] : null;
    };
    const splitList = (value) =>
        (value ?? "")
            .split(/[,\s]+/)
            .map((item) => item.trim())
            .filter(Boolean);

    const ledgerCommitRaw = grab("ledger-commit");
    const ledgerCommit = ledgerCommitRaw?.replace(/^synapse-rust@/, "") ?? null;

    return {
        contractPrompt: grab("contract-prompt"),
        ledgerCommit,
        ledgerCommitRaw,
        profiles: splitList(grab("ledger-profile")),
        changeTypes: splitList(grab("change-type")),
        modules: splitList(grab("module")),
    };
}

/**
 * 从**改动清单**推导"这次实际动了哪些内容载体"。
 *
 * 这一步是内容级判据的地基：profile 与 module 都从被改文件路径直接推导，
 * 不依赖 PR 作者自述，也不依赖 sibling 检出。
 */
export function expectationsFromChangedFiles(changedFiles) {
    const profiles = new Set();
    const modules = new Set();
    const manifestFiles = [];

    for (const file of changedFiles) {
        const profileMatch = PROFILE_MANIFEST_RE.exec(file);
        if (profileMatch) {
            profiles.add(profileMatch[1]);
            manifestFiles.push(file);
            continue;
        }
        const moduleMatch = MODULE_FILE_RE.exec(file);
        if (moduleMatch) modules.add(moduleMatch[1]);
    }

    return {
        profiles: [...profiles].sort(),
        modules: [...modules].sort(),
        manifestFiles: manifestFiles.sort(),
    };
}

/**
 * 读取镜像文件里**自记录**的后端 commit（`synapse_rust_commit`）。
 *
 * 这就是"声明 vs 内容"的锚点：PR/commit 声称"从 synapse-rust@X 生成"，
 * 而生成物本身写着 X —— 两者必须相等。文件不在场或字段缺失时返回 null
 * （调用方按 mismatch 处理，不静默放过）。
 */
export function readMirrorCommits(rootDir, files = MIRROR_COMMIT_FILES) {
    const found = [];
    for (const rel of files) {
        const abs = path.resolve(rootDir, rel);
        if (!fs.existsSync(abs)) continue;
        let payload;
        try {
            payload = JSON.parse(fs.readFileSync(abs, "utf8"));
        } catch {
            found.push({ file: rel, commit: null, profile: null, parseError: true });
            continue;
        }
        found.push({
            file: rel,
            commit: payload.synapse_rust_commit ?? null,
            profile: payload.state_profile ?? null,
        });
    }
    return found;
}

/**
 * 内容级审计：把**声明**与**实际生成物**对齐。
 *
 * 判定项：
 *   1. 声明 ledger-commit == 被改镜像文件自记录的 synapse_rust_commit（全量一致）；
 *   2. 声明 ledger-profile ⊇ 被改 route-manifest.<p>.json 的 profile；
 *   3. 声明 module ⊇ 被改 modules/<m>.json 的模块；
 *   4. 声明的 profile 值必须落在 {all,default,worker}；change-type 落在固定枚举。
 *
 * 返回 `{ mismatches }`：每条含 field / declared / actual / why，失败信息可直接照抄修。
 */
export function auditProvenance({ carrierText, changedFiles, mirrorCommits }) {
    const declared = parseProvenanceBlock(carrierText);
    const expected = expectationsFromChangedFiles(changedFiles);
    const mismatches = [];

    // 1. commit 绑定：声明必须与生成物自记录的后端 commit 逐字相等。
    //    镜像文件存在但字段缺失/不可解析 ⇒ 也判 mismatch（不静默放过）。
    const recorded = mirrorCommits ?? [];
    const commitsWithValue = recorded.filter((entry) => typeof entry.commit === "string" && entry.commit.length > 0);
    const commitsWithoutValue = recorded.filter(
        (entry) => !(typeof entry.commit === "string" && entry.commit.length > 0),
    );

    if (recorded.length === 0) {
        mismatches.push({
            field: "ledger-commit",
            declared: declared.ledgerCommitRaw ?? "(缺失)",
            actual: "(未找到镜像文件)",
            why: "无法从 docs/api-contract/generated/ 读取后端 commit ⇒ 内容级绑定不成立",
        });
    }
    for (const entry of commitsWithoutValue) {
        mismatches.push({
            field: "ledger-commit",
            declared: declared.ledgerCommitRaw ?? "(缺失)",
            actual: `${entry.file} 缺少可解析的 synapse_rust_commit`,
            why: "镜像文件必须自带后端 commit 才能自证来源",
        });
    }
    if (declared.ledgerCommit) {
        for (const entry of commitsWithValue) {
            if (entry.commit !== declared.ledgerCommit) {
                mismatches.push({
                    field: "ledger-commit",
                    declared: declared.ledgerCommit,
                    actual: `${entry.commit} (${entry.file})`,
                    why: "声明与生成物自记录的 backend commit 不符",
                });
            }
        }
    } else if (commitsWithValue.length > 0) {
        mismatches.push({
            field: "ledger-commit",
            declared: declared.ledgerCommitRaw ?? "(缺失)",
            actual: commitsWithValue
                .map((entry) => entry.commit)
                .filter((value, index, all) => all.indexOf(value) === index)
                .join(", "),
            why: "生成物自带 synapse_rust_commit，声明必须与之逐字相等",
        });
    }

    // 2. profile 覆盖
    const allowedProfiles = new Set(["all", "default", "worker"]);
    for (const value of declared.profiles) {
        if (!allowedProfiles.has(value)) {
            mismatches.push({
                field: "ledger-profile",
                declared: value,
                actual: [...allowedProfiles].join(","),
                why: "未知 profile（只接受 all/default/worker）",
            });
        }
    }
    for (const profile of expected.profiles) {
        if (!declared.profiles.includes(profile)) {
            mismatches.push({
                field: "ledger-profile",
                declared: declared.profiles.join(",") || "(缺失)",
                actual: profile,
                why: "route-manifest.<profile>.json 被改，但未在该字段声明",
            });
        }
    }

    // 3. module 覆盖
    for (const moduleName of expected.modules) {
        if (!declared.modules.includes(moduleName)) {
            mismatches.push({
                field: "module",
                declared: declared.modules.join(",") || "(缺失)",
                actual: moduleName,
                why: "modules/<module>.json 被改，但未在该字段声明",
            });
        }
    }

    // 4. change-type 枚举
    const allowedChangeTypes = new Set(["added", "modified", "removed", "renamed"]);
    for (const value of declared.changeTypes) {
        if (!allowedChangeTypes.has(value)) {
            mismatches.push({
                field: "change-type",
                declared: value,
                actual: [...allowedChangeTypes].join(","),
                why: "未知 change-type",
            });
        }
    }

    return { declared, expected, mismatches };
}

/** 在 push 区间里挑出**真正触碰 generated/** 的最后一个提交（载体即它的 message）。 */
function resolvePushCarrier(before, after) {
    if (!before || !after || ZERO_SHA.test(before)) return null;
    let commits = [];
    try {
        const raw = runGit(["log", "--format=%H", `${before}..${after}`, "--", generatedPrefix]);
        commits = raw ? raw.split(/\r?\n/).filter(Boolean) : [];
    } catch {
        return null;
    }
    if (commits.length === 0) return null;
    const sha = commits[0]; // git log 默认新→旧，取第一个即最新
    let message = "";
    try {
        message = runGit(["log", "-1", "--format=%B", sha]);
    } catch {
        return null;
    }
    return { sha, message, source: "push-commit-message" };
}

function main() {
    const payload = readEventPayload();

    // 载体与改动范围：PR 事件用 PR body + base sha；push 事件用触碰到 generated/ 的提交 message。
    let carrierText = null;
    let carrierSource = null;
    let changedFiles = [];

    if (payload?.pull_request) {
        changedFiles = getChangedFiles(fallbackBaseRef);
        carrierText = readPullRequestBody(payload);
        carrierSource = "pull_request.body";
    } else if (payload?.before && payload?.after) {
        changedFiles = getChangedFilesInRange(payload.before, payload.after);
        const carrier = resolvePushCarrier(payload.before, payload.after);
        carrierText = carrier?.message ?? null;
        carrierSource = carrier ? `${carrier.source}:${carrier.sha.slice(0, 12)}` : null;
    } else {
        process.stdout.write(
            "contract-provenance: skipping, no PR/push event payload available (local run) — not a pass.\n",
        );
        return 0;
    }

    const relevantChanged = changedFiles.some((file) => file.startsWith(generatedPrefix));
    if (!relevantChanged) {
        process.stdout.write(
            "contract-provenance: skipping, docs/api-contract/generated/ did not change vs base ref.\n",
        );
        return 0;
    }

    if (carrierText === null) {
        process.stdout.write(
            "contract-provenance: skipping, no pull_request body and no generated/-touching commit in the pushed range — not a pass.\n",
        );
        return 0;
    }

    const missing = missingProvenanceFields(carrierText);
    if (missing.length > 0) {
        process.stderr.write(
            `contract-provenance: provenance block is missing required field(s): ${missing.join(", ")}.\n`,
        );
        process.stderr.write(
            "Expected a provenance block for ledger-driven generated/ changes, for example:\n" +
                "contract-prompt: artifact://contract-drafts-<sha>\n" +
                "ledger-commit:   synapse-rust@<40-hex>\n" +
                "ledger-profile:  all\n" +
                "change-type:     added,modified\n" +
                "module:          dm,key_backup\n",
        );
        return 1;
    }

    const mirrorCommits = readMirrorCommits(projectRoot);
    const { mismatches } = auditProvenance({ carrierText, changedFiles, mirrorCommits });
    if (mismatches.length > 0) {
        process.stderr.write(
            `contract-provenance: ${mismatches.length} declaration(s) do not match the generated content (${carrierSource}):\n`,
        );
        for (const item of mismatches) {
            process.stderr.write(`- ${item.field}: declared=${item.declared} actual=${item.actual} (${item.why})\n`);
        }
        return 1;
    }

    const generatedCount = changedFiles.filter((file) => file.startsWith(generatedPrefix)).length;
    process.stdout.write(
        `contract-provenance: ${carrierSource} carries provenance consistent with ${generatedCount} generated file(s).\n`,
    );
    return 0;
}

// 仅在被直接执行时跑 main（原为顶层无条件执行，import 会跑 git diff 并写 exitCode）
if (import.meta.url === `file://${process.argv[1]}`) {
    try {
        process.exitCode = main();
    } catch (error) {
        process.stderr.write(`contract-provenance: ${error.message}\n`);
        if (process.env.CONTRACT_PROVENANCE_TRACE) {
            process.stderr.write(`${error.stack}\n`);
        }
        process.exitCode = 1;
    }
}
