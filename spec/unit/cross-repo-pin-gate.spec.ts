/*
 * 跨仓 pin 门禁的负向测试（F-C1-02）。
 *
 * 这个门禁有四条绑定，其中 `ledger_schema` 是从**两个仓库各自的源码常量**里读出来比对的
 * （SDK 的 `LEDGER_SCHEMA_VERSION` + 后端的 `pub const SCHEMA_VERSION`），因此它的判定必须
 * 区分两种完全不同的失败：
 *
 *   - `drift`    —— 两个常量都读到了，但值真的不同（要人改代码或改 pin）；
 *   - `unknown`  —— 某个常量**读不到**（路径腐烂、声明被改名）。
 *
 * 2026-09-19 实测到的缺陷正是把后者报成了前者：后端 crate 拆分把文件从 `src/web/routes/`
 * 挪到 `synapse-web/src/routes/`，读取方仍用旧路径 → 取到空值 → 三个值其实都是 `4`，
 * 门禁却输出 `actual: 4 (SDK) / (unset) (backend)` 并判 `drift`。把"测不到"说成"不一致"，
 * 会让人去修一个不存在的不一致，同时掩盖真正的问题（读取路径本身坏了）。
 */

import { describe, expect, it } from "vitest";

import { CHECKS, evaluatePin } from "../../scripts/quality/check-cross-repo-pin.mjs";

const TODAY = new Date("2026-09-19T00:00:00Z");

const IN_SYNC_PIN = {
    sdk_commit: "aaa",
    synapse_rust_commit: "bbb",
    tarball_sha256: "sha256-ccc",
    ledger_schema: "4",
};

function evaluate(overrides: Partial<Parameters<typeof evaluatePin>[0]> = {}) {
    return evaluatePin({
        pin: IN_SYNC_PIN,
        sdkHead: "aaa",
        backendHead: "bbb",
        tarballSha: "sha256-ccc",
        sdkLedgerSchema: "4",
        backendSchemaVersion: "4",
        waivers: [],
        today: TODAY,
        ...overrides,
    });
}

function schemaResult(results: ReturnType<typeof evaluatePin>) {
    const result = results.find((candidate) => candidate.key === "ledger_schema");
    if (!result) throw new Error("ledger_schema binding disappeared from CHECKS");
    return result;
}

describe("跨仓 pin 门禁: ledger_schema 判定", () => {
    it("CHECKS 仍包含 ledger_schema 这条绑定", () => {
        expect(CHECKS.map((check) => check.key)).toContain("ledger_schema");
    });

    it("三处声明一致且都能读到 → ok", () => {
        expect(schemaResult(evaluate({}))).toMatchObject({ status: "ok", actual: "4" });
    });

    it("后端声明读不到 → unknown，绝不报成 drift（回归守卫 F-C1-02）", () => {
        const result = schemaResult(evaluate({ backendSchemaVersion: "" }));

        expect(result.status).toBe("unknown");
        expect(result.status).not.toBe("drift");
        expect(result.note).toContain("--strict");
        // 报错信息里要能看出是"读不到"，而不是"值不同"
        expect(result.actual).toContain("(unset) (backend)");
    });

    it("SDK 声明读不到 → unknown", () => {
        expect(schemaResult(evaluate({ sdkLedgerSchema: "" })).status).toBe("unknown");
    });

    it("pin 自身缺 ledger_schema → unknown（不是 drift）", () => {
        const result = schemaResult(evaluate({ pin: { ...IN_SYNC_PIN, ledger_schema: "" } }));

        expect(result.status).toBe("unknown");
        expect(result.status).not.toBe("drift");
    });

    it("三处都能读到但版本真的不同 → drift，并分别列出两侧的值", () => {
        const result = schemaResult(evaluate({ backendSchemaVersion: "5" }));

        expect(result.status).toBe("drift");
        expect(result.actual).toContain("4 (SDK)");
        expect(result.actual).toContain("5 (backend)");
    });
});

describe("跨仓 pin 门禁: commit / 哈希绑定", () => {
    it("三条都能读到且一致 → ok", () => {
        const statuses = evaluate({})
            .filter((check) => check.key !== "ledger_schema")
            .map((check) => check.status);

        expect(statuses).toEqual(["ok", "ok", "ok"]);
    });

    it("HEAD 与 pin 不同 → drift，并给出 expected/actual 供人比对", () => {
        const result = evaluate({ backendHead: "moved" }).find((check) => check.key === "synapse_rust_commit");

        expect(result).toMatchObject({ status: "drift", expected: "bbb", actual: "moved" });
    });

    it("有未过期 waiver → waived；过期 → expired-waiver", () => {
        const waiver = { check: "synapse_rust_commit", reason: "等后端合入", expires: "2026-12-31" };

        expect(
            evaluate({ backendHead: "moved", waivers: [waiver] }).find((c) => c.key === "synapse_rust_commit"),
        ).toMatchObject({ status: "waived" });

        const expired = { ...waiver, expires: "2026-01-01" };
        expect(
            evaluate({ backendHead: "moved", waivers: [expired] }).find((c) => c.key === "synapse_rust_commit"),
        ).toMatchObject({ status: "expired-waiver" });
    });
});
