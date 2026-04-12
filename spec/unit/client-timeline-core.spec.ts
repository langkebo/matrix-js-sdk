import { describe, expect, it, vi } from "vitest";

import { Direction } from "../../src/models/event-timeline.ts";
import { MatrixEvent } from "../../src/models/event.ts";
import {
    applyUnknownStateEvents,
    deriveBackPaginationTokenFromMessages,
    mapStateAndChunkFromMessages,
    mapSafeEvents,
    normalizeEventContextResponse,
    paginateNotificationsWithRequest,
    stopBackPaginationIfNeeded,
    trackPaginationRequest,
} from "../../src/client-timeline-core.ts";

describe("client timeline core helpers", () => {
    it("normalizes /context response and defaults optional arrays", () => {
        const normalized = normalizeEventContextResponse({
            start: "s",
            end: "e",
            event: { room_id: "!r:example.org", type: "m.room.message", content: {}, event_id: "$e" } as any,
        });

        expect(normalized.event).toBeDefined();
        expect(normalized.events_after).toEqual([]);
        expect(normalized.events_before).toEqual([]);
        expect(normalized.state).toEqual([]);
        expect(normalized.start).toBe("s");
        expect(normalized.end).toBe("e");
    });

    it("throws if /context response is missing event", () => {
        expect(() => normalizeEventContextResponse({})).toThrow("'event' not in '/context' result");
    });

    it("tracks pagination request and clears after completion", async () => {
        const holder = {
            paginationRequests: {
                [Direction.Backward]: null,
                [Direction.Forward]: null,
            },
        };

        const req = Promise.resolve(true);
        const wrapped = trackPaginationRequest(holder, Direction.Backward, req);
        expect(holder.paginationRequests[Direction.Backward]).toBe(wrapped);
        await wrapped;
        expect(holder.paginationRequests[Direction.Backward]).toBeNull();
    });

    it("maps safe events via predicate and mapper", () => {
        const input = [{ ok: true }, { ok: false }, { ok: true }];
        const out = mapSafeEvents(
            input,
            (e) => e.ok,
            (e) => (e.ok ? 1 : 0),
        );
        expect(out).toEqual([1, 1]);
    });

    it("maps state and chunk from messages in one helper", () => {
        const mapper = (e: any) => new MatrixEvent({ type: e.type, content: e.content });
        const { matrixEvents, stateEvents } = mapStateAndChunkFromMessages(
            {
                chunk: [
                    { ok: true, type: "m.room.message", content: { body: "a" } },
                    { ok: false, type: "m.room.message", content: { body: "b" } },
                ],
                state: [{ ok: true, type: "m.room.name", content: { name: "r" } }],
            },
            (e: any) => e.ok === true,
            mapper,
        );
        expect(matrixEvents).toHaveLength(1);
        expect(stateEvents).toHaveLength(1);
    });

    it("derives back pagination token and end condition consistently", () => {
        expect(
            deriveBackPaginationTokenFromMessages({
                start: "t0",
                end: "t1",
                chunk: [{} as any],
            } as any),
        ).toBe("t1");
        expect(
            deriveBackPaginationTokenFromMessages({
                start: "t0",
                end: "t0",
                chunk: [{} as any],
            } as any),
        ).toBeNull();
        expect(
            deriveBackPaginationTokenFromMessages({
                start: "t0",
                end: "t1",
                chunk: [],
            } as any),
        ).toBeNull();
    });

    it("applies unknown state events when state is present", () => {
        const setUnknownStateEvents = vi.fn();
        const holder = {
            getState: vi.fn().mockReturnValue({ setUnknownStateEvents }),
        };

        const mapper = (e: any) => new MatrixEvent({ type: e.type, content: e.content });
        applyUnknownStateEvents(
            holder,
            Direction.Backward,
            [{ ok: true, type: "m.test", content: {} }],
            (e) => e.ok,
            mapper,
        );

        expect(holder.getState).toHaveBeenCalledWith(Direction.Backward);
        expect(setUnknownStateEvents).toHaveBeenCalledWith([expect.any(MatrixEvent)]);
    });

    it("stops back pagination when at end", () => {
        const holder = { setPaginationToken: vi.fn() };
        stopBackPaginationIfNeeded(holder, Direction.Backward, true, true);
        expect(holder.setPaginationToken).toHaveBeenCalledWith(null, Direction.Backward);
    });

    it("paginates notifications and returns true when next token exists", async () => {
        const holder = {
            paginationRequests: {
                [Direction.Backward]: null,
                [Direction.Forward]: null,
            },
            setPaginationToken: vi.fn(),
        };

        const result = await paginateNotificationsWithRequest({
            eventTimeline: holder,
            dir: Direction.Backward,
            backwards: true,
            request: Promise.resolve({
                notifications: [],
                next_token: "next",
            } as any),
            onSuccess: (res) => res.next_token,
        });

        expect(result).toBe(true);
        expect(holder.setPaginationToken).not.toHaveBeenCalled();
    });

    it("paginates notifications and stops back pagination when next token is missing", async () => {
        const holder = {
            paginationRequests: {
                [Direction.Backward]: null,
                [Direction.Forward]: null,
            },
            setPaginationToken: vi.fn(),
        };

        const result = await paginateNotificationsWithRequest({
            eventTimeline: holder,
            dir: Direction.Backward,
            backwards: true,
            request: Promise.resolve({
                notifications: [],
                next_token: undefined,
            } as any),
            onSuccess: () => null,
        });

        expect(result).toBe(false);
        expect(holder.setPaginationToken).toHaveBeenCalledWith(null, Direction.Backward);
    });
});
