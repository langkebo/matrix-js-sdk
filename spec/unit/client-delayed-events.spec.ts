import { describe, expect, it } from "vitest";

import { buildDelayedEventsPath, buildUnstableFeaturePrefix } from "../../src/client-delayed-events.ts";
import type { SendDelayedEventResponse } from "../../src/@types/requests.ts";

describe("client delayed-events helpers", () => {
    it("builds unstable feature prefix", () => {
        expect(buildUnstableFeaturePrefix("org.matrix.msc4140")).toBe("/_matrix/client/unstable/org.matrix.msc4140");
    });

    it("builds delayed events path", () => {
        expect(buildDelayedEventsPath("delay/2")).toBe("/delayed_events/delay%2F2");
    });

    // FT-084/FT-101: 后端 delay_id 为 i64 (JSON number)，路径构建须接受 number
    it("builds delayed events path with number delayId (FT-084/FT-101)", () => {
        expect(buildDelayedEventsPath(12345)).toBe("/delayed_events/12345");
    });
});

// FT-101: SendDelayedEventResponse 类型契约验证
describe("SendDelayedEventResponse type contract (FT-101)", () => {
    it("should accept delay_id as number (backend i64)", () => {
        // 后端返回 {"delay_id": 12345, "event_id": "$xxx:server"}
        const response: SendDelayedEventResponse = { delay_id: 12345, event_id: "$event:matrix.test" };
        expect(response.delay_id).toBe(12345);
        expect(response.event_id).toBe("$event:matrix.test");
    });

    it("should accept delay_id as string (backward compat)", () => {
        const response: SendDelayedEventResponse = { delay_id: "delay-str" };
        expect(response.delay_id).toBe("delay-str");
    });

    it("should allow optional event_id field", () => {
        const response: SendDelayedEventResponse = { delay_id: 99 };
        // event_id 可选，不提供时不应报错
        expect(response.event_id).toBeUndefined();
    });
});
