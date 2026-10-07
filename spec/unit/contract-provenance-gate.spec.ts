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

import { describe, expect, it } from "vitest";

import { missingProvenanceFields } from "../../scripts/quality/check-contract-provenance.mjs";

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
