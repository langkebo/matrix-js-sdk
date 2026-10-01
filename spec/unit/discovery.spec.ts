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

import { describe, expect, it, vi, beforeEach } from "vitest";

import { DiscoveryManager } from "../../src/discovery/index";
import { RoomType } from "../../src/@types/event.ts";
import { Method, ClientPrefix } from "../../src/http-api";
import { logger } from "../../src/logger";

describe("DiscoveryManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let discoveryManager: DiscoveryManager;
    let mockAuthedRequest: ReturnType<typeof vi.fn>;
    let mockRequest: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockAuthedRequest = vi.fn();
        mockRequest = vi.fn();
        mockClient = {
            baseUrl: "https://matrix.example.com",
            getClientConfig: vi.fn(),
            getVersions: vi.fn(),
            http: {
                authedRequest: mockAuthedRequest,
                request: mockRequest,
            },
        };
        discoveryManager = new DiscoveryManager(mockClient);
    });

    describe("getHomeserverUrl", () => {
        it("should return homeserver URL", () => {
            const url = discoveryManager.getHomeserverUrl();
            expect(url).toBe("https://matrix.example.com");
        });
    });

    describe("getClientWellKnown", () => {
        it("should return client well-known", () => {
            mockClient.clientWellKnown = { "m.homeserver": { base_url: "https://matrix.example.com" } };
            const wellKnown = discoveryManager.getClientWellKnown();
            expect(wellKnown).toEqual({ "m.homeserver": { base_url: "https://matrix.example.com" } });
        });
    });

    describe("getServerDiscoveryInfo", () => {
        it("should get server discovery info", async () => {
            const discoveryInfo = {
                "m.homeserver": { base_url: "https://matrix.example.com" },
                "m.identity_server": { base_url: "https://identity.example.com" },
            };
            mockRequest.mockResolvedValue(discoveryInfo);

            const result = await discoveryManager.getServerDiscoveryInfo();

            expect(mockRequest).toHaveBeenCalledWith(Method.Get, "/.well-known/matrix/client", undefined, undefined, {
                prefix: "",
            });
            expect(result).toEqual(discoveryInfo);
        });
    });

    describe("getClientConfig", () => {
        it("should get client-facing config through manager wrapper", async () => {
            const response = {
                homeserver: { base_url: "https://matrix.example.com", server_name: "example.com" },
                identity_server: { base_url: "https://identity.example.com" },
                push: { enabled: true },
                email: { enabled: false },
                features: { oidc: true },
                defaults: {},
            };
            mockClient.getClientConfig.mockResolvedValue(response);

            const result = await discoveryManager.getClientConfig();

            expect(mockClient.getClientConfig).toHaveBeenCalledWith();
            expect(result).toEqual(response);
        });
    });

    describe("well-known helpers", () => {
        it("should get server well-known info", async () => {
            const response = { "m.server": "matrix.example.com:443" };
            mockRequest.mockResolvedValue(response);

            const result = await discoveryManager.getServerWellKnown();

            expect(mockRequest).toHaveBeenCalledWith(Method.Get, "/.well-known/matrix/server", undefined, undefined, {
                prefix: "",
            });
            expect(result).toEqual(response);
        });

        it("should get support well-known info", async () => {
            const response = { contacts: [{ role: "admin", email_address: "admin@example.com" }] };
            mockRequest.mockResolvedValue(response);

            const result = await discoveryManager.getSupportWellKnown();

            expect(mockRequest).toHaveBeenCalledWith(Method.Get, "/.well-known/matrix/support", undefined, undefined, {
                prefix: "",
            });
            expect(result).toEqual(response);
        });
    });

    describe("public discovery endpoints", () => {
        it("should get client versions through manager wrapper", async () => {
            const response = { versions: ["r0.6.1", "v1.11"], unstable_features: { "org.matrix.msc123": true } };
            mockClient.getVersions.mockResolvedValue(response);

            const result = await discoveryManager.getVersions();

            expect(mockClient.getVersions).toHaveBeenCalledWith();
            expect(result).toEqual(response);
        });

        it("should get matrix server version", async () => {
            const response = { server: { name: "Synapse", version: "1.123.0" } };
            mockRequest.mockResolvedValue(response);

            const result = await discoveryManager.getMatrixServerVersion();

            expect(mockRequest).toHaveBeenCalledWith(Method.Get, "/_matrix/server_version", undefined, undefined, {
                prefix: "",
            });
            expect(result).toEqual(response);
        });

        it("should get /health", async () => {
            const response = { ok: true };
            mockRequest.mockResolvedValue(response);

            const result = await discoveryManager.getHealth();

            expect(mockRequest).toHaveBeenCalledWith(Method.Get, "/health", undefined, undefined, { prefix: "" });
            expect(result).toEqual(response);
        });

        it("should get /_health", async () => {
            const response = { ok: true };
            mockRequest.mockResolvedValue(response);

            const result = await discoveryManager.getUnderscoreHealth();

            expect(mockRequest).toHaveBeenCalledWith(Method.Get, "/_health", undefined, undefined, { prefix: "" });
            expect(result).toEqual(response);
        });
    });

    describe("getRoomIdForAlias", () => {
        it("should get room ID for alias", async () => {
            const response = {
                room_id: "!room:example.com",
                servers: ["example.com", "other.com"],
            };
            mockAuthedRequest.mockResolvedValue(response);

            const result = await discoveryManager.getRoomIdForAlias("#test:example.com");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/directory/room/%23test%3Aexample.com",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result).toEqual(response);
        });
    });

    describe("getAliasRoomId", () => {
        it("should return room ID for valid alias", async () => {
            mockAuthedRequest.mockResolvedValue({
                room_id: "!room:example.com",
                servers: ["example.com"],
            });

            const result = await discoveryManager.getAliasRoomId("#test:example.com");

            expect(result).toBe("!room:example.com");
        });

        it("should return null for invalid alias", async () => {
            mockAuthedRequest.mockRejectedValue(new Error("Not found"));

            const result = await discoveryManager.getAliasRoomId("#invalid:example.com");

            expect(result).toBeNull();
        });

        it("should log a warning when alias lookup fails", async () => {
            const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
            mockAuthedRequest.mockRejectedValue(new Error("Not found"));

            const result = await discoveryManager.getAliasRoomId("#invalid:example.com");

            expect(result).toBeNull();
            expect(warnSpy).toHaveBeenCalledWith("DiscoveryManager.getAliasRoomId failed:", expect.any(Error));
            warnSpy.mockRestore();
        });
    });

    describe("searchUserDirectory", () => {
        it("should search user directory", async () => {
            const response = {
                results: [
                    {
                        user_id: "@alice:example.com",
                        display_name: "Alice",
                        avatar_url: "mxc://example.com/avatar",
                    },
                ],
                limited: false,
            };
            mockAuthedRequest.mockResolvedValue(response);

            const result = await discoveryManager.searchUserDirectory("alice");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/user_directory/search",
                undefined,
                { search_term: "alice" },
                { prefix: ClientPrefix.V3 },
            );
            expect(result).toEqual(response);
        });

        it("should search with limit", async () => {
            const response = {
                results: [],
                limited: true,
            };
            mockAuthedRequest.mockResolvedValue(response);

            await discoveryManager.searchUserDirectory("alice", 10);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/user_directory/search",
                undefined,
                { search_term: "alice", limit: 10 },
                { prefix: ClientPrefix.V3 },
            );
        });
    });

    describe("listUserDirectory", () => {
        it("should list user directory", async () => {
            const response = {
                users: [
                    {
                        user_id: "@alice:example.com",
                        display_name: "Alice",
                    },
                ],
            };
            mockAuthedRequest.mockResolvedValue(response);

            const result = await discoveryManager.listUserDirectory();

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Post, "/user_directory/list", undefined, undefined, {
                prefix: ClientPrefix.V3,
            });
            expect(result).toEqual(response);
        });
    });

    describe("getUserDirectoryProfile", () => {
        it("should get user directory profile by user id", async () => {
            const response = {
                user_id: "@alice:example.com",
                display_name: "Alice",
                avatar_url: "mxc://example.com/alice",
            };
            mockAuthedRequest.mockResolvedValue(response);

            const result = await discoveryManager.getUserDirectoryProfile("@alice:example.com");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/user_directory/profiles/%40alice%3Aexample.com",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result).toEqual(response);
        });
    });

    describe("getRoomVisibility", () => {
        it("should get room visibility", async () => {
            const response = {
                room_id: "!room:example.com",
                visibility: "public" as const,
            };
            mockAuthedRequest.mockResolvedValue(response);

            const result = await discoveryManager.getRoomVisibility("!room:example.com");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/directory/list/room/!room%3Aexample.com",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result).toEqual(response);
        });
    });

    describe("setRoomVisibility", () => {
        it("should set room visibility to public", async () => {
            mockAuthedRequest.mockResolvedValue({});

            await discoveryManager.setRoomVisibility("!room:example.com", "public");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/directory/list/room/!room%3Aexample.com",
                undefined,
                { visibility: "public" },
                { prefix: ClientPrefix.V3 },
            );
        });

        it("should set room visibility to private", async () => {
            mockAuthedRequest.mockResolvedValue({});

            await discoveryManager.setRoomVisibility("!room:example.com", "private");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/directory/list/room/!room%3Aexample.com",
                undefined,
                { visibility: "private" },
                { prefix: ClientPrefix.V3 },
            );
        });
    });

    describe("getPublicRooms", () => {
        it("should get public rooms", async () => {
            const response = {
                chunk: [
                    {
                        room_id: "!room1:example.com",
                        name: "Test Room",
                        topic: "A test room",
                        num_joined_members: 10,
                    },
                ],
                next_batch: "next_token",
                total_room_count_estimate: 100,
            };
            mockRequest.mockResolvedValue(response);

            const result = await discoveryManager.getPublicRooms();

            expect(mockRequest).toHaveBeenCalledWith(Method.Get, "/publicRooms", {}, undefined, {
                prefix: ClientPrefix.V3,
            });
            expect(result).toEqual(response);
        });

        it("should get public rooms with limit", async () => {
            const response = {
                chunk: [],
            };
            mockRequest.mockResolvedValue(response);

            await discoveryManager.getPublicRooms(20);

            expect(mockRequest).toHaveBeenCalledWith(Method.Get, "/publicRooms", { limit: 20 }, undefined, {
                prefix: ClientPrefix.V3,
            });
        });

        it("should get public rooms with pagination", async () => {
            const response = {
                chunk: [],
            };
            mockRequest.mockResolvedValue(response);

            await discoveryManager.getPublicRooms(20, "since_token");

            expect(mockRequest).toHaveBeenCalledWith(
                Method.Get,
                "/publicRooms",
                {
                    limit: 20,
                    since: "since_token",
                },
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });

        it("should get public rooms from specific server", async () => {
            const response = {
                chunk: [],
            };
            mockRequest.mockResolvedValue(response);

            await discoveryManager.getPublicRooms(20, undefined, "other.example.com");

            expect(mockRequest).toHaveBeenCalledWith(
                Method.Get,
                "/publicRooms",
                {
                    limit: 20,
                    server: "other.example.com",
                },
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });
    });

    describe("queryPublicRooms", () => {
        it("should query public rooms with filter", async () => {
            const response = {
                chunk: [
                    {
                        room_id: "!room1:example.com",
                        name: "Gaming Room",
                        num_joined_members: 50,
                    },
                ],
            };
            mockRequest.mockResolvedValue(response);

            const result = await discoveryManager.queryPublicRooms({
                generic_search_term: "gaming",
            });

            expect(mockRequest).toHaveBeenCalledWith(
                Method.Post,
                "/publicRooms",
                {},
                { filter: { generic_search_term: "gaming" } },
                { prefix: ClientPrefix.V3 },
            );
            expect(result).toEqual(response);
        });

        it("should query with room types filter", async () => {
            const response = {
                chunk: [],
            };
            mockRequest.mockResolvedValue(response);

            await discoveryManager.queryPublicRooms({
                room_types: [RoomType.Space],
            });

            expect(mockRequest).toHaveBeenCalledWith(
                Method.Post,
                "/publicRooms",
                {},
                { filter: { room_types: [RoomType.Space] } },
                { prefix: ClientPrefix.V3 },
            );
        });

        it("should query with limit and pagination", async () => {
            const response = {
                chunk: [],
            };
            mockRequest.mockResolvedValue(response);

            await discoveryManager.queryPublicRooms({ generic_search_term: "test" }, 10, "since_token");

            expect(mockRequest).toHaveBeenCalledWith(
                Method.Post,
                "/publicRooms",
                { limit: 10, since: "since_token" },
                { filter: { generic_search_term: "test" } },
                { prefix: ClientPrefix.V3 },
            );
        });
    });

    describe("setRoomAlias", () => {
        it("should set room alias", async () => {
            mockAuthedRequest.mockResolvedValue({});

            await discoveryManager.setRoomAlias("!room:example.com", "#test:example.com");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/directory/room/%23test%3Aexample.com",
                undefined,
                { room_id: "!room:example.com" },
                { prefix: ClientPrefix.V3 },
            );
        });
    });

    describe("room alias management by room id", () => {
        it("should get aliases for room", async () => {
            mockAuthedRequest.mockResolvedValue({ aliases: ["#test:example.com"] });

            const result = await discoveryManager.getAliasesForRoom("!room:example.com");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/directory/room/!room%3Aexample.com/alias",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result).toEqual({ aliases: ["#test:example.com"] });
        });

        it("should add room alias for room", async () => {
            mockAuthedRequest.mockResolvedValue({});

            await discoveryManager.addRoomAliasForRoom("!room:example.com", "#test:example.com");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/directory/room/!room%3Aexample.com/alias/%23test%3Aexample.com",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });

        it("should delete room alias for room", async () => {
            mockAuthedRequest.mockResolvedValue({});

            await discoveryManager.deleteRoomAliasForRoom("!room:example.com", "#test:example.com");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Delete,
                "/directory/room/!room%3Aexample.com/alias/%23test%3Aexample.com",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });
    });

    describe("deleteRoomAlias", () => {
        it("should delete room alias", async () => {
            mockAuthedRequest.mockResolvedValue({});

            await discoveryManager.deleteRoomAlias("#test:example.com");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Delete,
                "/directory/room/%23test%3Aexample.com",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });
    });
});
