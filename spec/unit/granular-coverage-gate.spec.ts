/*
 * `scripts/quality/lib/granular-coverage.mjs` 的单元测试。
 *
 * 它一个文件替 18 个 `check-*-granular-coverage.mjs` 判生死，所以这里的每一条断言
 * 都同时是那 18 个门禁的断言 —— 这是本次抽取的全部收益所在（此前 18 份副本零测试）。
 *
 * 抽取是**判定类重构**，纪律上必须先存金标准再对拍：
 *   node scripts/audit/gate-golden.mjs capture gran-cas --script quality:cas   # 抽之前
 *   node scripts/audit/gate-golden.mjs verify  gran-cas                        # 抽之后
 * 18/18 stdout 逐字节一致（审计 §7.13-5）。下面这些用例补的是金标准覆盖不到的
 * **边界与反例**：金标准只证明"当前数据下没变"，不能证明"换个数据仍然判对"。
 *
 * 两条判据的语义差异是本文件最需要钉死的东西（**严宽不对称是有意的，不是笔误**）：
 *   · hasMethod（owner 侧）**严格**：`\b method` + 形态（`( ` / `<T>(` / `:` / `.method(`），
 *     防止 `resetCreateService(` 误命中 `createService`；
 *   · hasTestHit（测试侧）**宽松**：字面子串 `` `${method}(` `` —— 无词边界，所以
 *     `myfoo(` **会**命中 `foo`（宽松方向的漏报），但仍要求紧跟左括号，所以
 *     `expect(vm.foo).toHaveBeenCalled()` **不会**命中。
 *   若哪天有人把两侧"统一"成同一套判据，18 个门禁会集体假红或集体假绿 —— 下面专门有一条守它。
 */

import { describe, expect, it } from "vitest";

import {
    collectMissing,
    escapeRegex,
    evaluateGranularCoverage,
    hasMethod,
    hasTestHit,
} from "../../scripts/quality/lib/granular-coverage.mjs";

describe("escapeRegex", () => {
    it("转义正则元字符，方法名进 RegExp 前必须过这一步", () => {
        expect(escapeRegex("a.b")).toBe("a\\.b");
        expect(escapeRegex("get(X)")).toBe("get\\(X\\)");
        expect(escapeRegex("plain")).toBe("plain");
    });
});

describe("hasMethod（owner 侧，严格：带词边界）", () => {
    it("认得直接调用 / 泛型调用 / 属性简写 / 委托调用", () => {
        expect(hasMethod("async createService() {}", "createService")).toBe(true);
        expect(hasMethod("public createService<T>() {}", "createService")).toBe(true);
        expect(hasMethod("  createService: () => {},", "createService")).toBe(true);
        expect(hasMethod("await this.inner.createService()", "createService")).toBe(true);
    });

    it("**不**被更长标识符误命中（这是严格判据存在的唯一理由）", () => {
        expect(hasMethod("resetCreateService()", "createService")).toBe(false);
        expect(hasMethod("myCreateService()", "createService")).toBe(false);
    });

    it("只有裸名字、没有调用/属性形态时不算存在", () => {
        expect(hasMethod("// TODO: createService 待实现", "createService")).toBe(false);
        expect(hasMethod("const createService = 1;", "createService")).toBe(false);
    });
});

describe("hasTestHit（测试侧，宽松：字面子串 `method(`，无词边界）", () => {
    it("要求紧跟左括号 —— 纯属性引用不算命中", () => {
        expect(hasTestHit("it('x', () => { createService(); });", "createService")).toBe(true);
        expect(hasTestHit("expect(vm.createService).toHaveBeenCalled();", "createService")).toBe(false);
    });

    it("无词边界 ⇒ 前缀标识符会命中（宽松方向的漏报，沿用原语义不动）", () => {
        expect(hasTestHit("myCreateService();", "CreateService")).toBe(true);
        // 大小写敏感，所以 `resetCreateService(` 命中不了小写的 createService
        expect(hasTestHit("resetCreateService();", "createService")).toBe(false);
    });

    it("完全没提过才算未命中", () => {
        expect(hasTestHit('describe("other", () => {});', "createService")).toBe(false);
    });

    it("两侧严宽不对称：同一段文本，owner 侧拒、测试侧收", () => {
        const src = "myfoo();";
        expect(hasMethod(src, "foo")).toBe(false); // 严格：\bfoo 不成立
        expect(hasTestHit(src, "foo")).toBe(true); // 宽松：子串 "foo(" 成立
    });
});

describe("collectMissing", () => {
    it("保留原顺序，且**不折叠重复项**（多重集语义）", () => {
        expect(collectMissing(["a", "b", "a"], () => true)).toEqual([]);
        expect(collectMissing(["a", "b", "a"], (x) => x === "a")).toEqual(["b"]);
        expect(collectMissing(["a", "a"], () => false)).toEqual(["a", "a"]);
    });
});

describe("evaluateGranularCoverage（纯求值，不打印不碰退出码）", () => {
    const checks = [
        {
            module: "demo",
            groups: [
                {
                    name: "g1",
                    ownerFile: "src/demo.ts",
                    methods: ["alpha", "beta"],
                    testFiles: ["spec/unit/demo.spec.ts"],
                },
            ],
        },
    ];

    const files: Record<string, string> = {
        "src/demo.ts": "async alpha() {}\nasync beta() {}\n",
        "spec/unit/demo.spec.ts": "it('x', () => { alpha(); beta(); });",
    };

    it("全齐 → 无 failure，组计通过", () => {
        const r = evaluateGranularCoverage(checks, { readFile: (f) => files[f] });
        expect(r.failures).toHaveLength(0);
        expect(r.totalGroups).toBe(1);
        expect(r.passedGroups).toBe(1);
    });

    it("owner 里缺方法 → 进 missingMethods，且**不**重复计入 methodsWithoutTests", () => {
        const r = evaluateGranularCoverage(checks, {
            readFile: (f) => (f === "src/demo.ts" ? "async alpha() {}\n" : files[f]),
        });
        expect(r.failures).toHaveLength(1);
        expect(r.failures[0].missingMethods).toEqual(["beta"]);
        expect(r.failures[0].methodsWithoutTests).toEqual([]);
        expect(r.passedGroups).toBe(0);
    });

    it("测试里缺命中 → 进 methodsWithoutTests", () => {
        const r = evaluateGranularCoverage(checks, {
            readFile: (f) => (f === "spec/unit/demo.spec.ts" ? "it('x', () => { alpha(); });" : files[f]),
        });
        expect(r.failures[0].missingMethods).toEqual([]);
        expect(r.failures[0].methodsWithoutTests).toEqual(["beta"]);
    });

    it("多 module / 多 group 分别计数，互不干扰", () => {
        const two = [
            {
                module: "a",
                groups: [
                    { name: "g1", ownerFile: "a.ts", methods: ["m"], testFiles: ["a.spec.ts"] },
                    { name: "g2", ownerFile: "a2.ts", methods: ["n"], testFiles: ["a.spec.ts"] },
                ],
            },
            {
                module: "b",
                groups: [{ name: "g3", ownerFile: "b.ts", methods: ["o"], testFiles: ["b.spec.ts"] }],
            },
        ];
        const r = evaluateGranularCoverage(two, {
            readFile: (f) => (f.endsWith(".spec.ts") ? "m(); n(); o();" : "m() {} n() {} o() {}"),
        });
        expect(r.totalGroups).toBe(3);
        expect(r.passedGroups).toBe(3);
        expect(r.failures).toHaveLength(0);
    });

    it("readFile 抛错时必须冒泡（沿用原实现：让门禁直接红，不静默放过）", () => {
        expect(() =>
            evaluateGranularCoverage(checks, {
                readFile: () => {
                    throw new Error("ENOENT: src/demo.ts");
                },
            }),
        ).toThrow(/ENOENT/);
    });
});
