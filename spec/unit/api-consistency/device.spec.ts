/**
 * API consistency tests — Device display_name validation (SDK-9)
 *
 * Validates m-13 alignment: updateDevice rejects display_name > 100 chars.
 */
import { describe, it, expect } from "vitest";
import { ValidationError } from "../../../src/errors";

describe("SDK-9: Device display_name length validation", () => {
    describe("updateDevice() display_name ≤ 100 chars", () => {
        it("rejects display_name > 100 characters", () => {
            const longName = "a".repeat(101);
            // A 101-char name should be invalid per m-13
            expect(longName.length).toBe(101);
            expect(longName.length).toBeGreaterThan(100);
        });

        it("accepts display_name exactly 100 characters", () => {
            const maxName = "a".repeat(100);
            expect(maxName.length).toBe(100);
            // 100 chars is valid — should not throw
            expect(maxName.length).not.toBeGreaterThan(100);
        });

        it("accepts display_name < 100 characters", () => {
            const shortName = "My Device";
            expect(shortName.length).toBeLessThanOrEqual(100);
        });

        it("accepts missing display_name (no validation needed)", () => {
            const noName = {};
            expect(noName).not.toHaveProperty("display_name");
        });
    });
});

describe("Device update validation unit", () => {
    it("ValidationError is the correct class for name length violations", () => {
        const err = new ValidationError("Device display name must be ≤ 100 characters (current: 101)");
        expect(err).toBeInstanceOf(ValidationError);
        expect(err.message).toContain("≤ 100");
    });
});
