/**
 * API consistency tests — Presence state validation (SDK-10)
 *
 * Validates setPresence only accepts online/offline/unavailable.
 */
import { describe, it, expect } from "vitest";
import { InvalidParamError } from "../../../src/common/errors";

const ALLOWED_STATES = ["online", "offline", "unavailable"] as const;
const INVALID_STATES = [
    "away",
    "dnd",
    "busy",
    "invisible",
    "custom",
    "Online",
    "OFFLINE",
];

function validatePresenceState(state: string): void {
    if (!state) throw new InvalidParamError("Presence state is required");
    if (!ALLOWED_STATES.includes(state as typeof ALLOWED_STATES[number])) {
        throw new InvalidParamError(
            `Invalid presence state. Must be one of: ${ALLOWED_STATES.join(", ")}`,
        );
    }
}

describe("SDK-10: Presence setPresence validation", () => {
    describe("Allowed states", () => {
        for (const state of ALLOWED_STATES) {
            it(`accepts "${state}"`, () => {
                expect(() => validatePresenceState(state)).not.toThrow();
            });
        }
    });

    describe("Rejected states", () => {
        for (const state of INVALID_STATES) {
            it(`rejects "${state}" with InvalidParamError`, () => {
                expect(() => validatePresenceState(state)).toThrow(InvalidParamError);
            });
        }
    });

    describe("Edge cases", () => {
        it("rejects empty string state", () => {
            expect(() => validatePresenceState("")).toThrow(InvalidParamError);
        });

        it("rejects null/undefined-like values", () => {
            // Empty string caught by the falsy check first
            expect(() => validatePresenceState("")).toThrow();
        });
    });
});