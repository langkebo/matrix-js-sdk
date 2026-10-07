/*
 * `scripts/quality/check-public-api-docs.mjs` 的单元测试（666 行的棘轮门禁，此前零 spec）。
 *
 * 它管的是"公开 API 面有没有在持续变差"，判定链很长（package.json exports → 可达闭包
 * → AST 扫描 → 五条规则）。真正值得钉死的是**口径**部分：
 *
 *   · **R0 导出面撒谎**：`package.json` 声明 `./notification`，实际目录叫 `notifications`
 *     —— 本仓真实发生过（本轮已修）。映射不到真实文件的 entry 必须进 `broken`。
 *     这条一旦失守，后面所有"可达性"都是建立在错的入口之上。
 *   · **可达闭包**：`computeReachableFiles` 若漏掉传递依赖，就会有一批 Manager 悄悄
 *     逃出统计（缺口数不涨 ⇒ 棘轮永远绿）；若把不可达文件算进来，又会退化成
 *     "整个 src 都算公开 API"的旧口径（逼着给死代码补 JSDoc 把它洗白）。
 *   · **说明符解析**：`.js` 必须映射回 `.ts`、目录要落到 `index.ts`，否则闭包会断。
 *
 * 文件系统相关的用例一律用临时目录构造，不依赖仓库真实结构（避免仓库一变就红）。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
    computeReachableFiles,
    isConventionInternal,
    isTrackedClassName,
    managerModuleRoots,
    relativeSpecifiers,
    resolvePackageExports,
    resolveSpecifier,
} from "../../scripts/quality/check-public-api-docs.mjs";

let tmpRoot: string;

beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "public-api-docs-spec-"));
    const write = (rel: string, content: string): string => {
        const full = path.join(tmpRoot, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, "utf8");
        return full;
    };
    write("a.ts", 'import { b } from "./sub/b";\nexport const a = b;\n');
    write("sub/b.ts", 'import { c } from "../c";\nexport const b = c;\n');
    write("c.ts", "export const c = 1;\n");
    write("orphan.ts", "export const orphan = 1;\n");
    write("dir/index.ts", "export const idx = 1;\n");
    // 环形引用：闭包必须能终止，而不是无限递归
    write("cycle1.ts", 'import "./cycle2";\nexport const one = 1;\n');
    write("cycle2.ts", 'import "./cycle1";\nexport const two = 2;\n');
});

afterAll(() => {
    // 一次删整棵树：逐个 unlink 会撞沙箱"批量删除 > 50 条"拦截
    fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("isConventionInternal（下划线开头视为内部实现）", () => {
    it("回引方法 _setParent 不算公开 API", () => {
        expect(isConventionInternal("_setParent")).toBe(true);
        expect(isConventionInternal("_")).toBe(true);
    });

    it("普通公开方法不算内部", () => {
        expect(isConventionInternal("getFoo")).toBe(false);
        expect(isConventionInternal("setParent")).toBe(false);
    });
});

describe("isTrackedClassName（纳入统计的类）", () => {
    it("Manager 结尾的类与 MatrixClient 计入", () => {
        expect(isTrackedClassName("RoomManager")).toBe(true);
        expect(isTrackedClassName("MatrixClient")).toBe(true);
    });

    it("非 Manager / 非核心客户端不计入", () => {
        expect(isTrackedClassName("FooService")).toBe(false);
        expect(isTrackedClassName("ManagerFoo")).toBe(false);
        expect(isTrackedClassName("matrixclient")).toBe(false);
    });
});

describe("relativeSpecifiers（只收相对说明符）", () => {
    it("收静态 import / re-export / 动态 import 三种写法", () => {
        const text = [
            'import { x } from "./a";',
            'export { y } from "../b";',
            'const m = await import("../c/index.js");',
        ].join("\n");
        expect([...relativeSpecifiers(text)].sort()).toEqual(["../b", "../c/index.js", "./a"]);
    });

    it("忽略裸包名（不属于本仓，与可达性口径无关）", () => {
        const text = 'import { a } from "rxjs";\nimport fs from "node:fs";';
        expect([...relativeSpecifiers(text)]).toEqual([]);
    });
});

describe("resolveSpecifier（相对说明符 → 磁盘文件）", () => {
    it("解析到 .ts 文件", () => {
        expect(resolveSpecifier(path.join(tmpRoot, "a.ts"), "./sub/b")).toBe(path.join(tmpRoot, "sub/b.ts"));
    });

    it("目录落到 index.ts", () => {
        expect(resolveSpecifier(path.join(tmpRoot, "a.ts"), "./dir")).toBe(path.join(tmpRoot, "dir/index.ts"));
    });

    it(".js 说明符映射回 .ts 源文件", () => {
        expect(resolveSpecifier(path.join(tmpRoot, "a.ts"), "./c.js")).toBe(path.join(tmpRoot, "c.ts"));
    });

    it("解析不到返回 null（不抛异常）", () => {
        expect(resolveSpecifier(path.join(tmpRoot, "a.ts"), "./nope")).toBeNull();
    });
});

describe("computeReachableFiles（相对导入的传递闭包）", () => {
    it("沿传递依赖展开：a → sub/b → c", () => {
        const reachable = computeReachableFiles([path.join(tmpRoot, "a.ts")]);
        expect(reachable.has(path.join(tmpRoot, "a.ts"))).toBe(true);
        expect(reachable.has(path.join(tmpRoot, "sub/b.ts"))).toBe(true);
        expect(reachable.has(path.join(tmpRoot, "c.ts"))).toBe(true);
    });

    it("无人引用的文件不在闭包内（否则又变回『整个 src 都算公开 API』）", () => {
        const reachable = computeReachableFiles([path.join(tmpRoot, "a.ts")]);
        expect(reachable.has(path.join(tmpRoot, "orphan.ts"))).toBe(false);
    });

    it("环形引用不会死循环", () => {
        const reachable = computeReachableFiles([path.join(tmpRoot, "cycle1.ts")]);
        expect(reachable.has(path.join(tmpRoot, "cycle1.ts"))).toBe(true);
        expect(reachable.has(path.join(tmpRoot, "cycle2.ts"))).toBe(true);
    });
});

describe("resolvePackageExports（R0：导出面不许撒谎）", () => {
    it("每个 ./lib/ 入口都能映射到真实存在的 src 文件", () => {
        // 本仓真实事故：exports 里写 `./notification`，实际目录是 `notifications`
        // ⇒ 该子路径根本无法解析，而门禁当时看不出来。broken 必须为空。
        const { broken } = resolvePackageExports();
        expect(broken).toEqual([]);
    });

    it("解析成功的入口都指向磁盘上真实存在的文件", () => {
        const { entries } = resolvePackageExports();
        expect(entries.length).toBeGreaterThan(0);
        for (const entry of entries) {
            expect(fs.existsSync(entry.srcFile)).toBe(true);
        }
    });
});

describe("managerModuleRoots（动态 import 的模块根）", () => {
    it("首个根是 manager-extensions hub，且每个根都真实存在", () => {
        const roots = managerModuleRoots();
        expect(roots[0]).toContain(path.join("src", "manager-extensions"));
        for (const root of roots) {
            expect(fs.existsSync(root)).toBe(true);
        }
    });
});
