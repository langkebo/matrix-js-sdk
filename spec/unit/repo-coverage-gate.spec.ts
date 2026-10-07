/*
 * `scripts/quality/check-repo-coverage.mjs` 的单元测试（全仓覆盖率那一轨）。
 *
 * 它出错的方式只有一种但很致命：**聚合口径**。
 *
 * 各文件比率的**算术平均**会被小文件稀释 —— 一个 10 行全未覆盖的文件，
 * 和一个 1000 行全覆盖的文件，平均下来是 50%，而真实行覆盖率是 99%。
 * 门禁若按平均值判，就会在"补了几个 tiny 文件的测试"后虚假上涨，
 * 或在"删掉几个 tiny 死文件"后虚假下跌。所以必须按 LF/LH **加权求和**。
 *
 * 另有一条边界：找不到任何行（LF:0）时 pct 必须是 100，不能是 NaN 或 0。
 * 取 0 会让"lcov 解析失败/空文件"表现成"覆盖率 0% 未达标"，把环境问题
 * 误报成代码问题（本门禁特意用 exit 2 区分 lcov 缺失，就是这个道理）。
 */

import { describe, expect, it } from "vitest";

import { summarizeLcov } from "../../scripts/quality/check-repo-coverage.mjs";

/** 拼一段单文件 lcov 记录。 */
function record(file: string, lf: number, lh: number, brf = 0, brh = 0, fnf = 0, fnh = 0): string {
    return [
        `SF:${file}`,
        `LF:${lf}`,
        `LH:${lh}`,
        `BRF:${brf}`,
        `BRH:${brh}`,
        `FNF:${fnf}`,
        `FNH:${fnh}`,
        "end_of_record",
    ].join("\n");
}

describe("summarizeLcov（加权聚合，不是各文件比率的平均）", () => {
    it("空输入：0 个文件，各指标 100%（found=0 时不得返回 NaN 或 0）", () => {
        const s = summarizeLcov("");
        expect(s.fileCount).toBe(0);
        expect(s.lines.pct).toBe(100);
        expect(s.branches.pct).toBe(100);
        expect(s.functions.pct).toBe(100);
    });

    it("解析单文件记录的 LF/LH", () => {
        const s = summarizeLcov(record("src/a.ts", 10, 8));
        expect(s.fileCount).toBe(1);
        expect(s.lines).toEqual({ hit: 8, found: 10, pct: 80 });
    });

    it("解析 branches 与 functions", () => {
        const s = summarizeLcov(record("src/a.ts", 10, 10, 4, 2, 5, 4));
        expect(s.branches).toEqual({ hit: 2, found: 4, pct: 50 });
        expect(s.functions).toEqual({ hit: 4, found: 5, pct: 80 });
    });

    it("多文件按行加权：大小文件不等权（这条守住 '平均 vs 加权' 的口径）", () => {
        // 大文件 1000/1000，小文件 0/10。
        // 加权 = 1000/1010 ≈ 99.01%；若误用算术平均则是 (100 + 0) / 2 = 50%。
        const s = summarizeLcov([record("src/big.ts", 1000, 1000), record("src/tiny.ts", 10, 0)].join("\n"));
        expect(s.fileCount).toBe(2);
        expect(s.lines.found).toBe(1010);
        expect(s.lines.hit).toBe(1000);
        expect(s.lines.pct).toBeCloseTo(99.0099, 3);
        // 反证：绝不是平均值的 50
        expect(s.lines.pct).not.toBeCloseTo(50, 1);
    });

    it("BRF/FNF 全为 0 时 branches/functions 记 100%（不是 0，避免把 '没数据' 报成 '没覆盖'）", () => {
        const s = summarizeLcov(record("src/a.ts", 10, 5));
        expect(s.branches.found).toBe(0);
        expect(s.branches.pct).toBe(100);
        expect(s.functions.pct).toBe(100);
    });

    it("正常闭合的两段记为 2 个文件", () => {
        const s = summarizeLcov([record("src/a.ts", 10, 10), record("src/b.ts", 4, 1)].join("\n"));
        expect(s.fileCount).toBe(2);
        expect(s.lines).toEqual({ hit: 11, found: 14, pct: (11 / 14) * 100 });
    });

    it("末尾一段缺 end_of_record 时不计入 fileCount（已知边界，钉住现状）", () => {
        // 实现只在「被下一个 SF 或 end_of_record 闭合」时才 fileCount++，
        // 因此**末尾未闭合的一段会被漏计**。影响面很小：fileCount 只用于打印
        // "N 个源文件"，判定用的 lines/branches/functions 是逐行累加的，不受影响。
        // 修它属于判定类改动（须先存金标准），故这里先把现状钉住，避免有人
        // 顺手"修好"却没人知道改了什么。
        const s = summarizeLcov(["SF:src/a.ts", "LF:10", "LH:10", "SF:src/b.ts", "LF:4", "LH:1"].join("\n"));
        expect(s.fileCount).toBe(1);
        // 行覆盖仍然是两段之和 ⇒ 判定不受影响，这正是"影响面很小"的证据
        expect(s.lines).toEqual({ hit: 11, found: 14, pct: (11 / 14) * 100 });
    });

    it("忽略 SF 之前与记录块之外的噪声行", () => {
        const s = summarizeLcov(["TN:", "LF:999", "LH:999", record("src/a.ts", 2, 1)].join("\n"));
        expect(s.lines).toEqual({ hit: 1, found: 2, pct: 50 });
    });
});
