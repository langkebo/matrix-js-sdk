/*
 * `quality:swallow-fallbacks` 门禁的负向测试。
 *
 * 这个门禁曾经反过来骗过我们：它的旧实现是一行正则
 *   /catch\s*\([^)]*\)\s*\{[\s\S]{0,240}?return\s*(null|\[\]|false|\{\})\s*;/g
 * 其中 `{0,240}` 的字符窗口**不禁止跨过 `}`**，于是一个 `throw e` 的正当 catch 会匹配到
 * 它之外（甚至另一个方法内部）的 `return null`，被判成「吞错」。实测 64 个命中里有 6 个
 * 是这种跨块错配，而且已经写进 baseline；还有 14 个真吞错因为超出 240 字符窗口而漏检。
 *
 * 下面按缺陷编号钉住三个「能让门禁说出错话」的位置：
 *   - α 指纹：行号不许参与身份（否则上方插一行就整批 STALE）；
 *   - β 边界：判定必须落在 catch 的语法块内；
 *   - γ 语法族：哪些 return 算兜底值、哪些不算。
 * 外加注释定位与 baseline 形态两项回归。
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
    collectFindingsFromSource,
    findCatchBlocks,
    maskNonCode,
} from "../../scripts/quality/check-swallow-fallbacks.mjs";

const BASELINE_PATH = path.resolve(process.cwd(), "scripts/quality/swallow-fallback-baseline.json");
const FILE = "src/subject.ts";

/** 在片段上方垫 N 行注释，用来制造「行号漂移但内容不变」。 */
function withLeadingLines(body: string, count: number): string {
    if (count === 0) return body;
    const filler = Array.from({ length: count }, (_, i) => `// filler ${i}`).join("\n");
    return `${filler}\n${body}`;
}

describe("swallow-fallbacks gate: 指纹稳定性（缺陷 α）", () => {
    const BODY = "try { await this.request(); } catch (e) { logger.warn(e); return null; }";

    it("上方插入代码行不改变指纹——行号不是身份的一部分", () => {
        const atTop = collectFindingsFromSource(withLeadingLines(BODY, 0), FILE);
        const shifted = collectFindingsFromSource(withLeadingLines(BODY, 20), FILE);

        expect(atTop).toHaveLength(1);
        expect(shifted).toHaveLength(1);
        // 行号确实变了……
        expect(shifted[0].line).toBe(atTop[0].line + 20);
        // ……但身份必须一模一样，否则 baseline 会被误判成 STALE。
        expect(shifted[0].id).toBe(atTop[0].id);
    });

    it("片段内容变了，指纹必须跟着变", () => {
        const a = collectFindingsFromSource("try { x(); } catch (e) { return null; }", FILE);
        const b = collectFindingsFromSource("try { x(); } catch (e) { return []; }", FILE);
        expect(a[0].id).not.toBe(b[0].id);
    });

    /**
     * 白名单注解是**关于**这条命中的元数据，不是它的身份。
     *
     * 把注解文本算进指纹会造成和「行号进指纹」同类的病：只把 `expires` 续期（`2026-12-31` →
     * `2027-06-30`）就会让指纹漂移 ⇒ 旧条目判 STALE、门禁在纯元数据变更上变红。收尾复核时实测
     * 确认了这个缺陷（当时 10 条 baseline 条目受影响），故在指纹输入里剔除注解。
     */
    it("只改 expires 续期，指纹保持不变（注解不是身份）", () => {
        const withTag = (expires: string): string =>
            `try { x(); } catch (e) {\n    // @swallow-error { owner: "t", expires: "${expires}" }\n    return null;\n}`;
        const a = collectFindingsFromSource(withTag("2026-12-31"), FILE);
        const b = collectFindingsFromSource(withTag("2027-06-30"), FILE);
        expect(a).toHaveLength(1);
        expect(a[0].id).toBe(b[0].id);
    });

    it("同一站点：带注解 / 不带注解 / 注解在 catch 前或块内，指纹都相同", () => {
        const bare = collectFindingsFromSource("try { x(); } catch (e) {\n    return null;\n}", FILE)[0];
        const inBlock = collectFindingsFromSource(
            `try { x(); } catch (e) {\n    // @swallow-error { owner: "t", expires: "2099-01-01" }\n    return null;\n}`,
            FILE,
        )[0];
        const beforeCatch = collectFindingsFromSource(
            `// @swallow-error { owner: "t", expires: "2099-01-01" }\ntry { x(); } catch (e) {\n    return null;\n}`,
            FILE,
        )[0];

        expect(inBlock.id).toBe(bare.id);
        expect(beforeCatch.id).toBe(bare.id);
        // 剔除的是「注解参与身份」，不是「不认注解」——元数据仍须解析出来。
        expect(inBlock.whitelist).toEqual({ owner: "t", expires: "2099-01-01" });
        expect(beforeCatch.whitelist).toEqual({ owner: "t", expires: "2099-01-01" });
        expect(bare.whitelist).toBeNull();
    });

    it("同文件内完全相同的两个片段靠 ordinal 区分，不折叠成一条", () => {
        const source = [
            "function a() { try { x(); } catch (e) { logger.warn(e); return null; } }",
            "function b() { try { y(); } catch (e) { logger.warn(e); return null; } }",
        ].join("\n");
        const findings = collectFindingsFromSource(source, FILE);

        expect(findings).toHaveLength(2);
        expect(new Set(findings.map((f) => f.id)).size).toBe(2);
        expect(findings.map((f) => f.ordinal).sort()).toEqual([1, 2]);
    });
});

describe("swallow-fallbacks gate: catch 块边界（缺陷 β）", () => {
    it("catch 内 throw 的正当处理，不会被块外的 return false 误判成吞错", () => {
        const source = [
            "function f() {",
            "    try { return await this.request(); }",
            "    catch (e) { if (throwOnError) { throw e; } logger.warn(e); }",
            "    return false;",
            "}",
        ].join("\n");
        expect(collectFindingsFromSource(source, FILE)).toHaveLength(0);
    });

    it("不会跨过方法边界去认领下一个方法里的 return null", () => {
        const source = [
            "class C {",
            "    async a() { try { x(); } catch (e) { throw e; } }",
            "    b() { if (!this.v) { return null; } }",
            "}",
        ].join("\n");
        expect(collectFindingsFromSource(source, FILE)).toHaveLength(0);
    });

    it("catch 块内确实有兜底 return 时仍然命中", () => {
        const found = collectFindingsFromSource("try { x(); } catch (e) { logger.warn(e); return null; }", FILE);
        expect(found).toHaveLength(1);
        expect(found[0].snippet).toContain("return null");
    });

    it("块首到 return 的距离超过旧实现的 240 字符上限时仍然命中（缺陷 δ）", () => {
        const longStatement = `logger.warn(${JSON.stringify("x".repeat(300))}, e);`;
        const source = `try { x(); } catch (e) { ${longStatement} return null; }`;
        expect(collectFindingsFromSource(source, FILE)).toHaveLength(1);
    });

    it("嵌套 catch 各自被扫描到，命中只算真正兜底的那一个", () => {
        const source = ["try { x(); } catch (e) {", "    try { y(); } catch (inner) { return null; }", "}"].join("\n");
        expect(findCatchBlocks(maskNonCode(source))).toHaveLength(2);
        expect(collectFindingsFromSource(source, FILE)).toHaveLength(1);
    });
});

describe("swallow-fallbacks gate: 兜底值语法族（缺陷 γ）", () => {
    const swallowStatements = [
        "return null;",
        "return undefined;",
        "return [];",
        "return false;",
        "return {};",
        'return "";',
        "return 0;",
    ];

    for (const statement of swallowStatements) {
        it(`把 ${statement} 识别为吞错`, () => {
            const found = collectFindingsFromSource(`try { x(); } catch (e) { ${statement} }`, FILE);
            expect(found).toHaveLength(1);
        });
    }

    const normalStatements = ["return this.cached;", "return compute();", "return true;", "return 1;"];

    for (const statement of normalStatements) {
        it(`不把 ${statement} 当作吞错`, () => {
            expect(collectFindingsFromSource(`try { x(); } catch (e) { ${statement} }`, FILE)).toHaveLength(0);
        });
    }

    it("裸 return; 不算兜底值——错误已交给回调时不误报", () => {
        const found = collectFindingsFromSource("try { x(); } catch (e) { this.onFailed(e); return; }", FILE);
        expect(found).toHaveLength(0);
    });
});

describe("swallow-fallbacks gate: @swallow-error 注解定位", () => {
    const TAG = '// @swallow-error { owner: "t", expires: "2099-01-01" }';
    const EXPECTED = { owner: "t", expires: "2099-01-01" };

    it("认 catch 前一行的注解（惯用写法）", () => {
        const found = collectFindingsFromSource(`${TAG}\ntry { x(); } catch (e) { return null; }`, FILE);
        expect(found[0].whitelist).toEqual(EXPECTED);
    });

    it("认 catch 同一行尾的注解", () => {
        // 注意：`//` 会吞掉同一行之后的所有内容，所以 return 必须另起一行。
        const source = `try { x(); } catch (e) { ${TAG}\n    return null;\n}`;
        const found = collectFindingsFromSource(source, FILE);
        expect(found).toHaveLength(1);
        expect(found[0].whitelist).toEqual(EXPECTED);
    });

    it("认写在块内、紧贴兜底 return 的注解", () => {
        const source = [
            "try { x(); } catch (e) {",
            "    if (e) {",
            `        ${TAG}`,
            "        return null;",
            "    }",
            "}",
        ].join("\n");
        const found = collectFindingsFromSource(source, FILE);
        expect(found).toHaveLength(1);
        expect(found[0].whitelist).toEqual(EXPECTED);
    });

    it("没有注解时是 null，而不是伪造一个", () => {
        const found = collectFindingsFromSource("try { x(); } catch (e) { return null; }", FILE);
        expect(found[0].whitelist).toBeNull();
    });
});

describe("swallow-fallbacks gate: 注释与字符串不干扰判定", () => {
    it("注释里的花括号不会破坏 catch 块边界", () => {
        const source = "try { x(); } catch (e) { /* } return null; */ logger.warn(e); }";
        expect(collectFindingsFromSource(source, FILE)).toHaveLength(0);
    });

    it("字符串里的 return null 不算兜底", () => {
        const source = 'try { x(); } catch (e) { logger.warn("return null;"); }';
        expect(collectFindingsFromSource(source, FILE)).toHaveLength(0);
    });

    it("maskNonCode 保持总长度与行数（行号解析依赖这个不变量）", () => {
        const source = 'const a = "x"; // tail\nconst b = 1;';
        expect(maskNonCode(source)).toHaveLength(source.length);
        expect(maskNonCode(source).split("\n")).toHaveLength(source.split("\n").length);
    });
});

describe("swallow-fallbacks gate: 提交的 baseline 形态", () => {
    const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) as {
        findings: Array<{
            id: string;
            file: string;
            line: number;
            ordinal: number;
            snippet: string;
            whitelist: unknown;
        }>;
    };

    it("非空，且每条 id 都是 `file#digest` 形态（不含行号）", () => {
        expect(baseline.findings.length).toBeGreaterThan(0);
        for (const item of baseline.findings) {
            const parts = item.id.split("#");
            expect(parts).toHaveLength(2);
            expect(parts[0]).toBe(item.file);
            expect(parts[1]).toMatch(/^[0-9a-f]{16}$/);
        }
    });

    it("每条都带 owner/expires 注解，且 expires 是可解析的日期", () => {
        for (const item of baseline.findings) {
            const whitelist = item.whitelist as { owner?: string; expires?: string } | null;
            expect(whitelist?.owner).toBeTruthy();
            expect(whitelist?.expires).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
    });

    it("行号字段仍然保留（作为展示信息，不参与指纹）", () => {
        for (const item of baseline.findings) {
            expect(Number.isInteger(item.line)).toBe(true);
            expect(item.line).toBeGreaterThan(0);
            expect(Number.isInteger(item.ordinal)).toBe(true);
        }
    });
});
