/*
Copyright 2024 The Matrix.org Foundation C.I.C.

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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FakeTransport } from "../test-utils/FakeTransport";
import { ReadReceiptsManager } from "../../src/read-receipts/index";
import { Method } from "../../src/http-api/method";
import { ReceiptType } from "../../src/@types/read_receipts";

describe("ReadReceiptsManager", () => {
    let transport: FakeTransport;
    let manager: ReadReceiptsManager;
    let mockClient: any;

    beforeEach(() => {
        transport = new FakeTransport();
        mockClient = {
            isGuest: vi.fn().mockReturnValue(false),
            supportsThreads: vi.fn().mockReturnValue(false),
            credentials: { userId: "@user:example.com" },
            getRoom: vi.fn().mockReturnValue(null),
            doesServerSupportUnstableFeature: vi.fn().mockResolvedValue(false),
            isVersionSupported: vi.fn().mockResolvedValue(false),
            http: {
                authedRequest: vi.fn().mockResolvedValue({}),
            },
        };
        manager = new ReadReceiptsManager(mockClient, { transport });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function makeMockEvent(
        overrides: Partial<{
            roomId: string | null;
            eventId: string;
        }> = {},
    ): any {
        return {
            getRoomId: vi.fn().mockReturnValue(overrides.roomId ?? "!room:example.com"),
            getId: vi.fn().mockReturnValue(overrides.eventId ?? "$event123"),
            getType: vi.fn().mockReturnValue("m.room.message"),
        };
    }

    function makeMockRoom(overrides: Partial<any> = {}): any {
        return {
            hasPendingEvent: vi.fn().mockReturnValue(false),
            addLocalEchoReceipt: vi.fn(),
            findEventById: vi.fn().mockReturnValue(null),
            ...overrides,
        };
    }

    describe("sendReadReceipt", () => {
        it("should return undefined when event is null", async () => {
            const result = await manager.sendReadReceipt(null);
            expect(result).toBeUndefined();
        });

        it("should throw when event is pending", async () => {
            const event = makeMockEvent({ eventId: "$pending1" });
            const mockRoom = makeMockRoom({ hasPendingEvent: vi.fn().mockReturnValue(true) });
            mockClient.getRoom.mockReturnValue(mockRoom);

            await expect(manager.sendReadReceipt(event)).rejects.toThrow("Cannot set read receipt to a pending event");
        });

        it("should call sendReceipt for non-pending event", async () => {
            const event = makeMockEvent();
            const mockRoom = makeMockRoom({ hasPendingEvent: vi.fn().mockReturnValue(false) });
            mockClient.getRoom.mockReturnValue(mockRoom);

            // sendReadReceipt calls sendReceipt which enters debounce when roomId is present
            vi.useFakeTimers();
            const promise = manager.sendReadReceipt(event);

            // Advance past the 500ms debounce
            await vi.advanceTimersByTimeAsync(500);

            const result = await promise;
            expect(result).toEqual({});
            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });
    });

    describe("sendReceipt", () => {
        it("should bypass debounce and send directly when roomId is falsy", async () => {
            const event = makeMockEvent({ roomId: null });
            mockClient.isGuest.mockReturnValue(false);
            mockClient.http.authedRequest.mockResolvedValue({});

            const result = await manager.sendReceipt(event, ReceiptType.Read);

            expect(result).toEqual({});
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                Method.Post,
                expect.stringContaining("/rooms/"),
                undefined,
                expect.any(Object),
            );
        });

        it("should return empty object for guest users without making HTTP call", async () => {
            const event = makeMockEvent({ roomId: null });
            mockClient.isGuest.mockReturnValue(true);

            const result = await manager.sendReceipt(event, ReceiptType.Read);

            expect(result).toEqual({});
            expect(mockClient.http.authedRequest).not.toHaveBeenCalled();
        });

        it("should debounce requests for the same room", async () => {
            const event1 = makeMockEvent({ eventId: "$evt1" });
            const event2 = makeMockEvent({ eventId: "$evt2" });
            const mockRoom = makeMockRoom({ hasPendingEvent: vi.fn().mockReturnValue(false) });
            mockClient.getRoom.mockReturnValue(mockRoom);
            mockClient.http.authedRequest.mockResolvedValue({});

            vi.useFakeTimers();
            // Send two receipts for the same room quickly
            const promise1 = manager.sendReceipt(event1, ReceiptType.Read);
            const promise2 = manager.sendReceipt(event2, ReceiptType.Read);

            // Advance past debounce - only the latest should fire
            await vi.advanceTimersByTimeAsync(500);

            const [result1, result2] = await Promise.all([promise1, promise2]);
            expect(result1).toEqual({});
            expect(result2).toEqual({});
            // The HTTP call should reference event2 (the latest data)
            expect(mockClient.http.authedRequest).toHaveBeenCalledTimes(1);
        });
    });

    describe("setRoomReadMarkersHttpRequest", () => {
        it("should POST read markers to transport", async () => {
            transport.respondWith({});

            await manager.setRoomReadMarkersHttpRequest("!room:example.com", "$rm123", "$rr456");

            expect(transport.request).toHaveBeenCalledWith(
                Method.Post,
                "/rooms/!room%3Aexample.com/read_markers",
                undefined,
                expect.objectContaining({
                    "m.fully_read": "$rm123",
                    "m.read": "$rr456",
                }),
            );
        });

        it("should include private read receipt when server supports it", async () => {
            mockClient.doesServerSupportUnstableFeature.mockResolvedValue(true);
            transport.respondWith({});

            await manager.setRoomReadMarkersHttpRequest("!room:example.com", "$rm123", "$rr456", "$rp789");

            expect(transport.request).toHaveBeenCalledWith(
                Method.Post,
                "/rooms/!room%3Aexample.com/read_markers",
                undefined,
                expect.objectContaining({
                    "m.fully_read": "$rm123",
                    "m.read": "$rr456",
                    "m.read.private": "$rp789",
                }),
            );
        });

        it("should not include private read receipt when server does not support it", async () => {
            mockClient.doesServerSupportUnstableFeature.mockResolvedValue(false);
            mockClient.isVersionSupported.mockResolvedValue(false);
            transport.respondWith({});

            await manager.setRoomReadMarkersHttpRequest("!room:example.com", "$rm123", "$rr456", "$rp789");

            const callBody = transport.request.mock.calls[0][3];
            expect(callBody).not.toHaveProperty("m.read.private");
        });
    });

    describe("setRoomReadMarkers", () => {
        it("should complete read markers via transport when room is null", async () => {
            mockClient.getRoom.mockReturnValue(null);
            transport.respondWith({});

            await manager.setRoomReadMarkers("!room:example.com", "$rm123");

            // When room is null, setRoomReadMarkersWithLocalEcho skips pending checks
            // and calls setRoomReadMarkersHttpRequest which uses transport
            expect(transport.request).toHaveBeenCalledWith(
                Method.Post,
                "/rooms/!room%3Aexample.com/read_markers",
                undefined,
                expect.objectContaining({
                    "m.fully_read": "$rm123",
                }),
            );
        });
    });

    describe("getReceipt", () => {
        it("should return empty array when room is not found", () => {
            mockClient.getRoom.mockReturnValue(null);

            const result = manager.getReceipt("!room:example.com", "$event123");

            expect(result).toEqual([]);
        });

        it("should return empty array when event is not found in room", () => {
            const mockRoom = makeMockRoom({ findEventById: vi.fn().mockReturnValue(null) });
            mockClient.getRoom.mockReturnValue(mockRoom);

            const result = manager.getReceipt("!room:example.com", "$event123");

            expect(result).toEqual([]);
        });

        it("should return receipts when event has them", () => {
            const mockRoom = makeMockRoom({
                findEventById: vi.fn().mockReturnValue({}),
                getReceiptsForEvent: vi
                    .fn()
                    .mockReturnValue([
                        { userId: "@alice:example.com", data: { ts: 1000, event_id: "$event123" }, type: "m.read" },
                    ]),
            });
            mockClient.getRoom.mockReturnValue(mockRoom);

            const result = manager.getReceipt("!room:example.com", "$event123");

            expect(result).toHaveLength(1);
            expect(result[0].userId).toBe("@alice:example.com");
            expect(result[0].ts).toBe(1000);
        });
    });

    describe("getReadMarkers", () => {
        it("should return empty object when room is not found", () => {
            mockClient.getRoom.mockReturnValue(null);

            const result = manager.getReadMarkers("!room:example.com");

            expect(result).toEqual({});
        });

        it("should return read markers from room account data", () => {
            const mockReadReceipt = {
                getContent: vi.fn().mockReturnValue({ event_id: "$read123" }),
            };
            const mockFullyRead = {
                getContent: vi.fn().mockReturnValue({ event_id: "$fully123" }),
            };
            const mockRoom = {
                getAccountData: vi.fn((type: string) => {
                    if (type === "m.read") return mockReadReceipt;
                    if (type === "m.fully_read") return mockFullyRead;
                    return null;
                }),
            };
            mockClient.getRoom.mockReturnValue(mockRoom);

            const result = manager.getReadMarkers("!room:example.com");

            expect(result).toEqual({
                m_read: "$read123",
                m_fully_read: "$fully123",
            });
        });
    });

    describe("sendReadReceiptByEventId", () => {
        it("should do nothing when event is not found in room", async () => {
            const mockRoom = makeMockRoom({ findEventById: vi.fn().mockReturnValue(null) });
            mockClient.getRoom.mockReturnValue(mockRoom);

            await manager.sendReadReceiptByEventId("!room:example.com", "$nonexistent");

            expect(mockRoom.findEventById).toHaveBeenCalledWith("$nonexistent");
        });

        it("should send read receipt when event is found in room", async () => {
            const mockEvent = makeMockEvent({ eventId: "$foundEvent" });
            const mockRoom = makeMockRoom({
                findEventById: vi.fn().mockReturnValue(mockEvent),
                hasPendingEvent: vi.fn().mockReturnValue(false),
            });
            mockClient.getRoom.mockReturnValue(mockRoom);

            vi.useFakeTimers();
            const promise = manager.sendReadReceiptByEventId("!room:example.com", "$foundEvent");

            await vi.advanceTimersByTimeAsync(500);

            await promise;
            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });
    });

    describe("setReadMarkers / setReadMarker", () => {
        it("setReadMarker should call setRoomReadMarkers with same eventId", async () => {
            mockClient.getRoom.mockReturnValue(null);
            transport.respondWith({});

            await manager.setReadMarker("!room:example.com", "$rm123");

            expect(transport.request).toHaveBeenCalled();
        });

        it("setReadMarkers should work without a fullyReadEventId", async () => {
            mockClient.getRoom.mockReturnValue(null);
            transport.respondWith({});

            await manager.setReadMarkers("!room:example.com", "$evt456");

            expect(transport.request).toHaveBeenCalled();
        });
    });
});
