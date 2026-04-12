import { describe, expect, it, vi } from "vitest";

import {
    buildStateEventPath,
    dispatchDelayedStateEventRequest,
    dispatchStateEventRequest,
} from "../../src/client-send-state.ts";
import { Method } from "../../src/http-api/method.ts";

describe("client send state helper", () => {
    it("builds state event paths for empty and explicit state keys", () => {
        expect(buildStateEventPath("!room:example.org", "m.room.topic", "")).toBe(
            "/rooms/!room%3Aexample.org/state/m.room.topic/",
        );
        expect(buildStateEventPath("!room:example.org", "m.room.member", "@alice:example.org")).toBe(
            "/rooms/!room%3Aexample.org/state/m.room.member/%40alice%3Aexample.org",
        );
    });

    it("dispatches a regular state event request", async () => {
        const http = {
            authedRequest: vi.fn().mockResolvedValue({ event_id: "$state-1" }),
        };

        await expect(
            dispatchStateEventRequest({
                roomId: "!room:example.org",
                eventType: "m.room.topic",
                content: { topic: "hello" },
                stateKey: "",
                http,
            }),
        ).resolves.toEqual({ event_id: "$state-1" });

        expect(http.authedRequest).toHaveBeenCalledWith(
            Method.Put,
            "/rooms/!room%3Aexample.org/state/m.room.topic/",
            undefined,
            { topic: "hello" },
            {},
        );
    });

    it("builds a delayed state event request with a trailing slash for empty state keys", async () => {
        const http = {
            authedRequest: vi.fn().mockResolvedValue({ delay_id: "delay-1" }),
        };

        await expect(
            dispatchDelayedStateEventRequest({
                roomId: "!room:example.org",
                eventType: "m.room.topic",
                content: { topic: "hello" },
                stateKey: "",
                delayOpts: { delay: 2000 },
                http,
                unstableDelayFeatureName: "org.matrix.msc4140",
            }),
        ).resolves.toEqual({ delay_id: "delay-1" });

        expect(http.authedRequest).toHaveBeenCalledWith(
            Method.Put,
            "/rooms/!room%3Aexample.org/state/m.room.topic/",
            { "org.matrix.msc4140.delay": 2000 },
            { topic: "hello" },
            {},
        );
    });

    it("builds a delayed state event request with an explicit state key and request options", async () => {
        const http = {
            authedRequest: vi.fn().mockResolvedValue({ delay_id: "delay-2" }),
        };

        await dispatchDelayedStateEventRequest({
            roomId: "!room:example.org",
            eventType: "m.room.member",
            content: { membership: "join" },
            stateKey: "@alice:example.org",
            delayOpts: { parent_delay_id: "parent-1" },
            http,
            requestOpts: { prefix: "/_matrix/client/v3" } as any,
            unstableDelayFeatureName: "org.matrix.msc4140",
        });

        expect(http.authedRequest).toHaveBeenCalledWith(
            Method.Put,
            "/rooms/!room%3Aexample.org/state/m.room.member/%40alice%3Aexample.org",
            { "org.matrix.msc4140.parent_delay_id": "parent-1" },
            { membership: "join" },
            { prefix: "/_matrix/client/v3" },
        );
    });
});
