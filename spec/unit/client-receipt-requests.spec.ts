/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect, vi } from "vitest";

import {
    buildReceiptPath,
    buildReceiptBody,
    sendReceiptRequest,
    setRoomReadMarkersHttpRequest,
    setRoomReadMarkersWithLocalEcho,
    type SendReceiptOptions,
    type SetRoomReadMarkersOptions,
    type SetRoomReadMarkersFullOptions,
} from "../../src/client-receipt-requests.ts";
import { ReceiptType } from "../../src/@types/read_receipts.ts";
import { MatrixEvent } from "../../src/models/event.ts";
import { Method } from "../../src/http-api/method.ts";

describe("client-receipt-requests", () => {
    describe("buildReceiptPath", () => {
        it("should build correct receipt path with URL encoding", () => {
            const event = new MatrixEvent({
                type: "m.room.message",
                content: {},
                room_id: "!room:server",
                event_id: "$event_id",
            });

            const path = buildReceiptPath(event, ReceiptType.Read);

            expect(path).toBe("/rooms/!room%3Aserver/receipt/m.read/%24event_id");
        });

        it("should build path for private read receipt with URL encoding", () => {
            const event = new MatrixEvent({
                type: "m.room.message",
                content: {},
                room_id: "!room:server",
                event_id: "$event_id",
            });

            const path = buildReceiptPath(event, ReceiptType.ReadPrivate);

            expect(path).toBe("/rooms/!room%3Aserver/receipt/m.read.private/%24event_id");
        });
    });

    describe("buildReceiptBody", () => {
        it("should return body as-is when unthreaded", () => {
            const event = new MatrixEvent({
                type: "m.room.message",
                content: {},
            });
            const body = { custom: "data" };

            const result = buildReceiptBody(body, event, true, true);

            expect(result).toEqual({ custom: "data" });
        });

        it("should return body as-is when threads not supported", () => {
            const event = new MatrixEvent({
                type: "m.room.message",
                content: {},
            });
            vi.spyOn(event, "threadRootId", "get").mockReturnValue("$thread_root");
            const body = { custom: "data" };

            const result = buildReceiptBody(body, event, false, false);

            expect(result).toEqual({ custom: "data" });
        });

        it("should add thread_id when threaded and threads supported", () => {
            const event = new MatrixEvent({
                type: "m.room.message",
                content: {},
            });
            vi.spyOn(event, "threadRootId", "get").mockReturnValue("$thread_root");
            vi.spyOn(event, "isThreadRoot", "get").mockReturnValue(false);
            vi.spyOn(event, "isRelation").mockReturnValue(true);
            vi.spyOn(event, "relationEventId", "get").mockReturnValue("$other_event");
            const body = { custom: "data" };

            const result = buildReceiptBody(body, event, false, true);

            expect(result).toEqual({ custom: "data", thread_id: "$thread_root" });
        });

        it("should handle undefined body", () => {
            const event = new MatrixEvent({
                type: "m.room.message",
                content: {},
            });
            vi.spyOn(event, "threadRootId", "get").mockReturnValue("$thread_root");
            vi.spyOn(event, "isThreadRoot", "get").mockReturnValue(false);
            vi.spyOn(event, "isRelation").mockReturnValue(true);
            vi.spyOn(event, "relationEventId", "get").mockReturnValue("$other_event");

            const result = buildReceiptBody(undefined, event, false, true);

            expect(result).toEqual({ thread_id: "$thread_root" });
        });
    });

    describe("sendReceiptRequest", () => {
        it("should return empty object for guest users", async () => {
            const mockClient = {};

            const options: SendReceiptOptions = {
                event: new MatrixEvent({ type: "m.room.message", content: {} }),
                receiptType: ReceiptType.Read,
                unthreaded: true,
                isGuest: true,
                supportsThreads: false,
                userId: null,
            };

            const result = await sendReceiptRequest(mockClient as any, options);

            expect(result).toEqual({});
        });

        it("should send receipt request for non-guest users", async () => {
            const mockRoom = {
                addLocalEchoReceipt: vi.fn(),
            };

            const mockClient = {
                http: {
                    authedRequest: vi.fn().mockResolvedValue({}),
                },
                getRoom: vi.fn().mockReturnValue(mockRoom),
            };

            const event = new MatrixEvent({
                type: "m.room.message",
                content: {},
                room_id: "!room:server",
                event_id: "$event_id",
            });

            const options: SendReceiptOptions = {
                event,
                receiptType: ReceiptType.Read,
                unthreaded: true,
                isGuest: false,
                supportsThreads: false,
                userId: "@user:server",
            };

            const result = await sendReceiptRequest(mockClient as any, options);

            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/rooms/!room%3Aserver/receipt/m.read/%24event_id",
                undefined,
                {},
            );
            expect(mockRoom.addLocalEchoReceipt).toHaveBeenCalledWith("@user:server", event, ReceiptType.Read, true);
            expect(result).toEqual({});
        });

        it("should not add local echo when room is not found", async () => {
            const mockClient = {
                http: {
                    authedRequest: vi.fn().mockResolvedValue({}),
                },
                getRoom: vi.fn().mockReturnValue(null),
            };

            const event = new MatrixEvent({
                type: "m.room.message",
                content: {},
                room_id: "!room:server",
                event_id: "$event_id",
            });

            const options: SendReceiptOptions = {
                event,
                receiptType: ReceiptType.Read,
                unthreaded: true,
                isGuest: false,
                supportsThreads: false,
                userId: "@user:server",
            };

            await sendReceiptRequest(mockClient as any, options);

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });
    });

    describe("setRoomReadMarkersHttpRequest", () => {
        it("should send read markers request with all markers", async () => {
            const mockClient = {
                http: {
                    authedRequest: vi.fn().mockResolvedValue({}),
                },
            };

            const options: SetRoomReadMarkersOptions = {
                roomId: "!room:server",
                rmEventId: "$fully_read",
                rrEventId: "$read",
                rpEventId: "$read_private",
            };

            const result = await setRoomReadMarkersHttpRequest(mockClient as any, options);

            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/rooms/!room%3Aserver/read_markers",
                undefined,
                {
                    "m.fully_read": "$fully_read",
                    "m.read": "$read",
                    "m.read.private": "$read_private",
                },
            );
            expect(result).toEqual({});
        });

        it("should send read markers request with only fully_read marker", async () => {
            const mockClient = {
                http: {
                    authedRequest: vi.fn().mockResolvedValue({}),
                },
            };

            const options: SetRoomReadMarkersOptions = {
                roomId: "!room:server",
                rmEventId: "$fully_read",
            };

            const result = await setRoomReadMarkersHttpRequest(mockClient as any, options);

            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/rooms/!room%3Aserver/read_markers",
                undefined,
                {
                    "m.fully_read": "$fully_read",
                },
            );
            expect(result).toEqual({});
        });
    });

    describe("setRoomReadMarkersWithLocalEcho", () => {
        it("should throw error when fully_read event is pending", async () => {
            const mockRoom = {
                hasPendingEvent: vi.fn().mockReturnValue(true),
            };

            const mockClient = {};

            const options: SetRoomReadMarkersFullOptions = {
                roomId: "!room:server",
                rmEventId: "$pending_event",
                userId: "@user:server",
            };

            const httpHandler = vi.fn();

            await expect(
                setRoomReadMarkersWithLocalEcho(mockClient as any, mockRoom as any, options, httpHandler),
            ).rejects.toThrow("Cannot set read marker to a pending event");
        });

        it("should throw error when read receipt event is pending", async () => {
            const mockRoom = {
                hasPendingEvent: vi.fn().mockImplementation((eventId) => eventId === "$pending_rr"),
            };

            const mockClient = {};

            const rrEvent = new MatrixEvent({
                type: "m.room.message",
                event_id: "$pending_rr",
            });

            const options: SetRoomReadMarkersFullOptions = {
                roomId: "!room:server",
                rmEventId: "$fully_read",
                rrEvent,
                userId: "@user:server",
            };

            const httpHandler = vi.fn();

            await expect(
                setRoomReadMarkersWithLocalEcho(mockClient as any, mockRoom as any, options, httpHandler),
            ).rejects.toThrow("Cannot set read receipt to a pending event");
        });

        it("should call httpHandler with correct parameters", async () => {
            const mockRoom = {
                hasPendingEvent: vi.fn().mockReturnValue(false),
                addLocalEchoReceipt: vi.fn(),
            };

            const mockClient = {};

            const rrEvent = new MatrixEvent({
                type: "m.room.message",
                event_id: "$read",
            });

            const rpEvent = new MatrixEvent({
                type: "m.room.message",
                event_id: "$read_private",
            });

            const options: SetRoomReadMarkersFullOptions = {
                roomId: "!room:server",
                rmEventId: "$fully_read",
                rrEvent,
                rpEvent,
                userId: "@user:server",
            };

            const httpHandler = vi.fn().mockResolvedValue({});

            await setRoomReadMarkersWithLocalEcho(mockClient as any, mockRoom as any, options, httpHandler);

            expect(httpHandler).toHaveBeenCalledWith("!room:server", "$fully_read", "$read", "$read_private");
            expect(mockRoom.addLocalEchoReceipt).toHaveBeenCalledWith("@user:server", rrEvent, ReceiptType.Read);
            expect(mockRoom.addLocalEchoReceipt).toHaveBeenCalledWith("@user:server", rpEvent, ReceiptType.ReadPrivate);
        });

        it("should handle null room gracefully", async () => {
            const mockClient = {};

            const options: SetRoomReadMarkersFullOptions = {
                roomId: "!room:server",
                rmEventId: "$fully_read",
                userId: "@user:server",
            };

            const httpHandler = vi.fn().mockResolvedValue({});

            const result = await setRoomReadMarkersWithLocalEcho(mockClient as any, null, options, httpHandler);

            expect(httpHandler).toHaveBeenCalledWith("!room:server", "$fully_read", undefined, undefined);
            expect(result).toEqual({});
        });
    });
});
