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

import { describe, it, expect, vi, beforeEach } from "vitest";

import { beginRoomPeek, endRoomPeek } from "../../src/client-room-peek";
import type { SyncApi } from "../../src/sync";
import type { Room } from "../../src/models/room";

describe("client-room-peek", () => {
    let mockPeekSync: SyncApi;
    let mockRoom: Room;

    beforeEach(() => {
        mockRoom = { roomId: "!peek:example.com" } as unknown as Room;
        mockPeekSync = {
            peek: vi.fn().mockResolvedValue(mockRoom),
            stopPeeking: vi.fn(),
        } as unknown as SyncApi;
    });

    describe("beginRoomPeek", () => {
        it("creates a new peek sync and returns the peek promise", async () => {
            const createPeekSync = vi.fn().mockReturnValue(mockPeekSync);

            const { nextPeekSync, peekPromise } = beginRoomPeek("!peek:example.com", 10, null, createPeekSync);

            expect(createPeekSync).toHaveBeenCalledTimes(1);
            expect(nextPeekSync).toBe(mockPeekSync);
            expect(mockPeekSync.peek).toHaveBeenCalledWith("!peek:example.com", 10);
            await expect(peekPromise).resolves.toBe(mockRoom);
        });

        it("stops the current peek sync before creating a new one", () => {
            const currentPeekSync = {
                stopPeeking: vi.fn(),
            } as unknown as SyncApi;
            const createPeekSync = vi.fn().mockReturnValue(mockPeekSync);

            beginRoomPeek("!peek:example.com", 5, currentPeekSync, createPeekSync);

            expect(currentPeekSync.stopPeeking).toHaveBeenCalledTimes(1);
            expect(createPeekSync).toHaveBeenCalledTimes(1);
        });

        it("calls stopPeeking on current sync before createPeekSync (ordering)", () => {
            const callOrder: string[] = [];
            const currentPeekSync = {
                stopPeeking: vi.fn(() => {
                    callOrder.push("stopPeeking");
                }),
            } as unknown as SyncApi;
            const createPeekSync = vi.fn(() => {
                callOrder.push("createPeekSync");
                return mockPeekSync;
            });

            beginRoomPeek("!peek:example.com", 1, currentPeekSync, createPeekSync);

            expect(callOrder).toEqual(["stopPeeking", "createPeekSync"]);
        });

        it("does not fail when currentPeekSync is null", () => {
            const createPeekSync = vi.fn().mockReturnValue(mockPeekSync);

            expect(() => beginRoomPeek("!peek:example.com", 3, null, createPeekSync)).not.toThrow();
        });

        it("propagates the limit parameter verbatim", () => {
            const createPeekSync = vi.fn().mockReturnValue(mockPeekSync);

            beginRoomPeek("!peek:example.com", 0, null, createPeekSync);

            expect(mockPeekSync.peek).toHaveBeenCalledWith("!peek:example.com", 0);
        });

        it("returns the rejected promise when peek fails", async () => {
            const boom = new Error("peek failed");
            const failingSync = {
                peek: vi.fn().mockRejectedValue(boom),
                stopPeeking: vi.fn(),
            } as unknown as SyncApi;
            const createPeekSync = vi.fn().mockReturnValue(failingSync);

            const { peekPromise } = beginRoomPeek("!peek:example.com", 1, null, createPeekSync);

            await expect(peekPromise).rejects.toThrow("peek failed");
        });
    });

    describe("endRoomPeek", () => {
        it("stops peeking and returns null", () => {
            const result = endRoomPeek(mockPeekSync);

            expect(mockPeekSync.stopPeeking).toHaveBeenCalledTimes(1);
            expect(result).toBeNull();
        });

        it("returns null without calling stopPeeking when currentPeekSync is null", () => {
            const result = endRoomPeek(null);

            expect(result).toBeNull();
        });

        it("is idempotent — calling twice is safe", () => {
            const first = endRoomPeek(mockPeekSync);
            const second = endRoomPeek(null);

            expect(first).toBeNull();
            expect(second).toBeNull();
            expect(mockPeekSync.stopPeeking).toHaveBeenCalledTimes(1);
        });
    });

    describe("beginRoomPeek + endRoomPeek 协作", () => {
        it("full lifecycle: begin then end", async () => {
            const createPeekSync = vi.fn().mockReturnValue(mockPeekSync);

            const { nextPeekSync, peekPromise } = beginRoomPeek("!peek:example.com", 20, null, createPeekSync);
            await peekPromise;

            const ended = endRoomPeek(nextPeekSync);

            expect(ended).toBeNull();
            expect(mockPeekSync.stopPeeking).toHaveBeenCalledTimes(1);
        });

        it("re-peek stops the previous sync exactly once", async () => {
            const createPeekSync = vi.fn().mockReturnValue(mockPeekSync);

            // First peek
            const first = beginRoomPeek("!peek:example.com", 1, null, createPeekSync);
            await first.peekPromise;

            // Second peek — should stop the first sync
            const second = beginRoomPeek("!peek:example.com", 2, first.nextPeekSync, createPeekSync);
            await second.peekPromise;

            expect(mockPeekSync.stopPeeking).toHaveBeenCalledTimes(1);
            expect(createPeekSync).toHaveBeenCalledTimes(2);
        });
    });
});
