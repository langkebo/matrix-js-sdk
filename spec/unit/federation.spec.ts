import { describe, it, expect, beforeEach, vi } from "vitest";

import { FederationManager, FederationEvent, FederationBlacklistManager } from "../../src/federation/index";

describe("FederationManager", () => {
    let mockClient: any;
    let federationManager: FederationManager;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
            getUserId: vi.fn().mockReturnValue("@admin:example.com"),
        };
        federationManager = new FederationManager(mockClient);
    });

    describe("constructor", () => {
        it("should initialize correctly", () => {
            expect(federationManager).toBeDefined();
        });
    });

    describe("getBlacklist", () => {
        it("should get blacklist successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                blacklist: [
                    { serverName: "evil.example.com", reason: "spam", addedAt: 1234567890 },
                ],
            });

            const blacklist = await federationManager.getBlacklist();

            expect(blacklist).toHaveLength(1);
            expect(blacklist[0].serverName).toBe("evil.example.com");
        });

        it("should emit BlacklistUpdated event", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                blacklist: [],
            });

            const emitSpy = vi.spyOn(federationManager, "emit");
            await federationManager.getBlacklist();

            expect(emitSpy).toHaveBeenCalledWith(
                FederationEvent.BlacklistUpdated,
                expect.any(Array)
            );
        });

        it("should return cached blacklist on error", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Error"));

            const blacklist = await federationManager.getBlacklist();

            expect(blacklist).toHaveLength(0);
        });
    });

    describe("addToBlacklist", () => {
        it("should add server to blacklist", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await federationManager.addToBlacklist("evil.example.com", "spam");

            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                "/_synapse/admin/v1/federation/blacklist/add",
                undefined,
                { server_name: "evil.example.com", reason: "spam" },
                { prefix: "/_matrix/client/v3" }
            );
        });

        it("should emit BlacklistUpdated event", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            const emitSpy = vi.spyOn(federationManager, "emit");
            await federationManager.addToBlacklist("evil.example.com");

            expect(emitSpy).toHaveBeenCalledWith(
                FederationEvent.BlacklistUpdated,
                expect.any(Array)
            );
        });

        it("should throw error for empty server name", async () => {
            await expect(
                federationManager.addToBlacklist("")
            ).rejects.toThrow("Server name is required");
        });

        it("should emit FederationError on failure", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Network error"));

            const emitSpy = vi.spyOn(federationManager, "emit");
            await expect(
                federationManager.addToBlacklist("evil.example.com")
            ).rejects.toThrow();

            expect(emitSpy).toHaveBeenCalledWith(
                FederationEvent.FederationError,
                expect.any(Error)
            );
        });
    });

    describe("removeFromBlacklist", () => {
        it("should remove server from blacklist", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await federationManager.removeFromBlacklist("evil.example.com");

            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                "/_synapse/admin/v1/federation/blacklist/remove",
                undefined,
                { server_name: "evil.example.com" },
                { prefix: "/_matrix/client/v3" }
            );
        });

        it("should emit BlacklistUpdated event", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            const emitSpy = vi.spyOn(federationManager, "emit");
            await federationManager.removeFromBlacklist("evil.example.com");

            expect(emitSpy).toHaveBeenCalledWith(
                FederationEvent.BlacklistUpdated,
                expect.any(Array)
            );
        });

        it("should throw error for empty server name", async () => {
            await expect(
                federationManager.removeFromBlacklist("")
            ).rejects.toThrow("Server name is required");
        });
    });

    describe("isBlacklisted", () => {
        it("should return true if server is in blacklist", async () => {
            // First add to blacklist
            mockClient.http.authedRequest.mockResolvedValueOnce({});
            await federationManager.addToBlacklist("evil.example.com");

            const isBlacklisted = await federationManager.isBlacklisted("evil.example.com");

            expect(isBlacklisted).toBe(true);
        });

        it("should return false if server is not in blacklist", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                blacklist: [],
            });

            const isBlacklisted = await federationManager.isBlacklisted("good.example.com");

            expect(isBlacklisted).toBe(false);
        });
    });

    describe("getServerStatus", () => {
        it("should get server status", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                online: true,
                last_successful_connect: 1234567890,
                latency: 100,
            });

            const status = await federationManager.getServerStatus("example.org");

            expect(status?.online).toBe(true);
            expect(status?.latency).toBe(100);
        });

        it("should throw error for empty server name", async () => {
            await expect(
                federationManager.getServerStatus("")
            ).rejects.toThrow("Server name is required");
        });

        it("should return null on error", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Error"));

            const status = await federationManager.getServerStatus("example.org");

            expect(status).toBeNull();
        });
    });

    describe("getFederationDestinations", () => {
        it("should get federation destinations", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                destinations: [
                    { serverName: "example.org" },
                    { serverName: "matrix.org" },
                ],
            });

            const destinations = await federationManager.getFederationDestinations();

            expect(destinations).toHaveLength(2);
        });

        it("should cache servers", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                destinations: [{ serverName: "example.org" }],
            });

            await federationManager.getFederationDestinations();
            const cached = federationManager.getCachedServers();

            expect(cached).toHaveLength(1);
        });

        it("should return cached on error", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Error"));

            const destinations = await federationManager.getFederationDestinations();

            expect(destinations).toHaveLength(0);
        });
    });

    describe("disconnectServer", () => {
        it("should disconnect server", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await federationManager.disconnectServer("example.org");

            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                expect.stringContaining("disconnect"),
                undefined,
                undefined,
                { prefix: "/_matrix/client/v3" }
            );
        });

        it("should throw error for empty server name", async () => {
            await expect(
                federationManager.disconnectServer("")
            ).rejects.toThrow("Server name is required");
        });

        it("should emit FederationError on failure", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Error"));

            const emitSpy = vi.spyOn(federationManager, "emit");
            await expect(
                federationManager.disconnectServer("example.org")
            ).rejects.toThrow();

            expect(emitSpy).toHaveBeenCalledWith(
                FederationEvent.FederationError,
                expect.any(Error)
            );
        });
    });

    describe("reconnectServer", () => {
        it("should reconnect server", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await federationManager.reconnectServer("example.org");

            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                expect.stringContaining("reconnect"),
                undefined,
                undefined,
                { prefix: "/_matrix/client/v3" }
            );
        });

        it("should throw error for empty server name", async () => {
            await expect(
                federationManager.reconnectServer("")
            ).rejects.toThrow("Server name is required");
        });
    });

    describe("getServerVersion", () => {
        it("should get server version", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                server: { version: "1.0.0" },
            });

            const version = await federationManager.getServerVersion("example.org");

            expect(version?.version).toBe("1.0.0");
        });

        it("should return null on error", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Error"));

            const version = await federationManager.getServerVersion("example.org");

            expect(version).toBeNull();
        });
    });

    describe("getPublicRoomsOnServer", () => {
        it("should get public rooms", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                chunk: [{ room_id: "!room:example.com" }],
            });

            const rooms = await federationManager.getPublicRoomsOnServer("example.org");

            expect(rooms.chunk).toHaveLength(1);
        });

        it("should accept limit and since parameters", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({ chunk: [] });

            await federationManager.getPublicRoomsOnServer("example.org", 10, "token123");

            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                expect.stringContaining("publicRooms"),
                { limit: 10, since: "token123" },
                undefined,
                { prefix: "/_matrix/client/v3" }
            );
        });

        it("should emit FederationError on failure", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Error"));

            const emitSpy = vi.spyOn(federationManager, "emit");
            await expect(
                federationManager.getPublicRoomsOnServer("example.org")
            ).rejects.toThrow();

            expect(emitSpy).toHaveBeenCalledWith(
                FederationEvent.FederationError,
                expect.any(Error)
            );
        });
    });

    describe("getCachedBlacklist", () => {
        it("should return cached blacklist", async () => {
            expect(federationManager.getCachedBlacklist()).toHaveLength(0);
        });
    });

    describe("getCachedServer", () => {
        it("should return null for unknown server", () => {
            expect(federationManager.getCachedServer("unknown.example.com")).toBeNull();
        });

        it("should return cached server", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                destinations: [{ serverName: "example.org" }],
            });

            await federationManager.getFederationDestinations();
            const server = federationManager.getCachedServer("example.org");

            expect(server?.serverName).toBe("example.org");
        });
    });

    describe("getCachedServers", () => {
        it("should return cached servers", () => {
            expect(federationManager.getCachedServers()).toHaveLength(0);
        });
    });

    describe("clearCache", () => {
        it("should clear cache", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                destinations: [{ serverName: "example.org" }],
            });

            await federationManager.getFederationDestinations();
            federationManager.clearCache();

            expect(federationManager.getCachedServers()).toHaveLength(0);
        });
    });

    describe("start/stop", () => {
        it("should start and fetch blacklist", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                blacklist: [{ serverName: "evil.example.com" }],
            });

            await federationManager.start();

            expect(federationManager.getCachedBlacklist()).toHaveLength(1);
        });

        it("should not re-fetch if already initialized", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                blacklist: [],
            });

            await federationManager.start();
            await federationManager.start();

            expect(mockClient.http.authedRequest).toHaveBeenCalledTimes(1);
        });

        it("should stop and clear cache", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                blacklist: [{ serverName: "evil.example.com" }],
            });

            await federationManager.start();
            federationManager.stop();

            expect(federationManager.getCachedBlacklist()).toHaveLength(0);
        });
    });
});

describe("FederationBlacklistManager", () => {
    let mockClient: any;
    let blacklistManager: FederationBlacklistManager;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
        };
        blacklistManager = new FederationBlacklistManager(mockClient);
    });

    describe("constructor", () => {
        it("should initialize correctly", () => {
            expect(blacklistManager).toBeDefined();
        });
    });

    describe("getBlacklist", () => {
        it("should get blacklist from server", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                blacklist: [
                    { serverName: "evil1.example.com", reason: "spam" },
                    { serverName: "evil2.example.com", reason: "malware" },
                ],
            });

            const blacklist = await blacklistManager.getBlacklist();

            expect(blacklist).toHaveLength(2);
            expect(blacklist[0].serverName).toBe("evil1.example.com");
        });

        it("should return cached blacklist on error", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Error"));

            const blacklist = await blacklistManager.getBlacklist();

            expect(blacklist).toHaveLength(0);
        });
    });

    describe("addServer", () => {
        it("should add server to blacklist", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await blacklistManager.addServer("evil.example.com", "spam");

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });

        it("should throw error for empty server name", async () => {
            await expect(blacklistManager.addServer("")).rejects.toThrow("Server name is required");
        });

        it("should emit ServerAdded event", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            const emitSpy = vi.spyOn(blacklistManager, "emit");
            await blacklistManager.addServer("evil.example.com");

            expect(emitSpy).toHaveBeenCalledWith(
                FederationEvent.ServerAdded,
                "evil.example.com"
            );
        });
    });

    describe("removeServer", () => {
        it("should remove server from blacklist", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await blacklistManager.removeServer("evil.example.com");

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });

        it("should throw error for empty server name", async () => {
            await expect(blacklistManager.removeServer("")).rejects.toThrow("Server name is required");
        });

        it("should emit ServerRemoved event", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            const emitSpy = vi.spyOn(blacklistManager, "emit");
            await blacklistManager.removeServer("evil.example.com");

            expect(emitSpy).toHaveBeenCalledWith(
                FederationEvent.ServerRemoved,
                "evil.example.com"
            );
        });
    });
});
