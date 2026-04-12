/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect, vi, beforeEach } from "vitest";

import { queueOrSendEvent } from "../../src/client-send-execution.ts";
import { EventStatus, MatrixEvent } from "../../src/models/event.ts";
import type { Room } from "../../src/models/room.ts";
import type { MatrixScheduler } from "../../src/scheduler.ts";
import type { ISendEventResponse } from "../../src/@types/requests.ts";
import type { QueryDict } from "../../src/utils.ts";

describe("client-send-execution", () => {
    describe("queueOrSendEvent", () => {
        let mockEvent: MatrixEvent;
        let mockRoom: Partial<Room>;
        let mockScheduler: Partial<MatrixScheduler<ISendEventResponse>>;
        let sendEventHttpRequest: (event: MatrixEvent, queryDict?: QueryDict) => Promise<ISendEventResponse>;
        let updatePendingEventStatus: (room: Room | null, event: MatrixEvent, status: EventStatus) => void;

        beforeEach(() => {
            mockEvent = new MatrixEvent({
                type: "m.room.message",
                content: { body: "test" },
                room_id: "!room:server",
            });

            mockRoom = {
                updatePendingEvent: vi.fn(),
            };

            mockScheduler = {
                queueEvent: vi.fn(),
                getQueueForEvent: vi.fn(),
            };

            sendEventHttpRequest = vi
                .fn()
                .mockResolvedValue({ event_id: "$event_id" }) as unknown as typeof sendEventHttpRequest;
            updatePendingEventStatus = vi.fn() as unknown as typeof updatePendingEventStatus;
        });

        describe("without scheduler", () => {
            it("should send event directly via HTTP request", async () => {
                const result = await queueOrSendEvent({
                    scheduler: undefined,
                    room: mockRoom as Room,
                    event: mockEvent,
                    sendEventHttpRequest,
                    updatePendingEventStatus,
                });

                expect(sendEventHttpRequest).toHaveBeenCalledWith(mockEvent, undefined);
                expect(result).toEqual({ event_id: "$event_id" });
            });

            it("should update pending event status after successful send", async () => {
                await queueOrSendEvent({
                    scheduler: undefined,
                    room: mockRoom as Room,
                    event: mockEvent,
                    sendEventHttpRequest,
                    updatePendingEventStatus,
                });

                expect(mockRoom.updatePendingEvent).toHaveBeenCalledWith(mockEvent, EventStatus.SENT, "$event_id");
            });

            it("should pass query options to HTTP request", async () => {
                const queryOpts = { key: "value" };

                await queueOrSendEvent({
                    scheduler: undefined,
                    room: mockRoom as Room,
                    event: mockEvent,
                    queryOpts,
                    sendEventHttpRequest,
                    updatePendingEventStatus,
                });

                expect(sendEventHttpRequest).toHaveBeenCalledWith(mockEvent, queryOpts);
            });

            it("should handle null room gracefully", async () => {
                const result = await queueOrSendEvent({
                    scheduler: undefined,
                    room: null,
                    event: mockEvent,
                    sendEventHttpRequest,
                    updatePendingEventStatus,
                });

                expect(result).toEqual({ event_id: "$event_id" });
                expect(mockRoom.updatePendingEvent).not.toHaveBeenCalled();
            });

            it("should propagate HTTP request errors", async () => {
                const error = new Error("Network error");
                const mockFn = vi.fn().mockRejectedValue(error);
                const errorRequest = mockFn as unknown as typeof sendEventHttpRequest;

                await expect(
                    queueOrSendEvent({
                        scheduler: undefined,
                        room: mockRoom as Room,
                        event: mockEvent,
                        sendEventHttpRequest: errorRequest,
                        updatePendingEventStatus,
                    }),
                ).rejects.toThrow("Network error");
            });
        });

        describe("with scheduler", () => {
            it("should queue event when scheduler is provided", async () => {
                const queuedPromise = Promise.resolve({ event_id: "$queued_event_id" });
                (mockScheduler.queueEvent as ReturnType<typeof vi.fn>).mockReturnValue(queuedPromise);
                (mockScheduler.getQueueForEvent as ReturnType<typeof vi.fn>).mockReturnValue([mockEvent]);

                const result = await queueOrSendEvent({
                    scheduler: mockScheduler as MatrixScheduler<ISendEventResponse>,
                    room: mockRoom as Room,
                    event: mockEvent,
                    sendEventHttpRequest,
                    updatePendingEventStatus,
                });

                expect(mockScheduler.queueEvent).toHaveBeenCalledWith(mockEvent);
                expect(result).toEqual({ event_id: "$queued_event_id" });
            });

            it("should update status to QUEUED when queue has multiple events", async () => {
                const queuedPromise = Promise.resolve({ event_id: "$queued_event_id" });
                (mockScheduler.queueEvent as ReturnType<typeof vi.fn>).mockReturnValue(queuedPromise);
                (mockScheduler.getQueueForEvent as ReturnType<typeof vi.fn>).mockReturnValue([
                    mockEvent,
                    {} as MatrixEvent,
                ]);

                await queueOrSendEvent({
                    scheduler: mockScheduler as MatrixScheduler<ISendEventResponse>,
                    room: mockRoom as Room,
                    event: mockEvent,
                    sendEventHttpRequest,
                    updatePendingEventStatus,
                });

                expect(updatePendingEventStatus).toHaveBeenCalledWith(mockRoom, mockEvent, EventStatus.QUEUED);
            });

            it("should not update status to QUEUED when queue has single event", async () => {
                const queuedPromise = Promise.resolve({ event_id: "$queued_event_id" });
                (mockScheduler.queueEvent as ReturnType<typeof vi.fn>).mockReturnValue(queuedPromise);
                (mockScheduler.getQueueForEvent as ReturnType<typeof vi.fn>).mockReturnValue([mockEvent]);

                await queueOrSendEvent({
                    scheduler: mockScheduler as MatrixScheduler<ISendEventResponse>,
                    room: mockRoom as Room,
                    event: mockEvent,
                    sendEventHttpRequest,
                    updatePendingEventStatus,
                });

                expect(updatePendingEventStatus).not.toHaveBeenCalled();
            });

            it("should fall back to direct send when scheduler.queueEvent returns null", async () => {
                (mockScheduler.queueEvent as ReturnType<typeof vi.fn>).mockReturnValue(null);

                const result = await queueOrSendEvent({
                    scheduler: mockScheduler as MatrixScheduler<ISendEventResponse>,
                    room: mockRoom as Room,
                    event: mockEvent,
                    sendEventHttpRequest,
                    updatePendingEventStatus,
                });

                expect(sendEventHttpRequest).toHaveBeenCalledWith(mockEvent, undefined);
                expect(result).toEqual({ event_id: "$event_id" });
            });
        });

        describe("edge cases", () => {
            it("should handle empty query options", async () => {
                await queueOrSendEvent({
                    scheduler: undefined,
                    room: mockRoom as Room,
                    event: mockEvent,
                    queryOpts: {},
                    sendEventHttpRequest,
                    updatePendingEventStatus,
                });

                expect(sendEventHttpRequest).toHaveBeenCalledWith(mockEvent, {});
            });

            it("should handle event without room_id", async () => {
                const eventWithoutRoom = new MatrixEvent({
                    type: "m.room.message",
                    content: { body: "test" },
                });

                const result = await queueOrSendEvent({
                    scheduler: undefined,
                    room: mockRoom as Room,
                    event: eventWithoutRoom,
                    sendEventHttpRequest,
                    updatePendingEventStatus,
                });

                expect(result).toEqual({ event_id: "$event_id" });
            });
        });
    });
});
