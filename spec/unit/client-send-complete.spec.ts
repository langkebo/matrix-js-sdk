/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
    ensureTxnId,
    createLocalEchoEvent,
    attachThreadToLocalEvent,
    setupLocalEventReemit,
    bindPendingRelationTarget,
    formatSendEventDebugMessage,
    addPendingEventOrThrow,
} from "../../src/client-send-complete.ts";
import { EventStatus, MatrixEvent, MatrixEventEvent } from "../../src/models/event.ts";
import type { Room } from "../../src/models/room.ts";
import type { Thread } from "../../src/models/thread.ts";

describe("client-send-complete", () => {
    describe("ensureTxnId", () => {
        it("should return existing txnId when provided", () => {
            const makeTxnId = vi.fn(() => "generated-txn-id");
            const result = ensureTxnId("existing-txn-id", makeTxnId);
            expect(result).toBe("existing-txn-id");
            expect(makeTxnId).not.toHaveBeenCalled();
        });

        it("should generate txnId when not provided", () => {
            const makeTxnId = vi.fn(() => "generated-txn-id");
            const result = ensureTxnId(undefined, makeTxnId);
            expect(result).toBe("generated-txn-id");
            expect(makeTxnId).toHaveBeenCalledTimes(1);
        });

        it("should handle empty string txnId as valid", () => {
            const makeTxnId = vi.fn(() => "generated-txn-id");
            const result = ensureTxnId("", makeTxnId);
            expect(result).toBe("");
            expect(makeTxnId).not.toHaveBeenCalled();
        });
    });

    describe("createLocalEchoEvent", () => {
        it("should create MatrixEvent with provided event object", () => {
            const eventObject = {
                type: "m.room.message",
                content: { body: "test message", msgtype: "m.text" },
            };
            const roomId = "!room:server";
            const userId = "@user:server";
            const txnId = "txn123";

            const event = createLocalEchoEvent(eventObject, roomId, userId, txnId);

            expect(event).toBeInstanceOf(MatrixEvent);
            expect(event.getId()).toBe(`~${roomId}:${txnId}`);
            expect(event.getRoomId()).toBe(roomId);
            expect(event.getSender()).toBe(userId);
            expect(event.getType()).toBe("m.room.message");
        });

        it("should set origin_server_ts to current time", () => {
            const beforeTime = Date.now();
            const event = createLocalEchoEvent({ type: "test" }, "!room:server", "@user:server", "txn123");
            const afterTime = Date.now();
            const ts = event.getTs();
            expect(ts).toBeGreaterThanOrEqual(beforeTime);
            expect(ts).toBeLessThanOrEqual(afterTime);
        });

        it("should override provided event_id with local id", () => {
            const eventObject = {
                type: "test",
                event_id: "original-event-id",
            };
            const event = createLocalEchoEvent(eventObject, "!room:server", "@user:server", "txn123");
            expect(event.getId()).toBe("~!room:server:txn123");
        });

        it("should handle minimal event object", () => {
            const event = createLocalEchoEvent({}, "!room:server", "@user:server", "txn123");
            expect(event).toBeInstanceOf(MatrixEvent);
            expect(event.getRoomId()).toBe("!room:server");
        });
    });

    describe("attachThreadToLocalEvent", () => {
        let mockRoom: Partial<Room>;
        let mockThread: Partial<Thread>;
        let localEvent: MatrixEvent;

        beforeEach(() => {
            mockThread = {};
            mockRoom = {
                getThread: vi.fn().mockReturnValue(mockThread as Thread),
            };
            localEvent = new MatrixEvent({ type: "test" });
            localEvent.setThread = vi.fn();
        });

        it("should attach thread when threadId and room are provided", () => {
            attachThreadToLocalEvent(localEvent, mockRoom as Room, "thread-id");
            expect(mockRoom.getThread).toHaveBeenCalledWith("thread-id");
            expect(localEvent.setThread).toHaveBeenCalledWith(mockThread);
        });

        it("should not attach thread when threadId is null", () => {
            attachThreadToLocalEvent(localEvent, mockRoom as Room, null);
            expect(mockRoom.getThread).not.toHaveBeenCalled();
            expect(localEvent.setThread).not.toHaveBeenCalled();
        });

        it("should not attach thread when room is null", () => {
            attachThreadToLocalEvent(localEvent, null, "thread-id");
            expect(localEvent.setThread).not.toHaveBeenCalled();
        });

        it("should not attach thread when room.getThread returns undefined", () => {
            mockRoom.getThread = vi.fn().mockReturnValue(undefined);
            attachThreadToLocalEvent(localEvent, mockRoom as Room, "thread-id");
            expect(localEvent.setThread).not.toHaveBeenCalled();
        });
    });

    describe("setupLocalEventReemit", () => {
        it("should re-emit events from local event using reEmitter", () => {
            const localEvent = new MatrixEvent({ type: "test" });
            const mockRoom = {
                reEmitter: {
                    reEmit: vi.fn(),
                },
            };
            const reEmitter = {
                reEmit: vi.fn(),
            };

            setupLocalEventReemit(localEvent, mockRoom as unknown as Room, reEmitter);

            expect(reEmitter.reEmit).toHaveBeenCalledWith(localEvent, [
                MatrixEventEvent.Replaced,
                MatrixEventEvent.VisibilityChange,
            ]);
            expect(mockRoom.reEmitter.reEmit).toHaveBeenCalledWith(localEvent, [MatrixEventEvent.BeforeRedaction]);
        });

        it("should handle null room gracefully", () => {
            const localEvent = new MatrixEvent({ type: "test" });
            const reEmitter = {
                reEmit: vi.fn(),
            };

            setupLocalEventReemit(localEvent, null, reEmitter);

            expect(reEmitter.reEmit).toHaveBeenCalledWith(localEvent, [
                MatrixEventEvent.Replaced,
                MatrixEventEvent.VisibilityChange,
            ]);
        });
    });

    describe("bindPendingRelationTarget", () => {
        it("should not bind when event has no associated id", () => {
            const localEvent = new MatrixEvent({ type: "test" });
            vi.spyOn(localEvent, "getAssociatedId").mockReturnValue(undefined);

            bindPendingRelationTarget(localEvent, {} as Room);

            expect(localEvent.getAssociatedId).toHaveBeenCalled();
        });

        it("should not bind when associated id does not start with ~", () => {
            const localEvent = new MatrixEvent({ type: "test" });
            vi.spyOn(localEvent, "getAssociatedId").mockReturnValue("valid-event-id");

            bindPendingRelationTarget(localEvent, {} as Room);

            expect(localEvent.getAssociatedId).toHaveBeenCalled();
        });

        it("should bind pending relation when target exists", () => {
            const localEvent = new MatrixEvent({ type: "test" });
            const targetEvent = new MatrixEvent({ type: "test", event_id: "~room:txn" });
            vi.spyOn(localEvent, "getAssociatedId").mockReturnValue("~room:txn");
            vi.spyOn(targetEvent, "getId").mockReturnValue("~room:txn");
            vi.spyOn(targetEvent, "once").mockImplementation(() => targetEvent);
            vi.spyOn(localEvent, "updateAssociatedId").mockImplementation(() => {});

            const mockRoom = {
                getPendingEvents: vi.fn().mockReturnValue([targetEvent]),
            };

            bindPendingRelationTarget(localEvent, mockRoom as unknown as Room);

            expect(mockRoom.getPendingEvents).toHaveBeenCalled();
            expect(targetEvent.once).toHaveBeenCalledWith(MatrixEventEvent.LocalEventIdReplaced, expect.any(Function));
        });

        it("should not bind when target event not found", () => {
            const localEvent = new MatrixEvent({ type: "test" });
            vi.spyOn(localEvent, "getAssociatedId").mockReturnValue("~room:txn");

            const mockRoom = {
                getPendingEvents: vi.fn().mockReturnValue([]),
            };

            bindPendingRelationTarget(localEvent, mockRoom as unknown as Room);

            expect(mockRoom.getPendingEvents).toHaveBeenCalled();
        });
    });

    describe("formatSendEventDebugMessage", () => {
        it("should format basic message without query params", () => {
            const result = formatSendEventDebugMessage("m.room.message", "!room:server", "txn123", false);
            expect(result).toBe("sendEvent of type m.room.message in !room:server with txnId txn123");
        });

        it("should include delayed event indicator", () => {
            const result = formatSendEventDebugMessage("m.room.message", "!room:server", "txn123", true);
            expect(result).toBe("sendEvent of type m.room.message in !room:server with txnId txn123 (delayed event)");
        });

        it("should include query params when provided", () => {
            const queryDict = { key: "value", another: "param" };
            const result = formatSendEventDebugMessage("m.room.message", "!room:server", "txn123", false, queryDict);
            expect(result).toContain("query params:");
            expect(result).toContain('"key":"value"');
            expect(result).toContain('"another":"param"');
        });

        it("should handle empty query params", () => {
            const result = formatSendEventDebugMessage("m.room.message", "!room:server", "txn123", false, {});
            expect(result).toContain("query params: {}");
        });
    });

    describe("addPendingEventOrThrow", () => {
        it("should add pending event to room", () => {
            const localEvent = new MatrixEvent({ type: "test" });
            const mockRoom = {
                addPendingEvent: vi.fn(),
            };

            addPendingEventOrThrow(mockRoom as unknown as Room, localEvent, "txn123");

            expect(mockRoom.addPendingEvent).toHaveBeenCalledWith(localEvent, "txn123");
        });

        it("should throw when event status is NOT_SENT", () => {
            const localEvent = new MatrixEvent({ type: "test" });
            Object.defineProperty(localEvent, "status", { value: EventStatus.NOT_SENT, writable: false });

            const mockRoom = {
                addPendingEvent: vi.fn(),
            };

            expect(() => {
                addPendingEventOrThrow(mockRoom as unknown as Room, localEvent, "txn123");
            }).toThrow("Event blocked by other events not yet sent");
        });

        it("should handle null room gracefully", () => {
            const localEvent = new MatrixEvent({ type: "test" });

            expect(() => {
                addPendingEventOrThrow(null, localEvent, "txn123");
            }).not.toThrow();
        });

        it("should not throw when event status is not NOT_SENT", () => {
            const localEvent = new MatrixEvent({ type: "test" });

            const mockRoom = {
                addPendingEvent: vi.fn(),
            };

            expect(() => {
                addPendingEventOrThrow(mockRoom as unknown as Room, localEvent, "txn123");
            }).not.toThrow();
        });
    });
});
