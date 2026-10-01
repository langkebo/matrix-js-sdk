import { describe, expect, it } from "vitest";

import { buildUnstableDelayQueryOpts } from "../../src/client-internals.ts";

describe("client-internals helpers", () => {
    it("maps delayed event options into unstable query keys", () => {
        const result = buildUnstableDelayQueryOpts({ delay: 10 }, "org.matrix.msc4140");
        expect(result).toEqual({ "org.matrix.msc4140.delay": 10 });
    });
});
