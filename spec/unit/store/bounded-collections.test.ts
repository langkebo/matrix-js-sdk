/*
Copyright 2025 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStore } from "../../../src/store/memory";
import { EventStatus } from "../../../src/models/event-status";
import { MatrixEvent } from "../../../src/models/event";
import { EventTimelineSet } from "../../../src/models/event-timeline-set";
import { Room } from "../../../src/models/room";
import { type MatrixClient, PendingEventOrdering } from "../../../src/client";

const USER_ID = "@user:example.org";

function createMockClient(): MatrixClient {
    return {
        supportsThreads: vi.fn().mockReturnValue(false),
        decryptEventIfNeeded: vi.fn().mockResolvedValue(undefined),
        getUserId: vi.fn().mockReturnValue(USER_ID),
        getEventMapper: vi.fn().mockReturnValue((event: Partial<{ event_id: string; type: string; content: Record<string, unknown>; sender: string }>) => new MatrixEvent(event)),
        store: {
            getPendingEvents: vi.fn().mockResolvedValue([]),
            setPendingEvents: vi.fn().mockResolvedValue(undefined),
            savePendingEvents: vi.fn().mockResolvedValue(undefined),
        },
    } as unknown as MatrixClient;
}

describe("ISSUE-11b bounded collections", () => {
    describe("Part 1: NOT_SENT timeout eviction", () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });
        afterEach(() => {
            vi.useRealTimers();
        });

        function makeNotSentEvent(eventId: string, txnId: string): MatrixEvent {
            const event = new MatrixEvent({
                type: "m.room.message",
                content: { body: "fail-prone" },
                event_id: eventId,
                sender: USER_ID,
                txn_id: txnId,
            });
            event.setStatus(EventStatus.NOT_SENT);
            return event;
        }

        it("auto-cancels NOT_SENT events after the configured timeout", () => {
            const client = createMockClient();
            const room = new Room("!room:example.org", client, USER_ID, {
                pendingEventOrdering: PendingEventOrdering.Detached,
                pendingEventNotSentTimeoutMs: 10_000, // 10s
            });

            const event = makeNotSentEvent("$ev1:server", "txn1");
            room.addPendingEvent(event, "txn1");

            // Sanity: event is in the pending list with NOT_SENT status
            expect(room.getPendingEvents()).toHaveLength(1);
            expect(room.getPendingEvents()[0].status).toBe(EventStatus.NOT_SENT);

            // Advance past the sweep interval (60s) so the sweep runs at least once
            // with the event older than the timeout (10s).
            vi.advanceTimersByTime(60_000);

            // Event should have been auto-cancelled and removed from the pending list
            expect(room.getPendingEvents()).toHaveLength(0);

            // dispose timer so the test doesn't leak
            room.disposeNotSentSweepTimer();
        });

        it("does not cancel NOT_SENT events when timeout is 0 (disabled)", () => {
            const client = createMockClient();
            const room = new Room("!room:example.org", client, USER_ID, {
                pendingEventOrdering: PendingEventOrdering.Detached,
                pendingEventNotSentTimeoutMs: 0, // disabled
            });

            const event = makeNotSentEvent("$ev2:server", "txn2");
            room.addPendingEvent(event, "txn2");

            expect(room.getPendingEvents()).toHaveLength(1);

            // Advance well beyond the default 24h timeout
            vi.advanceTimersByTime(120_000);

            // Still there — timer was never started
            expect(room.getPendingEvents()).toHaveLength(1);
            expect(room.getPendingEvents()[0].status).toBe(EventStatus.NOT_SENT);

            room.disposeNotSentSweepTimer();
        });

        it("leaves non-NOT_SENT pending events alone", () => {
            const client = createMockClient();
            const room = new Room("!room:example.org", client, USER_ID, {
                pendingEventOrdering: PendingEventOrdering.Detached,
                pendingEventNotSentTimeoutMs: 1_000,
            });

            const sendingEvent = new MatrixEvent({
                type: "m.room.message",
                content: { body: "in flight" },
                event_id: "$ev3:server",
                sender: USER_ID,
                txn_id: "txn3",
            });
            sendingEvent.setStatus(EventStatus.SENDING);
            room.addPendingEvent(sendingEvent, "txn3");

            // addPendingEvent forces NOT_SENT if any sibling is NOT_SENT — keep one SENDING-only case.
            vi.advanceTimersByTime(60_000);

            // SENDING event is untouched by the sweep
            expect(room.getPendingEvents()).toHaveLength(1);
            expect(room.getPendingEvents()[0].status).toBe(EventStatus.SENDING);

            room.disposeNotSentSweepTimer();
        });
    });

    describe("Part 2: MemoryStore pendingEvents cap", () => {
        it("caps pendingEvents at MAX_PENDING_EVENTS_PER_ROOM (100)", async () => {
            const store = new MemoryStore();
            const roomId = "!room:server";
            const events = Array.from({ length: 200 }, (_, i) => ({
                type: "m.room.message",
                content: { body: String(i) },
            }));
            await store.setPendingEvents(roomId, events as any);

            const result = await store.getPendingEvents(roomId);
            expect(result.length).toBe(100);
            // LRU: should keep the most recent 100 (i.e. events 100..199)
            expect((result[0].content as any).body).toBe("100");
            expect((result[99].content as any).body).toBe("199");
        });

        it("leaves pendingEvents under the cap untouched", async () => {
            const store = new MemoryStore();
            const roomId = "!room:server";
            const events = Array.from({ length: 50 }, (_, i) => ({
                type: "m.room.message",
                content: { body: String(i) },
            }));
            await store.setPendingEvents(roomId, events as any);
            const result = await store.getPendingEvents(roomId);
            expect(result.length).toBe(50);
        });
    });

    describe("Part 2: MemoryStore oobMembers cap", () => {
        it("caps oobMembers rooms at MAX_OOB_MEMBERS_ROOMS (50) with LRU eviction", async () => {
            const store = new MemoryStore();
            for (let i = 0; i < 60; i++) {
                await store.setOutOfBandMembers(`!room${i}:server`, [
                    { type: "m.room.member", content: { membership: "join" } } as any,
                ]);
            }
            // Internal map should be capped at 50
            // @ts-expect-error accessing private field for test
            expect(store.oobMembers.size).toBe(50);
            // The first 10 rooms should have been evicted (oldest)
            // @ts-expect-error accessing private field for test
            expect(store.oobMembers.has("!room0:server")).toBe(false);
            // @ts-expect-error accessing private field for test
            expect(store.oobMembers.has("!room9:server")).toBe(false);
            // @ts-expect-error accessing private field for test
            expect(store.oobMembers.has("!room10:server")).toBe(true);
            // @ts-expect-error accessing private field for test
            expect(store.oobMembers.has("!room59:server")).toBe(true);
        });
    });

    describe("Part 3: cleanupOldEvents covers thread timelines", () => {
        it("trims thread timeline events over maxTimelineEvents", () => {
            const client = createMockClient();
            const room = new Room("!room:example.org", client, USER_ID, {
                maxTimelineEvents: 5,
            });

            // Build a fake EventTimelineSet whose live timeline holds 10 events.
            const fakeTimeline = {
                getEvents: () => eventsArr,
            };
            const eventsArr: MatrixEvent[] = Array.from({ length: 10 }, (_, i) => {
                return new MatrixEvent({
                    type: "m.room.message",
                    content: { body: `t${i}` },
                    event_id: `$thread-ev${i}:server`,
                    sender: USER_ID,
                });
            });
            const fakeThreadTimelineSet = {
                getLiveTimeline: () => fakeTimeline,
            } as unknown as EventTimelineSet;

            // Inject into threadsTimelineSets (tuple, starts as []).
            // Cast to any to bypass the tuple type guard.
            (room as any).threadsTimelineSets = [fakeThreadTimelineSet, fakeThreadTimelineSet];

            // Trigger cleanupOldEvents (private). Cast to any for direct call.
            (room as any).cleanupOldEvents();

            // The thread timeline should have been trimmed to 5 events
            expect(eventsArr.length).toBe(5);
            // Newest 5 kept (t5..t9)
            expect((eventsArr[0].getContent() as any).body).toBe("t5");
            expect((eventsArr[4].getContent() as any).body).toBe("t9");
        });

        it("does not throw when threadsTimelineSets is empty (uninitialised)", () => {
            const client = createMockClient();
            const room = new Room("!room:example.org", client, USER_ID, {
                maxTimelineEvents: 5,
            });
            // threadsTimelineSets defaults to []
            expect(() => (room as any).cleanupOldEvents()).not.toThrow();
        });
    });
});
