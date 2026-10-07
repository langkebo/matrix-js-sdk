/*
 * `scripts/quality/check-log-sensitive.mjs` 的单元测试。
 *
 * 这条门禁默认"只警告、不阻断"（仅 LOG_SENSITIVE_BLOCK=true 时失败）。**警告型门禁
 * 最大的失效方式不是漏报，而是噪音**：一旦它开始对 `logger.info("token refreshed")`
 * 这类无泄露的日志也报警，人就会整体忽略它 —— 那时它等于不存在。
 *
 * 所以这里把"报 / 不报"两侧都钉死：
 *   报：logger 调用 + 敏感词出现 + (模板串插值 | 字符串拼接)
 *   不报：没调 logger / 敏感词只是字面文本 / 拼的不是敏感值 / 该行带 @log-allow
 */

import { describe, expect, it } from "vitest";

import { scanLines } from "../../scripts/quality/check-log-sensitive.mjs";

describe("scanLines", () => {
    it("模板串把 token 插进日志 ⇒ 报", () => {
        const out = scanLines("src/a.ts", ["logger.info(`token=${accessToken}`);"]);
        expect(out).toHaveLength(1);
        expect(out[0].term).toBe("token");
        expect(out[0].line).toBe(1);
    });

    it("字符串拼接把 authorization 拼进日志 ⇒ 报", () => {
        const out = scanLines("src/a.ts", ['this.logger.error("authorization: " + auth);']);
        expect(out).toHaveLength(1);
        expect(out[0].term).toBe("authorization");
    });

    it("敏感词出现在文本里、但没有插值/拼接 ⇒ 不报（否则是噪音）", () => {
        expect(scanLines("src/a.ts", ['logger.info("token refreshed");'])).toHaveLength(0);
    });

    it("没有调 logger ⇒ 不报（即便是拼接 + 敏感词）", () => {
        expect(scanLines("src/a.ts", ["const msg = `password=${password}`;"])).toHaveLength(0);
    });

    it("拼的不是敏感值 ⇒ 不报", () => {
        expect(scanLines("src/a.ts", ["this.logger.debug(`user=${userId}`);"])).toHaveLength(0);
    });

    it("@log-allow 白名单行直接跳过", () => {
        expect(scanLines("src/a.ts", ["logger.warn(`secret=${secret}`); // @log-allow"])).toHaveLength(0);
    });

    it("四种 logger 级别都覆盖（debug/info/warn/error）", () => {
        const lines = [
            "logger.debug(`token=${t}`);",
            "logger.info(`password=${p}`);",
            "logger.warn(`secret=${s}`);",
            "logger.error(`bearer=${b}`);",
        ];
        const out = scanLines("src/a.ts", lines);
        expect(out.map((f) => f.line)).toEqual([1, 2, 3, 4]);
    });

    it("行号是 1-based，且不受前面无关行影响", () => {
        const out = scanLines("src/a.ts", ["const a = 1;", "", "this.logger.info(`token=${t}`);"]);
        expect(out[0].line).toBe(3);
        expect(out[0].rel).toBe("src/a.ts");
    });
});
