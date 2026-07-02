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

import { describe, it, expect, beforeEach, vi } from "vitest";

import { type MatrixClient } from "../../src/client";
import { FriendManager, FriendEvent, type Friend, type FriendRequest, type FriendSearchResult } from "../../src/friend/index.ts";
import { InvalidParamError } from "../../src/common/errors.ts";
import { Method } from "../../src/http-api/method.ts";
import { ClientPrefix } from "../../src/http-api/prefix.ts";
import { NotFoundError } from "../../src/errors";

describe("FriendManager", () => {
    let client: MatrixClient;
    let friendManager: FriendManager;
    let mockAuthedRequest: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockAuthedRequest = vi.fn();
        client = {
            http: {
                authedRequest: mockAuthedRequest,
            },
            getUserId: () => "@alice:example.com",
        } as any;

        friendManager = new FriendManager(client);
    });

    describe("isSupported", () => {
        it("defaults to supported for clients without centralized discovery", async () => {
            await expect(friendManager.isSupported()).resolves.toBe(true);
        });

        it("uses centralized synapse-rust friends discovery when available", async () => {
            (client as any).doesServerAdvertiseSynapseRustFeature = vi.fn().mockResolvedValue(false);

            await expect(friendManager.isSupported()).resolves.toBe(false);
            expect((client as any).doesServerAdvertiseSynapseRustFeature).toHaveBeenCalledWith("io.hula.friends");
        });
    });

    describe("sendFriendRequest", () => {
        it("should send a friend request successfully", async () => {
            mockAuthedRequest.mockResolvedValue({});

            const eventSpy = vi.fn();
            friendManager.on(FriendEvent.Invited, eventSpy);

            await friendManager.sendFriendRequest("@bob:example.com", "Hello!");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/friends/request",
                undefined,
                { user_id: "@bob:example.com", message: "Hello!" },
                { prefix: ClientPrefix.V1 },
            );

            expect(eventSpy).toHaveBeenCalledWith(
                "@bob:example.com",
                expect.objectContaining({
                    user_id: "@bob:example.com",
                    reason: "Hello!",
                    status: "pending",
                }),
            );
        });

        it("should throw InvalidParamError for empty user ID", async () => {
            await expect(friendManager.sendFriendRequest("")).rejects.toThrow(InvalidParamError);
        });

        it("should throw InvalidParamError when sending request to self", async () => {
            await expect(friendManager.sendFriendRequest("@alice:example.com")).rejects.toThrow(InvalidParamError);
        });

        it("should send request without reason", async () => {
            mockAuthedRequest.mockResolvedValue({});

            await friendManager.sendFriendRequest("@bob:example.com");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/friends/request",
                undefined,
                { user_id: "@bob:example.com", message: undefined },
                { prefix: ClientPrefix.V1 },
            );
        });

        it("should expose request_id/status from backend response", async () => {
            mockAuthedRequest.mockResolvedValue({ request_id: "req-123", status: "pending" });
            const result = await friendManager.sendFriendRequest("@bob:example.com");
            expect(result).toEqual({ request_id: "req-123", status: "pending" });
        });

        it("should reject request messages longer than the backend limit", async () => {
            await expect(friendManager.sendFriendRequest("@bob:example.com", "a".repeat(501))).rejects.toThrow(
                InvalidParamError,
            );
            expect(mockAuthedRequest).not.toHaveBeenCalled();
        });
    });

    describe("acceptFriendRequest", () => {
        it("should accept a friend request successfully", async () => {
            mockAuthedRequest.mockResolvedValue({});

            const acceptedSpy = vi.fn();
            const listUpdatedSpy = vi.fn();
            friendManager.on(FriendEvent.Accepted, acceptedSpy);
            friendManager.on(FriendEvent.ListUpdated, listUpdatedSpy);

            await friendManager.acceptFriendRequest("@bob:example.com");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/friends/request/%40bob%3Aexample.com/accept",
                undefined,
                undefined,
                { prefix: ClientPrefix.V1 },
            );

            expect(acceptedSpy).toHaveBeenCalledWith("@bob:example.com");
            expect(listUpdatedSpy).toHaveBeenCalled();
        });

        it("should throw InvalidParamError for empty user ID", async () => {
            await expect(friendManager.acceptFriendRequest("")).rejects.toThrow(InvalidParamError);
        });

        it("should expose room_id from backend response", async () => {
            mockAuthedRequest.mockResolvedValue({ room_id: "!room-dm:example.com" });
            const result = await friendManager.acceptFriendRequest("@bob:example.com");
            expect(result).toEqual({ room_id: "!room-dm:example.com" });
        });
    });

    describe("rejectFriendRequest", () => {
        it("should reject a friend request successfully", async () => {
            mockAuthedRequest.mockResolvedValue({});

            const rejectedSpy = vi.fn();
            friendManager.on(FriendEvent.Rejected, rejectedSpy);

            await friendManager.rejectFriendRequest("@bob:example.com");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/friends/request/%40bob%3Aexample.com/reject",
                undefined,
                undefined,
                { prefix: ClientPrefix.V1 },
            );

            expect(rejectedSpy).toHaveBeenCalledWith("@bob:example.com");
        });

        it("should throw InvalidParamError for empty user ID", async () => {
            await expect(friendManager.rejectFriendRequest("")).rejects.toThrow(InvalidParamError);
        });
    });

    describe("cancelFriendRequest", () => {
        it("should cancel a friend request successfully", async () => {
            mockAuthedRequest.mockResolvedValue({});

            const cancelledSpy = vi.fn();
            friendManager.on(FriendEvent.Cancelled, cancelledSpy);

            await friendManager.cancelFriendRequest("@bob:example.com");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/friends/request/%40bob%3Aexample.com/cancel",
                undefined,
                undefined,
                { prefix: ClientPrefix.V1 },
            );

            expect(cancelledSpy).toHaveBeenCalledWith("@bob:example.com");
        });

        it("should throw InvalidParamError for empty user ID", async () => {
            await expect(friendManager.cancelFriendRequest("")).rejects.toThrow(InvalidParamError);
        });
    });

    describe("removeFriend", () => {
        it("should remove a friend successfully", async () => {
            mockAuthedRequest.mockResolvedValue({});

            const removedSpy = vi.fn();
            const listUpdatedSpy = vi.fn();
            friendManager.on(FriendEvent.Removed, removedSpy);
            friendManager.on(FriendEvent.ListUpdated, listUpdatedSpy);

            await friendManager.removeFriend("@bob:example.com");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Delete,
                "/friends/%40bob%3Aexample.com",
                undefined,
                undefined,
                { prefix: ClientPrefix.V1 },
            );

            expect(removedSpy).toHaveBeenCalledWith("@bob:example.com");
            expect(listUpdatedSpy).toHaveBeenCalled();
        });

        it("should throw InvalidParamError for empty user ID", async () => {
            await expect(friendManager.removeFriend("")).rejects.toThrow(InvalidParamError);
        });
    });

    describe("getFriends", () => {
        it("should fetch and cache friends list", async () => {
            const mockFriends: Friend[] = [
                { user_id: "@bob:example.com", status: "normal", since: 123456 },
                { user_id: "@charlie:example.com", status: "favorite", since: 123457 },
            ];

            mockAuthedRequest.mockResolvedValue({ friends: mockFriends, room_id: "!friends:example.com" });

            const friends = await friendManager.getFriends();

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/friends", undefined, undefined, {
                prefix: ClientPrefix.V3,
            });

            expect(friends).toEqual(mockFriends);
            expect(friendManager.getCachedFriends()).toHaveLength(2);
            expect(friendManager.getFriendListRoomId()).toBe("!friends:example.com");
        });

        it("should map backend displayname into display_name", async () => {
            mockAuthedRequest.mockResolvedValue({
                friends: [{ user_id: "@bob:example.com", status: "normal", displayname: "Bob" }],
            });

            const friends = await friendManager.getFriends();

            expect(friends[0]).toEqual(
                expect.objectContaining({
                    user_id: "@bob:example.com",
                    displayname: "Bob",
                    display_name: "Bob",
                }),
            );
        });

        it("should normalize friend status", async () => {
            mockAuthedRequest.mockResolvedValue({
                friends: [{ user_id: "@bob:example.com", status: "invalid_status" }],
            });

            const friends = await friendManager.getFriends();

            expect(friends[0].status).toBe("normal");
        });

        it("should handle empty friends list", async () => {
            mockAuthedRequest.mockResolvedValue({ friends: [] });

            const friends = await friendManager.getFriends();

            expect(friends).toEqual([]);
        });

        it("should reuse the backend-provided friend list room id", async () => {
            mockAuthedRequest.mockResolvedValueOnce({
                friends: [{ user_id: "@bob:example.com", status: "normal" }],
                room_id: "!friends:example.com",
            });

            const roomId = await (friendManager as any).ensureFriendListRoom();

            expect(roomId).toBe("!friends:example.com");
            expect(mockAuthedRequest).toHaveBeenCalledTimes(1);
            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/friends", undefined, undefined, {
                prefix: ClientPrefix.V3,
            });
        });

        it("should not fall back to posting /friends when room_id is absent", async () => {
            mockAuthedRequest.mockResolvedValueOnce({ friends: [] });

            const roomId = await (friendManager as any).ensureFriendListRoom();

            expect(roomId).toBe("");
            expect(mockAuthedRequest).toHaveBeenCalledTimes(1);
            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/friends", undefined, undefined, {
                prefix: ClientPrefix.V3,
            });
        });
    });

    describe("getIncomingRequests", () => {
        it("should fetch incoming friend requests", async () => {
            const mockRequests: FriendRequest[] = [
                { user_id: "@bob:example.com", status: "pending", timestamp: 123456 },
            ];

            mockAuthedRequest.mockResolvedValue({ requests: mockRequests });

            const requests = await friendManager.getIncomingRequests();

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/friends/request/received",
                undefined,
                undefined,
                { prefix: ClientPrefix.V1 },
            );

            expect(requests).toEqual(mockRequests);
        });

        it("should normalize request message into reason and display_name", async () => {
            mockAuthedRequest.mockResolvedValue({
                requests: [
                    {
                        user_id: "@bob:example.com",
                        status: "pending",
                        message: "hi",
                        displayname: "Bob",
                    },
                ],
            });

            const requests = await friendManager.getIncomingRequests();

            expect(requests[0]).toEqual(
                expect.objectContaining({
                    user_id: "@bob:example.com",
                    message: "hi",
                    reason: "hi",
                    displayname: "Bob",
                    display_name: "Bob",
                }),
            );
        });

        it("should fall back to the legacy incoming alias when canonical path is unavailable", async () => {
            const mockRequests: FriendRequest[] = [
                { user_id: "@bob:example.com", status: "pending", timestamp: 123456 },
            ];

            mockAuthedRequest
                .mockRejectedValueOnce(new NotFoundError("missing"))
                .mockResolvedValueOnce({ requests: mockRequests });

            const requests = await friendManager.getIncomingRequests();

            expect(mockAuthedRequest).toHaveBeenNthCalledWith(
                1,
                Method.Get,
                "/friends/request/received",
                undefined,
                undefined,
                { prefix: ClientPrefix.V1 },
            );
            expect(mockAuthedRequest).toHaveBeenNthCalledWith(
                2,
                Method.Get,
                "/friends/requests/incoming",
                undefined,
                undefined,
                { prefix: ClientPrefix.V1 },
            );
            expect(requests).toEqual(mockRequests);
        });
    });

    describe("getOutgoingRequests", () => {
        it("should fetch outgoing friend requests", async () => {
            const mockRequests: FriendRequest[] = [
                { user_id: "@charlie:example.com", status: "pending", timestamp: 123456 },
            ];

            mockAuthedRequest.mockResolvedValue({ requests: mockRequests });

            const requests = await friendManager.getOutgoingRequests();

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/friends/requests/outgoing",
                undefined,
                undefined,
                { prefix: ClientPrefix.V1 },
            );

            expect(requests).toEqual(mockRequests);
        });
    });

    describe("updateFriendStatus", () => {
        it("should update friend status successfully", async () => {
            mockAuthedRequest.mockResolvedValue({});

            // First add friend to cache
            mockAuthedRequest.mockResolvedValueOnce({
                friends: [{ user_id: "@bob:example.com", status: "normal" }],
            });
            await friendManager.getFriends();

            mockAuthedRequest.mockResolvedValue({});
            const updatedSpy = vi.fn();
            friendManager.on(FriendEvent.FriendUpdated, updatedSpy);

            await friendManager.updateFriendStatus("@bob:example.com", "favorite");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/friends/%40bob%3Aexample.com/status",
                undefined,
                { status: "favorite" },
                { prefix: ClientPrefix.V1 },
            );

            expect(updatedSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    user_id: "@bob:example.com",
                    status: "favorite",
                }),
            );
        });

        it("should throw InvalidParamError for invalid status", async () => {
            await expect(friendManager.updateFriendStatus("@bob:example.com", "invalid")).rejects.toThrow(
                InvalidParamError,
            );
        });

        it("should throw InvalidParamError for empty user ID", async () => {
            await expect(friendManager.updateFriendStatus("", "favorite")).rejects.toThrow(InvalidParamError);
        });
    });

    describe("checkFriendship", () => {
        it("should return true for a friend", async () => {
            mockAuthedRequest.mockResolvedValue({ user_id: "@bob:example.com", is_friend: true, are_friends: true });

            const result = await friendManager.checkFriendship("@bob:example.com");

            expect(result.is_friend).toBe(true);
        });

        it("should return false for non-friend", async () => {
            mockAuthedRequest.mockResolvedValue({ user_id: "@bob:example.com", is_friend: false, are_friends: false });

            const result = await friendManager.checkFriendship("@bob:example.com");

            expect(result.is_friend).toBe(false);
        });
    });

    describe("Friend Groups", () => {
        it("should create a friend group", async () => {
            mockAuthedRequest.mockResolvedValue({ id: "group123", name: "Best Friends", members: [], created_at: 1 });

            const group = await friendManager.createFriendGroup("Best Friends");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/friends/groups",
                undefined,
                { name: "Best Friends" },
                { prefix: ClientPrefix.V1 },
            );

            expect(group.id).toBe("group123");
            expect(group.name).toBe("Best Friends");
        });

        it("should add user to friend group", async () => {
            mockAuthedRequest.mockResolvedValue({});

            await friendManager.addToFriendGroup("group123", "@bob:example.com");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/friends/groups/group123/add/%40bob%3Aexample.com",
                undefined,
                undefined,
                { prefix: ClientPrefix.V1 },
            );
        });

        it("should remove user from friend group", async () => {
            mockAuthedRequest.mockResolvedValue({});

            await friendManager.removeFromFriendGroup("group123", "@bob:example.com");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Delete,
                "/friends/groups/group123/remove/%40bob%3Aexample.com",
                undefined,
                undefined,
                { prefix: ClientPrefix.V1 },
            );
        });

        it("should delete friend group", async () => {
            mockAuthedRequest.mockResolvedValue({});

            await friendManager.deleteFriendGroup("group123");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Delete,
                "/friends/groups/group123",
                undefined,
                undefined,
                { prefix: ClientPrefix.V1 },
            );
        });

        it("should rename friend group", async () => {
            mockAuthedRequest.mockResolvedValue({});

            await friendManager.renameFriendGroup("group123", "New Name");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/friends/groups/group123/name",
                undefined,
                { name: "New Name" },
                { prefix: ClientPrefix.V1 },
            );
        });

        it("should throw InvalidParamError for invalid group name", async () => {
            await expect(friendManager.renameFriendGroup("group123", "")).rejects.toThrow(InvalidParamError);
            await expect(friendManager.renameFriendGroup("group123", "a".repeat(51))).rejects.toThrow(
                InvalidParamError,
            );
        });

        it("should get friends in group", async () => {
            const mockFriends: Friend[] = [{ user_id: "@bob:example.com", status: "normal" }];
            mockAuthedRequest.mockResolvedValue({ friends: mockFriends });

            const friends = await friendManager.getFriendsInGroup("group123");

            expect(friends).toEqual(mockFriends);
        });

        it("should get groups for user", async () => {
            const mockGroups = [
                { id: "group1", name: "Work", members: ["@bob:example.com"], created_at: 1700000000000 },
                { id: "group2", name: "Family", members: ["@bob:example.com"], created_at: 1700000000000 },
            ];
            mockAuthedRequest.mockResolvedValue({ groups: mockGroups });

            const groups = await friendManager.getGroupsForUser("@bob:example.com");

            expect(groups).toEqual(mockGroups);
        });
    });

    describe("Cache Management", () => {
        it("should return cache statistics", async () => {
            mockAuthedRequest.mockResolvedValue({
                friends: [{ user_id: "@bob:example.com", status: "normal" }],
            });

            await friendManager.getFriends();
            await friendManager.checkFriendship("@bob:example.com");

            const stats = friendManager.getCacheStats();

            expect(stats).toHaveProperty("size");
            expect(stats).toHaveProperty("hits");
            expect(stats).toHaveProperty("misses");
            expect(stats).toHaveProperty("hitRate");
        });

        it("should clear cache", async () => {
            mockAuthedRequest.mockResolvedValue({
                friends: [{ user_id: "@bob:example.com", status: "normal" }],
            });

            await friendManager.getFriends();
            expect(friendManager.getCachedFriends()).toHaveLength(1);

            friendManager.clearCache();
            expect(friendManager.getCachedFriends()).toHaveLength(0);
        });

        it("should return friend count", async () => {
            mockAuthedRequest.mockResolvedValue({
                friends: [
                    { user_id: "@bob:example.com", status: "normal" },
                    { user_id: "@charlie:example.com", status: "normal" },
                ],
            });

            await friendManager.getFriends();

            expect(friendManager.getFriendCount()).toBe(2);
        });
    });

    describe("Additional Methods", () => {
        it("should check friendship status", async () => {
            mockAuthedRequest.mockResolvedValue({ is_friend: true, are_friends: true, user_id: "@bob:example.com" });

            const result = await friendManager.checkFriendship("@bob:example.com");

            expect(result).toEqual({ is_friend: true, are_friends: true, user_id: "@bob:example.com" });
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/friends/check/%40bob%3Aexample.com",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });

        it("should update friend note", async () => {
            mockAuthedRequest.mockResolvedValue({});

            await friendManager.updateFriendNote("@bob:example.com", "My best friend");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/friends/%40bob%3Aexample.com/note",
                undefined,
                { note: "My best friend" },
                { prefix: ClientPrefix.V1 },
            );
        });

        it("should get friend suggestions", async () => {
            const mockSuggestions: Friend[] = [{ user_id: "@dave:example.com", status: "normal" }];
            mockAuthedRequest.mockResolvedValue({ suggestions: mockSuggestions });

            const suggestions = await friendManager.getFriendSuggestions(5);

            expect(suggestions).toEqual(mockSuggestions);
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/friends/suggestions",
                { limit: "5" },
                undefined,
                { prefix: ClientPrefix.V1 },
            );
        });

        it("should set friend display name", async () => {
            mockAuthedRequest.mockResolvedValue({});

            await friendManager.setFriendDisplayName("@bob:example.com", "Bobby");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/friends/%40bob%3Aexample.com/displayname",
                undefined,
                { displayname: "Bobby" },
                { prefix: ClientPrefix.V1 },
            );
        });

        it("should get friend info", async () => {
            const mockFriend: Friend = { user_id: "@bob:example.com", status: "normal" };
            mockAuthedRequest.mockResolvedValue(mockFriend);

            const friend = await friendManager.getFriendInfo("@bob:example.com");

            expect(friend).toEqual(mockFriend);
        });

        it("should return the full friend status object via getFriendStatusInfo", async () => {
            mockAuthedRequest.mockResolvedValue({
                user_id: "@bob:example.com",
                status: "none",
                is_friend: false,
            });

            const status = await friendManager.getFriendStatusInfo("@bob:example.com");

            expect(status).toEqual({
                user_id: "@bob:example.com",
                status: "none",
                is_friend: false,
            });
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/friends/%40bob%3Aexample.com/status",
                undefined,
                undefined,
                { prefix: ClientPrefix.V1 },
            );
        });

        it("should preserve getFriendStatus as the status-string helper", async () => {
            mockAuthedRequest.mockResolvedValue({
                user_id: "@bob:example.com",
                status: "favorite",
                is_friend: true,
            });

            await expect(friendManager.getFriendStatus("@bob:example.com")).resolves.toBe("favorite");
        });

        it("should search users with fuzzy match (default)", async () => {
            const mockResults: FriendSearchResult[] = [
                {
                    user_id: "@bob:example.com",
                    username: "bob",
                    displayname: "Bob Smith",
                    avatar_url: "mxc://example.com/avatar",
                    presence: "online",
                    online: true,
                    last_active_ts: 1700000000000,
                    match_score: 0.95,
                    match_type: "fuzzy",
                },
                {
                    user_id: "@charlie:example.com",
                    username: "charlie",
                    displayname: "Charlie",
                    presence: "offline",
                    online: false,
                    match_score: 0.6,
                    match_type: "fuzzy",
                },
            ];

            mockAuthedRequest.mockResolvedValue({
                results: mockResults,
                count: 2,
                mode: "fuzzy",
                limited: false,
                retry_after_seconds: 0,
            });

            const response = await friendManager.searchUsers("bob");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/friends/search",
                { q: "bob" },
                undefined,
                { prefix: ClientPrefix.V3 },
            );

            expect(response.results).toHaveLength(2);
            expect(response.results![0].user_id).toBe("@bob:example.com");
            expect(response.results![0].presence).toBe("online");
            expect(response.results![0].online).toBe(true);
            expect(response.results![0].match_score).toBe(0.95);
            expect(response.count).toBe(2);
            expect(response.mode).toBe("fuzzy");
            expect(response.limited).toBe(false);
        });

        it("should search users with exact match mode", async () => {
            mockAuthedRequest.mockResolvedValue({
                results: [{ user_id: "@bob:example.com", match_type: "exact" }],
                count: 1,
                mode: "exact",
                limited: false,
                retry_after_seconds: 0,
            });

            const response = await friendManager.searchUsers("@bob:example.com", "exact");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/friends/search",
                { q: "@bob:example.com", mode: "exact" },
                undefined,
                { prefix: ClientPrefix.V3 },
            );

            expect(response.mode).toBe("exact");
        });

        it("should pass custom limit to search", async () => {
            mockAuthedRequest.mockResolvedValue({
                results: [],
                count: 0,
                mode: "fuzzy",
                limited: false,
                retry_after_seconds: 0,
            });

            await friendManager.searchUsers("test", undefined, 5);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/friends/search",
                { q: "test", limit: 5 },
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });

        it("should throw InvalidParamError for empty search term", async () => {
            await expect(friendManager.searchUsers("")).rejects.toThrow(InvalidParamError);
            await expect(friendManager.searchUsers("   ")).rejects.toThrow(InvalidParamError);
        });

        it("should handle empty results", async () => {
            mockAuthedRequest.mockResolvedValue({
                results: [],
                count: 0,
                mode: "fuzzy",
                limited: false,
                retry_after_seconds: 0,
            });

            const response = await friendManager.searchUsers("nonexistent");

            expect(response.results).toHaveLength(0);
            expect(response.count).toBe(0);
        });

        it("should propagate API errors", async () => {
            const apiError = new Error("Network error");
            mockAuthedRequest.mockRejectedValue(apiError);

            await expect(friendManager.searchUsers("test")).rejects.toThrow();
        });

        it("should trim whitespace from search term", async () => {
            mockAuthedRequest.mockResolvedValue({
                results: [],
                count: 0,
                mode: "fuzzy",
                limited: false,
                retry_after_seconds: 0,
            });

            await friendManager.searchUsers("  alice  ");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/friends/search",
                { q: "alice" },
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });

        it("should expose retry_after_seconds for rate limiting", async () => {
            mockAuthedRequest.mockResolvedValue({
                results: [],
                count: 0,
                mode: "fuzzy",
                limited: true,
                retry_after_seconds: 5,
            });

            const response = await friendManager.searchUsers("spam");

            expect(response.retry_after_seconds).toBe(5);
            expect(response.limited).toBe(true);
        });

        it("should return null for non-existent friend info when throwOnError is false", async () => {
            const notFoundError = new NotFoundError("Not found");
            mockAuthedRequest.mockRejectedValue(notFoundError);

            const friend = await friendManager.getFriendInfo("@bob:example.com", false);

            expect(friend).toBeNull();
        });

        it("should throw on 404 error by default", async () => {
            const notFoundError = new NotFoundError("Not found");
            mockAuthedRequest.mockRejectedValue(notFoundError);

            await expect(friendManager.getFriendInfo("@bob:example.com")).rejects.toThrow();
        });
    });

    describe("Lifecycle Methods", () => {
        it("should sync all friend data", async () => {
            mockAuthedRequest
                .mockResolvedValueOnce({ friends: [] })
                .mockResolvedValueOnce({ requests: [] })
                .mockResolvedValueOnce({ requests: [] });

            const syncSpy = vi.fn();
            friendManager.on(FriendEvent.SyncComplete, syncSpy);

            await friendManager.sync();

            expect(syncSpy).toHaveBeenCalled();
        });

        it("should start and initialize manager", async () => {
            mockAuthedRequest
                .mockResolvedValueOnce({ friends: [] })
                .mockResolvedValueOnce({ requests: [] })
                .mockResolvedValueOnce({ requests: [] })
                .mockResolvedValueOnce({ groups: [] });

            await friendManager.start();

            expect(mockAuthedRequest).toHaveBeenCalledTimes(4);
        });

        it("should not reinitialize if already started", async () => {
            mockAuthedRequest
                .mockResolvedValueOnce({ friends: [] })
                .mockResolvedValueOnce({ requests: [] })
                .mockResolvedValueOnce({ requests: [] })
                .mockResolvedValueOnce({ groups: [] });

            await friendManager.start();
            await friendManager.start();

            expect(mockAuthedRequest).toHaveBeenCalledTimes(4);
        });

        it("should stop and clear all data", async () => {
            mockAuthedRequest.mockResolvedValue({ friends: [{ user_id: "@bob:example.com", status: "normal" }] });

            await friendManager.getFriends();
            expect(friendManager.getCachedFriends()).toHaveLength(1);

            friendManager.stop();

            expect(friendManager.getCachedFriends()).toHaveLength(0);
            expect(friendManager.getCachedIncomingRequests()).toHaveLength(0);
            expect(friendManager.getCachedOutgoingRequests()).toHaveLength(0);
        });
    });

});
