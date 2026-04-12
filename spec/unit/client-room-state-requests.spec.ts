import { describe, expect, it } from "vitest";

import { buildRoomStatePath, buildStateEventPath } from "../../src/client-batch-requests.ts";

describe("client room state request helpers", () => {
    it("builds room state path", () => {
        expect(buildRoomStatePath("!room:example.org")).toBe("/rooms/!room%3Aexample.org/state");
    });

    it("builds state event path with and without state key", () => {
        expect(buildStateEventPath("!room:example.org", "m.room.topic", "")).toBe(
            "/rooms/!room%3Aexample.org/state/m.room.topic/",
        );
        expect(buildStateEventPath("!room:example.org", "m.room.member", "@alice:example.org")).toBe(
            "/rooms/!room%3Aexample.org/state/m.room.member/%40alice%3Aexample.org",
        );
        expect(buildStateEventPath("!room:example.org", "m.room.topic")).toBe(
            "/rooms/!room%3Aexample.org/state/m.room.topic",
        );
    });
});
