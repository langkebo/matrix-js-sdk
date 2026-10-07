/*
 * `scripts/quality/check-no-default-key.mjs` 的单元测试。
 *
 * 这条门禁防的是一次真实事故（ISSUE-08）：`client.ts` 里曾有
 * `legacyPickleKey ?? "DEFAULT_KEY"` —— 一个**公开的常量密钥**，
 * 任何进程都能拿它解密本地 crypto store，端侧 E2EE 等于不存在。
 *
 * 它出错的代价是不对称的：
 *   · 假阴性（漏报）→ 密钥兜底悄悄回归，等于把漏洞放回去；
 *   · 假阳性（误报）→ 有人为了让它变绿而把「错误提示文本」删掉，信息质量下降。
 * 所以下面把「什么算用了、什么不算」逐条钉死。
 */

import { describe, expect, it } from "vitest";

import { findDefaultKeyViolations, isCommentLine } from "../../scripts/quality/check-no-default-key.mjs";

describe("isCommentLine", () => {
    it("认得 //、* 与 /* 开头的注释（含缩进）", () => {
        expect(isCommentLine("// 说明")).toBe(true);
        expect(isCommentLine("   // 缩进的说明")).toBe(true);
        expect(isCommentLine(" * JSDoc 续行")).toBe(true);
        expect(isCommentLine("/* 块注释起点")).toBe(true);
    });

    it("代码行不是注释", () => {
        expect(isCommentLine('const key = legacyPickleKey ?? "DEFAULT_KEY";')).toBe(false);
    });
});

describe("findDefaultKeyViolations", () => {
    it("命中历史事故那一行（回归守卫）", () => {
        const src = 'const key = legacyPickleKey ?? "DEFAULT_KEY";';
        const out = findDefaultKeyViolations(src, "src/client.ts");
        expect(out).toHaveLength(1);
        expect(out[0]).toContain("src/client.ts:1:");
        expect(out[0]).toContain("DEFAULT_KEY");
    });

    it("三种形态都算使用：?? / = / :", () => {
        const src = ['a ?? "DEFAULT_KEY"', 'b = "DEFAULT_KEY"', 'c: "DEFAULT_KEY"'].join("\n");
        expect(findDefaultKeyViolations(src, "x.ts")).toHaveLength(3);
    });

    it("注释里的 DEFAULT_KEY 不算违规", () => {
        const src = ['// 兜底曾写成 ?? "DEFAULT_KEY"，已删除', "/*", ' * 历史：= "DEFAULT_KEY"', " */"].join("\n");
        expect(findDefaultKeyViolations(src, "x.ts")).toHaveLength(0);
    });

    it("能定位到正确的行号（多行文件）", () => {
        const src = ["const a = 1;", "const b = 2;", 'const k = a ?? "DEFAULT_KEY";'].join("\n");
        const out = findDefaultKeyViolations(src, "src/x.ts");
        expect(out[0].startsWith("src/x.ts:3:")).toBe(true);
    });

    it("裸字符串（前面没有 ??/=/:）按当前口径【不报】—— 口径变了必须是有意的", () => {
        // 这是一处已知边界：判据只在"赋值/兜底/属性值"位置生效，
        // 目的是避免把错误提示文本里的 DEFAULT_KEY 也算进来。
        // 若将来收紧口径，本断言会红，提醒改的人同时更新这条说明。
        expect(findDefaultKeyViolations('throw new Error("DEFAULT_KEY missing");', "x.ts")).toHaveLength(0);
    });
});
