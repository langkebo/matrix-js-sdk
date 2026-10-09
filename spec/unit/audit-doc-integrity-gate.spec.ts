/*
 * audit-doc-integrity-gate.spec.ts — 「审计文档章节完整性哨兵」的守卫 spec（2026-10-09）。
 *
 * ## 为什么钉的是「抽取」而不是「门禁结论」
 *
 * 这条门禁的两侧都是"文本匹配"：从 markdown 里抽章节标题、与台账比集合。
 * 它的失效方式**不是报错**，而是**静默判错**：
 *
 *   1. 不跳围栏代码块 ⇒ 示例里的 `# 注释` / `## 步骤` 被当章节 ⇒ 标题集合随示例改动漂移
 *      （本仓审计文档含大量 ```bash / ```rust 片段，这是最先会踩的坑）；
 *   2. 认了 `#` 一级标题 ⇒ 把文档标题也算成"承诺章节"，改标题就假红；
 *   3. 比对时不去重 / 顺序敏感 ⇒ 同一个标题写两遍就报"丢失"。
 *
 * 所以下面每个 `it` 都对应其中一条，并给出必须被识别（或必须**不**被识别）的样本。
 */

import { describe, expect, it } from "vitest";

import {
    diffHeadingSets,
    extractHeadings,
    listAuditDocs,
    normalizeHeading,
} from "../../scripts/quality/check-audit-doc-integrity.mjs";

describe("audit-doc-integrity：章节抽取", () => {
    it("认 ## / ### / ####，保留层级前缀", () => {
        const md = ["## 一级", "### 二级", "#### 三级"].join("\n\n");
        expect(extractHeadings(md)).toEqual(["## 一级", "### 二级", "#### 三级"]);
    });

    it("⚠️ 不把 `#` 与 `#####` 当章节（前者是文档标题，后者不在承诺面内）", () => {
        const md = ["# 文档标题", "##### 五级", "## 真章节"].join("\n\n");
        expect(extractHeadings(md)).toEqual(["## 真章节"]);
    });

    it("⚠️ 跳过围栏代码块：示例里的 `# 注释` / `## 步骤` 不算章节", () => {
        const md = [
            "## 真章节",
            "",
            "```bash",
            "# 这是 shell 注释，不是章节",
            "## 步骤（示例里的）",
            "```",
            "",
            "### 另一个真章节",
        ].join("\n");
        expect(extractHeadings(md)).toEqual(["## 真章节", "### 另一个真章节"]);
    });

    it("~~~ 围栏同样跳过（含围栏后的语言标注）", () => {
        const md = ["~~~rust", "// ### 示例标题", "~~~", "## 真章节"].join("\n");
        expect(extractHeadings(md)).toEqual(["## 真章节"]);
    });

    it("围栏未闭合时不吞掉后面的真章节（兜底：正则失效也不许凭空少标题）", () => {
        const md = ["```bash", "echo hi", "## 未闭合围栏后的章节"].join("\n");
        // 未闭合 ⇒ 该围栏块不被剥离；此时 `## …` 仍会被抽出来（宁可多认，不可少认）
        expect(extractHeadings(md)).toContain("## 未闭合围栏后的章节");
    });

    it("空输入 / 非字符串不抛异常", () => {
        expect(extractHeadings("")).toEqual([]);
        expect(extractHeadings(null as unknown as string)).toEqual([]);
    });
});

describe("audit-doc-integrity：集合比对（只增不减）", () => {
    it("丢失 ⇒ ok=false，并按台账顺序去重列出", () => {
        const r = diffHeadingSets({
            baseline: ["## a", "### b", "## c"],
            current: ["## a", "### b", "## d"],
        });
        expect(r.ok).toBe(false);
        expect(r.missing).toEqual(["## c"]);
        expect(r.added).toEqual(["## d"]);
    });

    it("新增不算违规（正常演进），但要报在 added 里", () => {
        const r = diffHeadingSets({ baseline: ["## a"], current: ["## a", "## b"] });
        expect(r).toEqual({ missing: [], added: ["## b"], ok: true });
    });

    it("重复标题不影响判定（去重）", () => {
        const r = diffHeadingSets({ baseline: ["## a"], current: ["## a", "## a", "## a"] });
        expect(r.ok).toBe(true);
        expect(r.missing).toEqual([]);
    });

    it("当前为空 ⇒ 全部视为丢失（回写成空文件/被截断的情形）", () => {
        const r = diffHeadingSets({ baseline: ["## a", "## b"], current: [] });
        expect(r.ok).toBe(false);
        expect(r.missing).toEqual(["## a", "## b"]);
    });
});

/*
 * 2026-10-09 实测：`artifacts/sdk-contract-gap-report.md` 由 `scripts/audit/compare-routes.mjs`
 * 重新生成后，**章节一条不少**，但标题尾巴里的生成计数与复核日期变了
 * （`— 客户端面 584 条` → `— 475 条`、`（本轮，2026-10-07）` → `2026-10-09`）
 * ⇒ 哨兵误报"章节丢失" 4 条。下面钉住"易变字段归一化"，同时钉住
 * **不许把段号也抹掉**（否则真删一节会被掩盖 —— 那才是本门禁要防的事）。
 */
describe("audit-doc-integrity：标题归一化（只抹易变字段）", () => {
    it("破折号之后的生成计数被抹平（破折号之前原样）", () => {
        expect(normalizeHeading("## 3. 仅构造证据（T2，无精确调用点）— 客户端面 584 条")).toBe(
            "## 3. 仅构造证据（T2，无精确调用点）— 客户端面 {N} 条",
        );
    });

    it("完整日期被抹平（复核日期每轮都会变）", () => {
        expect(normalizeHeading("## 7. 人工复核记录（本轮，2026-10-07）")).toBe("## 7. 人工复核记录（本轮，{DATE}）");
    });

    it("⚠️ 段号不抹：`### 7.6` 与 `### 7.7` 必须是两个不同的键", () => {
        expect(normalizeHeading("### 7.6 第三轮")).not.toBe(normalizeHeading("### 7.7 第四轮"));
    });

    it("破折号之前的数字不抹（`—` 前是正文，改动即真改动）", () => {
        expect(normalizeHeading("## 2. 客户端面缺口（三级证据全无）— 7 条")).not.toBe(
            normalizeHeading("## 9. 客户端面缺口（三级证据全无）— 7 条"),
        );
    });

    it("无破折号 / 无日期的标题原样返回", () => {
        expect(normalizeHeading("## 附录 B：核验边界")).toBe("## 附录 B：核验边界");
    });

    it("端到端：只有计数变了 ⇒ 不算丢失；段号变了 ⇒ 算丢失", () => {
        const baseline = [
            "## 3. 仅构造证据（T2，无精确计算点）— 客户端面 584 条",
            "## 7. 人工复核记录（本轮，2026-10-07）",
        ];
        // 计数与日期变化（脚本重新生成）—— 章节其实都在
        expect(
            diffHeadingSets({
                baseline,
                current: [
                    "## 3. 仅构造证据（T2，无精确计算点）— 客户端面 475 条",
                    "## 7. 人工复核记录（本轮，2026-10-09）",
                ],
            }).ok,
        ).toBe(true);
        // 标题正文真的变了（不是计数）—— 必须报丢失
        const r = diffHeadingSets({ baseline, current: ["## 3. 仅构造证据（T2，无精确计算点）— 客户端面 475 条"] });
        expect(r.ok).toBe(false);
        expect(r.missing).toEqual(["## 7. 人工复核记录（本轮，2026-10-07）"]);
    });
});

describe("audit-doc-integrity：受管辖文档发现", () => {
    it("列出 artifacts/ 下的 markdown（仓库相对路径，已排序）", () => {
        const docs = listAuditDocs();
        expect(docs.length).toBeGreaterThan(0);
        expect(docs.every((d) => d.startsWith("artifacts/") && d.endsWith(".md"))).toBe(true);
        expect([...docs].sort()).toEqual(docs);
    });
});
