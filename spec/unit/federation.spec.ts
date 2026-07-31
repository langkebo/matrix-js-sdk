import { describe, expect, it, vi, beforeEach } from "vitest";
import { FederationManager, FederationEvent } from "../../src/federation";
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;
        federationManager = new FederationManager(mockClient);
    });

    it("should fetch the blacklist and cache it", async () => {
        mockAuthedRequest.mockResolvedValue({ blacklist: [{ serverName: "server1.com", addedAt: 123 }] });

        const result = await federationManager.blacklist.getBlacklist();

        expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/federation/blacklist", undefined, undefined, {
            prefix: AdminPrefix.V1,
        });
        expect(result).toEqual([{ serverName: "server1.com", addedAt: 123 }]);
        expect(federationManager.blacklist.getCachedBlacklist()).toEqual([{ serverName: "server1.com", addedAt: 123 }]);
    });

    it("should add a server to the blacklist", async () => {
        await federationManager.blacklist.addToBlacklist("server2.com", "test reason");

        expect(mockAuthedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/federation/blacklist/add",
            undefined,
            { server_name: "server2.com", reason: "test reason" },
            { prefix: AdminPrefix.V1 },
        );
        expect(federationManager.blacklist.getCachedBlacklist()).toEqual([
            {
                serverName: "server2.com",
                reason: "test reason",
                addedAt: expect.any(Number),
                addedBy: "@user:example.com",
            },
        ]);
    });

    it("should remove a server from the blacklist", async () => {
        federationManager.blacklist.addToBlacklist("server3.com"); // Add to cache first
        mockAuthedRequest.mockClear(); // Clear previous call

        await federationManager.blacklist.removeFromBlacklist("server3.com");

        expect(mockAuthedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/federation/blacklist/remove",
            undefined,
            { server_name: "server3.com" },
            { prefix: AdminPrefix.V1 },
        );
        expect(federationManager.blacklist.getCachedBlacklist()).toEqual([]);
    });

    it("should get server status", async () => {
        mockAuthedRequest.mockResolvedValue({ online: true, last_successful_connect: 456, latency: 100 });

        const result = await federationManager.server.getServerStatus("server4.com");

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

        const result = await federationManager.server.getFederationDestinations();

        expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/federation/destinations", undefined, undefined, {
            prefix: AdminPrefix.V1,
        });
        expect(result).toEqual([{ serverName: "dest1.com" }]);
        expect(federationManager.server.getCachedServers()).toEqual([{ serverName: "dest1.com" }]);
    });

    it("should disconnect a server", async () => {
        await federationManager.server.disconnectServer("server5.com");

        expect(mockAuthedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/federation/disconnect/server5.com",
            undefined,
            undefined,
            { prefix: AdminPrefix.V1 },
        );
    });

    it("should reconnect a server", async () => {
        await federationManager.server.reconnectServer("server6.com");

        expect(mockAuthedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/federation/reconnect/server6.com",
            undefined,
            undefined,
            { prefix: AdminPrefix.V1 },
        );
    });

    it("should get server version", async () => {
        mockRequest.mockResolvedValue({ server: { version: "1.0.0" } });

        const result = await federationManager.server.getServerVersion("server7.com");

        expect(mockRequest).toHaveBeenCalledWith(Method.Get, "/_matrix/federation/v1/version", undefined, undefined, {
            prefix: "",
        });
        expect(result).toEqual({ version: "1.0.0" });
    });

    it("should clear cache", async () => {
        mockAuthedRequest.mockResolvedValueOnce({}); // Mock for addToBlacklist
        await federationManager.blacklist.addToBlacklist("server_to_clear.com");
        expect(federationManager.blacklist.getCachedBlacklist().length).toBe(1);

        federationManager.clearCache();

        expect(federationManager.blacklist.getCachedBlacklist().length).toBe(0);
    });

    it("should initialize blacklist on start", async () => {
        mockAuthedRequest.mockResolvedValue({
            blacklist: [{ serverName: "initial.com", addedAt: 123, addedBy: "@user:example.com" }],
        });
        federationManager.clearCache(); // Ensure empty before start

        await federationManager.start();

        expect(federationManager.blacklist.getCachedBlacklist()).toEqual([
            { serverName: "initial.com", addedAt: 123, addedBy: "@user:example.com" },
        ]);
    });

    it("should stop and clear cache", async () => {
        mockAuthedRequest.mockResolvedValueOnce({}); // Mock for addToBlacklist
        await federationManager.blacklist.addToBlacklist("server_to_stop.com");
        expect(federationManager.blacklist.getCachedBlacklist().length).toBe(1);

        federationManager.stop();

        expect(federationManager.blacklist.getCachedBlacklist().length).toBe(0);
    });

    it("should query profile over federation", async () => {
        const profile: IUserProfile = { displayname: "Alice", avatar_url: "mxc://example.com/alice" };
        mockRequest.mockResolvedValue(profile);

        const result = await federationManager.query.queryProfile("@alice:example.com");

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

        const result = await federationManager.query.queryDirectory("#alias:example.com");

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

        const result = await federationManager.room.getHierarchy("!room:example.com");

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

        const result = await federationManager.query.getFederationInfo();

        expect(mockRequest).toHaveBeenCalledWith(Method.Get, "/_matrix/federation/v1", undefined, undefined, {
            prefix: "",
        });
        expect(result).toEqual(info);
    });

    it("should query destination over federation", async () => {
        const response = { destination: "example.org" };
        mockRequest.mockResolvedValue(response);

        const result = await federationManager.query.queryDestination("example.org");

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

        const result = await federationManager.room.getRoomEvent("!room:example.com", "$evt:example.com");

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

        const result = await federationManager.room.downloadMedia("remote.example", "m123");

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

        const result = await federationManager.room.getMediaThumbnail("remote.example", "m123");

        expect(mockRequest).toHaveBeenCalledWith(
            Method.Get,
            "/_matrix/federation/v1/media/thumbnail/remote.example/m123",
            undefined,
            undefined,
            { prefix: "" },
        );
        expect(result).toEqual(response);
    });

    it("should get room state over federation", async () => {
        const response = { pdus: [] };
        mockRequest.mockResolvedValue(response);

        const result = await federationManager.room.getState("!room:example.com");

        expect(mockRequest).toHaveBeenCalledWith(
            Method.Get,
            "/_matrix/federation/v1/state/!room%3Aexample.com",
            undefined,
            undefined,
            { prefix: "" },
        );
        expect(result).toEqual(response);
    });

    it("should throw ValidationError if room ID is empty for getState", async () => {
        await expect(federationManager.room.getState("")).rejects.toThrow("Room ID is required");
    });

    it("should get room state IDs over federation", async () => {
        const response = { auth_chain_ids: [], pdu_ids: [] };
        mockRequest.mockResolvedValue(response);

        const result = await federationManager.room.getStateIds("!room:example.com");

        expect(mockRequest).toHaveBeenCalledWith(
            Method.Get,
            "/_matrix/federation/v1/state_ids/!room%3Aexample.com",
            undefined,
            undefined,
            { prefix: "" },
        );
        expect(result).toEqual(response);
    });

    it("should throw ValidationError if room ID is empty for getStateIds", async () => {
        await expect(federationManager.room.getStateIds("")).rejects.toThrow("Room ID is required");
    });

    it("should get room members over federation", async () => {
        const response = { chunk: [], total_room_count_estimate: 0 };
        mockRequest.mockResolvedValue(response);

        const result = await federationManager.room.getMembers("!room:example.com");

        expect(mockRequest).toHaveBeenCalledWith(
            Method.Get,
            "/_matrix/federation/v1/members/!room%3Aexample.com",
            undefined,
            undefined,
            { prefix: "" },
        );
        expect(result).toEqual(response);
    });

    it("should throw ValidationError if room ID is empty for getMembers", async () => {
        await expect(federationManager.room.getMembers("")).rejects.toThrow("Room ID is required");
    });

    it("should get joined members over federation", async () => {
        const response = { joined: {} };
        mockRequest.mockResolvedValue(response);

        const result = await federationManager.room.getJoinedMembers("!room:example.com");

        expect(mockRequest).toHaveBeenCalledWith(
            Method.Get,
            "/_matrix/federation/v1/members/!room%3Aexample.com/joined",
            undefined,
            undefined,
            { prefix: "" },
        );
        expect(result).toEqual(response);
    });

    it("should throw ValidationError if room ID is empty for getJoinedMembers", async () => {
        await expect(federationManager.room.getJoinedMembers("")).rejects.toThrow("Room ID is required");
    });

    it("should get event over federation by event ID", async () => {
        const response = { origin: "example.com", event: { room_id: "!room:example.com" } };
        mockRequest.mockResolvedValue(response);

        const result = await federationManager.room.getEvent("$event:example.com");

        expect(mockRequest).toHaveBeenCalledWith(
            Method.Get,
            "/_matrix/federation/v1/event/%24event%3Aexample.com",
            undefined,
            undefined,
            { prefix: "" },
        );
        expect(result).toEqual(response);
    });

    it("should throw ValidationError if event ID is empty for getEvent", async () => {
        await expect(federationManager.room.getEvent("")).rejects.toThrow("Event ID is required");
    });

    it("should backfill room history over federation", async () => {
        const response = { origin: "example.com", events: [] };
        mockRequest.mockResolvedValue(response);

        const result = await federationManager.room.backfillRoom("!room:example.com");

        expect(mockRequest).toHaveBeenCalledWith(
            Method.Get,
            "/_matrix/federation/v1/backfill/!room%3Aexample.com",
            undefined,
            undefined,
            { prefix: "" },
        );
        expect(result).toEqual(response);
    });

    it("should backfill room history with limit and from params", async () => {
        const response = { origin: "example.com", events: [] };
        mockRequest.mockResolvedValue(response);

        const result = await federationManager.room.backfillRoom("!room:example.com", {
            limit: 10,
            from: "$prev:example.com",
        });

        expect(mockRequest).toHaveBeenCalledWith(
            Method.Get,
            "/_matrix/federation/v1/backfill/!room%3Aexample.com",
            { limit: 10, from: "$prev:example.com" },
            undefined,
            { prefix: "" },
        );
        expect(result).toEqual(response);
    });

    it("should throw ValidationError if room ID is empty for backfillRoom", async () => {
        await expect(federationManager.room.backfillRoom("")).rejects.toThrow("Room ID is required");
    });

    // ============ 事件转发测试（P-102 I-1） ============

    describe("sub-manager 事件转发到顶层 FederationManager", () => {
        it("should forward BlacklistUpdated event from blacklist sub-manager", async () => {
            mockAuthedRequest.mockResolvedValue({ blacklist: [{ serverName: "s1.com", addedAt: 1 }] });
            const emitSpy = vi.spyOn(federationManager, "emit");

            await federationManager.blacklist.getBlacklist();

            expect(emitSpy).toHaveBeenCalledWith(FederationEvent.BlacklistUpdated, expect.any(Array));
        });

        it("should forward FederationError event from blacklist sub-manager", async () => {
            mockAuthedRequest.mockRejectedValue(new Error("network failure"));
            const emitSpy = vi.spyOn(federationManager, "emit");

            // addToBlacklist 失败时 emit BlacklistError，转发到顶层 FederationError
            await expect(federationManager.blacklist.addToBlacklist("s1.com")).rejects.toThrow();

            expect(emitSpy).toHaveBeenCalledWith(FederationEvent.FederationError, expect.any(Error));
        });
    });
});
