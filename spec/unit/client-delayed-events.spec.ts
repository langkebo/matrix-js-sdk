import { describe, expect, it } from "vitest";

import {
    buildDelayedEventsActionPath,
    buildDelayedEventsPath,
    buildDelayedEventsQuery,
    buildUnstableFeaturePrefix,
} from "../../src/client-delayed-events.ts";
import { UpdateDelayedEventAction } from "../../src/@types/requests.ts";

describe("client delayed-events helpers", () => {
    it("builds unstable feature prefix", () => {
        expect(buildUnstableFeaturePrefix("org.matrix.msc4140")).toBe("/_matrix/client/unstable/org.matrix.msc4140");
    });

    it("builds delayed events query", () => {
        expect(buildDelayedEventsQuery("scheduled", ["d1", "d2"], "tok")).toEqual({
            from: "tok",
            status: "scheduled",
            delay_id: ["d1", "d2"],
        });
    });

    it("builds delayed events action path", () => {
        expect(buildDelayedEventsActionPath("delay/1", UpdateDelayedEventAction.Cancel)).toBe(
            "/delayed_events/delay%2F1/cancel",
        );
    });

    it("builds delayed events path", () => {
        expect(buildDelayedEventsPath("delay/2")).toBe("/delayed_events/delay%2F2");
    });
});
