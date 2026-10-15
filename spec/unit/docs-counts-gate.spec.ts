/*
 * `scripts/quality/check-docs-counts.mjs` 的单元测试。
 *
 * 这个门禁守的是「文档里写的可计算数字」与「代码实时算出来的数字」之间的一致性。
 *
 * 真实事故背景（2026-10-08 实测）：同一个「manager 数量」在五处各不相同 ——
 *   `MANAGER_EXTENSION_MODULES` 98 / `DEFAULT_CORE_EXTENSIONS` 98 /
 *   `ManagerName` 联合 100 / `CLAUDE.md` 写 101 / `frontend-usage-matrix.md` 写 114。
 * 数字腐烂的方向往往危险：写小了会让人以为某能力不存在，写大了会让人以为某模块已覆盖。
 *
 * 值得钉的口径：
 *
 *   · **锚点失配也是失败**：只在「匹配到才校验」的守卫，可以靠改写句子静默绕过。
 *     让锚点本身成为契约 —— 改写句子就必须改规则表，而那是显式动作。
 *   · **同句多文件逐条登记**：`CLAUDE.md` 与 `AGENTS.md` 是姊妹文件，只守一个
 *     会让另一个继续腐烂。
 *   · **未知指标要报错而非跳过**：规则表写错指标名时静默跳过 = 该规则永远不生效。
 *   · **文件读不到要计入锚点失配**：文档改名/删除不应让门禁变绿。
 *   · **多类问题互不遮蔽**：某条规则数值不对，不影响其它规则继续被检查。
 */

import { describe, expect, it } from "vitest";

import {
    METRICS,
    evaluateDocsCounts,
    hasDocsCountsFailure,
    renderDocsCountsFailure,
} from "../../scripts/quality/check-docs-counts.mjs";

/** 用一组「文件内容」夹具构造 readFile。 */
function makeReadFile(files: Record<string, string>) {
    return (relPath: string): string => {
        if (!(relPath in files)) throw new Error(`ENOENT: ${relPath}`);
        return files[relPath];
    };
}

const RULE_MANAGERS = {
    file: "CLAUDE.md",
    anchor: "ManagerName 联合类型键数",
    metric: "managerNames",
    pattern: /authoritative key list: (\d+) keys/,
};

describe("check-docs-counts / evaluateDocsCounts", () => {
    it("数值一致时无失败", () => {
        const result = evaluateDocsCounts({
            rules: [RULE_MANAGERS],
            metricValues: { managerNames: 100 },
            readFile: makeReadFile({ "CLAUDE.md": "the union is the authoritative key list: 100 keys as of today" }),
        });
        expect(hasDocsCountsFailure(result)).toBe(false);
        expect(result.checked).toBe(1);
    });

    it("数值不一致 -> mismatches，并同时记录 claimed 与 actual", () => {
        const result = evaluateDocsCounts({
            rules: [RULE_MANAGERS],
            metricValues: { managerNames: 100 },
            readFile: makeReadFile({ "CLAUDE.md": "the union is the authoritative key list: 101 keys as of today" }),
        });
        expect(result.mismatches).toEqual([
            {
                file: "CLAUDE.md",
                anchor: "ManagerName 联合类型键数",
                metric: "managerNames",
                claimed: 101,
                actual: 100,
            },
        ]);
        expect(hasDocsCountsFailure(result)).toBe(true);
    });

    it("锚点句子被改写 -> anchorMisses（不能靠改写句子绕过门禁）", () => {
        const result = evaluateDocsCounts({
            rules: [RULE_MANAGERS],
            metricValues: { managerNames: 100 },
            readFile: makeReadFile({ "CLAUDE.md": "the union now has a hundred keys" }),
        });
        expect(result.mismatches).toEqual([]);
        expect(result.anchorMisses).toHaveLength(1);
        expect(result.anchorMisses[0].reason).toContain("anchor sentence not found");
        expect(hasDocsCountsFailure(result)).toBe(true);
    });

    it("文件读不到 -> 计入 anchorMisses，不让门禁变绿", () => {
        const result = evaluateDocsCounts({
            rules: [RULE_MANAGERS],
            metricValues: { managerNames: 100 },
            readFile: makeReadFile({}),
        });
        expect(result.anchorMisses).toHaveLength(1);
        expect(result.anchorMisses[0].reason).toContain("cannot read file");
        expect(hasDocsCountsFailure(result)).toBe(true);
    });

    it("指标名未知 -> anchorMisses 报 unknown metric，而不是静默跳过", () => {
        const result = evaluateDocsCounts({
            rules: [{ ...RULE_MANAGERS, metric: "typoMetric" }],
            metricValues: { managerNames: 100 },
            readFile: makeReadFile({ "CLAUDE.md": "the union is the authoritative key list: 100 keys" }),
        });
        expect(result.anchorMisses).toHaveLength(1);
        expect(result.anchorMisses[0].reason).toContain("unknown metric");
    });

    it("多文件同一句子逐条登记：只改一个文件也会被抓到", () => {
        const rules = [RULE_MANAGERS, { ...RULE_MANAGERS, file: "AGENTS.md" }];
        const result = evaluateDocsCounts({
            rules,
            metricValues: { managerNames: 100 },
            readFile: makeReadFile({
                "CLAUDE.md": "authoritative key list: 100 keys",
                "AGENTS.md": "authoritative key list: 101 keys", // 姊妹文件腐烂
            }),
        });
        expect(result.mismatches).toHaveLength(1);
        expect(result.mismatches[0].file).toBe("AGENTS.md");
    });

    it("多类问题互不遮蔽：数值不一致与锚点失配同时可见", () => {
        const result = evaluateDocsCounts({
            rules: [
                RULE_MANAGERS,
                { ...RULE_MANAGERS, file: "AGENTS.md" },
                {
                    file: "docs/api-contract/contract-artifacts.md",
                    anchor: "后端 ledger 全量路由数",
                    metric: "contractManifestEntries",
                    pattern: /entry_count`[^\n]*?\|\s*(\d+)\s*\|/,
                },
            ],
            metricValues: { managerNames: 100, contractManifestEntries: 1159 },
            readFile: makeReadFile({
                "CLAUDE.md": "authoritative key list: 999 keys",
                "AGENTS.md": "句子被改写了",
                "docs/api-contract/contract-artifacts.md": "| `x` 的 `entry_count` | y | 1159 |",
            }),
        });
        expect(result.mismatches).toHaveLength(1);
        expect(result.anchorMisses).toHaveLength(1);
        expect(result.checked).toBe(3);
        expect(hasDocsCountsFailure(result)).toBe(true);
    });

    it("pattern 抓取的是最后一个数字列（表格行末列）", () => {
        const result = evaluateDocsCounts({
            rules: [
                {
                    file: "d.md",
                    anchor: "路由数",
                    metric: "routes",
                    pattern: /字面量路由条目[^\n]*?\|\s*(\d+)\s*\|/,
                },
            ],
            metricValues: { routes: 853 },
            readFile: makeReadFile({
                "d.md": "| 4b | 上述 39 张表的条目总数 | SDK 侧可被 import 的字面量路由条目 | 853 |",
            }),
        });
        expect(hasDocsCountsFailure(result)).toBe(false);
    });
});

/**
 * `CONTRACT_INDEX.md` 的指标（2026-10-15 新增）。
 *
 * 该页此前**没有任何门禁覆盖** —— 本脚本原先只守 `contract-artifacts.md` 与 `CLAUDE.md`/`AGENTS.md`。
 * 后果是真实的：收编线跑了 9 个提交、改了 47 张表的口径，该页仍停在 10-12 的状态，
 * 且两行端点数本身就是错的（`auth` 写 146 实测 104、`rendezvous` 写 6 实测 10）。
 */
describe("check-docs-counts / CONTRACT_INDEX 指标", () => {
    const INDEX = "docs/api-contract/CONTRACT_INDEX.md";

    /** 形态与真实页面一致：模块表 + 两张**非模块**表（订正说明、批次表）。 */
    const FIXTURE = [
        "| 模块     | 文档                             | 端点数 | SDK 覆盖率 | 优先级  |",
        "| -------- | -------------------------------- | ------ | ---------- | ------- |",
        "| 认证     | [auth.md](auth.md)               | 104    | 100%       | ✅ 完善 |",
        "| 联邦     | [federation.md](federation.md)   | 55     | —          | 🖥️ 服务端面 |",
        "| 延迟事件 | [delayed-events.md](delayed-events.md) | 7 | 100%   | ✅ 完善 |",
        "",
        "> | 行        | 原值 |    实测 | 依据          |",
        "> | --------- | ---: | ------: | ------------- |",
        "> | `auth.md` |  146 | **104** | `assembly` 桶 |",
        "",
        "> | 批次 | 模块（条数）             | 性质         |",
        "> | ---- | ------------------------ | ------------ |",
        "> | 001  | `delayed_events`(7)      | 补登记即收编 |",
    ].join("\n");

    it("只累加模块表行：订正说明表与批次表不计入", () => {
        const readFile = makeReadFile({ [INDEX]: FIXTURE });
        expect(METRICS.contractIndexEntrySum(readFile)).toBe(104 + 55 + 7);
        expect(METRICS.contractIndexModuleRows(readFile)).toBe(3);
    });

    it("覆盖率列为「—」的行也计入（federation 是唯一无百分比的模块行）", () => {
        const readFile = makeReadFile({
            [INDEX]: "| 联邦 | [federation.md](federation.md) | 55 | — | 🖥️ 服务端面 |",
        });
        expect(METRICS.contractIndexEntrySum(readFile)).toBe(55);
        expect(METRICS.contractIndexModuleRows(readFile)).toBe(1);
    });

    it("无模块表时返回 0（不抛错，交由规则判为不一致）", () => {
        const readFile = makeReadFile({ [INDEX]: "# 只有正文，没有表格\n" });
        expect(METRICS.contractIndexEntrySum(readFile)).toBe(0);
        expect(METRICS.contractIndexModuleRows(readFile)).toBe(0);
    });

    it("真实事故形态：合计写 1070 而后端是 1032 -> 报不一致", () => {
        const result = evaluateDocsCounts({
            rules: [
                {
                    file: INDEX,
                    anchor: "索引表端点数合计 = 后端 ledger 全量（all profile）",
                    metric: "contractManifestEntries",
                    pattern: /索引表端点数合计\*\*:\s*\*\*(\d+)\*\*/,
                },
            ],
            metricValues: { contractManifestEntries: 1032 },
            readFile: makeReadFile({
                [INDEX]: "- **索引表端点数合计**: **1070**（页级 `entry_count` 之和）\n",
            }),
        });
        expect(result.mismatches).toEqual([
            {
                file: INDEX,
                anchor: "索引表端点数合计 = 后端 ledger 全量（all profile）",
                metric: "contractManifestEntries",
                claimed: 1070,
                actual: 1032,
            },
        ]);
        expect(hasDocsCountsFailure(result)).toBe(true);
    });

    it("合计行被改写 -> 锚点失配（不能靠删掉这句话绕过）", () => {
        const result = evaluateDocsCounts({
            rules: [
                {
                    file: INDEX,
                    anchor: "索引表端点数合计 = 表内各行端点数之和",
                    metric: "contractIndexEntrySum",
                    pattern: /索引表端点数合计\*\*:\s*\*\*(\d+)\*\*/,
                },
            ],
            metricValues: { contractIndexEntrySum: 1032 },
            readFile: makeReadFile({ [INDEX]: "- **索引合计**: 1032\n" }),
        });
        expect(result.anchorMisses).toHaveLength(1);
        expect(result.anchorMisses[0].reason).toContain("anchor sentence not found");
    });
});

describe("check-docs-counts / renderDocsCountsFailure", () => {
    it("同时渲染数值不一致与锚点失配，便于 CI 直接定位", () => {
        const result = evaluateDocsCounts({
            rules: [RULE_MANAGERS, { ...RULE_MANAGERS, file: "AGENTS.md" }],
            metricValues: { managerNames: 100 },
            readFile: makeReadFile({
                "CLAUDE.md": "authoritative key list: 101 keys",
                "AGENTS.md": "没有这句话",
            }),
        });
        const text = renderDocsCountsFailure(result);
        expect(text).toContain("数值不一致");
        expect(text).toContain("锚点失配");
        expect(text).toContain("CLAUDE.md");
        expect(text).toContain("AGENTS.md");
        expect(text).toContain("文档写 101，实际 100");
    });
});
