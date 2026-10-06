import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface DtoRiskItem {
    id: string;
    filePath: string;
    line: number;
    code: string;
    snippet: string;
}

async function loadQualityGate(): Promise<{
    readBaselineIds: (filePath?: string) => string[];
    scanGeneratedDtoRisks: (scanRoot?: string) => DtoRiskItem[];
}> {
    // @ts-expect-error test dynamically imports an ESM quality script.
    return await import("../../scripts/quality/check-generated-dto-strictness.mjs");
}

describe("generated dto strictness quality gate", () => {
    it("finds risky DTO widenings inside generated dto files", async () => {
        const { scanGeneratedDtoRisks } = await loadQualityGate();
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-js-sdk-dto-risk-"));
        const generatedDir = path.join(tempRoot, "src", "sample", "__generated__");
        fs.mkdirSync(generatedDir, { recursive: true });
        fs.writeFileSync(
            path.join(generatedDir, "dto.ts"),
            [
                "export interface SampleDto {",
                "    payload: Record<string, unknown>;",
                "    auth_data: any;",
                "    items: unknown[];",
                "}",
                "",
            ].join("\n"),
            "utf8",
        );

        const risks = scanGeneratedDtoRisks(tempRoot);

        expect(risks.map((item: DtoRiskItem) => item.code)).toEqual([
            "bare-unknown",
            "record-unknown",
            "explicit-any",
            "bare-unknown",
        ]);
        expect(risks.every((item: DtoRiskItem) => item.filePath === "src/sample/__generated__/dto.ts")).toBe(true);
    });

    it("reads baseline ids from json files", async () => {
        const { readBaselineIds } = await loadQualityGate();
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-js-sdk-dto-baseline-"));
        const baselinePath = path.join(tempDir, "baseline.json");
        fs.writeFileSync(
            baselinePath,
            JSON.stringify({ generatedAt: "2026-05-03T00:00:00.000Z", ids: ["a", "b"] }, null, 2),
            "utf8",
        );

        expect(readBaselineIds(baselinePath)).toEqual(["a", "b"]);
        expect(readBaselineIds(path.join(tempDir, "missing.json"))).toEqual([]);
    });

    it('does not count the string literal "unknown" as a bare `unknown` type', async () => {
        // `trust_level: "verified" | "unverified" | "unknown"` is a narrow union; the word
        // "unknown" inside a literal used to land in the baseline as a widening, which
        // inflated the very number the gate is judged by (2 of 111 entries on 2026-09-13).
        const { scanGeneratedDtoRisks } = await loadQualityGate();
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-js-sdk-dto-literal-"));
        const generatedDir = path.join(tempRoot, "src", "sample", "__generated__");
        fs.mkdirSync(generatedDir, { recursive: true });
        fs.writeFileSync(
            path.join(generatedDir, "dto.ts"),
            [
                "export interface TrustDto {",
                '    trust_level?: "verified" | "unverified" | "unknown";',
                "    content: unknown;",
                "}",
                "",
            ].join("\n"),
            "utf8",
        );

        const risks = scanGeneratedDtoRisks(tempRoot);

        expect(risks).toHaveLength(1);
        expect(risks[0].code).toBe("bare-unknown");
        expect(risks[0].snippet).toContain("content: unknown");
    });

    /**
     * 指纹稳定性（对应审计缺陷 α，2026-10-06 修复）。
     *
     * 生成文件几乎每次 codegen 都整段重排。如果身份里含行号，那么「上方插一行注释」就会让
     * 全部条目同时 STALE，门禁变成必须全量重记才可能变绿——等于把审查门废掉。因此身份只由
     * `filePath + code + snippet + ordinal` 决定，行号单独作为展示字段。
     */
    it("指纹不含行号：上方插入代码行只改 line，不改 id", async () => {
        const { scanGeneratedDtoRisks } = await loadQualityGate();

        const writeRoot = (leadingLines: number): string => {
            const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-js-sdk-dto-stable-"));
            const generatedDir = path.join(tempRoot, "src", "sample", "__generated__");
            fs.mkdirSync(generatedDir, { recursive: true });
            fs.writeFileSync(
                path.join(generatedDir, "dto.ts"),
                [
                    ...Array.from({ length: leadingLines }, (_, i) => `// filler ${i}`),
                    "export interface SampleDto {",
                    "    payload: unknown;",
                    "}",
                    "",
                ].join("\n"),
                "utf8",
            );
            return tempRoot;
        };

        const atTop = scanGeneratedDtoRisks(writeRoot(0));
        const shifted = scanGeneratedDtoRisks(writeRoot(20));

        expect(atTop).toHaveLength(1);
        expect(shifted).toHaveLength(1);
        // 行号确实变了……
        expect(shifted[0].line).toBe(atTop[0].line + 20);
        // ……但身份必须一模一样。
        expect(shifted[0].id).toBe(atTop[0].id);
        // 身份形态：`<相对路径>#<16 位 sha1 片段>`，其中不含行号。
        expect(atTop[0].id).toMatch(/^src\/sample\/__generated__\/dto\.ts#[0-9a-f]{16}$/);
    });

    /**
     * 序数去重（同一轮修复）：同一文件内**文本完全相同**的两行不折叠成一条。
     * 折叠会让「复制粘贴出一份新风险」逃过门禁——新条目会顶掉旧条目的身份。
     */
    it("同一文件内文本相同的两行用 ordinal 区分，不折叠", async () => {
        const { scanGeneratedDtoRisks } = await loadQualityGate();
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-js-sdk-dto-ordinal-"));
        const generatedDir = path.join(tempRoot, "src", "sample", "__generated__");
        fs.mkdirSync(generatedDir, { recursive: true });
        fs.writeFileSync(
            path.join(generatedDir, "dto.ts"),
            [
                "export interface ADto {",
                "    payload: unknown;",
                "}",
                "export interface BDto {",
                "    payload: unknown;",
                "}",
                "",
            ].join("\n"),
            "utf8",
        );

        const risks = scanGeneratedDtoRisks(tempRoot);

        expect(risks).toHaveLength(2);
        expect(risks[0].snippet).toBe(risks[1].snippet);
        expect(risks[0].id).not.toBe(risks[1].id);
    });
});
