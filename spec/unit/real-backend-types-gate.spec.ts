/*
 * Negative tests for the real-backend typecheck ratchet.
 *
 * The gate exists because its CI job carried `continue-on-error: true`: 85 pre-existing
 * errors meant it could never fail, so nothing stopped error 86 from landing. These tests
 * pin the two halves that would silently make it pass forever — the parser (an output shape
 * it no longer understands would parse to zero diagnostics) and the fingerprint (a line
 * shift must not look like a new error, a changed message must).
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
    diagnosticId,
    parseDiagnostics,
    readBaseline,
    selectNewIds,
    selectResolvedIds,
} from "../../scripts/quality/check-real-backend-types.mjs";

const TSC_OUTPUT = [
    "spec/integ/real-backend/step7-search.test.ts(281,27): error TS2339: Property 'lookupThreePid' does not exist on type 'MatrixClient'.",
    "spec/integ/real-backend/space-manager.spec.ts(70,52): error TS2345: Argument of type '{ name: string; }' is not assignable to parameter of type 'CreateSpaceOptions'.",
    "  Property 'room_id' is missing in type '{ name: string; }' but required in type 'CreateSpaceOptions'.",
    "spec/integ/real-backend/step4-user.test.ts(221,70): error TS2345: Argument of type '\"public\"' is not assignable to parameter of type 'Visibility'.",
].join("\n");

describe("real-backend types gate: diagnostics parsing", () => {
    it("parses every diagnostic and ignores continuation/other lines", () => {
        const diagnostics = parseDiagnostics(TSC_OUTPUT);

        expect(diagnostics).toHaveLength(3);
        expect(diagnostics[0]).toMatchObject({
            filePath: "spec/integ/real-backend/step7-search.test.ts",
            line: 281,
            column: 27,
            code: "TS2339",
        });
        expect(diagnostics[0].message).toContain("lookupThreePid");
    });

    it("normalizes Windows separators so the same error fingerprints identically", () => {
        const [windows] = parseDiagnostics(
            "spec\\integ\\real-backend\\step7-search.test.ts(1,2): error TS2339: Property 'x' does not exist.",
        );
        const [posix] = parseDiagnostics(
            "spec/integ/real-backend/step7-search.test.ts(1,2): error TS2339: Property 'x' does not exist.",
        );

        expect(windows.filePath).toBe("spec/integ/real-backend/step7-search.test.ts");
        expect(diagnosticId(windows)).toBe(diagnosticId(posix));
    });

    it("returns nothing for output that carries no diagnostics", () => {
        expect(parseDiagnostics("")).toEqual([]);
        expect(parseDiagnostics("Version 5.9.3\nSomething went wrong")).toEqual([]);
    });
});

describe("real-backend types gate: fingerprint stability", () => {
    const base = {
        filePath: "spec/integ/real-backend/step7-search.test.ts",
        line: 281,
        column: 27,
        code: "TS2339",
        message: "Property 'lookupThreePid' does not exist on type 'MatrixClient'.",
    };

    it("keeps the same id when only the line moves (inserting a line is not a new error)", () => {
        expect(diagnosticId({ ...base, line: 900, column: 1 })).toBe(diagnosticId(base));
    });

    it("changes the id when the message or the file changes", () => {
        const otherMessage = diagnosticId({
            ...base,
            message: "Property 'lookupThreePid' does not exist on type 'Foo'.",
        });
        const otherFile = diagnosticId({ ...base, filePath: "spec/integ/real-backend/step6-crypto.test.ts" });

        expect(otherMessage).not.toBe(diagnosticId(base));
        expect(otherFile).not.toBe(diagnosticId(base));
    });
});

describe("real-backend types gate: baseline comparison", () => {
    it("reports only ids the baseline does not know about, deduplicated and sorted", () => {
        const newIds = selectNewIds(["b", "a", "a", "c"], ["c"]);

        expect(newIds).toEqual(["a", "b"]);
    });

    it("treats an empty baseline as 'everything is new' (missing baseline must not pass)", () => {
        expect(selectNewIds(["a"], [])).toEqual(["a"]);
    });

    it("reports baseline entries the project no longer produces as resolved", () => {
        expect(selectResolvedIds(["a"], ["a", "b"])).toEqual(["b"]);
    });

    it("reads an absent baseline file as empty instead of throwing", () => {
        const missing = path.join(fs.mkdtempSync(path.join("/tmp", "rb-types-")), "nope.json");

        expect(readBaseline(missing)).toEqual({ generatedAt: null, total: 0, ids: [] });
    });

    it("keeps the committed baseline in the shape the gate expects", () => {
        const baseline = readBaseline();

        // `7c7ccf91d` 把 78 条 real-backend 类型债逐条清完后，baseline **合法地**变为空
        // （`total: 0`）—— 原先这里断言 `total > 0`，与"清完"直接矛盾（既有红）。
        // 改为断言**结构与排序**；「baseline 文件缺失不得通过」由 `generatedAt !== null`
        // 兜住（`readBaseline(不存在的路径)` 返回 `{ generatedAt: null, total: 0, ids: [] }`）。
        expect(baseline.generatedAt).not.toBeNull();
        expect(baseline.total).toBe(baseline.ids.length);
        expect([...baseline.ids].sort()).toEqual(baseline.ids);
    });
});
