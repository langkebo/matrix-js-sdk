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

import { diffHeadingSets, extractHeadings, listAuditDocs } from "../../scripts/quality/check-audit-doc-integrity.mjs";

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

describe("audit-doc-integrity：受管辖文档发现", () => {
    it("列出 artifacts/ 下的 markdown（仓库相对路径，已排序）", () => {
        const docs = listAuditDocs();
        expect(docs.length).toBeGreaterThan(0);
        expect(docs.every((d) => d.startsWith("artifacts/") && d.endsWith(".md"))).toBe(true);
        expect([...docs].sort()).toEqual(docs);
    });
});
