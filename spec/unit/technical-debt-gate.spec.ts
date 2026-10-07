/*
 * `scripts/quality/scan-technical-debt.mjs` 的单元测试。
 *
 * 这个门禁把 TODO/FIXME/HACK/XXX 收集成清单，并按"是否在基线里"判定是否阻断。
 * 判定链上值得钉的有三处：
 *
 *   · **指纹**：`sha1(路径|类型|片段)`。片段进了指纹，意味着注释文字一改就算
 *     **一条新债** —— 否则改一改措辞就能继续躲在旧基线下不被拦。
 *     反过来，路径必须归一成 `/`，不然同一条债在 Windows 上会算出另一个指纹。
 *   · **CSV 转义**：清单会落一份 .csv。含逗号的片段不转义就会把一行拆成两列，
 *     整份清单从那行起全部错位 —— 而且错得很安静（文件照样生成）。
 *   · **严重度/优先级映射**：FIXME 必须是最高的 P0/Critical。门禁在非 strict 下
 *     只拦 FIXME 与 HACK，映射错位就等于拦错了对象。
 */

import { describe, expect, it } from "vitest";

import {
    escapeCsvField,
    fingerprintFor,
    inferPriority,
    inferSeverity,
    normalizePath,
    parseMeta,
    scoreFromPriority,
} from "../../scripts/quality/scan-technical-debt.mjs";

describe("normalizePath（指纹必须跨 OS 稳定）", () => {
    it("反斜杠统一成正斜杠", () => {
        expect(normalizePath("src\\room\\RoomManager.ts")).toBe("src/room/RoomManager.ts");
    });

    it("已经是正斜杠的不变", () => {
        expect(normalizePath("src/room/RoomManager.ts")).toBe("src/room/RoomManager.ts");
    });
});

describe("escapeCsvField（不转义会让整份清单从那行起错位）", () => {
    it("普通文本不加引号", () => {
        expect(escapeCsvField("simple snippet")).toBe("simple snippet");
    });

    it("含逗号 → 整体加引号", () => {
        expect(escapeCsvField("fix this, then that")).toBe('"fix this, then that"');
    });

    it("含双引号 → 加引号且内部引号翻倍", () => {
        expect(escapeCsvField('use "strict" mode')).toBe('"use ""strict"" mode"');
    });

    it("含换行 → 加引号", () => {
        expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
    });

    it("null / undefined → 空串（不输出 'null'）", () => {
        expect(escapeCsvField(null)).toBe("");
        expect(escapeCsvField(undefined)).toBe("");
    });
});

describe("fingerprintFor（片段进指纹 ⇒ 改措辞就是一条新债）", () => {
    it("同输入同输出（稳定）", () => {
        expect(fingerprintFor("src/a.ts", "TODO", "fix me")).toBe(fingerprintFor("src/a.ts", "TODO", "fix me"));
    });

    it("片段变了 → 指纹变了（不能被旧基线继续豁免）", () => {
        expect(fingerprintFor("src/a.ts", "TODO", "fix me")).not.toBe(fingerprintFor("src/a.ts", "TODO", "fix me!"));
    });

    it("路径或类型变了 → 指纹变了", () => {
        expect(fingerprintFor("src/a.ts", "TODO", "x")).not.toBe(fingerprintFor("src/b.ts", "TODO", "x"));
        expect(fingerprintFor("src/a.ts", "TODO", "x")).not.toBe(fingerprintFor("src/a.ts", "FIXME", "x"));
    });

    it("输出是 sha1 十六进制（40 位）", () => {
        expect(fingerprintFor("a", "TODO", "b")).toMatch(/^[0-9a-f]{40}$/);
    });
});

describe("严重度与优先级映射（FIXME 必须最高）", () => {
    it("inferSeverity", () => {
        expect(inferSeverity("FIXME")).toBe("Critical");
        expect(inferSeverity("TODO")).toBe("Major");
        expect(inferSeverity("HACK")).toBe("Major");
        expect(inferSeverity("XXX")).toBe("Minor");
    });

    it("inferPriority：FIXME=P0 / TODO=P1 / HACK=P2 / 其它=P3", () => {
        expect(inferPriority("FIXME")).toBe("P0");
        expect(inferPriority("TODO")).toBe("P1");
        expect(inferPriority("HACK")).toBe("P2");
        expect(inferPriority("XXX")).toBe("P3");
    });

    it("scoreFromPriority 随优先级单调下降", () => {
        const scores = ["P0", "P1", "P2", "P3"].map(scoreFromPriority);
        expect(scores).toEqual([4.6, 3.8, 3.2, 2.6]);
        for (let i = 1; i < scores.length; i += 1) {
            expect(scores[i]).toBeLessThan(scores[i - 1]);
        }
    });

    it("未知优先级落在最低档（不抛异常）", () => {
        expect(scoreFromPriority("P9")).toBe(2.6);
    });
});

describe("parseMeta（从注释文本里提 owner / 日期 / jira / 状态）", () => {
    it("owner 支持 `owner: xxx` 与 `@xxx` 两种写法", () => {
        expect(parseMeta("TODO owner: alice").owner).toBe("alice");
        expect(parseMeta("TODO @bob please fix").owner).toBe("bob");
    });

    it("显式 owner 优先于 @提及", () => {
        expect(parseMeta("TODO owner: alice cc @bob").owner).toBe("alice");
    });

    it("提取 due/deadline/eta 日期与 jira key", () => {
        const meta = parseMeta("TODO due: 2026-12-31 ABC-123");
        expect(meta.dueDate).toBe("2026-12-31");
        expect(meta.jiraKey).toBe("ABC-123");
    });

    it("status 取得到就用，取不到默认 Open", () => {
        expect(parseMeta("TODO status-ish InProgress").status).toBe("InProgress");
        expect(parseMeta("TODO nothing here").status).toBe("Open");
    });

    it("空文本 → 全部为空串，status 为 Open", () => {
        expect(parseMeta("")).toEqual({ owner: "", createdAt: "", dueDate: "", jiraKey: "", status: "Open" });
    });
});
