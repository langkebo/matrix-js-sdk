/*
 * `scripts/quality/check-type-coverage.mjs` 的单元测试。
 *
 * 这个门禁对 `src` 整体 + 8 个模块目录各跑一次 type-coverage，收集哪些文件进
 * 每次统计，全靠 `collectTypeScriptFiles`。它错一点点，覆盖率数字就悄悄变味：
 *
 *   · **递归开关用错**：`src/root` 那一档用的是**非递归**（只看根目录的 .ts），
 *     若误用成递归，根目录那一档会把所有子目录都算进去，与 8 个模块档大面积重叠；
 *     反过来模块档若关掉递归，就只剩 `index.ts` 一个文件 —— 覆盖率会虚高到 100%，
 *     而实际上是"只测了入口那几行"。
 *   · **`.test-d.ts` 必须排除**：那是给类型测试用的声明文件，算进分母会稀释百分比。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { collectTypeScriptFiles } from "../../scripts/quality/check-type-coverage.mjs";

let tmpRoot: string;

beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "type-coverage-spec-"));
    const write = (rel: string): string => {
        const full = path.join(tmpRoot, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, "export const x = 1;\n", "utf8");
        return full;
    };
    write("b.ts");
    write("a.ts");
    write("index.ts");
    write("models/event.ts");
    write("models/room.ts");
    write("models/room.test-d.ts");
    write("notes.md");
    write("data.json");
    write("legacy.js");
});

afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const base = (rel: string): string => path.join(tmpRoot, rel);

describe("collectTypeScriptFiles（决定 '每次统计哪些文件'）", () => {
    it("默认递归：收集所有层级的 .ts", () => {
        const files = collectTypeScriptFiles(tmpRoot);
        expect(files).toContain(base("models/event.ts"));
        expect(files).toContain(base("a.ts"));
    });

    it("recursive=false 只收根目录的 .ts（src/root 那一档必须这样）", () => {
        const files = collectTypeScriptFiles(tmpRoot, false);
        expect(files).toContain(base("a.ts"));
        expect(files).not.toContain(base("models/event.ts"));
    });

    it("排除 .test-d.ts（类型测试的声明文件不该进分母）", () => {
        const files = collectTypeScriptFiles(tmpRoot);
        expect(files).not.toContain(base("models/room.test-d.ts"));
        expect(files).toContain(base("models/room.ts"));
    });

    it("只收 .ts：.md / .json / .js 一律不收", () => {
        const files = collectTypeScriptFiles(tmpRoot);
        expect(files).not.toContain(base("notes.md"));
        expect(files).not.toContain(base("data.json"));
        expect(files).not.toContain(base("legacy.js"));
    });

    it("结果按路径排序（顺序稳定，输出才可比对）", () => {
        const files = collectTypeScriptFiles(tmpRoot);
        expect([...files].sort()).toEqual(files);
    });

    it("目录不存在时抛 ENOENT —— 判存在的责任在调用方（钉住现状）", () => {
        // 本函数不做 existsSync：main() 里 8 个模块档是先 filter 过
        // `existsSync(...) && isDirectory()` 才调它的，"src/root" 则必然存在。
        // 这里钉住"会抛"而不是"返回空"，免得有人以为可以随便传不存在的路径。
        expect(() => collectTypeScriptFiles(path.join(tmpRoot, "nope"))).toThrow();
    });
});
