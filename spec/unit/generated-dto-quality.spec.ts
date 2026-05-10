import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface DtoRiskItem {
    filePath: string;
    code: string;
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
});
