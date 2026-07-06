import { describe, expect, it, beforeEach, vi } from "vitest";

import { FakeTransport } from "../test-utils/FakeTransport";
import { EventManager, EventManagerEvent } from "../../src/event/EventManager";
import { Method } from "../../src/http-api/method";
import { InvalidParamError, ValidationError } from "../../src/errors";
import { MatrixEvent, EventStatus } from "../../src/models/event";
import { Room } from "../../src/models/room";
import { Direction } from "../../src/models/event-timeline";
import { ThreadFilterType } from "../../src/models/thread";

describe("EventManager", () => {
    let transport: FakeTransport;
    let manager: EventManager;
    let mockClient: any;

    const roomId = "!test:example.org";
    const eventId = "$event123";

    beforeEach(() => {
        transport = new FakeTransport();
        mockClient = {
            getRoom: vi.fn(),
            http: { authedRequest: vi.fn() },
        };
        manager = new EventManager(mockClient, { transport });
    });

    // ==================== getMessages ====================

    describe("getMessages", () => {
        it("validates roomId", async () => {
            await expect(manager.getMessages("", { from: "t1", dir: "b" })).rejects.toThrow(ValidationError);
        });

        it("sends GET with required params", async () => {
            const response = { chunk: [], start: "s1", end: "e1" };
            transport.respondWith(response);

            const result = await manager.getMessages(roomId, { from: "token1", dir: "b" });

            expect(result).toEqual(response);
            expect(transport.request).toHaveBeenCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent(roomId)}/messages`,
                { from: "token1", dir: "b" },
                undefined,
                expect.objectContaining({ prefix: "/_matrix/client/v3" }),
            );
        });

        it("includes optional params", async () => {
            transport.respondWith({ chunk: [], start: "s1" });
            await manager.getMessages(roomId, {
                from: "t1",
                dir: "f",
                to: "t2",
                limit: 10,
                filter: { types: ["m.room.message"] },
            });

            const queryParams = transport.request.mock.calls[0][2] as Record<string, unknown>;
            expect(queryParams).toMatchObject({
                from: "t1",
                dir: "f",
                to: "t2",
                limit: "10",
            });
            expect(queryParams.filter).toBeDefined();
        });
    });

    // ==================== createMessagesRequest ====================

    describe("createMessagesRequest", () => {
        it("validates roomId", () => {
            expect(() => manager.createMessagesRequest("", null, 30, Direction.Backward)).toThrow(ValidationError);
        });

        it("sends GET to messages endpoint", async () => {
            transport.respondWith({ chunk: [], start: "s", end: "e" });
            await manager.createMessagesRequest(roomId, "fromTok", 20, Direction.Backward);
            expect(transport.request).toHaveBeenCalled();
            transport.expectCalledWith(Method.Get, `/rooms/${encodeURIComponent(roomId)}/messages`);
        });
    });

    // ==================== createThreadListMessagesRequest ====================

    describe("createThreadListMessagesRequest", () => {
        it("validates roomId", async () => {
            await expect(manager.createThreadListMessagesRequest("", null)).rejects.toThrow(ValidationError);
        });

        it("sends GET to thread list endpoint", async () => {
            transport.respondWith({ chunk: [], prev_batch: "p1", next_batch: "n1" });
            const result = await manager.createThreadListMessagesRequest(
                roomId, "tok", 10, Direction.Backward, ThreadFilterType.All,
            );
            expect(result.chunk).toEqual([]);
            expect(result.start).toBe("p1");
            expect(result.end).toBe("n1");
        });
    });

    // ==================== sendEvent (simple path) ====================

    describe("sendEvent", () => {
        it("validates roomId", async () => {
            await expect(manager.sendEvent("", "m.room.message", {})).rejects.toThrow(ValidationError);
        });

        it("validates eventType is required", async () => {
            await expect(manager.sendEvent(roomId, "", {})).rejects.toThrow(InvalidParamError);
        });

        it("sends PUT with generated txnId and emits EventSent", async () => {
            const response = { event_id: "$newEvent" };
            transport.respondWith(response);
            const emitSpy = vi.spyOn(manager, "emit");

            const result = await manager.sendEvent(roomId, "m.room.message", { body: "hello" });

            expect(result).toEqual(response);
            expect(emitSpy).toHaveBeenCalledWith(EventManagerEvent.EventSent, roomId, "$newEvent");
            expect(transport.request).toHaveBeenCalledWith(
                Method.Put,
                expect.stringMatching(/\/rooms\/.*\/send\/m\.room\.message\/m\d+/),
                undefined,
                { body: "hello" },
                expect.objectContaining({ prefix: "/_matrix/client/v3" }),
            );
        });

        it("uses provided txnId when given", async () => {
            transport.respondWith({ event_id: "$ev" });
            await manager.sendEvent(roomId, "m.room.message", {}, "my-txn-id");
            const path = transport.request.mock.calls[0][1];
            expect(path).toContain("my-txn-id");
        });
    });

    // ==================== getState ====================

    describe("getState", () => {
        it("validates roomId", async () => {
            await expect(manager.getState("")).rejects.toThrow(ValidationError);
        });

        it("fetches and caches state events", async () => {
            const state = [{ type: "m.room.name", state_key: "", content: { name: "Test" } }];
            transport.respondWith(state);

            const result1 = await manager.getState(roomId);
            expect(result1).toEqual(state);

            // Second call should use cache — but since FakeTransport returns same,
            // verify the endpoint was called only once
            expect(transport.request).toHaveBeenCalledTimes(1);

            await manager.getState(roomId);
            // Still 1 — cached
            expect(transport.request).toHaveBeenCalledTimes(1);
        });

        it("bypasses cache when forceRefresh is true", async () => {
            transport.respondWith([{ type: "m.room.name", state_key: "", content: {} }]);
            await manager.getState(roomId, true);
            await manager.getState(roomId, true);
            expect(transport.request).toHaveBeenCalledTimes(2);
        });
    });

    // ==================== getStateEvent ====================

    describe("getStateEvent", () => {
        it("validates roomId", async () => {
            await expect(manager.getStateEvent("", "m.room.name")).rejects.toThrow(ValidationError);
        });

        it("validates eventType is required", async () => {
            await expect(manager.getStateEvent(roomId, "")).rejects.toThrow(InvalidParamError);
        });

        it("fetches a specific state event", async () => {
            transport.respondWith({ name: "Test Room" });
            const result = await manager.getStateEvent(roomId, "m.room.name", "");
            expect(result).toEqual({ name: "Test Room" });
        });

        it("fetches state event without stateKey", async () => {
            transport.respondWith({ name: "Test" });
            await manager.getStateEvent(roomId, "m.room.name");
            expect(transport.request).toHaveBeenCalledTimes(1);
        });
    });

    // ==================== sendStateEvent ====================

    describe("sendStateEvent", () => {
        it("validates roomId", async () => {
            await expect(manager.sendStateEvent("", "m.room.name", {})).rejects.toThrow(ValidationError);
        });

        it("validates eventType is required", async () => {
            await expect(manager.sendStateEvent(roomId, "", {})).rejects.toThrow(InvalidParamError);
        });

        it("sends PUT state event and emits StateChanged", async () => {
            const response = { event_id: "$stateEv" };
            transport.respondWith(response);
            const emitSpy = vi.spyOn(manager, "emit");

            const result = await manager.sendStateEvent(roomId, "m.room.name", { name: "New" }, "");

            expect(result).toEqual(response);
            expect(emitSpy).toHaveBeenCalledWith(EventManagerEvent.StateChanged, roomId, "m.room.name", "");
        });
    });

    // ==================== getEvent ====================

    describe("getEvent", () => {
        it("validates roomId", async () => {
            await expect(manager.getEvent("", eventId)).rejects.toThrow(ValidationError);
        });

        it("validates eventId", async () => {
            await expect(manager.getEvent(roomId, "")).rejects.toThrow(InvalidParamError);
            await expect(manager.getEvent(roomId, "   ")).rejects.toThrow(InvalidParamError);
        });

        it("fetches a single event", async () => {
            const event = { content: { body: "hi" }, type: "m.room.message", event_id: eventId, sender: "@a:ex.com", origin_server_ts: 1000 };
            transport.respondWith(event);
            const result = await manager.getEvent(roomId, eventId);
            expect(result).toEqual(event);
            transport.expectCalledWith(Method.Get, `/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eventId)}`);
        });
    });

    // ==================== getEventContext ====================

    describe("getEventContext", () => {
        it("validates roomId and eventId", async () => {
            await expect(manager.getEventContext("", eventId)).rejects.toThrow(ValidationError);
            await expect(manager.getEventContext(roomId, "")).rejects.toThrow(InvalidParamError);
        });

        it("fetches event context", async () => {
            const response = {
                event: { content: {}, type: "m.room.message", event_id: eventId, sender: "@a:ex.com", origin_server_ts: 1000 },
                events_before: [],
                events_after: [],
                start: "s1",
                end: "e1",
                state: [],
            };
            transport.respondWith(response);
            const result = await manager.getEventContext(roomId, eventId);
            expect(result.event).toBeDefined();
            expect(result.events_before).toEqual([]);
        });

        it("passes limit and filter params", async () => {
            transport.respondWith({
                event: { content: {}, type: "x", event_id: eventId, sender: "@a:ex.com", origin_server_ts: 1000 },
                events_before: [], events_after: [], start: "s", end: "e", state: [],
            });
            await manager.getEventContext(roomId, eventId, { limit: 5, filter: { types: ["m.room.message"] } });
            const queryParams = transport.request.mock.calls[0][2] as Record<string, unknown>;
            expect(queryParams.limit).toBe("5");
            expect(queryParams.filter).toBeDefined();
        });
    });

    // ==================== redactEvent ====================

    describe("redactEvent", () => {
        it("validates roomId and eventId", async () => {
            await expect(manager.redactEvent("", eventId)).rejects.toThrow(ValidationError);
            await expect(manager.redactEvent(roomId, "")).rejects.toThrow(InvalidParamError);
        });

        it("sends PUT to redact and emits EventRedacted", async () => {
            const response = { event_id: "$redaction" };
            transport.respondWith(response);
            const emitSpy = vi.spyOn(manager, "emit");

            const result = await manager.redactEvent(roomId, eventId, "no longer needed");

            expect(result).toEqual(response);
            expect(emitSpy).toHaveBeenCalledWith(EventManagerEvent.EventRedacted, roomId, eventId);
        });

        it("sends empty body when reason is empty string", async () => {
            transport.respondWith({ event_id: "$r" });
            await manager.redactEvent(roomId, eventId, "");
            expect(transport.request.mock.calls[0][3]).toEqual({});
        });

        it("accepts object as reason content", async () => {
            transport.respondWith({ event_id: "$r" });
            await manager.redactEvent(roomId, eventId, { reason: "custom" });
            expect(transport.request.mock.calls[0][3]).toEqual({ reason: "custom" });
        });
    });

    // ==================== resendEvent ====================

    describe("resendEvent", () => {
        it("delegates to deps for resending", async () => {
            const event = new MatrixEvent({ event_id: "$e", type: "m.room.message", content: {} });
            const room = new Room(roomId, mockClient, "@me:ex.com", {});
            const deps = {
                toDeviceMessageQueueSendQueue: vi.fn(),
                updatePendingEventStatus: vi.fn(),
                encryptAndSendEvent: vi.fn().mockResolvedValue({ event_id: "$e" }),
            };

            const result = await manager.resendEvent(event, room, deps);

            expect(deps.toDeviceMessageQueueSendQueue).toHaveBeenCalled();
            expect(deps.updatePendingEventStatus).toHaveBeenCalledWith(room, event, EventStatus.SENDING);
            expect(deps.encryptAndSendEvent).toHaveBeenCalledWith(room, event);
            expect(result).toEqual({ event_id: "$e" });
        });
    });

    // ==================== cancelPendingEvent ====================

    describe("cancelPendingEvent", () => {
        it("throws when event is not in cancellable status", () => {
            const event = new MatrixEvent({ event_id: "$e", type: "m.room.message", content: {} });
            event.status = EventStatus.SENT;

            expect(() => manager.cancelPendingEvent(event, {
                eventsBeingEncrypted: new Set(),
                getRoom: vi.fn(),
                updatePendingEventStatus: vi.fn(),
            })).toThrow("cannot cancel an event with status");
        });

        it("removes event from encryption set when ENCRYPTING", () => {
            const event = new MatrixEvent({ event_id: "$e", type: "m.room.message", content: {} });
            event.status = EventStatus.ENCRYPTING;
            const eventsBeingEncrypted = new Set(["$e"]);
            const updatePendingEventStatus = vi.fn();

            manager.cancelPendingEvent(event, {
                eventsBeingEncrypted,
                getRoom: vi.fn().mockReturnValue(null),
                updatePendingEventStatus,
            });

            expect(eventsBeingEncrypted.has("$e")).toBe(false);
            expect(updatePendingEventStatus).toHaveBeenCalledWith(null, event, EventStatus.CANCELLED);
        });

        it("removes from scheduler queue when QUEUED", () => {
            const event = new MatrixEvent({ event_id: "$e", type: "m.room.message", content: {} });
            event.status = EventStatus.QUEUED;
            const removeFromQueue = vi.fn();
            const updatePendingEventStatus = vi.fn();

            manager.cancelPendingEvent(event, {
                eventsBeingEncrypted: new Set(),
                scheduler: { removeEventFromQueue: removeFromQueue },
                getRoom: vi.fn().mockReturnValue(null),
                updatePendingEventStatus,
            });

            expect(removeFromQueue).toHaveBeenCalledWith(event);
        });

        it("handles NOT_SENT status by updating to CANCELLED", () => {
            const event = new MatrixEvent({ event_id: "$e", type: "m.room.message", content: {} });
            event.status = EventStatus.NOT_SENT;
            const updatePendingEventStatus = vi.fn();

            manager.cancelPendingEvent(event, {
                eventsBeingEncrypted: new Set(),
                getRoom: vi.fn().mockReturnValue(null),
                updatePendingEventStatus,
            });

            expect(updatePendingEventStatus).toHaveBeenCalledWith(null, event, EventStatus.CANCELLED);
        });
    });

    // ==================== decryptEventIfNeeded ====================

    describe("decryptEventIfNeeded", () => {
        it("does nothing for encrypted state events when not enabled", async () => {
            const event = new MatrixEvent({
                event_id: "$e",
                type: "m.room.encrypted",
                state_key: "",
                content: { algorithm: "m.megolm.v1.aes-sha2" },
            });

            const result = await manager.decryptEventIfNeeded(event, {
                enableEncryptedStateEvents: false,
                getCrypto: () => ({}),
                cryptoBackend: {},
            });

            expect(result).toBeUndefined();
        });

        it("does nothing for non-encrypted events", async () => {
            const event = new MatrixEvent({
                event_id: "$e",
                type: "m.room.message",
                content: { body: "hi" },
            });

            const result = await manager.decryptEventIfNeeded(event, {
                enableEncryptedStateEvents: true,
                getCrypto: () => ({}),
                cryptoBackend: {},
            });

            expect(result).toBeUndefined();
        });
    });

    // ==================== sendStateEventWithEncryption ====================

    describe("sendStateEventWithEncryption", () => {
        it("delegates to sendStateEvent when no deps provided", async () => {
            const response = { event_id: "$state" };
            transport.respondWith(response);

            const result = await manager.sendStateEventWithEncryption(roomId, "m.room.name", { name: "R" }, "");

            expect(result).toEqual(response);
            expect(transport.request).toHaveBeenCalledTimes(1);
        });
    });
});
