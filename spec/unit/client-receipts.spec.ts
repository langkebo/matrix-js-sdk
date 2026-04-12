/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect, vi } from "vitest";

import {
    threadIdForReceipt,
    inMainTimelineForReceipt,
    fixNotificationCountOnDecryption,
} from "../../src/client-receipts.ts";
import { MAIN_ROOM_TIMELINE } from "../../src/@types/read_receipts.ts";
import { MatrixEvent } from "../../src/models/event.ts";
import { THREAD_RELATION_TYPE } from "../../src/models/thread.ts";
import { NotificationCountType } from "../../src/models/room.ts";

describe("client-receipts", () => {
    describe("threadIdForReceipt", () => {
        it("should return MAIN_ROOM_TIMELINE for events without threadRootId", () => {
            const event = new MatrixEvent({
                type: "m.room.message",
                content: { body: "test" },
            });
            vi.spyOn(event, "threadRootId", "get").mockReturnValue(undefined);

            const result = threadIdForReceipt(event);
            expect(result).toBe(MAIN_ROOM_TIMELINE);
        });

        it("should return MAIN_ROOM_TIMELINE for thread roots", () => {
            const event = new MatrixEvent({
                type: "m.room.message",
                content: { body: "test" },
            });
            vi.spyOn(event, "threadRootId", "get").mockReturnValue("$thread_root");
            vi.spyOn(event, "isThreadRoot", "get").mockReturnValue(true);

            const result = threadIdForReceipt(event);
            expect(result).toBe(MAIN_ROOM_TIMELINE);
        });

        it("should return threadRootId for events with thread relation", () => {
            const event = new MatrixEvent({
                type: "m.room.message",
                content: { body: "test" },
            });
            vi.spyOn(event, "threadRootId", "get").mockReturnValue("$thread_root");
            vi.spyOn(event, "isThreadRoot", "get").mockReturnValue(false);
            vi.spyOn(event, "isRelation").mockReturnValue(true);
            vi.spyOn(event, "relationEventId", "get").mockReturnValue("$other_event");

            const result = threadIdForReceipt(event);
            expect(result).toBe("$thread_root");
        });
    });

    describe("inMainTimelineForReceipt", () => {
        it("should return true for events without threadRootId", () => {
            const event = new MatrixEvent({
                type: "m.room.message",
                content: { body: "test" },
            });
            vi.spyOn(event, "threadRootId", "get").mockReturnValue(undefined);

            expect(inMainTimelineForReceipt(event)).toBe(true);
        });

        it("should return true for thread roots", () => {
            const event = new MatrixEvent({
                type: "m.room.message",
                content: { body: "test" },
            });
            vi.spyOn(event, "threadRootId", "get").mockReturnValue("$thread_root");
            vi.spyOn(event, "isThreadRoot", "get").mockReturnValue(true);

            expect(inMainTimelineForReceipt(event)).toBe(true);
        });

        it("should return false for thread relations", () => {
            const event = new MatrixEvent({
                type: "m.room.message",
                content: { body: "test" },
            });
            vi.spyOn(event, "threadRootId", "get").mockReturnValue("$thread_root");
            vi.spyOn(event, "isThreadRoot", "get").mockReturnValue(false);
            vi.spyOn(event, "isRelation").mockImplementation((relType) => {
                if (relType === THREAD_RELATION_TYPE.name) return true;
                return true;
            });
            vi.spyOn(event, "relationEventId", "get").mockReturnValue("$other_event");

            expect(inMainTimelineForReceipt(event)).toBe(false);
        });

        it("should return true for relations to thread root (non-thread relation)", () => {
            const event = new MatrixEvent({
                type: "m.room.message",
                content: { body: "test" },
            });
            vi.spyOn(event, "threadRootId", "get").mockReturnValue("$thread_root");
            vi.spyOn(event, "isThreadRoot", "get").mockReturnValue(false);
            vi.spyOn(event, "isRelation").mockImplementation((relType) => {
                if (relType === THREAD_RELATION_TYPE.name) return false;
                return true;
            });
            vi.spyOn(event, "relationEventId", "get").mockReturnValue("$thread_root");

            expect(inMainTimelineForReceipt(event)).toBe(true);
        });

        it("should return true for non-relation events with threadRootId (edge case)", () => {
            const event = new MatrixEvent({
                type: "m.room.message",
                content: { body: "test" },
            });
            vi.spyOn(event, "threadRootId", "get").mockReturnValue("$thread_root");
            vi.spyOn(event, "isThreadRoot", "get").mockReturnValue(false);
            vi.spyOn(event, "isRelation").mockReturnValue(false);

            expect(inMainTimelineForReceipt(event)).toBe(true);
        });
    });

    describe("fixNotificationCountOnDecryption", () => {
        it("should return early when room is not found", () => {
            const mockClient = {
                getUserId: vi.fn().mockReturnValue("@user:server"),
                getRoom: vi.fn().mockReturnValue(null),
            };

            const event = new MatrixEvent({
                type: "m.room.encrypted",
                content: {},
                room_id: "!room:server",
                event_id: "$event_id",
            });

            fixNotificationCountOnDecryption(mockClient as unknown as any, event);

            expect(mockClient.getUserId).toHaveBeenCalled();
            expect(mockClient.getRoom).toHaveBeenCalledWith("!room:server");
        });

        it("should return early when eventId is null", () => {
            const mockRoom = {
                findEventById: vi.fn(),
            };

            const mockClient = {
                getUserId: vi.fn().mockReturnValue("@user:server"),
                getRoom: vi.fn().mockReturnValue(mockRoom),
            };

            const event = new MatrixEvent({
                type: "m.room.encrypted",
                content: {},
                room_id: "!room:server",
            });
            vi.spyOn(event, "getId").mockReturnValue(undefined);

            fixNotificationCountOnDecryption(mockClient as unknown as any, event);

            expect(mockClient.getUserId).toHaveBeenCalled();
            expect(mockClient.getRoom).toHaveBeenCalled();
            expect(mockRoom.findEventById).not.toHaveBeenCalled();
        });

        it("should return early when event is not found in room", () => {
            const mockRoom = {
                findEventById: vi.fn().mockReturnValue(null),
            };

            const mockClient = {
                getUserId: vi.fn().mockReturnValue("@user:server"),
                getRoom: vi.fn().mockReturnValue(mockRoom),
            };

            const event = new MatrixEvent({
                type: "m.room.encrypted",
                content: {},
                room_id: "!room:server",
                event_id: "$event_id",
            });

            fixNotificationCountOnDecryption(mockClient as unknown as any, event);

            expect(mockRoom.findEventById).toHaveBeenCalledWith("$event_id");
        });

        it("should skip processing when event has been read", () => {
            const mockRoom = {
                findEventById: vi.fn().mockReturnValue({}),
                hasUserReadEvent: vi.fn().mockReturnValue(true),
                getUnreadCountForEventContext: vi.fn(),
            };

            const mockClient = {
                getUserId: vi.fn().mockReturnValue("@user:server"),
                getRoom: vi.fn().mockReturnValue(mockRoom),
                getPushActionsForEvent: vi.fn(),
            };

            const event = new MatrixEvent({
                type: "m.room.encrypted",
                content: {},
                room_id: "!room:server",
                event_id: "$event_id",
            });
            vi.spyOn(event, "threadRootId", "get").mockReturnValue(undefined);

            fixNotificationCountOnDecryption(mockClient as unknown as any, event);

            expect(mockRoom.hasUserReadEvent).toHaveBeenCalledWith("@user:server", "$event_id");
            expect(mockClient.getPushActionsForEvent).not.toHaveBeenCalled();
        });

        it("should increment highlight count for highlight actions", () => {
            const mockRoom = {
                findEventById: vi.fn().mockReturnValue({}),
                hasUserReadEvent: vi.fn().mockReturnValue(false),
                getUnreadCountForEventContext: vi.fn().mockReturnValue(0),
                setUnreadNotificationCount: vi.fn(),
            };

            const mockClient = {
                getUserId: vi.fn().mockReturnValue("@user:server"),
                getRoom: vi.fn().mockReturnValue(mockRoom),
                getPushActionsForEvent: vi.fn().mockReturnValue({
                    tweaks: { highlight: true },
                    notify: false,
                }),
            };

            const event = new MatrixEvent({
                type: "m.room.encrypted",
                content: {},
                room_id: "!room:server",
                event_id: "$event_id",
            });
            vi.spyOn(event, "threadRootId", "get").mockReturnValue(undefined);

            fixNotificationCountOnDecryption(mockClient as unknown as any, event);

            expect(mockRoom.setUnreadNotificationCount).toHaveBeenCalledWith(NotificationCountType.Highlight, 1);
        });

        it("should increment total count for notify actions", () => {
            const mockRoom = {
                findEventById: vi.fn().mockReturnValue({}),
                hasUserReadEvent: vi.fn().mockReturnValue(false),
                getUnreadCountForEventContext: vi.fn().mockReturnValue(0),
                setUnreadNotificationCount: vi.fn(),
            };

            const mockClient = {
                getUserId: vi.fn().mockReturnValue("@user:server"),
                getRoom: vi.fn().mockReturnValue(mockRoom),
                getPushActionsForEvent: vi.fn().mockReturnValue({
                    tweaks: { highlight: false },
                    notify: true,
                }),
            };

            const event = new MatrixEvent({
                type: "m.room.encrypted",
                content: {},
                room_id: "!room:server",
                event_id: "$event_id",
            });
            vi.spyOn(event, "threadRootId", "get").mockReturnValue(undefined);

            fixNotificationCountOnDecryption(mockClient as unknown as any, event);

            expect(mockRoom.setUnreadNotificationCount).toHaveBeenCalledWith(NotificationCountType.Total, 1);
        });

        it("should handle thread events correctly", () => {
            const mockThread = {
                hasUserReadEvent: vi.fn().mockReturnValue(false),
            };

            const mockRoom = {
                findEventById: vi.fn().mockReturnValue({}),
                getThread: vi.fn().mockReturnValue(mockThread),
                getUnreadCountForEventContext: vi.fn().mockReturnValue(0),
                setThreadUnreadNotificationCount: vi.fn(),
            };

            const mockClient = {
                getUserId: vi.fn().mockReturnValue("@user:server"),
                getRoom: vi.fn().mockReturnValue(mockRoom),
                getPushActionsForEvent: vi.fn().mockReturnValue({
                    tweaks: { highlight: true },
                    notify: true,
                }),
            };

            const event = new MatrixEvent({
                type: "m.room.encrypted",
                content: {},
                room_id: "!room:server",
                event_id: "$event_id",
            });
            vi.spyOn(event, "threadRootId", "get").mockReturnValue("$thread_root");
            vi.spyOn(event, "isThreadRoot", "get").mockReturnValue(false);

            fixNotificationCountOnDecryption(mockClient as unknown as any, event);

            expect(mockRoom.getThread).toHaveBeenCalledWith("$thread_root");
            expect(mockThread.hasUserReadEvent).toHaveBeenCalledWith("@user:server", "$event_id");
            expect(mockRoom.setThreadUnreadNotificationCount).toHaveBeenCalled();
        });
    });
});
