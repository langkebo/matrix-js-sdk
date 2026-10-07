/*
 * `scripts/quality/check-gate-reachability.mjs` 的单元测试。
 *
 * 这个门禁回答的是「**这个脚本到底会不会被执行**」。它自己有两条很阴险的失效路径，
 * 都会让"没人跑"看起来像"有人跑"（假绿），比漏报更危险：
 *
 *   1. **枚举盲区**：旧实现只收「正文含 process.exitCode = 1」的脚本 ⇒
 *      `scripts/quality/` 下**不含 exit-1** 的诊断脚本对它完全隐形，坏了半年没人知道
 *      （审计 §7.11-2）。修法：枚举由**目录**决定，判据只用来分类。
 *   2. **注释自指假绿**：可达性 = "谁调用了它"。若把注释也算进来，在任一可达脚本的
 *      注释里写一句 `scripts/quality/xxx.mjs` 就能把 xxx 伪造成"可达" —— 本门禁的
 *      文档注释实测干过这件事（把台账里的真孤岛"救活"）。修法：`stripComments()` 之后再抽引用。
 *
 * 下面把 stripComments / extractReferences / globToRegExp 三个纯函数逐条钉死；
 * 「新旧枚举口径下孤岛数量变化」「台账腐烂即失败」属端到端行为，由审计文档 §7.13 的
 * 变异自证覆盖（造新孤岛 → 报错；台账写不存在的文件 → 报错）。
 */

import { describe, expect, it } from "vitest";

import {
    GATE_LIKE,
    GATE_PATTERN,
    isGoverned,
    extractReferences,
    globToRegExp,
    stripComments,
} from "../../scripts/quality/check-gate-reachability.mjs";

describe("isGoverned：受管辖由**路径**决定，不看正文有没有 exit-1", () => {
    it("scripts/quality/ 下的脚本受管辖，即使正文不含 exit-1", () => {
        // 这正是 18 个 granular 门禁抽库后的形态：判定逻辑在 lib/ 里，
        // 文件本身只剩数据 + 一行调用，正文不再有 process.exitCode = 1。
        expect(isGoverned("scripts/quality/check-cas-granular-coverage.mjs")).toBe(true);
        expect(isGoverned("scripts/quality/probe-contract-drift.mjs")).toBe(true);
        expect(isGoverned("scripts/quality/debt-weekly-report.mjs")).toBe(true);
    });

    it("lib/ 下的共享库**不**受管辖（它们是被 import 的实现，不是门禁）", () => {
        expect(GATE_LIKE.test("scripts/quality/lib/granular-coverage.mjs")).toBe(true);
        expect(isGoverned("scripts/quality/lib/granular-coverage.mjs")).toBe(false);
        expect(isGoverned("scripts/quality/lib/stable-id.mjs")).toBe(false);
    });

    it("任何目录下 check-/verify-/validate-/assert-/enforce- 开头的脚本都受管辖", () => {
        expect(isGoverned("scripts/check-bundle-size.mjs")).toBe(true);
        expect(isGoverned("scripts/quality/verify-path-contract.mjs")).toBe(true);
        expect(isGoverned("scripts/perf/generate-comparison-report.mjs")).toBe(false);
    });

    it("受管辖与自称 exit-1 是**两件事**：判据不得依赖文件内容", () => {
        // 反证：若哪天有人把 isGoverned 改回「先读文件看有没有 exit-1」，
        // 这个断言仍成立但实际语义已变 —— 故再由下面这条把「内容无关」钉死。
        expect(typeof isGoverned).toBe("function");
        expect(isGoverned.length).toBe(1); // 只吃路径一个参数，拿不到内容
    });
});

describe("GATE_PATTERN / GATE_LIKE 判据", () => {
    it("GATE_PATTERN 认得两种自称门禁的写法", () => {
        expect(GATE_PATTERN.test("process.exitCode = 1;")).toBe(true);
        expect(GATE_PATTERN.test("process.exit(1)")).toBe(true);
        expect(GATE_PATTERN.test("process.exitCode = 0;")).toBe(false);
    });

    it("GATE_LIKE：scripts/quality/ 下的都算，别处要带 check-/verify- 前缀", () => {
        expect(GATE_LIKE.test("scripts/quality/anything.mjs")).toBe(true);
        expect(GATE_LIKE.test("scripts/audit/check-foo.mjs")).toBe(true);
        expect(GATE_LIKE.test("scripts/audit/verify-bar.mjs")).toBe(true);
        expect(GATE_LIKE.test("scripts/perf/not-a-gate.mjs")).toBe(false);
        // 反例夹具刻意用**不存在的**路径 —— 若写成真实脚本路径，可执行性盘点会把
        // "测试里出现过这个名字"误当成"有人跑它"（实测过一次，真孤岛被抹掉）。
        expect(GATE_LIKE.test("scripts/not-gates/loose-tool.mjs")).toBe(false);
    });
});

describe("stripComments", () => {
    it("去掉行注释与块注释", () => {
        const out = stripComments("const a = 1; // 注释\n/* 块注释 */\nconst b = 2;");
        expect(out).toContain("const a = 1;");
        expect(out).toContain("const b = 2;");
        expect(out).not.toContain("注释");
    });

    it("注释里的脚本路径必须消失（防自指假绿）", () => {
        // 夹具刻意用**不存在的**路径：写真实脚本名会让"可执行性盘点"把测试字符串
        // 当成一次真实引用（实测把某个零引用的诊断脚本从孤岛里抹掉）。
        const src = "/* scripts/quality/ghost-probe.mjs 是零引用脚本 */\nconst a = 1;";
        expect(stripComments(src)).not.toContain("ghost-probe");
    });

    it("字符串里的 // 不是注释（URL 不能把后半行吃掉）", () => {
        const src = 'const u = "https://example.com/x"; const v = "scripts/quality/a.mjs";';
        const out = stripComments(src);
        expect(out).toContain("https://example.com/x");
        expect(out).toContain("scripts/quality/a.mjs"); // 字符串里的引用要保留
    });

    it("注释里的 // 不会误伤前面的字符串", () => {
        const src = 'const p = "a"; // const q = "scripts/quality/b.mjs";\nconst r = 1;';
        const out = stripComments(src);
        expect(out).toContain('const p = "a";');
        expect(out).toContain("const r = 1;");
        expect(out).not.toContain("scripts/quality/b.mjs");
    });

    it("正则字面量里的引号/反引号不能让词法器错位（回归：曾导致整文件注释不被剥离）", () => {
        // 这个正则和 extractReferences 里那个一样，字符类里同时含 " ' ` ——
        // 老实现会在反引号处进入"模板串"状态，之后整篇注释都剥不掉。
        const src = "const re = /(?:^|[\\s\"'`([])([\\w.-]+\\.mjs)/gm;\n// scripts/quality/ghost.mjs\nconst after = 1;";
        const out = stripComments(src);
        expect(out).toContain("const after = 1;"); // 注释真被剥掉了
        expect(out).not.toContain("ghost.mjs");
        expect(out).toContain("[\\s\"'`([])"); // 正则本身原样保留
    });

    it("模板串内容整段保留（`node scripts/x.mjs` 常写在里面）", () => {
        const src = "const cmd = `node scripts/quality/x.mjs --flag`; // 注释";
        const out = stripComments(src);
        expect(out).toContain("node scripts/quality/x.mjs --flag");
        expect(out).not.toContain("注释");
    });

    it("除号不被误判成正则起始", () => {
        const src = "const r = (a + b) / (c - d); // 注释\nconst e = 1;";
        const out = stripComments(src);
        expect(out).toContain("(a + b) / (c - d)"); // 除号后的内容不能被吞
        expect(out).not.toContain("注释");
    });
});

describe("extractReferences", () => {
    it("抽出 pnpm script 名与仓库根相对路径", () => {
        // 夹具用**不存在的**示例路径：写真实脚本名会被可执行性盘点当成
        // "该脚本被测试引用"，污染覆盖统计。
        const { scripts, files } = extractReferences(
            "pnpm run quality:example-gate && node scripts/quality/example-gate.mjs",
        );
        expect(scripts.has("quality:example-gate")).toBe(true);
        expect(files.has("scripts/quality/example-gate.mjs")).toBe(true);
    });

    it("相对引用按 baseDir 解析（./ 与 ../）", () => {
        const { files } = extractReferences(
            'import a from "./example-lib.mjs";\nimport b from "../example-map.mjs";',
            "scripts/quality",
        );
        expect(files.has("scripts/quality/example-lib.mjs")).toBe(true);
        expect(files.has("scripts/example-map.mjs")).toBe(true);
    });

    it("同一段文本在错误 baseDir 下解析出的路径是不同的（证明 baseDir 真的被用上）", () => {
        const { files } = extractReferences('import a from "./example-lib.mjs";', "");
        expect(files.has("example-lib.mjs")).toBe(true);
        expect(files.has("scripts/quality/example-lib.mjs")).toBe(false);
    });

    it("裸文件名不算路径", () => {
        const { files } = extractReferences("node foo.mjs");
        expect(files.size).toBe(0);
    });

    it("模板串里的调用点也能抽到", () => {
        const { files } = extractReferences("execSync(`node scripts/audit/example-tool.mjs attrib`)");
        expect(files.has("scripts/audit/example-tool.mjs")).toBe(true);
    });

    it("注释里的路径先被 stripComments 剥掉 ⇒ 不再产生引用边", () => {
        const raw = "// node scripts/quality/ghost.mjs";
        const { files } = extractReferences(stripComments(raw));
        expect(files.size).toBe(0);
    });
});

describe("globToRegExp", () => {
    it("* 不跨目录，** 跨目录", () => {
        const one = globToRegExp("scripts/quality/*.mjs");
        expect(one.test("scripts/quality/a.mjs")).toBe(true);
        expect(one.test("scripts/quality/sub/a.mjs")).toBe(false);

        const deep = globToRegExp("scripts/**/*.mjs");
        expect(deep.test("scripts/quality/sub/a.mjs")).toBe(true);
        expect(deep.test("scripts/quality/a.mjs")).toBe(true);
    });

    it("点号按字面匹配，不当通配", () => {
        const re = globToRegExp("scripts/a.mjs");
        expect(re.test("scripts/a.mjs")).toBe(true);
        expect(re.test("scripts/axmjs")).toBe(false);
    });
});
