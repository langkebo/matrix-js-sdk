/*
 * `scripts/quality/check-contract-provenance.mjs` 的单元测试。
 *
 * 它要求：改动了 `docs/api-contract/generated/` 的 PR，body 里必须带一段
 * provenance（contract-prompt / ledger-commit / ledger-profile / change-type / module），
 * 用来回答"这份生成物是从哪个后端提交、按哪份 prompt 生成的"。
 *
 * 最值得钉的是**整行锚定**：五条正则都带 `^...$` + `m` flag。
 * 一旦被改成子串匹配（去掉 `^`），随便一句 "see contract-prompt: xxx" 的
 * 散文就能满足要求 —— 门禁会变成"看起来有校验，实际从不拦人"。
 * 同理，`contract-prompt` 的值只接受 `docs/api-contract/drafts/...` 或
 * `artifact://contract-drafts-...`，填个 "foo" 不该算数。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
    auditProvenance,
    expectationsFromChangedFiles,
    missingProvenanceFields,
    parseProvenanceBlock,
    readMirrorCommits,
} from "../../scripts/quality/check-contract-provenance.mjs";

const FULL_BLOCK = [
    "Some PR description.",
    "",
    "contract-prompt: artifact://contract-drafts-abc123",
    "ledger-commit:   synapse-rust@605bb06eb",
    "ledger-profile:  all",
    "change-type:     added,modified",
    "module:          dm,key_backup",
].join("\n");

function missingFor(body: string): string[] {
    return missingProvenanceFields(body);
}

describe("missingProvenanceFields（PR body 溯源块）", () => {
    it("五字段齐全 → 无缺失", () => {
        expect(missingFor(FULL_BLOCK)).toEqual([]);
    });

    it("contract-prompt 也接受 docs/api-contract/drafts/ 路径形式", () => {
        const body = FULL_BLOCK.replace(
            "contract-prompt: artifact://contract-drafts-abc123",
            "contract-prompt: docs/api-contract/drafts/my-prompt.md",
        );
        expect(missingFor(body)).toEqual([]);
    });

    it("缺哪个就报哪个（按固定顺序）", () => {
        const body = FULL_BLOCK.replace(/^ledger-commit:.*$/m, "").replace(/^module:.*$/m, "");
        expect(missingFor(body)).toEqual(["ledger-commit", "module"]);
    });

    it("整行锚定：写在散文里的 'see contract-prompt: ...' 不算数", () => {
        // 去掉 ^ 锚定就会变成子串匹配，这类"提到了字段名"的文本会被误判为合规
        const body = "see contract-prompt: artifact://contract-drafts-abc123 for details";
        expect(missingFor(body)).toContain("contract-prompt");
    });

    it("contract-prompt 的值必须落在白名单形态内（填 foo 不算）", () => {
        const body = FULL_BLOCK.replace("artifact://contract-drafts-abc123", "foo");
        expect(missingFor(body)).toEqual(["contract-prompt"]);
    });

    it("ledger-commit 必须以 synapse-rust@ 开头", () => {
        const body = FULL_BLOCK.replace("synapse-rust@605bb06eb", "matrix-org@605bb06eb");
        expect(missingFor(body)).toEqual(["ledger-commit"]);
    });

    it("空 body → 五个字段全缺", () => {
        expect(missingFor("")).toHaveLength(5);
    });

    it("body 为 null/undefined 时不抛异常（按空处理）", () => {
        expect(missingProvenanceFields(null)).toHaveLength(5);
        expect(missingProvenanceFields(undefined)).toHaveLength(5);
    });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 以下为「内容级判据」部分：声明必须与**实际生成物**相符。
 *
 * 原判据只看载体文本写没写齐字段 ⇒ 写对文案即可通过（纸面门禁）。
 * 现在把镜像文件自记录的 `synapse_rust_commit` / `state_profile` / 模块页清单
 * 当锚点：声明写错 commit、漏报 profile、漏报 module 都必须红。
 * ──────────────────────────────────────────────────────────────────────────── */

const MIRROR_COMMIT = "122aaf109a883a078861fce740e9ce1af416f1b0";

const CONSISTENT_BLOCK = [
    "contract-prompt: artifact://contract-drafts-abc123",
    `ledger-commit:   synapse-rust@${MIRROR_COMMIT}`,
    "ledger-profile:  all,default,worker",
    "change-type:     modified",
    "module:          media,voice",
].join("\n");

const CHANGED_FILES = [
    "docs/api-contract/generated/index.json",
    "docs/api-contract/generated/route-manifest.all.json",
    "docs/api-contract/generated/route-manifest.default.json",
    "docs/api-contract/generated/route-manifest.worker.json",
    "docs/api-contract/generated/modules/media.json",
    "docs/api-contract/generated/modules/voice.json",
    "src/media/__generated__/dto.ts",
];

const MIRROR_ENTRIES = [
    { file: "docs/api-contract/generated/index.json", commit: MIRROR_COMMIT, profile: null },
    { file: "docs/api-contract/generated/route-manifest.all.json", commit: MIRROR_COMMIT, profile: "all" },
    { file: "docs/api-contract/generated/route-manifest.default.json", commit: MIRROR_COMMIT, profile: "default" },
    { file: "docs/api-contract/generated/route-manifest.worker.json", commit: MIRROR_COMMIT, profile: "worker" },
];

function fieldsOf(mismatches: { field: string }[]): string[] {
    return mismatches.map((item) => item.field);
}

describe("parseProvenanceBlock（结构化解析）", () => {
    it("解析出各字段，并把 ledger-commit 的 synapse-rust@ 前缀剥掉", () => {
        expect(parseProvenanceBlock(CONSISTENT_BLOCK)).toMatchObject({
            ledgerCommit: MIRROR_COMMIT,
            profiles: ["all", "default", "worker"],
            changeTypes: ["modified"],
            modules: ["media", "voice"],
        });
    });

    it("缺失字段解析为 null / 空数组（不抛异常）", () => {
        expect(parseProvenanceBlock("nothing here")).toMatchObject({ ledgerCommit: null, modules: [] });
        expect(parseProvenanceBlock(null).profiles).toEqual([]);
    });
});

describe("expectationsFromChangedFiles（从改动推导内容载体）", () => {
    it("只认 manifest 与 modules/ 两类文件，其余忽略", () => {
        const result = expectationsFromChangedFiles(CHANGED_FILES);
        expect(result.profiles).toEqual(["all", "default", "worker"]);
        expect(result.modules).toEqual(["media", "voice"]);
        expect(result.manifestFiles).toHaveLength(3);
    });

    it("index.json / 源码改动不算 profile，也不算 module", () => {
        const result = expectationsFromChangedFiles([
            "docs/api-contract/generated/index.json",
            "src/media/__generated__/dto.ts",
        ]);
        expect(result.profiles).toEqual([]);
        expect(result.modules).toEqual([]);
    });
});

describe("readMirrorCommits（生成物自记录的后端 commit）", () => {
    it("读出 synapse_rust_commit 与 state_profile；缺字段/坏 JSON 记为 null 而不吞掉", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "provenance-mirror-"));
        fs.writeFileSync(path.join(dir, "ok.json"), JSON.stringify({ synapse_rust_commit: MIRROR_COMMIT }));
        fs.writeFileSync(path.join(dir, "missing-field.json"), JSON.stringify({ state_profile: "all" }));
        fs.writeFileSync(path.join(dir, "broken.json"), "{not json");
        fs.writeFileSync(path.join(dir, "absent.json"), "{}");

        const entries = readMirrorCommits(dir, ["ok.json", "missing-field.json", "broken.json", "不存在.json"]);
        expect(entries).toHaveLength(3); // 不存在的文件直接跳过
        expect(entries.find((entry) => entry.file === "ok.json")?.commit).toBe(MIRROR_COMMIT);
        expect(entries.find((entry) => entry.file === "missing-field.json")?.commit).toBeNull();
        expect(entries.find((entry) => entry.file === "broken.json")?.parseError).toBe(true);
    });
});

describe("auditProvenance（声明 ↔ 生成物 内容级比对）", () => {
    const audit = (carrierText: string) =>
        auditProvenance({ carrierText, changedFiles: CHANGED_FILES, mirrorCommits: MIRROR_ENTRIES });

    it("声明与生成物完全一致 → 无 mismatch", () => {
        expect(audit(CONSISTENT_BLOCK).mismatches).toEqual([]);
    });

    it("ledger-commit 与生成物自记录的 commit 不符 → 红（这就是给「纸面判据」补上的那条）", () => {
        const body = CONSISTENT_BLOCK.replace(MIRROR_COMMIT, "0000000000000000000000000000000000000000");
        const mismatches = audit(body).mismatches;
        expect(fieldsOf(mismatches)).toContain("ledger-commit");
        expect(mismatches[0].actual).toContain(MIRROR_COMMIT);
    });

    it("漏报被改的 profile → 红", () => {
        const body = CONSISTENT_BLOCK.replace("all,default,worker", "all");
        const mismatches = audit(body).mismatches;
        expect(fieldsOf(mismatches).filter((field) => field === "ledger-profile")).toHaveLength(2);
    });

    it("漏报被改的 module → 红", () => {
        const body = CONSISTENT_BLOCK.replace("module:          media,voice", "module:          media");
        const mismatches = audit(body).mismatches;
        expect(mismatches.map((item) => item.actual)).toContain("voice");
    });

    it("未知枚举（profile / change-type）→ 红", () => {
        const body = CONSISTENT_BLOCK.replace("all,default,worker", "all,default,worker,bogus").replace(
            "change-type:     modified",
            "change-type:     whatever",
        );
        const fields = fieldsOf(audit(body).mismatches);
        expect(fields).toContain("ledger-profile");
        expect(fields).toContain("change-type");
    });

    it("镜像文件缺 synapse_rust_commit → 红（测不到 ≠ 一致）", () => {
        const mismatches = auditProvenance({
            carrierText: CONSISTENT_BLOCK,
            changedFiles: CHANGED_FILES,
            mirrorCommits: [{ file: "docs/api-contract/generated/index.json", commit: null, profile: null }],
        }).mismatches;
        expect(fieldsOf(mismatches)).toContain("ledger-commit");
    });

    it("找不到任何镜像文件 → 红（内容级绑定不成立）", () => {
        const mismatches = auditProvenance({
            carrierText: CONSISTENT_BLOCK,
            changedFiles: CHANGED_FILES,
            mirrorCommits: [],
        }).mismatches;
        expect(mismatches[0].actual).toContain("未找到镜像文件");
    });
});
