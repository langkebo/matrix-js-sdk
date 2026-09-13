/*
 * Negative tests for the critical-module coverage ratchet.
 *
 * The gate spent a long time permanently red for a reason nobody spotted: it looked up lcov
 * `SF:` records by absolute path while lcov writes repo-relative paths, so every module
 * reported "missing coverage record" — misread during the 2026-09-13 review as stale
 * coverage. These tests pin both path forms, the per-module floor, and the modules list
 * itself, so a future refactor cannot quietly turn this gate into a no-op.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { evaluateCriticalCoverage, parseLcov } from "../../scripts/quality/check-critical-coverage.mjs";

const LCOV = [
    "TN:",
    "SF:src/room/RoomManager.ts",
    "LF:100",
    "LH:95",
    "end_of_record",
    "SF:src/push/PushManager.ts",
    "LF:100",
    "LH:50",
    "end_of_record",
].join("\n");

const requiredFrom = (floors: Record<string, number>) => (entry: { path: string }) => floors[entry.path] ?? 90;

describe("critical coverage gate: lcov parsing", () => {
    it("parses records and computes the hit ratio", () => {
        const records = parseLcov(LCOV);

        expect(records.size).toBe(2);
        expect(records.get("src/room/RoomManager.ts")).toMatchObject({ linesFound: 100, linesHit: 95, ratio: 95 });
        expect(records.get("src/push/PushManager.ts")?.ratio).toBe(50);
    });

    it("treats a record with no LF lines as 0% instead of NaN", () => {
        const records = parseLcov(["SF:src/empty.ts", "LH:0", "end_of_record"].join("\n"));

        expect(records.get("src/empty.ts")?.ratio).toBe(0);
    });

    it("normalizes Windows separators in SF paths", () => {
        const records = parseLcov(["SF:src\\room\\RoomManager.ts", "LF:10", "LH:10", "end_of_record"].join("\n"));

        expect(records.has("src/room/RoomManager.ts")).toBe(true);
    });
});

describe("critical coverage gate: evaluation", () => {
    const records = parseLcov(LCOV);
    const projectRoot = "/repo";

    it("finds repo-relative SF records (the absolute-only lookup was a permanent false red)", () => {
        const { failures, checked } = evaluateCriticalCoverage({
            records,
            targets: [{ path: "src/room/RoomManager.ts", floorPercent: 90 }],
            required: requiredFrom({ "src/room/RoomManager.ts": 90 }),
            projectRoot,
        });

        expect(failures).toEqual([]);
        expect(checked).toEqual([{ path: "src/room/RoomManager.ts", ratio: 95, required: 90 }]);
    });

    it("still accepts absolute SF records", () => {
        const absolute = parseLcov(["SF:/repo/src/room/RoomManager.ts", "LF:10", "LH:10", "end_of_record"].join("\n"));
        const { failures } = evaluateCriticalCoverage({
            records: absolute,
            targets: [{ path: "src/room/RoomManager.ts", floorPercent: 90 }],
            required: requiredFrom({ "src/room/RoomManager.ts": 90 }),
            projectRoot,
        });

        expect(failures).toEqual([]);
    });

    it("fails a module below its floor with the measured ratio in the message", () => {
        const { failures } = evaluateCriticalCoverage({
            records,
            targets: [{ path: "src/push/PushManager.ts", floorPercent: 89 }],
            required: requiredFrom({ "src/push/PushManager.ts": 89 }),
            projectRoot,
        });

        expect(failures).toEqual(["src/push/PushManager.ts: 50.00% < 89%"]);
    });

    it("fails a missing record instead of silently skipping the module", () => {
        const { failures, checked } = evaluateCriticalCoverage({
            records,
            targets: [{ path: "src/space/SpaceManager.ts", floorPercent: 77 }],
            required: requiredFrom({}),
            projectRoot,
        });

        expect(failures).toEqual(["src/space/SpaceManager.ts: missing coverage record"]);
        expect(checked).toEqual([]);
    });

    it("treats a floor of 0 as satisfiable but a strictly-below floor as a failure", () => {
        const between = parseLcov(["SF:src/edge.ts", "LF:1000", "LH:899", "end_of_record"].join("\n"));

        expect(
            evaluateCriticalCoverage({
                records: between,
                targets: [{ path: "src/edge.ts" }],
                required: () => 89.9,
                projectRoot,
            }).failures,
        ).toEqual([]);
        expect(
            evaluateCriticalCoverage({
                records: between,
                targets: [{ path: "src/edge.ts" }],
                required: () => 90,
                projectRoot,
            }).failures,
        ).toEqual(["src/edge.ts: 89.90% < 90%"]);
    });
});

describe("critical coverage gate: configuration", () => {
    it("ships a modules list where every entry has a path and a numeric floor", () => {
        const configPath = path.resolve("scripts/quality/critical-modules.json");
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

        expect(config.targetPercent).toBeGreaterThan(0);
        expect(config.modules.length).toBeGreaterThan(0);
        for (const entry of config.modules) {
            expect(typeof entry.path).toBe("string");
            expect(entry.path.startsWith("src/")).toBe(true);
            // The floor is the measured value (rounded down), not the aspirational target:
            // a module already above `targetPercent` legitimately keeps a higher floor.
            expect(typeof entry.floorPercent).toBe("number");
            expect(entry.floorPercent).toBeGreaterThan(0);
        }
    });
});
