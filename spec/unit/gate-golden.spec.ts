/*
 * `scripts/audit/gate-golden.mjs` 的单元测试。
 *
 * 这个工具回答的是「这条红灯是本轮改红的，还是本来就红」以及「这次重构是否只改成本、不改判定」。
 * 它自己出错的方式很阴险：**归因错但看起来像正常输出**。比如把「两侧同红但本轮又新增失败」
 * 误判成「本来就红」，会直接让人放弃排查一条真回归。所以下面把 5 种归因分支、归一化口径、
 * 多重集差分、CLI 参数校验逐条钉死。
 *
 * 注意：这里只测**纯函数**。真正「base 世界能不能造出来、跑完能不能清干净」属端到端行为，
 * 由审计文档 §7.12 的变异自证（对真实门禁跑 attrib：CLEAN → 注入缺陷 → INTRODUCED → 还原 → CLEAN）覆盖。
 */

import { describe, expect, it } from "vitest";

import {
    ATTRIBUTION,
    classifyAttribution,
    multisetDiff,
    normalizeForDiff,
    parseArgs,
    sanitizeGoldenId,
    splitLines,
} from "../../scripts/audit/gate-golden.mjs";

describe("sanitizeGoldenId", () => {
    it("保留正常 id", () => {
        expect(sanitizeGoldenId("manager-codegen")).toBe("manager-codegen");
        expect(sanitizeGoldenId("quality:swallow-fallbacks")).toBe("quality_swallow-fallbacks");
    });

    it("抹掉路径分隔符，禁止写到仓库外", () => {
        const id = sanitizeGoldenId("../../etc/passwd");
        expect(id).not.toContain("/");
        expect(id).not.toContain("\\");
        expect(id).not.toContain("..");
        expect(id.length).toBeGreaterThan(0);
    });

    it("空串或纯空白回退成 unnamed", () => {
        expect(sanitizeGoldenId("")).toBe("unnamed");
        expect(sanitizeGoldenId("   ")).toBe("unnamed");
    });

    it("不以点/下划线开头（避免生成隐藏文件）", () => {
        expect(sanitizeGoldenId("...hidden")).not.toMatch(/^[._]/);
    });
});

describe("splitLines", () => {
    it("丢掉末尾换行产生的空串", () => {
        expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    });

    it("保留中间的空行", () => {
        expect(splitLines("a\n\nb")).toEqual(["a", "", "b"]);
    });

    it("归一化 CRLF", () => {
        expect(splitLines("a\r\nb")).toEqual(["a", "b"]);
    });

    it("空文本得到空数组", () => {
        expect(splitLines("")).toEqual([]);
    });
});

describe("multisetDiff", () => {
    it("保留重数：多出一条重复行也要看得见", () => {
        const { onlyInBase, onlyInWork, shared } = multisetDiff(["a", "a", "b"], ["a", "c"]);
        expect(onlyInBase).toEqual(["a", "b"]);
        expect(onlyInWork).toEqual(["c"]);
        expect(shared).toEqual(["a"]);
    });

    it("两边完全一致时无差异", () => {
        const { onlyInBase, onlyInWork } = multisetDiff(["x", "y"], ["y", "x"]);
        expect(onlyInBase).toEqual([]);
        expect(onlyInWork).toEqual([]);
    });

    it("空 base 时全部算新增", () => {
        expect(multisetDiff([], ["n1", "n2"]).onlyInWork).toEqual(["n1", "n2"]);
    });

    it("重复行多出来时按重数计", () => {
        expect(multisetDiff(["d"], ["d", "d", "d"]).onlyInWork).toEqual(["d", "d"]);
    });
});

describe("classifyAttribution", () => {
    const cases: Array<{
        name: string;
        input: { baseExit: number; workExit: number; onlyInBase: string[]; onlyInWork: string[] };
        kind: string;
        bad: boolean;
    }> = [
        {
            name: "两侧都绿 → CLEAN",
            input: { baseExit: 0, workExit: 0, onlyInBase: [], onlyInWork: [] },
            kind: ATTRIBUTION.CLEAN,
            bad: false,
        },
        {
            name: "base 绿、本轮红 → INTRODUCED",
            input: { baseExit: 0, workExit: 1, onlyInBase: [], onlyInWork: ["boom"] },
            kind: ATTRIBUTION.INTRODUCED,
            bad: true,
        },
        {
            name: "base 红、本轮绿 → FIXED",
            input: { baseExit: 1, workExit: 0, onlyInBase: ["boom"], onlyInWork: [] },
            kind: ATTRIBUTION.FIXED,
            bad: false,
        },
        {
            name: "两侧同红且失败集一致 → PRE_EXISTING（本来就红）",
            input: { baseExit: 1, workExit: 1, onlyInBase: [], onlyInWork: [] },
            kind: ATTRIBUTION.PRE_EXISTING,
            bad: false,
        },
        {
            name: "两侧同红但本轮又新增 → PRE_EXISTING_PLUS_NEW",
            input: { baseExit: 1, workExit: 1, onlyInBase: [], onlyInWork: ["new-failure"] },
            kind: ATTRIBUTION.PRE_EXISTING_PLUS_NEW,
            bad: true,
        },
    ];

    for (const testCase of cases) {
        it(testCase.name, () => {
            const verdict = classifyAttribution(testCase.input);
            expect(verdict.kind).toBe(testCase.kind);
            expect(verdict.bad).toBe(testCase.bad);
            expect(verdict.label.length).toBeGreaterThan(0);
            expect(verdict.emoji.length).toBeGreaterThan(0);
        });
    }

    it("只有 base 侧的差异不影响「本来就红」的判定", () => {
        // 本轮把一条失败**修好**了，但仍有一条旧失败 —— 依然是「本来就红」，不是新回归。
        const verdict = classifyAttribution({
            baseExit: 1,
            workExit: 1,
            onlyInBase: ["old-but-fixed"],
            onlyInWork: [],
        });
        expect(verdict.kind).toBe(ATTRIBUTION.PRE_EXISTING);
        expect(verdict.bad).toBe(false);
    });

    it("base 绿 + 本轮红即使打印不出差异也要判 INTRODUCED", () => {
        // 有些门禁失败时只改退出码、不打字。此时 onlyInWork 为空，但绝不能判成 CLEAN。
        const verdict = classifyAttribution({ baseExit: 0, workExit: 1, onlyInBase: [], onlyInWork: [] });
        expect(verdict.kind).toBe(ATTRIBUTION.INTRODUCED);
        expect(verdict.bad).toBe(true);
    });

    it("上面的用例覆盖了 ATTRIBUTION 里的每一个结论（不能有不可达的结论）", () => {
        const covered = new Set(cases.map((testCase) => testCase.kind));
        expect([...covered].sort()).toEqual([...Object.values(ATTRIBUTION)].sort());
    });
});

describe("normalizeForDiff", () => {
    it("把两个世界的仓库根统一成 <ROOT>", () => {
        const text = "at /tmp/gg-1/matrix-js-sdk/src/a.ts and /repo/matrix-js-sdk/src/b.ts";
        const out = normalizeForDiff(text, { roots: ["/tmp/gg-1/matrix-js-sdk", "/repo/matrix-js-sdk"] });
        expect(out).toBe("at <ROOT>/src/a.ts and <ROOT>/src/b.ts");
    });

    it("抹掉 ANSI 颜色", () => {
        expect(normalizeForDiff("\u001B[31mred\u001B[0m")).toBe("red");
    });

    it("折叠 ISO 时间戳", () => {
        expect(normalizeForDiff("at 2026-10-07T00:12:33.123Z done")).toBe("at <TS> done");
    });

    it("默认折叠行号：行号平移不算新失败", () => {
        const out = normalizeForDiff("src/a.ts:12:3: boom", { collapseLineNumbers: true });
        expect(out).toBe("src/a.ts:<L>: boom");
    });

    it("关闭行号折叠时保留原样（--exact-lines 的语义）", () => {
        const out = normalizeForDiff("src/a.ts:12:3: boom", { collapseLineNumbers: false });
        expect(out).toBe("src/a.ts:12:3: boom");
    });

    it("归一化 CRLF", () => {
        expect(normalizeForDiff("a\r\nb")).toBe("a\nb");
    });
});

describe("parseArgs", () => {
    it("attrib 支持位置参数简写 script 名", () => {
        const parsed = parseArgs(["attrib", "quality:swallow-fallbacks"]);
        expect(parsed.error).toBeNull();
        expect(parsed.command).toBe("attrib");
        expect(parsed.options.script).toBe("quality:swallow-fallbacks");
    });

    it("位置参数与 --script 同时给应报错", () => {
        const parsed = parseArgs(["attrib", "quality:a", "--script", "quality:b"]);
        expect(parsed.error).toContain("不能同时给");
    });

    it("capture 必需 <id>", () => {
        expect(parseArgs(["capture"]).error).toContain("需要 <id>");
        const ok = parseArgs(["capture", "my-id", "--node", "scripts/x.mjs"]);
        expect(ok.id).toBe("my-id");
        expect(ok.options.node).toBe("scripts/x.mjs");
    });

    it("未知选项与缺值都要报错", () => {
        expect(parseArgs(["attrib", "--bogus"]).error).toContain("未知选项");
        expect(parseArgs(["attrib", "--base"]).error).toContain("缺少取值");
    });

    it("数值选项非法要报错", () => {
        expect(parseArgs(["attrib", "--timeout", "abc"]).error).toContain("正数");
        expect(parseArgs(["attrib", "--timeout", "0"]).error).toContain("正数");
        expect(parseArgs(["attrib", "--max-diff", "-1"]).error).toContain("非负数");
    });

    it("多余位置参数要报错", () => {
        expect(parseArgs(["attrib", "a", "b"]).error).toContain("多余的位置参数");
    });

    it("默认 base 是 HEAD，默认不做 raw", () => {
        const parsed = parseArgs(["attrib", "--script", "quality:x"]);
        expect(parsed.options.base).toBe("HEAD");
        expect(parsed.options.raw).toBe(false);
        expect(parsed.options.exactLines).toBe(false);
    });

    it("-h / --help 走帮助分支", () => {
        expect(parseArgs(["--help"]).help).toBe(true);
        expect(parseArgs(["-h"]).help).toBe(true);
    });

    it("list 不接受位置参数；无子命令时 command 为 null", () => {
        expect(parseArgs(["list"]).command).toBe("list");
        expect(parseArgs(["list", "x"]).error).toContain("list 不接受位置参数");
        expect(parseArgs([]).command).toBeNull();
    });
});
