import { describe, expect, it, vi } from "vitest";

import { paginateEventTimelineRequest } from "../../src/client-timeline-pagination.ts";
import { Direction } from "../../src/models/event-timeline.ts";

describe("client timeline pagination helper", () => {
    const baseDeps = {
        notifTimelineSet: null,
        getRoom: vi.fn(),
        createMessagesRequest: vi.fn(),
        createThreadListMessagesRequest: vi.fn(),
        fetchRelations: vi.fn(),
        fetchRoomEvent: vi.fn(),
        getEventMapper: vi.fn(),
        getPushDetailsForEvent: vi.fn(),
        processPaginationEvents: vi.fn(),
        requestNotifications: vi.fn(),
        canSupportRelationsRecursion: false,
    };

    it("returns existing pending pagination request", async () => {
        const pending = Promise.resolve(true);
        const timelineSet = { threadListType: null, thread: null };
        const eventTimeline = {
            getTimelineSet: () => timelineSet,
            getRoomId: () => "!room:example.org",
            getPaginationToken: () => "tok",
            paginationRequests: {
                [Direction.Backward]: pending,
                [Direction.Forward]: null,
            },
            getFilter: () => undefined,
        };

        const result = paginateEventTimelineRequest(eventTimeline as any, { backwards: true }, { ...baseDeps });
        await expect(result).resolves.toBe(true);
        expect(result).toBe(pending);
    });

    it("throws when notifications timeline paginates forwards", () => {
        const notifTimelineSet = { threadListType: null, thread: null };
        const eventTimeline = {
            getTimelineSet: () => notifTimelineSet,
            getRoomId: () => "!room:example.org",
            getPaginationToken: () => null,
            paginationRequests: {
                [Direction.Backward]: null,
                [Direction.Forward]: null,
            },
            getFilter: () => undefined,
        };

        expect(() =>
            paginateEventTimelineRequest(
                eventTimeline as any,
                { backwards: false },
                {
                    ...baseDeps,
                    notifTimelineSet: notifTimelineSet as any,
                },
            ),
        ).toThrow("paginateNotifTimeline can only paginate backwards");
    });

    it("throws for unknown room on regular message pagination", () => {
        const timelineSet = { threadListType: null, thread: null };
        const eventTimeline = {
            getTimelineSet: () => timelineSet,
            getRoomId: () => "!missing:example.org",
            getPaginationToken: () => null,
            paginationRequests: {
                [Direction.Backward]: null,
                [Direction.Forward]: null,
            },
            getFilter: () => undefined,
        };

        expect(() =>
            paginateEventTimelineRequest(
                eventTimeline as any,
                { backwards: true },
                {
                    ...baseDeps,
                    getRoom: () => null,
                },
            ),
        ).toThrow("Unknown room !missing:example.org");
    });
});
