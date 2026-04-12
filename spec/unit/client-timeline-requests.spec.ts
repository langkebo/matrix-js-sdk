import { describe, expect, it } from "vitest";

import { Direction } from "../../src/models/event-timeline.ts";
import {
    buildEventContextParams,
    buildEventContextPath,
    buildMessagesRequestParams,
    buildMessagesRequestPath,
    buildThreadListRequestParams,
    buildThreadListRequestPath,
} from "../../src/client-timeline-requests.ts";

describe("client timeline request helpers", () => {
    it("builds messages and thread list paths", () => {
        expect(buildMessagesRequestPath("!room:example.org")).toBe("/rooms/!room%3Aexample.org/messages");
        expect(buildThreadListRequestPath("!room:example.org")).toBe("/rooms/!room%3Aexample.org/threads");
    });

    it("builds event context path and params", () => {
        expect(buildEventContextPath("!room:example.org", "$event:example.org")).toBe(
            "/rooms/!room%3Aexample.org/context/%24event%3Aexample.org",
        );
        expect(buildEventContextParams(false)).toEqual({ limit: "0" });
        expect(buildEventContextParams(true)).toEqual({
            limit: "0",
            filter: '{"lazy_load_members":true}',
        });
    });

    it("builds /messages params with lazy-load and timeline filter merge", () => {
        const params = buildMessagesRequestParams({
            fromToken: "tok",
            limit: 30,
            dir: Direction.Backward,
            lazyLoadMembers: true,
            timelineFilter: { not_types: ["m.reaction"] },
        });

        expect(params.limit).toBe("30");
        expect(params.dir).toBe(Direction.Backward);
        expect(params.from).toBe("tok");
        expect(params.filter).toBe('{"lazy_load_members":true,"not_types":["m.reaction"]}');
    });

    it("builds /threads params and skips empty filter", () => {
        const params = buildThreadListRequestParams({
            fromToken: null,
            limit: 10,
            dir: Direction.Forward,
            include: "all",
            lazyLoadMembers: false,
        });

        expect(params).toEqual({
            limit: "10",
            dir: Direction.Forward,
            include: "all",
        });
    });
});
