/*
 * `scripts/quality/check-coverage-critical-files.mjs` 的单元测试。
 *
 * 这条门禁管的是「零覆盖 + 高危源文件」：含 HTTP 调用却没有任何 spec 触及的
 * 源文件必须登记进台账，且台账不许腐烂。四条规则各有各的失效方式：
 *
 *   · **R1 新盲区**：新出现的 critical 文件未登记 → 必须拦下，否则盲区默默增长。
 *   · **R2 台账缺字段**：条目缺 owner/deadline/reason 就是"记了等于没记"
 *     —— 没人负责、没有期限，于是永远不还。
 *   · **R3 deadline 过期**：这是整套机制的牙齿。边界最容易错一天 ——
 *     把"到期当天"判成已过期，就会在到期日假红；判反了则债务可以永不归还。
 *   · **R4 台账失效**：文件已被 spec 覆盖却还留在台账里 → 台账退化成一份
 *     没人维护的名单，R1 的"新盲区"信号会被淹没在里面。
 *
 * 判定原本全写在 `main()` 里，本次抽成 `evaluateLedger({critical, entries, today})`
 * 后才有得测；`today` 显式入参是为了让 R3 的日期边界可钉死。
 */

import { describe, expect, it } from "vitest";

import { evaluateLedger } from "../../scripts/quality/check-coverage-critical-files.mjs";

/** 固定的"今天"：2026-06-01 本地零点（避免用例随真实日期漂移）。 */
const TODAY = new Date(2026, 5, 1);

function criticalFile(file: string, httpCalls = 3, lines = 120) {
    return { file, lines, httpCalls, evidence: "no direct spec, no spec imports this module" };
}

function entry(overrides: Record<string, unknown> = {}) {
    return { file: "src/a.ts", owner: "alice", deadline: "2026-12-31", reason: "待补测试", ...overrides };
}

describe("R1：新出现的 critical 文件必须登记", () => {
    it("未登记的 critical 文件报 R1（带行数与 HTTP 调用数）", () => {
        const { violations } = evaluateLedger({
            critical: [criticalFile("src/new.ts")],
            entries: [],
            today: TODAY,
        });
        expect(violations).toHaveLength(1);
        expect(violations[0].rule).toBe("R1");
        expect(violations[0].file).toBe("src/new.ts");
        expect(String(violations[0].detail)).toContain("120 lines / 3 HTTP calls");
    });

    it("已在台账登记过则不报 R1", () => {
        const { violations } = evaluateLedger({
            critical: [criticalFile("src/a.ts")],
            entries: [entry()],
            today: TODAY,
        });
        expect(violations.filter((v) => v.rule === "R1")).toEqual([]);
    });
});

describe("R2：台账条目必须字段完整且 deadline 可解析", () => {
    it("缺 owner / deadline / reason 任一即报 R2", () => {
        for (const missing of ["owner", "deadline", "reason"]) {
            const { violations } = evaluateLedger({
                critical: [],
                entries: [{ ...entry(), [missing]: undefined }],
                today: TODAY,
            });
            expect(
                violations.some((v) => v.rule === "R2"),
                `缺 ${missing} 应报 R2`,
            ).toBe(true);
        }
    });

    it("deadline 不是 YYYY-MM-DD 时报 R2（而不是被当成有效日期）", () => {
        const { violations } = evaluateLedger({
            critical: [],
            entries: [entry({ deadline: "31/12/2026" })],
            today: TODAY,
        });
        const r2 = violations.find((v) => v.rule === "R2");
        expect(r2).toBeDefined();
        expect(String(r2?.detail)).toContain("invalid deadline");
    });

    it("连 file 字段都没有时报 R2 且 file 占位为 <missing file field>", () => {
        const { violations } = evaluateLedger({
            critical: [],
            entries: [{ owner: "alice", deadline: "2026-12-31", reason: "x" }],
            today: TODAY,
        });
        expect(violations[0].rule).toBe("R2");
        expect(violations[0].file).toBe("<missing file field>");
    });
});

describe("R3：deadline 过期且仍未覆盖（日期边界最容易错一天）", () => {
    const critical = [criticalFile("src/a.ts")];

    it("昨天到期 → 报 R3", () => {
        const { violations, tracked } = evaluateLedger({
            critical,
            entries: [entry({ deadline: "2026-05-31" })],
            today: TODAY,
        });
        expect(violations.some((v) => v.rule === "R3")).toBe(true);
        expect(tracked).toHaveLength(0);
    });

    it("今天到期（daysLeft === 0）→ **不算过期**，仍算在期限内", () => {
        // 把"到期当天"判成已过期，会让每个到期日都假红一次。
        const { violations, tracked } = evaluateLedger({
            critical,
            entries: [entry({ deadline: "2026-06-01" })],
            today: TODAY,
        });
        expect(violations).toEqual([]);
        expect(tracked).toHaveLength(1);
        expect(tracked[0].daysLeft).toBe(0);
    });

    it("明天到期 → 在期限内，daysLeft 为 1", () => {
        const { tracked } = evaluateLedger({
            critical,
            entries: [entry({ deadline: "2026-06-02" })],
            today: TODAY,
        });
        expect(tracked[0].daysLeft).toBe(1);
    });
});

describe("R4：台账条目已失效必须清理", () => {
    it("文件已被 spec 覆盖（不再 critical）却仍在台账 → 报 R4", () => {
        const { violations } = evaluateLedger({
            critical: [],
            entries: [entry()],
            today: TODAY,
        });
        expect(violations).toHaveLength(1);
        expect(violations[0].rule).toBe("R4");
    });

    it("仍在 critical 列表里则不报 R4", () => {
        const { violations } = evaluateLedger({
            critical: [criticalFile("src/a.ts")],
            entries: [entry()],
            today: TODAY,
        });
        expect(violations.filter((v) => v.rule === "R4")).toEqual([]);
    });
});

describe("组合行为", () => {
    it("R2 缺字段的条目会 continue，不再触发后面的 R3/R4 判定", () => {
        // 同一条只报一次：缺字段已经说明"记了等于没记"，再叠一条过期没意义
        const { violations } = evaluateLedger({
            critical: [],
            entries: [{ file: "src/a.ts", deadline: "2020-01-01" }],
            today: TODAY,
        });
        expect(violations).toHaveLength(1);
        expect(violations[0].rule).toBe("R2");
    });

    it("完全空输入 → 无违规、无 tracked", () => {
        expect(evaluateLedger({ critical: [], entries: [], today: TODAY })).toEqual({
            violations: [],
            tracked: [],
        });
    });

    it("台账缺 entries 之外结构时也按空处理（不抛异常）", () => {
        const { violations, tracked } = evaluateLedger({ critical: [], entries: [], today: TODAY });
        expect(violations).toEqual([]);
        expect(tracked).toEqual([]);
    });
});
