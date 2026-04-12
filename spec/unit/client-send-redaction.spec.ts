import { describe, expect, it } from "vitest";

import { buildRedactEventContent } from "../../src/client-send-redaction.ts";
import { RelationType } from "../../src/@types/event.ts";
import { ServerSupport } from "../../src/feature.ts";

describe("client send redaction helper", () => {
    const relationPropertyNames = {
        stable: "m.relates_to_types",
        unstable: "org.matrix.msc3912.with_relations",
    };

    it("returns a plain reason-only body when no relation filter is requested", () => {
        expect(
            buildRedactEventContent({
                opts: { reason: "cleanup" },
                relationBasedRedactionsSupport: ServerSupport.Unsupported,
                relationPropertyNames,
                roomId: "!room:example.org",
                eventId: "$event:example.org",
                txnId: "txn-1",
                threadId: null,
            }),
        ).toEqual({ reason: "cleanup" });
    });

    it("throws when relation-based redactions are unsupported", () => {
        expect(() =>
            buildRedactEventContent({
                opts: { with_rel_types: [RelationType.Reference] },
                relationBasedRedactionsSupport: ServerSupport.Unsupported,
                relationPropertyNames,
                roomId: "!room:example.org",
                eventId: "$event:example.org",
                txnId: "txn-1",
                threadId: null,
            }),
        ).toThrow(
            "Server does not support relation based redactions roomId !room:example.org eventId $event:example.org txnId: txn-1 threadId null",
        );
    });

    it("uses the stable relation property when the server reports stable support", () => {
        expect(
            buildRedactEventContent({
                opts: { reason: "cleanup", with_rel_types: [RelationType.Reference] },
                relationBasedRedactionsSupport: ServerSupport.Stable,
                relationPropertyNames,
                roomId: "!room:example.org",
                eventId: "$event:example.org",
                txnId: "txn-1",
                threadId: null,
            }),
        ).toEqual({ "reason": "cleanup", "m.relates_to_types": ["m.reference"] });
    });

    it("uses the unstable relation property when the server reports unstable support", () => {
        expect(
            buildRedactEventContent({
                opts: { reason: "cleanup", with_rel_types: [RelationType.Reference] },
                relationBasedRedactionsSupport: ServerSupport.Unstable,
                relationPropertyNames,
                roomId: "!room:example.org",
                eventId: "$event:example.org",
                txnId: "txn-1",
                threadId: "$thread:example.org",
            }),
        ).toEqual({ "reason": "cleanup", "org.matrix.msc3912.with_relations": ["m.reference"] });
    });
});
