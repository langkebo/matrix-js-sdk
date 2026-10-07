/*
 * `scripts/quality/lib/stable-id.mjs` 的单元测试。
 *
 * 这个文件替**所有 baseline 机制**守「指纹到底由什么构成」——这是审计 §7 里
 * α 缺陷的根治方案。α 的原形是 `id = file:line:sha1(file|line|snippet)`：
 * 行号编进了身份，于是上方插入任意一行（哪怕只是 prettier 重排）都会让整批
 * baseline 条目 STALE，逼出一次无审查的全量重记，而重记会顺手吸收真正的新缺陷。
 *
 * 下面每一条都对应源码注释里写明的**一条约定或一个已踩过的坑**，不是顺手补的断言：
 *
 *   · **维度连接符必须是 NUL，不能是 `|`**：维度内容里出现 `|` 时，
 *     `["a|b", "c"]` 与 `["a", "b|c"]` 会拼出同一个串，两种完全不同的缺陷
 *     撞成同一个 id —— 一条被修掉，另一条就"已经修过了"。这是选 NUL 的**唯一**理由，
 *     也是本文件最不能丢的一条。
 *   · **行号绝不参与指纹**：体现为「片段的空白重排不改变指纹」（normalizeSnippet）。
 *     prettier 重排会改缩进换行但不改语义，若指纹随之漂移，α 就等于没修。
 *   · **完全相同的片段不折叠**：用 nextOrdinal 分序数。折叠会让「又复制粘贴了一份
 *     同样的缺陷」隐身 —— 第二份没有自己的 id，删掉第一份时它会被当成已修复。
 *   · **digest 定长 16**：baseline 是可读的文本文件，长度变了等于全量重写。
 */

import { describe, expect, it } from "vitest";

import { nextOrdinal, normalizeSnippet, stableId } from "../../scripts/quality/lib/stable-id.mjs";

describe("stableId", () => {
    it("形状是 `<filePath>#<digest>`，不掺行号/列号", () => {
        const id = stableId("src/foo.ts", ["catch { return null; }"]);
        expect(id.startsWith("src/foo.ts#")).toBe(true);
        // digest 部分是纯 hex，不含 ':' —— 老格式 `file:line:sha1` 的形状不应再现
        expect(id.slice("src/foo.ts#".length)).toMatch(/^[0-9a-f]+$/);
        expect(id).not.toContain(":");
    });

    it("digest 定长 16（改短/改长都会全量重写 baseline）", () => {
        expect(stableId("a.ts", ["x"]).split("#")[1]).toHaveLength(16);
    });

    it("同样的输入得到同样的 id", () => {
        expect(stableId("a.ts", ["x", "y"])).toBe(stableId("a.ts", ["x", "y"]));
    });

    it("⚠️ 维度内容里的 `|` 不会与分隔符混淆（NUL 分隔符的唯一理由）", () => {
        // 若分隔符是 `|`，["b|c"] 与 ["b", "c"] 会拼成同一个串 ⇒ 维度边界丢失：
        // 一个「2 个维度」的条目与一个「1 个维度」的条目撞成同一个 id，
        // 修掉其中一条，另一条就被当成"已修复"。
        // 注意不能拿 filePath 不同的两组来比 —— id 里本来就带 filePath，那样恒不等。
        expect(stableId("a.ts", ["b|c"])).not.toBe(stableId("a.ts", ["b", "c"]));
        expect(stableId("a.ts", ["b", "c"])).not.toBe(stableId("a.ts", ["b|c"]));
    });

    it("文件路径不同则 id 不同", () => {
        expect(stableId("src/a.ts", ["x"])).not.toBe(stableId("src/b.ts", ["x"]));
    });

    it("片段不同则 id 不同", () => {
        expect(stableId("src/a.ts", ["x"])).not.toBe(stableId("src/a.ts", ["y"]));
    });

    it("数字维度与字符串维度在同一位置等价（join 的固有行为，钉住以免误以为有区分）", () => {
        // `[filePath, ...parts].join(NUL)` 会把 1 与 "1" 拼成同一个串，所以二者同指纹。
        // 这不会造成实际歧义：维度**位置**固定，同一位置上的维度类型也固定，
        // 不存在「一会儿传数字、一会儿传字符串」的调用方。
        expect(stableId("a.ts", [1])).toBe(stableId("a.ts", ["1"]));
    });

    it("维度顺序不同则 id 不同（位置本身是维度的一部分）", () => {
        expect(stableId("a.ts", ["x", "y"])).not.toBe(stableId("a.ts", ["y", "x"]));
    });

    it("空维度数组也能出 id（不崩）", () => {
        expect(stableId("a.ts", [])).toMatch(/^a\.ts#[0-9a-f]{16}$/);
    });
});

describe("normalizeSnippet", () => {
    it("折叠所有空白并去首尾", () => {
        expect(normalizeSnippet("  catch  {\n    return null;\n  }  ")).toBe("catch { return null; }");
    });

    it("prettier 式的重排不改变归一化结果（这是 α 不复发的前提）", () => {
        const before = "catch (e) {\n    return null;\n}";
        const after = "catch (e) { return null; }"; // 同一行、少一层缩进
        expect(normalizeSnippet(before)).toBe(normalizeSnippet(after));
    });

    it("配合 stableId：重排前后指纹一致", () => {
        const a = stableId("src/a.ts", [normalizeSnippet("catch (e) {\n    return null;\n}")]);
        const b = stableId("src/a.ts", [normalizeSnippet("catch (e) { return null; }")]);
        expect(a).toBe(b);
    });

    it("制表符与连续空格同样被折叠", () => {
        expect(normalizeSnippet("a\t\t b")).toBe("a b");
    });

    it("语义不同的片段不会因归一化而被抹平", () => {
        expect(normalizeSnippet("return null;")).not.toBe(normalizeSnippet("return [];"));
    });
});

describe("nextOrdinal", () => {
    it("同一 key 依次分配 1、2、3（不折叠成一条）", () => {
        const counter = new Map<string, number>();
        expect(nextOrdinal(counter, "src/a.ts|snippet")).toBe(1);
        expect(nextOrdinal(counter, "src/a.ts|snippet")).toBe(2);
        expect(nextOrdinal(counter, "src/a.ts|snippet")).toBe(3);
    });

    it("复制粘贴的第二份缺陷有自己的序数，不会隐身", () => {
        const counter = new Map<string, number>();
        const first = nextOrdinal(counter, "k");
        const second = nextOrdinal(counter, "k");
        expect(stableId("src/a.ts", ["x", first])).not.toBe(stableId("src/a.ts", ["x", second]));
    });

    it("不同 key 各自从 1 开始", () => {
        const counter = new Map<string, number>();
        expect(nextOrdinal(counter, "a")).toBe(1);
        expect(nextOrdinal(counter, "b")).toBe(1);
        expect(nextOrdinal(counter, "a")).toBe(2);
        expect(nextOrdinal(counter, "b")).toBe(2);
    });

    it("累加器由调用方持有，可跨调用累积", () => {
        const counter = new Map<string, number>();
        nextOrdinal(counter, "a");
        nextOrdinal(counter, "a");
        // 换一个新的累加器则重新计数（每次扫描一个）
        expect(nextOrdinal(new Map(), "a")).toBe(1);
    });
});
