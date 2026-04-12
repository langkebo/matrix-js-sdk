import { describe, expect, it } from "vitest";

import { buildUnstableDelayQueryOpts, getLegacyClientPrefix } from "../../src/client-internals.ts";

describe("client-internals helpers", () => {
    it("returns the expected legacy prefix", () => {
        expect(getLegacyClientPrefix("v1")).toBe("/_matrix/client/v1");
        expect(getLegacyClientPrefix("r0")).toBe("/_matrix/client/r0");
    });

    it("maps delayed event options into unstable query keys", () => {
        const result = buildUnstableDelayQueryOpts({ delay: 10 }, "org.matrix.msc4140");
        expect(result).toEqual({ "org.matrix.msc4140.delay": 10 });
    });
});
