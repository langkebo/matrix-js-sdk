import { describe, expect, it } from "vitest";

import { resolveSendEventRequestArgs } from "../../src/client-send-request.ts";

describe("client send request helpers", () => {
    it("resolves regular query options", () => {
        const args = resolveSendEventRequestArgs({ ts: 1234 });
        expect(args).toEqual({ delayOpts: undefined, queryOpts: { ts: 1234 } });
    });

    it("resolves delayed send options and keeps extra query options", () => {
        const args = resolveSendEventRequestArgs({ delay: 1000 }, { timestamp: 42 });
        expect(args).toEqual({ delayOpts: { delay: 1000 }, queryOpts: { timestamp: 42 } });
    });
});
