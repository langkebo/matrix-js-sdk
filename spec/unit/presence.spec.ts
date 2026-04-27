import { describe, it, expect, beforeEach, vi } from "vitest";

import { PresenceManager, PresenceEvent, type PresenceState } from "../../src/presence/index";
import { InvalidParamError } from "../../src/common/errors.ts";
import { AuthError, NotFoundError, RetryableError, ApiError } from "../../src/errors";

describe("PresenceManager", () => {
    let mockClient: any;
    let presenceManager: PresenceManager;

    const createMockClient = () => ({
        http: {
            authedRequest: vi.fn().mockImplementation((method: any, path: string) => {
                if (path.includes("/presence/") && path.includes("/status")) {
                    return Promise.resolve({
                        presence: "online",
                        last_active_ago: 5000,
                        status_msg: "Hello",
                    });
                }
                if (path.includes("/presence/list")) {
                    return Promise.resolve({
                        presences: [
                            {
                                user_id: "@user1:example.com",
                                presence: "online",
                                last_active_ago: 1000,
                                status_msg: "Working",
                            },
                            {
                                user_id: "@user2:example.com",
                                presence: "offline",
                                last_active_ago: 60000,
                            },
                        ],
                    });
                }
                return Promise.resolve({});
            }),
        },
        userId: "@test:example.com",
        getUserId: vi.fn().mockReturnValue("@test:example.com"),
        credentials: {
            userId: "@test:example.com",
        },
    });

    beforeEach(() => {
        mockClient = createMockClient();
        presenceManager = new PresenceManager(mockClient);
        vi.spyOn(presenceManager as any, "sleep").mockResolvedValue(undefined);
    });

    describe("Constructor", () => {
        it("should initialize with empty cache", () => {
            expect(presenceManager.getCachedPresences().size).toBe(0);
            expect(presenceManager.getSubscribedUsers().length).toBe(0);
        });
    });

    describe("setPresence", () => {
        it("should set user presence successfully", async () => {
            await presenceManager.setPresence("online", "Available");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "PUT",
                expect.stringContaining("/presence/"),
                {},
                { presence: "online", status_msg: "Available" },
                { prefix: "/_matrix/client/v3", priority: undefined },
            );
        });

        it("should set presence without status message", async () => {
            await presenceManager.setPresence("offline");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "PUT",
                expect.stringContaining("/presence/"),
                {},
                { presence: "offline" },
                { prefix: "/_matrix/client/v3", priority: undefined },
            );
        });

        it("should throw InvalidParamError when presence is empty", async () => {
            await expect(presenceManager.setPresence("" as PresenceState)).rejects.toThrow(InvalidParamError);
        });

        it("should throw InvalidParamError for invalid presence state", async () => {
            await expect(presenceManager.setPresence("invalid" as PresenceState)).rejects.toThrow(InvalidParamError);
        });

        it("should emit PresenceUpdated event on success", async () => {
            const listener = vi.fn();
            presenceManager.on(PresenceEvent.PresenceUpdated, listener);
            await presenceManager.setPresence("online", "Test");
            expect(listener).toHaveBeenCalledWith(
                "@test:example.com",
                expect.objectContaining({
                    presence: "online",
                    status_msg: "Test",
                }),
            );
        });

        it("should emit PresenceError event on failure", async () => {
            const errorListener = vi.fn();
            presenceManager.on(PresenceEvent.PresenceError, errorListener);
            mockClient.http.authedRequest.mockRejectedValue({
                message: "Network error",
                httpStatus: 500,
            });
            await expect(presenceManager.setPresence("online")).rejects.toThrow();
            expect(errorListener).toHaveBeenCalled();
        });

        it("should throw AuthError on 401", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce({
                message: "Unauthorized",
                httpStatus: 401,
                errcode: "M_UNKNOWN_TOKEN",
            });
            await expect(presenceManager.setPresence("online")).rejects.toThrow(AuthError);
        });

        it("should URL encode user ID", async () => {
            await presenceManager.setPresence("online");
            const call = mockClient.http.authedRequest.mock.calls[0];
            expect(call[1]).toContain(encodeURIComponent("@test:example.com"));
        });
    });

    describe("getPresence", () => {
        it("should get user presence successfully", async () => {
            const presence = await presenceManager.getPresence("@other:example.com");
            expect(presence).toBeDefined();
            expect(presence?.presence).toBe("online");
            expect(presence?.status_msg).toBe("Hello");
        });

        it("should throw InvalidParamError when userId is empty", async () => {
            await expect(presenceManager.getPresence("")).rejects.toThrow(InvalidParamError);
        });

        it("should return cached presence if available", async () => {
            await presenceManager.setPresence("online", "Cached");
            mockClient.http.authedRequest.mockClear();
            const presence = await presenceManager.getPresence("@test:example.com");
            expect(presence?.status_msg).toBe("Cached");
            expect(mockClient.http.authedRequest).not.toHaveBeenCalled();
        });

        it("should return null on 404 error when throwOnError is false", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce({
                message: "Not found",
                httpStatus: 404,
                errcode: "M_NOT_FOUND",
            });
            const presence = await presenceManager.getPresence("@unknown:example.com", false, false);
            expect(presence).toBeNull();
        });

        it("should throw error on 404 by default", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce({
                message: "Not found",
                httpStatus: 404,
                errcode: "M_NOT_FOUND",
            });
            await expect(presenceManager.getPresence("@unknown:example.com")).rejects.toThrow();
        });

        it("should throw AuthError on 401", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce({
                message: "Unauthorized",
                httpStatus: 401,
                errcode: "M_UNKNOWN_TOKEN",
            });
            await expect(presenceManager.getPresence("@user:example.com")).rejects.toThrow(AuthError);
        });

        it("should throw RetryableError on network error", async () => {
            mockClient.http.authedRequest.mockRejectedValue({
                message: "Connection reset",
                code: "ECONNRESET",
            });
            await expect(presenceManager.getPresence("@user:example.com")).rejects.toThrow(RetryableError);
        });

        it("should URL encode user ID in request", async () => {
            await presenceManager.getPresence("@user:example.com");
            const call = mockClient.http.authedRequest.mock.calls[0];
            expect(call[1]).toContain(encodeURIComponent("@user:example.com"));
        });
    });

    describe("getPresences", () => {
        it("should get presences for multiple users", async () => {
            const presences = await presenceManager.getPresences(["@user1:example.com", "@user2:example.com"]);
            expect(presences.size).toBe(2);
        });

        it("should skip users with null presence", async () => {
            mockClient.http.authedRequest
                .mockResolvedValueOnce({ presence: "online" })
                .mockRejectedValueOnce({ httpStatus: 404, errcode: "M_NOT_FOUND" });
            const presences = await presenceManager.getPresences(["@user1:example.com", "@user2:example.com"]);
            expect(presences.size).toBe(1);
        });
    });

    describe("subscribeToPresence", () => {
        it("should subscribe to user presences", async () => {
            await presenceManager.subscribeToPresence(["@user1:example.com", "@user2:example.com"]);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                "/presence/list",
                {},
                { subscribe: ["@user1:example.com", "@user2:example.com"] },
                { prefix: "/_matrix/client/v3", priority: undefined },
            );
            expect(presenceManager.isSubscribed("@user1:example.com")).toBe(true);
            expect(presenceManager.isSubscribed("@user2:example.com")).toBe(true);
        });

        it("should throw InvalidParamError when userIds is empty", async () => {
            await expect(presenceManager.subscribeToPresence([])).rejects.toThrow(InvalidParamError);
            await expect(presenceManager.subscribeToPresence(null as any)).rejects.toThrow(InvalidParamError);
        });

        it("should emit PresenceError event on failure", async () => {
            const errorListener = vi.fn();
            presenceManager.on(PresenceEvent.PresenceError, errorListener);
            mockClient.http.authedRequest.mockRejectedValue({
                message: "Server error",
                httpStatus: 500,
            });
            await expect(presenceManager.subscribeToPresence(["@user:example.com"])).rejects.toThrow();
            expect(errorListener).toHaveBeenCalled();
        });
    });

    describe("unsubscribeFromPresence", () => {
        it("should unsubscribe from user presences", async () => {
            mockClient.http.authedRequest
                .mockResolvedValueOnce({
                    presences: [
                        {
                            user_id: "@user1:example.com",
                            presence: "online",
                            last_active_ago: 1000,
                            status_msg: "Working",
                        },
                        {
                            user_id: "@user2:example.com",
                            presence: "offline",
                            last_active_ago: 60000,
                        },
                    ],
                })
                .mockResolvedValueOnce({
                    presences: [
                        {
                            user_id: "@user2:example.com",
                            presence: "offline",
                            last_active_ago: 60000,
                        },
                    ],
                });
            await presenceManager.subscribeToPresence(["@user1:example.com", "@user2:example.com"]);
            await presenceManager.unsubscribeFromPresence(["@user1:example.com"]);
            expect(mockClient.http.authedRequest).toHaveBeenLastCalledWith(
                "POST",
                "/presence/list",
                {},
                { unsubscribe: ["@user1:example.com"] },
                { prefix: "/_matrix/client/v3", priority: undefined },
            );
            expect(presenceManager.isSubscribed("@user1:example.com")).toBe(false);
            expect(presenceManager.isSubscribed("@user2:example.com")).toBe(true);
        });

        it("should throw InvalidParamError when userIds is empty", async () => {
            await expect(presenceManager.unsubscribeFromPresence([])).rejects.toThrow(InvalidParamError);
        });

        it("should emit PresenceError event on failure", async () => {
            const errorListener = vi.fn();
            presenceManager.on(PresenceEvent.PresenceError, errorListener);
            mockClient.http.authedRequest.mockRejectedValue({
                message: "Server error",
                httpStatus: 500,
            });
            await expect(presenceManager.unsubscribeFromPresence(["@user:example.com"])).rejects.toThrow();
            expect(errorListener).toHaveBeenCalled();
        });
    });

    describe("getSubscribedPresence", () => {
        it("should get subscribed presence list", async () => {
            const events = await presenceManager.getSubscribedPresence();
            expect(events).toHaveLength(2);
            expect(events[0].user_id).toBe("@user1:example.com");
            expect(events[1].user_id).toBe("@user2:example.com");
        });

        it("should emit PresenceListUpdated event", async () => {
            const listener = vi.fn();
            presenceManager.on(PresenceEvent.PresenceListUpdated, listener);
            await presenceManager.getSubscribedPresence();
            expect(listener).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ user_id: "@user1:example.com" }),
                    expect.objectContaining({ user_id: "@user2:example.com" }),
                ]),
            );
        });

        it("should update cache with presence data", async () => {
            await presenceManager.getSubscribedPresence();
            const cached = presenceManager.getCachedPresence("@user1:example.com");
            expect(cached).toBeDefined();
            expect(cached?.presence).toBe("online");
        });

        it("should return empty array on 404", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce({
                message: "Not found",
                httpStatus: 404,
                errcode: "M_NOT_FOUND",
            });
            const events = await presenceManager.getSubscribedPresence();
            expect(events).toEqual([]);
        });

        it("should throw ApiError on other errors", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce({
                message: "Forbidden",
                httpStatus: 403,
                errcode: "M_FORBIDDEN",
            });
            await expect(presenceManager.getSubscribedPresence()).rejects.toThrow(ApiError);
        });
    });

    describe("getPresenceList", () => {
        it("should get presence list for specific user", async () => {
            const events = await presenceManager.getPresenceList("@target:example.com");
            expect(events).toHaveLength(2);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                expect.stringContaining("/presence/list/"),
                {},
                undefined,
                { prefix: "/_matrix/client/v3", priority: undefined },
            );
        });

        it("should use POST /presence/list for the current user's subscriptions", async () => {
            const events = await presenceManager.getPresenceList();
            expect(events).toHaveLength(2);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                "/presence/list",
                {},
                {},
                { prefix: "/_matrix/client/v3", priority: undefined },
            );
        });

        it("should throw InvalidParamError when userId is empty", async () => {
            await expect(presenceManager.getPresenceList("")).rejects.toThrow(InvalidParamError);
        });

        it("should URL encode user ID", async () => {
            await presenceManager.getPresenceList("@user:example.com");
            const call = mockClient.http.authedRequest.mock.calls[0];
            expect(call[1]).toContain(encodeURIComponent("@user:example.com"));
        });

        it("should update cache with presence data", async () => {
            await presenceManager.getPresenceList("@target:example.com");
            const cached = presenceManager.getCachedPresence("@user1:example.com");
            expect(cached).toBeDefined();
            expect(cached?.presence).toBe("online");
        });

        it("should return empty array on 404 when throwOnError is false", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce({
                message: "Not found",
                httpStatus: 404,
                errcode: "M_NOT_FOUND",
            });
            const events = await presenceManager.getPresenceList("@unknown:example.com", false);
            expect(events).toEqual([]);
        });

        it("should throw error on 404 by default", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce({
                message: "Not found",
                httpStatus: 404,
                errcode: "M_NOT_FOUND",
            });
            await expect(presenceManager.getPresenceList("@unknown:example.com")).rejects.toThrow();
        });

        it("should throw AuthError on 401", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce({
                message: "Unauthorized",
                httpStatus: 401,
                errcode: "M_UNKNOWN_TOKEN",
            });
            await expect(presenceManager.getPresenceList("@user:example.com")).rejects.toThrow(AuthError);
        });

        it("should throw RetryableError on timeout", async () => {
            mockClient.http.authedRequest.mockRejectedValue({
                message: "Timeout",
                code: "ETIMEDOUT",
            });
            await expect(presenceManager.getPresenceList("@user:example.com")).rejects.toThrow(RetryableError);
        });

        it("should throw ApiError on other errors", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce({
                message: "Forbidden",
                httpStatus: 403,
                errcode: "M_FORBIDDEN",
            });
            await expect(presenceManager.getPresenceList("@user:example.com")).rejects.toThrow(ApiError);
        });
    });

    describe("getPresenceListByIds", () => {
        it("should get presence list by user ids", async () => {
            const events = await presenceManager.getPresenceListByIds(["@user1:example.com", "@user2:example.com"]);
            expect(events).toHaveLength(2);
            expect(mockClient.http.authedRequest).toHaveBeenNthCalledWith(
                1,
                "GET",
                `/presence/${encodeURIComponent("@user1:example.com")}/status`,
                {},
                undefined,
                { prefix: "/_matrix/client/v3", priority: undefined },
            );
            expect(mockClient.http.authedRequest).toHaveBeenNthCalledWith(
                2,
                "GET",
                `/presence/${encodeURIComponent("@user2:example.com")}/status`,
                {},
                undefined,
                { prefix: "/_matrix/client/v3", priority: undefined },
            );
        });

        it("should return empty array when userIds is empty", async () => {
            const events = await presenceManager.getPresenceListByIds([]);
            expect(events).toEqual([]);
            expect(mockClient.http.authedRequest).not.toHaveBeenCalled();
        });

        it("should return empty array on 404 when throwOnError is false", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce({
                message: "Not found",
                httpStatus: 404,
                errcode: "M_NOT_FOUND",
            });
            const events = await presenceManager.getPresenceListByIds(["@unknown:example.com"], false);
            expect(events).toEqual([]);
        });

        it("should throw error on 404 by default", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce({
                message: "Not found",
                httpStatus: 404,
                errcode: "M_NOT_FOUND",
            });
            await expect(presenceManager.getPresenceListByIds(["@unknown:example.com"])).rejects.toThrow();
        });

        it("should throw ApiError on other errors", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce({
                message: "Forbidden",
                httpStatus: 403,
                errcode: "M_FORBIDDEN",
            });
            await expect(presenceManager.getPresenceListByIds(["@user:example.com"])).rejects.toThrow(ApiError);
        });
    });

    describe("Convenience methods", () => {
        it("setOnline should set presence to online", async () => {
            await presenceManager.setOnline("Working");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "PUT",
                expect.any(String),
                {},
                { presence: "online", status_msg: "Working" },
                { prefix: "/_matrix/client/v3", priority: undefined },
            );
        });

        it("setOffline should set presence to offline", async () => {
            await presenceManager.setOffline("Gone home");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "PUT",
                expect.any(String),
                {},
                { presence: "offline", status_msg: "Gone home" },
                { prefix: "/_matrix/client/v3", priority: undefined },
            );
        });

        it("setUnavailable should set presence to unavailable", async () => {
            await presenceManager.setUnavailable("In a meeting");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "PUT",
                expect.any(String),
                {},
                { presence: "unavailable", status_msg: "In a meeting" },
                { prefix: "/_matrix/client/v3", priority: undefined },
            );
        });

        it("setBusy should set presence to busy", async () => {
            await presenceManager.setBusy("Do not disturb");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "PUT",
                expect.any(String),
                {},
                { presence: "busy", status_msg: "Do not disturb" },
                { prefix: "/_matrix/client/v3", priority: undefined },
            );
        });
    });

    describe("clearStatusMessage", () => {
        it("should clear status message while keeping presence", async () => {
            mockClient.http.authedRequest
                .mockResolvedValueOnce({ presence: "online", status_msg: "Old message" })
                .mockResolvedValueOnce({});
            await presenceManager.clearStatusMessage();
            const calls = mockClient.http.authedRequest.mock.calls;
            const lastCall = calls[calls.length - 1];
            expect(lastCall[3]).toEqual({ presence: "online" });
        });

        it("should do nothing if no current presence", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce({
                httpStatus: 404,
                errcode: "M_NOT_FOUND",
            });
            await presenceManager.clearStatusMessage();
            expect(mockClient.http.authedRequest).toHaveBeenCalledTimes(1);
        });
    });

    describe("updatePresenceFromSync", () => {
        it("should update cache from sync event", () => {
            presenceManager.updatePresenceFromSync({
                user_id: "@sync:example.com",
                presence: "online",
                status_msg: "From sync",
                last_active_ago: 1000,
            });
            const cached = presenceManager.getCachedPresence("@sync:example.com");
            expect(cached).toEqual({
                presence: "online",
                status_msg: "From sync",
                last_active_ago: 1000,
                currently_active: undefined,
            });
        });

        it("should emit PresenceUpdated event", () => {
            const listener = vi.fn();
            presenceManager.on(PresenceEvent.PresenceUpdated, listener);
            presenceManager.updatePresenceFromSync({
                user_id: "@sync:example.com",
                presence: "online",
            });
            expect(listener).toHaveBeenCalledWith(
                "@sync:example.com",
                expect.objectContaining({
                    presence: "online",
                }),
            );
        });
    });

    describe("Cache methods", () => {
        it("getCachedPresence should return null for unknown user", () => {
            expect(presenceManager.getCachedPresence("@unknown:example.com")).toBeNull();
        });

        it("getCachedPresences should return copy of cache", async () => {
            await presenceManager.setPresence("online", "Test");
            const cache1 = presenceManager.getCachedPresences();
            const cache2 = presenceManager.getCachedPresences();
            expect(cache1).not.toBe(cache2);
            expect(cache1.size).toBe(cache2.size);
        });
    });

    describe("Subscription methods", () => {
        it("getSubscribedUsers should return array of subscribed users", async () => {
            await presenceManager.subscribeToPresence(["@user1:example.com", "@user2:example.com"]);
            const users = presenceManager.getSubscribedUsers();
            expect(users).toContain("@user1:example.com");
            expect(users).toContain("@user2:example.com");
        });

        it("isSubscribed should return correct status", async () => {
            expect(presenceManager.isSubscribed("@user:example.com")).toBe(false);
            await presenceManager.subscribeToPresence(["@user:example.com"]);
            expect(presenceManager.isSubscribed("@user:example.com")).toBe(true);
        });
    });

    describe("start/stop lifecycle", () => {
        it("should initialize on start", async () => {
            await presenceManager.start();
            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });

        it("should not reinitialize if already started", async () => {
            await presenceManager.start();
            mockClient.http.authedRequest.mockClear();
            await presenceManager.start();
            expect(mockClient.http.authedRequest).not.toHaveBeenCalled();
        });

        it("should clear state on stop", async () => {
            await presenceManager.setPresence("online", "Test");
            await presenceManager.subscribeToPresence(["@user:example.com"]);
            presenceManager.stop();
            expect(presenceManager.getCachedPresences().size).toBe(0);
            expect(presenceManager.getSubscribedUsers().length).toBe(0);
        });
    });

    describe("Error handling", () => {
        it("should classify 401 as AuthError", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce({
                message: "Unauthorized",
                httpStatus: 401,
            });
            await expect(presenceManager.getPresence("@user:example.com")).rejects.toThrow(AuthError);
        });

        it("should classify M_UNKNOWN_TOKEN as AuthError", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce({
                message: "Token unknown",
                errcode: "M_UNKNOWN_TOKEN",
            });
            await expect(presenceManager.getPresence("@user:example.com")).rejects.toThrow(AuthError);
        });

        it("should classify 404 as NotFoundError", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce({
                message: "Not found",
                httpStatus: 404,
            });
            await expect(presenceManager.setPresence("online")).rejects.toThrow(NotFoundError);
        });

        it("should classify M_NOT_FOUND as NotFoundError", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce({
                message: "Not found",
                errcode: "M_NOT_FOUND",
            });
            await expect(presenceManager.setPresence("online")).rejects.toThrow(NotFoundError);
        });

        it("should classify ECONNRESET as RetryableError", async () => {
            mockClient.http.authedRequest.mockRejectedValue({
                message: "Connection reset",
                code: "ECONNRESET",
            });
            await expect(presenceManager.setPresence("online")).rejects.toThrow(RetryableError);
        });

        it("should classify ETIMEDOUT as RetryableError", async () => {
            mockClient.http.authedRequest.mockRejectedValue({
                message: "Timeout",
                code: "ETIMEDOUT",
            });
            await expect(presenceManager.setPresence("online")).rejects.toThrow(RetryableError);
        });

        it("should classify 5xx as RetryableError", async () => {
            mockClient.http.authedRequest.mockRejectedValue({
                message: "Server error",
                httpStatus: 503,
            });
            await expect(presenceManager.setPresence("online")).rejects.toThrow(RetryableError);
        });

        it("should classify other errors as ApiError", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce({
                message: "Forbidden",
                httpStatus: 403,
                errcode: "M_FORBIDDEN",
            });
            await expect(presenceManager.setPresence("online")).rejects.toThrow(ApiError);
        });
    });
});
