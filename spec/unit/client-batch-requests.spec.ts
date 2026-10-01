/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect, vi } from "vitest";

import {
    buildRoomStatePath,
    buildStateEventPath,
    roomStateRequest,
    fetchRoomEventRequest,
    membersRequest,
    getJoinedRoomMembersRequest,
    setRoomReadMarkersRequest,
    roomInitialSyncRequest,
    getJoinedRoomsRequest,
    publicRoomsRequest,
    createAliasRequest,
    deleteAliasRequest,
    getLocalAliasesRequest,
    getRoomIdForAliasRequest,
    getRoomDirectoryVisibilityRequest,
    setRoomDirectoryVisibilityRequest,
    buildSearchMessageRequestBody,
    searchMessageTextRequest,
    getOpenIdTokenRequest,
} from "../../src/client-batch-requests.ts";
import { getMyRoomsRequest } from "../../src/client-secure-backup-requests.ts";
import { Method, ClientPrefix, VendorPrefix } from "../../src/http-api/index.ts";
import { ReceiptType } from "../../src/@types/read_receipts.ts";
import { Visibility } from "../../src/@types/partials.ts";

describe("client-batch-requests", () => {
    const mockAuthedRequest = vi.fn();

    beforeEach(() => {
        mockAuthedRequest.mockReset();
    });

    describe("buildRoomStatePath", () => {
        it("should build correct room state path", () => {
            const path = buildRoomStatePath("!room:server");
            expect(path).toBe("/rooms/!room%3Aserver/state");
        });
    });

    describe("buildStateEventPath", () => {
        it("should build path without state key", () => {
            const path = buildStateEventPath("!room:server", "m.room.name");
            expect(path).toBe("/rooms/!room%3Aserver/state/m.room.name");
        });

        it("should build path with state key", () => {
            const path = buildStateEventPath("!room:server", "m.room.member", "@user:server");
            expect(path).toBe("/rooms/!room%3Aserver/state/m.room.member/%40user%3Aserver");
        });
    });

    describe("roomStateRequest", () => {
        it("should make request to get room state", async () => {
            const mockResponse = [{ type: "m.room.name", content: { name: "Test" } }];
            mockAuthedRequest.mockResolvedValue(mockResponse);

            const result = await roomStateRequest("!room:server", mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/rooms/!room%3Aserver/state");
            expect(result).toEqual(mockResponse);
        });
    });

    describe("fetchRoomEventRequest", () => {
        it("should make request to fetch room event", async () => {
            const mockResponse = { type: "m.room.message", content: { body: "test" } };
            mockAuthedRequest.mockResolvedValue(mockResponse);

            const result = await fetchRoomEventRequest("!room:server", "$event_id", mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/rooms/!room%3Aserver/event/%24event_id");
            expect(result).toEqual(mockResponse);
        });
    });

    describe("membersRequest", () => {
        it("should make request with all parameters", async () => {
            const mockResponse = { joined: [] };
            mockAuthedRequest.mockResolvedValue(mockResponse);

            const result = await membersRequest("!room:server", "join", "leave", "$at_event", mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                expect.stringContaining("/rooms/!room%3Aserver/members?"),
            );
            expect(result).toEqual(mockResponse);
        });

        it("should make request without optional parameters", async () => {
            const mockResponse = { joined: [] };
            mockAuthedRequest.mockResolvedValue(mockResponse);

            await membersRequest("!room:server", undefined, undefined, undefined, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, expect.stringContaining("/members?"));
        });
    });

    describe("getJoinedRoomMembersRequest", () => {
        it("should make request to get joined members", async () => {
            const mockResponse = { joined: { "@user:server": {} } };
            mockAuthedRequest.mockResolvedValue(mockResponse);

            const result = await getJoinedRoomMembersRequest("!room:server", mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/rooms/!room%3Aserver/joined_members");
            expect(result).toEqual(mockResponse);
        });
    });

    describe("setRoomReadMarkersRequest", () => {
        it("should set read markers with private read receipt support", async () => {
            mockAuthedRequest.mockResolvedValue({});

            await setRoomReadMarkersRequest(
                "!room:server",
                "$fully_read",
                "$read",
                "$read_private",
                async () => true,
                mockAuthedRequest,
            );

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/rooms/!room%3Aserver/read_markers",
                undefined,
                {
                    [ReceiptType.FullyRead]: "$fully_read",
                    [ReceiptType.Read]: "$read",
                    [ReceiptType.ReadPrivate]: "$read_private",
                },
            );
        });

        it("should set read markers without private read receipt when not supported", async () => {
            mockAuthedRequest.mockResolvedValue({});

            await setRoomReadMarkersRequest(
                "!room:server",
                "$fully_read",
                "$read",
                "$read_private",
                async () => false,
                mockAuthedRequest,
            );

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/rooms/!room%3Aserver/read_markers",
                undefined,
                {
                    [ReceiptType.FullyRead]: "$fully_read",
                    [ReceiptType.Read]: "$read",
                },
            );
        });
    });

    describe("roomInitialSyncRequest", () => {
        it("should make request with default limit", async () => {
            const mockResponse = { room_id: "!room:server" };
            mockAuthedRequest.mockResolvedValue(mockResponse);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await roomInitialSyncRequest("!room:server", undefined as any, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/rooms/!room%3Aserver/initialSync", {
                limit: "30",
            });
            expect(result).toEqual(mockResponse);
        });

        it("should make request with custom limit", async () => {
            mockAuthedRequest.mockResolvedValue({});

            await roomInitialSyncRequest("!room:server", 100, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/rooms/!room%3Aserver/initialSync", {
                limit: "100",
            });
        });
    });

    describe("getJoinedRoomsRequest", () => {
        it("should make request to get joined rooms", async () => {
            const mockResponse = { joined_rooms: ["!room:server"] };
            mockAuthedRequest.mockResolvedValue(mockResponse);

            const result = await getJoinedRoomsRequest(mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/joined_rooms", undefined, undefined, {
                prefix: ClientPrefix.V3,
            });
            expect(result).toEqual(mockResponse);
        });
    });

    describe("getMyRoomsRequest", () => {
        it("should make request to get my rooms on v3", async () => {
            const mockResponse = { rooms: [], total: 0 };
            mockAuthedRequest.mockResolvedValue(mockResponse);

            const result = await getMyRoomsRequest(mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/my_rooms", undefined, undefined, {
                prefix: VendorPrefix,
            });
            expect(result).toEqual(mockResponse);
        });
    });

    describe("publicRoomsRequest", () => {
        it("should make GET request when no filter options", async () => {
            const mockResponse = { chunk: [] };
            mockAuthedRequest.mockResolvedValue(mockResponse);

            const result = await publicRoomsRequest({ server: "server.com" }, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/publicRooms", { server: "server.com" });
            expect(result).toEqual(mockResponse);
        });

        it("should make POST request when filter options provided", async () => {
            const mockResponse = { chunk: [] };
            mockAuthedRequest.mockResolvedValue(mockResponse);

            await publicRoomsRequest(
                { server: "server.com", limit: 10, since: "token", filter: { generic_search_term: "test" } },
                mockAuthedRequest,
            );

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/publicRooms",
                { server: "server.com" },
                expect.objectContaining({ limit: 10, since: "token" }),
            );
        });
    });

    describe("createAliasRequest", () => {
        it("should make request to create alias", async () => {
            mockAuthedRequest.mockResolvedValue({});

            await createAliasRequest("#alias:server", "!room:server", mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Put, "/directory/room/%23alias%3Aserver", undefined, {
                room_id: "!room:server",
            });
        });
    });

    describe("deleteAliasRequest", () => {
        it("should make request to delete alias", async () => {
            mockAuthedRequest.mockResolvedValue({});

            await deleteAliasRequest("#alias:server", mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Delete, "/directory/room/%23alias%3Aserver");
        });
    });

    describe("getLocalAliasesRequest", () => {
        it("should make request to get local aliases", async () => {
            const mockResponse = { aliases: ["#alias:server"] };
            mockAuthedRequest.mockResolvedValue(mockResponse);

            const result = await getLocalAliasesRequest("!room:server", mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/rooms/!room%3Aserver/aliases",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result).toEqual(mockResponse);
        });
    });

    describe("getRoomIdForAliasRequest", () => {
        it("should make request to get room id for alias", async () => {
            const mockResponse = { room_id: "!room:server", servers: ["server.com"] };
            mockAuthedRequest.mockResolvedValue(mockResponse);

            const result = await getRoomIdForAliasRequest("#alias:server", mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/directory/room/%23alias%3Aserver");
            expect(result).toEqual(mockResponse);
        });
    });

    describe("getRoomDirectoryVisibilityRequest", () => {
        it("should make request to get visibility", async () => {
            const mockResponse = { visibility: "public" };
            mockAuthedRequest.mockResolvedValue(mockResponse);

            const result = await getRoomDirectoryVisibilityRequest("!room:server", mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/directory/list/room/!room%3Aserver");
            expect(result).toEqual(mockResponse);
        });
    });

    describe("setRoomDirectoryVisibilityRequest", () => {
        it("should make request to set visibility", async () => {
            mockAuthedRequest.mockResolvedValue({});

            await setRoomDirectoryVisibilityRequest("!room:server", Visibility.Private, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/directory/list/room/!room%3Aserver",
                undefined,
                { visibility: Visibility.Private },
            );
        });
    });

    describe("buildSearchMessageRequestBody", () => {
        it("should build search request body with query", () => {
            const body = buildSearchMessageRequestBody({ query: "test" });

            expect(body).toEqual({
                search_categories: {
                    room_events: {
                        search_term: "test",
                    },
                },
            });
        });

        it("should build search request body with keys", () => {
            const body = buildSearchMessageRequestBody({ query: "test", keys: ["content.body"] });

            expect(body).toEqual({
                search_categories: {
                    room_events: {
                        search_term: "test",
                        keys: ["content.body"],
                    },
                },
            });
        });
    });

    describe("searchMessageTextRequest", () => {
        it("should call search with built body", async () => {
            const mockResponse = { search_categories: {} };
            const mockSearch = vi.fn().mockResolvedValue(mockResponse);

            const result = await searchMessageTextRequest({ query: "test" }, mockSearch);

            expect(mockSearch).toHaveBeenCalledWith({
                body: {
                    search_categories: {
                        room_events: {
                            search_term: "test",
                        },
                    },
                },
            });
            expect(result).toEqual(mockResponse);
        });
    });

    describe("getOpenIdTokenRequest", () => {
        it("should make request to get OpenID token", async () => {
            const mockResponse = { access_token: "token", token_type: "Bearer" };
            mockAuthedRequest.mockResolvedValue(mockResponse);

            const result = await getOpenIdTokenRequest("@user:server", mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/user/%40user%3Aserver/openid/request_token",
                undefined,
                {},
            );
            expect(result).toEqual(mockResponse);
        });
    });
});
