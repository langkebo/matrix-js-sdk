import { describe, expect, it } from "vitest";

import { buildSendEventPath } from "../../src/client-send-paths.ts";

describe("client send paths helpers", () => {
    it("builds regular send event path", () => {
        const path = buildSendEventPath({
            roomId: "!room:example.org",
            eventType: "m.room.message",
            txnId: "t1",
            isState: false,
            isRedaction: false,
        });
        expect(path).toBe("/rooms/!room%3Aexample.org/send/m.room.message/t1");
    });

    it("builds state event path", () => {
        const path = buildSendEventPath({
            roomId: "!room:example.org",
            eventType: "m.room.topic",
            txnId: "t2",
            isState: true,
            stateKey: "",
            isRedaction: false,
        });
        expect(path).toBe("/rooms/!room%3Aexample.org/state/m.room.topic");
    });

    it("builds state event path with state key", () => {
        const path = buildSendEventPath({
            roomId: "!room:example.org",
            eventType: "m.room.member",
            txnId: "t3",
            isState: true,
            stateKey: "@alice:example.org",
            isRedaction: false,
        });
        expect(path).toBe("/rooms/!room%3Aexample.org/state/m.room.member/%40alice%3Aexample.org");
    });

    it("builds redaction path", () => {
        const path = buildSendEventPath({
            roomId: "!room:example.org",
            eventType: "m.room.redaction",
            txnId: "t4",
            isState: false,
            isRedaction: true,
            redactsEventId: "$target:event.org",
        });
        expect(path).toBe("/rooms/!room%3Aexample.org/redact/%24target%3Aevent.org/t4");
    });
});
