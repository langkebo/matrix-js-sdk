import { describe, expect, it } from "vitest";

import { assertExtendedProfileSupported } from "../../src/client-profile-core.ts";

describe("client profile core helpers", () => {
    it("does nothing when extended profile is supported", () => {
        expect(() => assertExtendedProfileSupported(true)).not.toThrow();
    });

    it("throws when extended profile is not supported", () => {
        expect(() => assertExtendedProfileSupported(false)).toThrow("Server does not support extended profiles");
    });
});
