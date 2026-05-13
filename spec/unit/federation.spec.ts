import { describe, expect, it, vi, beforeEach } from "vitest";
import { FederationManager } from "../../src/federation";
import { AdminPrefix } from "../../src/http-api/prefix";
import { Method } from "../../src/http-api/method.ts";
import { MatrixClient } from "../../src/client";
import { IUserProfile } from "../../src/user-directory";

describe("FederationManager", () => {
    let mockClient: MatrixClient;
    let federationManager: FederationManager;
    let mockAuthedRequest: ReturnType<typeof vi.fn>;
    let mockRequest: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockAuthedRequest = vi.fn();
        mockRequest = vi.fn();
        mockClient = {
            http: {
                authedRequest: mockAuthedRequest,
                request: mockRequest,
            },
            getUserId: vi.fn(() => "@user:example.com"),
            baseUrl: "https://example.com",
        } as any;
        federationManager = new FederationManager(mockClient);
    });

    it("should fetch the blacklist and cache it", async () => {
        mockAuthedRequest.mockResolvedValue({ blacklist: [{ serverName: "server1.com", addedAt: 123 }] });

        const result = await federationManager.getBlacklist();

        expect(mockAuthedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/federation/blacklist",
            undefined,
            undefined,
            { prefix: AdminPrefix.V1 },
        );
        expect(result).toEqual([{ serverName: "server1.com", addedAt: 123 }]);
        expect(federationManager.getCachedBlacklist()).toEqual([{ serverName: "server1.com", addedAt: 123 }]);
    });

    it("should add a server to the blacklist", async () => {
        await federationManager.addToBlacklist("server2.com", "test reason");

        expect(mockAuthedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/federation/blacklist/add",
            undefined,
            { server_name: "server2.com", reason: "test reason" },
            { prefix: AdminPrefix.V1 },
        );
        expect(federationManager.getCachedBlacklist()).toEqual([
            { serverName: "server2.com", reason: "test reason", addedAt: expect.any(Number), addedBy: "@user:example.com" },
        ]);
    });

    it("should remove a server from the blacklist", async () => {
        federationManager.addToBlacklist("server3.com"); // Add to cache first
        mockAuthedRequest.mockClear(); // Clear previous call

        await federationManager.removeFromBlacklist("server3.com");

        expect(mockAuthedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/federation/blacklist/remove",
            undefined,
            { server_name: "server3.com" },
            { prefix: AdminPrefix.V1 },
        );
        expect(federationManager.getCachedBlacklist()).toEqual([]);
    });

    it("should get server status", async () => {
        mockAuthedRequest.mockResolvedValue({ online: true, last_successful_connect: 456, latency: 100 });

        const result = await federationManager.getServerStatus("server4.com");

        expect(mockAuthedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/federation/status/server4.com",
            undefined,
            undefined,
            { prefix: AdminPrefix.V1 },
        );
        expect(result).toEqual({ online: true, lastSuccessfulConnect: 456, latency: 100 });
    });

    it("should get federation destinations", async () => {
        mockAuthedRequest.mockResolvedValue({ destinations: [{ serverName: "dest1.com" }] });

        const result = await federationManager.getFederationDestinations();

        expect(mockAuthedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/federation/destinations",
            undefined,
            undefined,
            { prefix: AdminPrefix.V1 },
        );
        expect(result).toEqual([{ serverName: "dest1.com" }]);
        expect(federationManager.getCachedServers()).toEqual([{ serverName: "dest1.com" }]);
    });

    it("should disconnect a server", async () => {
        await federationManager.disconnectServer("server5.com");

        expect(mockAuthedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/federation/disconnect/server5.com",
            undefined,
            undefined,
            { prefix: AdminPrefix.V1 },
        );
    });

    it("should reconnect a server", async () => {
        await federationManager.reconnectServer("server6.com");

        expect(mockAuthedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/federation/reconnect/server6.com",
            undefined,
            undefined,
            { prefix: AdminPrefix.V1 },
        );
    });

    it("should get server version", async () => {
        mockAuthedRequest.mockResolvedValue({ server: { version: "1.0.0" } });

        const result = await federationManager.getServerVersion("server7.com");

        expect(mockAuthedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/_matrix/federation/v1/version",
            undefined,
            undefined,
            { prefix: "" },
        );
        expect(result).toEqual({ version: "1.0.0" });
    });



    it("should clear cache", async () => {
        mockAuthedRequest.mockResolvedValueOnce({}); // Mock for addToBlacklist
        await federationManager.addToBlacklist("server_to_clear.com");
        expect(federationManager.getCachedBlacklist().length).toBe(1);

        federationManager.clearCache();

        expect(federationManager.getCachedBlacklist().length).toBe(0);
    });

    it("should initialize blacklist on start", async () => {
        mockAuthedRequest.mockResolvedValue({ blacklist: [{ serverName: "initial.com", addedAt: 123, addedBy: "@user:example.com" }] });
        federationManager.clearCache(); // Ensure empty before start

        await federationManager.start();

        expect(federationManager.getCachedBlacklist()).toEqual([{ serverName: "initial.com", addedAt: 123, addedBy: "@user:example.com" }]);
    });

    it("should stop and clear cache", async () => {
        mockAuthedRequest.mockResolvedValueOnce({}); // Mock for addToBlacklist
        await federationManager.addToBlacklist("server_to_stop.com");
        expect(federationManager.getCachedBlacklist().length).toBe(1);

        federationManager.stop();

        expect(federationManager.getCachedBlacklist().length).toBe(0);
    });

    it("should query profile over federation", async () => {
        const profile: IUserProfile = { displayname: "Alice", avatar_url: "mxc://example.com/alice" };
        mockRequest.mockResolvedValue(profile);

        const result = await federationManager.queryProfile("@alice:example.com");

        expect(mockRequest).toHaveBeenCalledWith(
            Method.Get,
            "/_matrix/federation/v1/query/profile/%40alice%3Aexample.com",
            undefined,
            undefined,
            { prefix: "" },
        );
        expect(result).toEqual(profile);
    });

    it("should query room directory over federation", async () => {
        const response = { room_id: "!room:example.com", servers: ["example.com"] };
        mockRequest.mockResolvedValue(response);

        const result = await federationManager.queryDirectory("#alias:example.com");

        expect(mockRequest).toHaveBeenCalledWith(
            Method.Get,
            "/_matrix/federation/v1/query/directory",
            { room_alias: "#alias:example.com" },
            undefined,
            { prefix: "" },
        );
        expect(result).toEqual(response);
    });

    it("should get room hierarchy over federation", async () => {
        const hierarchy = { rooms: [] };
        mockRequest.mockResolvedValue(hierarchy);

        const result = await federationManager.getHierarchy("!room:example.com");

        expect(mockRequest).toHaveBeenCalledWith(
            Method.Get,
            "/_matrix/federation/v1/hierarchy/!room%3Aexample.com",
            undefined,
            undefined,
            { prefix: "" },
        );
        expect(result).toEqual(hierarchy);
    });

    it("should get federation info", async () => {
        const info = { server: "example.com" };
        mockRequest.mockResolvedValue(info);

        const result = await federationManager.getFederationInfo();

        expect(mockRequest).toHaveBeenCalledWith(Method.Get, "/_matrix/federation/v1", undefined, undefined, { prefix: "" });
        expect(result).toEqual(info);
    });

    it("should query destination over federation", async () => {
        const response = { destination: "example.org" };
        mockRequest.mockResolvedValue(response);

        const result = await federationManager.queryDestination("example.org");

        expect(mockRequest).toHaveBeenCalledWith(
            Method.Get,
            "/_matrix/federation/v1/query/destination",
            { destination: "example.org" },
            undefined,
            { prefix: "" },
        );
        expect(result).toEqual(response);
    });

    it("should get room event over federation", async () => {
        const response = { event_id: "$evt:example.com" };
        mockRequest.mockResolvedValue(response);

        const result = await federationManager.getRoomEvent("!room:example.com", "$evt:example.com");

        expect(mockRequest).toHaveBeenCalledWith(
            Method.Get,
            "/_matrix/federation/v1/room/!room%3Aexample.com/%24evt%3Aexample.com",
            undefined,
            undefined,
            { prefix: "" },
        );
        expect(result).toEqual(response);
    });

    it("should download media over federation", async () => {
        const response = { ok: true };
        mockRequest.mockResolvedValue(response);

        const result = await federationManager.downloadMedia("remote.example", "m123");

        expect(mockRequest).toHaveBeenCalledWith(
            Method.Get,
            "/_matrix/federation/v1/media/download/remote.example/m123",
            undefined,
            undefined,
            { prefix: "" },
        );
        expect(result).toEqual(response);
    });

    it("should get media thumbnail over federation", async () => {
        const response = { ok: true };
        mockRequest.mockResolvedValue(response);

        const result = await federationManager.getMediaThumbnail("remote.example", "m123");

        expect(mockRequest).toHaveBeenCalledWith(
            Method.Get,
            "/_matrix/federation/v1/media/thumbnail/remote.example/m123",
            undefined,
            undefined,
            { prefix: "" },
        );
        expect(result).toEqual(response);
    });
});
