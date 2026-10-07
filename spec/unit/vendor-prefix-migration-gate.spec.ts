/*
 * `scripts/quality/check-vendor-prefix-migration.mjs` 的单元测试（ISSUE-13 收口）。
 *
 * 它拦的是"私有扩展端点冒用标准 CS 命名空间"：`prefix: ClientPrefix.V1/V3/R0`
 * 出现在 friend / voice / key-rotation 等私有模块里就是违规，应走
 * `/_matrix/vendor/v1`。
 *
 * 唯一有点微妙的是**豁免窗口**：端点定义与路径常量经常不在同一行，所以判定时
 * 会看目标行**前后 4 行**内有没有标准路径（`/rooms/{id}/send/` 之类）。
 * 窗口边界值得钉死 —— 太小会把标准 API 误判成违规（逼人改不该改的代码），
 * 太大则真正的私有端点也会被一并豁免（门禁形同虚设）。
 */

import { describe, expect, it } from "vitest";

import { scanLinesForViolations } from "../../scripts/quality/check-vendor-prefix-migration.mjs";

const CLIENT_PREFIX = "  prefix: ClientPrefix.V1,";
const STANDARD_PATH = '  path: "/rooms/{roomId}/send/{txnId}",';

/** 造一个 lines 数组：prefix 行在第 prefixIndex 行（0-based）。 */
function makeLines(prefixIndex: number, pathIndex: number | null): string[] {
    const size = Math.max(prefixIndex, pathIndex ?? 0) + 6;
    const lines = Array.from({ length: size }, () => "  // filler");
    lines[prefixIndex] = CLIENT_PREFIX;
    if (pathIndex !== null) lines[pathIndex] = STANDARD_PATH;
    return lines;
}

describe("scanLinesForViolations（私有端点不得冒用 client 前缀）", () => {
    it("client 前缀且附近无标准路径 → 违规，行号为 1-based", () => {
        const lines = makeLines(3, null);
        expect(scanLinesForViolations(lines)).toEqual([{ line: 4, text: CLIENT_PREFIX.trim() }]);
    });

    it("client 前缀 + 紧邻的标准 send 路径 → 豁免", () => {
        expect(scanLinesForViolations(makeLines(3, 4))).toEqual([]);
    });

    it("标准路径在前方 4 行内 → 豁免（窗口向后也生效）", () => {
        expect(scanLinesForViolations(makeLines(5, 2))).toEqual([]);
    });

    it("标准路径正好在窗口边界（距离 4）→ 仍豁免", () => {
        expect(scanLinesForViolations(makeLines(4, 8))).toEqual([]);
    });

    it("标准路径在窗口外（距离 5）→ 不豁免（窗口不能被放大）", () => {
        const lines = makeLines(4, 9);
        expect(scanLinesForViolations(lines)).toHaveLength(1);
    });

    it("vendor 前缀不算违规（V1/V3/R0 之外的前缀不在判据里）", () => {
        const lines = ["  prefix: ClientPrefix.Vendor,"];
        expect(scanLinesForViolations(lines)).toEqual([]);
    });

    it("没有任何 prefix 行 → 不违规", () => {
        expect(scanLinesForViolations(["  path: '/_matrix/vendor/v1/foo'", "  // nothing here"])).toEqual([]);
    });

    it("多行违规各自上报（不会被只报第一条吞掉）", () => {
        const lines = [CLIENT_PREFIX, "  // filler", CLIENT_PREFIX];
        expect(scanLinesForViolations(lines).map((v) => v.line)).toEqual([1, 3]);
    });
});
