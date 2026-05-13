import "../../src/typing/index";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { TypingManager } from "../../src/typing/index";
import { Method } from "../../src/http-api";
import { ClientPrefix } from "../../src/http-api/prefix";

describe("TypingManager", () => {
    let mockClient: any;
    let typingManager: TypingManager;
    let mockAuthedRequest: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockAuthedRequest = vi.fn();
        mockClient = {
            http: {
                authedRequest: mockAuthedRequest,
            },
            sendTyping: vi.fn().mockResolvedValue({}),
            getUserId: vi.fn().mockReturnValue("@user:example.com"),
            getRoom: vi.fn().mockReturnValue({
                currentState: {
                    getStateEvents: vi.fn().mockReturnValue({
                        getContent: vi.fn().mockReturnValue({
                            user_ids: ["@user1:example.com", "@user2:example.com"],
                            timeout: 30000,
                        }),
                    }),
                },
            }),
        };
        typingManager = new TypingManager(mockClient);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe("startTyping", () => {
        it("should start typing in a room", async () => {
            await typingManager.startTyping("!room:example.com");
            expect(mockClient.sendTyping).toHaveBeenCalledWith("!room:example.com", true, expect.any(Number));
        });

        it("should use custom timeout", async () => {
            await typingManager.startTyping("!room:example.com", { timeout: 5000 });
            expect(mockClient.sendTyping).toHaveBeenCalledWith("!room:example.com", true, 5000);
        });

        it("should handle errors gracefully", async () => {
            mockClient.sendTyping.mockRejectedValueOnce(new Error("Network error"));
            await expect(typingManager.startTyping("!room:example.com")).resolves.not.toThrow();
        });

        it("should stop typing automatically after timeout", async () => {
            vi.useFakeTimers();

            await typingManager.startTyping("!room:example.com", { timeout: 5000 });
            await vi.advanceTimersByTimeAsync(5000);

            expect(mockClient.sendTyping).toHaveBeenNthCalledWith(1, "!room:example.com", true, 5000);
            expect(mockClient.sendTyping).toHaveBeenNthCalledWith(2, "!room:example.com", false, 0);
        });
    });

    describe("stopTyping", () => {
        it("should stop typing in a room", async () => {
            await typingManager.startTyping("!room:example.com");
            await typingManager.stopTyping("!room:example.com");
            expect(mockClient.sendTyping).toHaveBeenCalledWith("!room:example.com", false, 0);
        });
    });

    describe("getTypingUsers", () => {
        it("should get typing users in a room", async () => {
            const users = await typingManager.getTypingUsers("!room:example.com");
            expect(users).toHaveLength(2);
            expect(users[0].userId).toBe("@user1:example.com");
        });

        it("should return empty array for unknown room", async () => {
            mockClient.getRoom.mockReturnValueOnce(null);
            const users = await typingManager.getTypingUsers("!unknown:example.com");
            expect(users).toHaveLength(0);
        });

        it("should return empty array when typing content user_ids is invalid", async () => {
            mockClient.getRoom.mockReturnValueOnce({
                currentState: {
                    getStateEvents: vi.fn().mockReturnValue({
                        getContent: vi.fn().mockReturnValue({
                            user_ids: undefined,
                            timeout: 30000,
                        }),
                    }),
                },
            });
            const users = await typingManager.getTypingUsers("!room:example.com");
            expect(users).toEqual([]);
        });
    });

    describe("getRoomsTyping", () => {
        it("should get typing users for multiple rooms", async () => {
            mockClient.getRoom
                .mockReturnValueOnce({
                    currentState: {
                        getStateEvents: vi.fn().mockReturnValue({
                            getContent: vi.fn().mockReturnValue({
                                user_ids: ["@user1:example.com"],
                                timeout: 30000,
                            }),
                        }),
                    },
                })
                .mockReturnValueOnce({
                    currentState: {
                        getStateEvents: vi.fn().mockReturnValue(null),
                    },
                });

            const result = await typingManager.getRoomsTyping(["!room1:example.com", "!room2:example.com"]);

            expect(result.size).toBe(1);
            expect(result.get("!room1:example.com")).toEqual([{ userId: "@user1:example.com", timeout: 30000 }]);
            expect(result.has("!room2:example.com")).toBe(false);
        });
    });

    describe("isUserTyping", () => {
        it("should check if user is typing in a room", async () => {
            await expect(typingManager.isUserTyping("!room:example.com", "@user1:example.com")).resolves.toBe(true);
            await expect(typingManager.isUserTyping("!room:example.com", "@nobody:example.com")).resolves.toBe(false);
        });
    });

    describe("clearAllTimers", () => {
        it("should clear all typing timers", async () => {
            vi.useFakeTimers();
            await typingManager.startTyping("!room1:example.com");
            await typingManager.startTyping("!room2:example.com");

            typingManager.clearAllTimers();
            await vi.advanceTimersByTimeAsync(30000);

            expect(mockClient.sendTyping).toHaveBeenCalledTimes(2);
        });
    });

    describe("start/stop", () => {
        it("should start and stop without errors", () => {
            expect(() => typingManager.start()).not.toThrow();
            expect(() => typingManager.stop()).not.toThrow();
        });
    });

    describe("fetchTypingUsers", () => {
        it("should fetch typing users via v3 room typing endpoint", async () => {
            mockAuthedRequest.mockResolvedValueOnce({
                user_ids: ["@user1:example.com", "@user2:example.com"],
                timeout: 10000,
            });

            const result = await typingManager.fetchTypingUsers("!room:example.com");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/rooms/!room%3Aexample.com/typing",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result).toEqual([
                { userId: "@user1:example.com", timeout: 10000 },
                { userId: "@user2:example.com", timeout: 10000 },
            ]);
        });

        it("should accept legacy typing field as fallback", async () => {
            mockAuthedRequest.mockResolvedValueOnce({
                typing: ["@legacy:example.com"],
            });

            await expect(typingManager.fetchTypingUsers("!room:example.com")).resolves.toEqual([
                { userId: "@legacy:example.com", timeout: 30000 },
            ]);
        });
    });

    describe("fetchUserTyping", () => {
        it("should fetch a single user typing state", async () => {
            mockAuthedRequest.mockResolvedValueOnce({ typing: true });

            await expect(typingManager.fetchUserTyping("!room:example.com", "@user:example.com")).resolves.toBe(true);
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/rooms/!room%3Aexample.com/typing/%40user%3Aexample.com",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });
    });

    describe("fetchRoomsTyping", () => {
        it("should post room_ids and map wrapped batch typing responses", async () => {
            mockAuthedRequest.mockResolvedValueOnce({
                rooms: {
                    "!room1:example.com": { user_ids: ["@user1:example.com"], timeout: 5000 },
                    "!room2:example.com": { typing: ["@legacy:example.com"] },
                },
            });

            const result = await typingManager.fetchRoomsTyping(["!room1:example.com", "!room2:example.com"]);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/rooms/typing",
                undefined,
                { room_ids: ["!room1:example.com", "!room2:example.com"] },
                { prefix: ClientPrefix.V3 },
            );
            expect(result.get("!room1:example.com")).toEqual([{ userId: "@user1:example.com", timeout: 5000 }]);
            expect(result.get("!room2:example.com")).toEqual([{ userId: "@legacy:example.com", timeout: 30000 }]);
        });

        it("should also accept unwrapped batch typing responses", async () => {
            mockAuthedRequest.mockResolvedValueOnce({
                "!room1:example.com": { user_ids: ["@user1:example.com"] },
            });

            await expect(typingManager.fetchRoomsTyping(["!room1:example.com"])).resolves.toEqual(
                new Map([["!room1:example.com", [{ userId: "@user1:example.com", timeout: 30000 }]]]),
            );
        });
    });
});
