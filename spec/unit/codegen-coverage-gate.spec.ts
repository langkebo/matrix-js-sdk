/*
 * Negative tests for the manager-codegen coverage gate.
 *
 * The gate used to report a flat "71.4% covered / 14 missing" with no way to tell a real
 * gap from a module that simply does not consume a route table (three of those 14 were
 * actually gate bugs — see the 2026-09-13 review, P2 item 2.4). The classification is now
 * exported so these rules are pinned: a known non-consumer must be waived, but anything
 * unlisted — or listed with an expired waiver — must still fail.
 */

import { describe, expect, it } from "vitest";

import { classifyModuleCoverage } from "../../scripts/quality/check-manager-codegen-coverage.mjs";

const TODAY = new Date("2026-09-13T00:00:00Z");

describe("codegen coverage gate: module classification", () => {
    it("covers a module that has both a route table and a consuming manager", () => {
        expect(classifyModuleCoverage("room", { hasCodegen: 40, hasManager: true, today: TODAY })).toEqual({
            status: "covered",
        });
    });

    it("waives a documented non-consumer while its waiver is live", () => {
        const verdict = classifyModuleCoverage("admin", { hasCodegen: 0, hasManager: false, today: TODAY });
        expect(verdict.status).toBe("waived");
        expect(verdict.waiver?.expires).toBe("2026-12-31");
        expect(verdict.waiver?.reason).toBeTruthy();
    });

    it("fails an UNLISTED module that has no route table (new gaps must not hide)", () => {
        expect(
            classifyModuleCoverage("brand_new_module", { hasCodegen: 0, hasManager: true, today: TODAY }),
        ).toMatchObject({ status: "missing", reason: "NO_CODEGEN" });
    });

    it("fails an UNLISTED module whose route table no manager consumes", () => {
        expect(
            classifyModuleCoverage("brand_new_module", { hasCodegen: 12, hasManager: false, today: TODAY }),
        ).toMatchObject({ status: "missing", reason: "MISSING_MANAGER" });
    });

    it("turns a waived module back into a failure once the waiver expires", () => {
        const afterExpiry = new Date("2027-01-01T00:00:00Z");
        expect(classifyModuleCoverage("admin", { hasCodegen: 0, hasManager: false, today: afterExpiry })).toMatchObject(
            { status: "missing", reason: "EXPIRED_WAIVER" },
        );
    });
});
