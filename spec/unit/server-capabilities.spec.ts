import { describe, it, expect, beforeEach, vi } from "vitest";
import { FakeTransport } from "../test-utils/FakeTransport";
import { ServerCapabilitiesManager, SynapseRustFeature } from "../../src/server-capabilities/index";
import { Method } from "../../src/http-api/method";
import { Feature } from "../../src/feature";
import { FeatureSupport } from "../../src/models/thread";
import { Preset } from "../../src/@types/partials";

describe("ServerCapabilitiesManager", () => {
    let transport: FakeTransport;
    let manager: ServerCapabilitiesManager;

    // Shared mock client factory
    function createMockClient(customizations: Record<string, unknown> = {}) {
        return {
            getVersions: vi.fn().mockResolvedValue({ versions: ["v1.11"] }),
            getClientOpts: vi.fn().mockReturnValue({}),
            canSupport: new Map(),
            http: {
                authedRequest: vi.fn(),
            },
            ...customizations,
        };
    }

    beforeEach(() => {
        transport = new FakeTransport();
    });

    // ============ getServerCapabilities (uses transport) ============

    describe("getServerCapabilities", () => {
        it("should fetch capabilities via the transport", async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(createMockClient() as any, { transport });
            transport.respondWith({ capabilities: { "m.change_password": { enabled: true } } });

            const result = await manager.getServerCapabilities();

            expect(result).toEqual({ "m.change_password": { enabled: true } });
            transport.expectCalledWith(Method.Get, "/capabilities");
        });

        it("should cache capabilities and not re-fetch within TTL", async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(createMockClient() as any, { transport });
            transport.respondWith({ capabilities: { "m.change_password": { enabled: true } } });
            await manager.getServerCapabilities();
            transport.resetCalls();

            const result = await manager.getServerCapabilities();

            expect(result).toEqual({ "m.change_password": { enabled: true } });
            expect(transport.request).not.toHaveBeenCalled();
        });
    });

    // ============ hasServerSupport (sync) ============

    describe("hasServerSupport", () => {
        it("should return true when feature is Supported (value 0)", () => {
            const mockClient = createMockClient();
            // ServerSupport.Stable = 0, ServerSupport.Unsupported = 2
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            mockClient.canSupport.set("m.room_versions" as any, 0);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(mockClient as any, { transport });

            expect(manager.hasServerSupport("m.room_versions")).toBe(true);
        });

        it("should return false when feature is Unsupported (value 2)", () => {
            const mockClient = createMockClient();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            mockClient.canSupport.set("m.unknown_feature" as any, 2);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(mockClient as any, { transport });

            expect(manager.hasServerSupport("m.unknown_feature")).toBe(false);
        });
    });

    // ============ getServerVersion ============

    describe("getServerVersion", () => {
        it("should return the first version from getVersions", async () => {
            const mockClient = createMockClient();
            mockClient.getVersions.mockResolvedValue({ versions: ["v1.11", "v1.12"] });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(mockClient as any, { transport });

            const version = await manager.getServerVersion();

            expect(version).toBe("v1.11");
        });

        it("should return empty string when no versions", async () => {
            const mockClient = createMockClient();
            mockClient.getVersions.mockResolvedValue({ versions: [] });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(mockClient as any, { transport });

            const version = await manager.getServerVersion();

            expect(version).toBe("");
        });
    });

    // ============ isVersionSupported ============

    describe("isVersionSupported", () => {
        it("should return true when version is in the list", async () => {
            const mockClient = createMockClient();
            mockClient.getVersions.mockResolvedValue({ versions: ["v1.11", "v1.12"] });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(mockClient as any, { transport });

            const supported = await manager.isVersionSupported("v1.11");

            expect(supported).toBe(true);
        });

        it("should return false when version is not in the list", async () => {
            const mockClient = createMockClient();
            mockClient.getVersions.mockResolvedValue({ versions: ["v1.11"] });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(mockClient as any, { transport });

            const supported = await manager.isVersionSupported("v1.99");

            expect(supported).toBe(false);
        });
    });

    // ============ doesServerSupportUnstableFeature ============

    describe("doesServerSupportUnstableFeature", () => {
        it("should return true when unstable feature is enabled", async () => {
            const mockClient = createMockClient();
            mockClient.getVersions.mockResolvedValue({
                versions: ["v1.11"],
                unstable_features: { "org.matrix.msc1234": true },
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(mockClient as any, { transport });

            const result = await manager.doesServerSupportUnstableFeature("org.matrix.msc1234");

            expect(result).toBe(true);
        });

        it("should return false when unstable feature is not enabled", async () => {
            const mockClient = createMockClient();
            mockClient.getVersions.mockResolvedValue({
                versions: ["v1.11"],
                unstable_features: { "org.matrix.msc1234": false },
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(mockClient as any, { transport });

            const result = await manager.doesServerSupportUnstableFeature("org.matrix.msc9999");

            expect(result).toBe(false);
        });
    });

    // ============ doesServerAdvertiseSynapseRustFeature ============

    describe("doesServerAdvertiseSynapseRustFeature", () => {
        it("should detect feature from unstable_features", async () => {
            const mockClient = createMockClient();
            mockClient.getVersions.mockResolvedValue({
                versions: ["v1.11"],
                unstable_features: { openclaw: true },
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(mockClient as any, { transport });
            transport.respondWith({ capabilities: {} });

            const result = await manager.doesServerAdvertiseSynapseRustFeature("openclaw");

            expect(result).toBe(true);
        });

        it("should detect feature from capability aliases", async () => {
            const mockClient = createMockClient();
            mockClient.getVersions.mockResolvedValue({
                versions: ["v1.11"],
                unstable_features: {},
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(mockClient as any, { transport });
            transport.respondWith({ capabilities: { "io.hula.friends": { enabled: true } } });

            const result = await manager.doesServerAdvertiseSynapseRustFeature(SynapseRustFeature.Friends);

            expect(result).toBe(true);
        });
    });

    // ============ getSynapseRustFeatureSupport ============

    describe("getSynapseRustFeatureSupport", () => {
        it("should resolve full feature support map", async () => {
            const mockClient = createMockClient();
            mockClient.getVersions.mockResolvedValue({
                versions: ["v1.11"],
                unstable_features: { openclaw: true, "io.hula.friends": true },
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(mockClient as any, { transport });
            transport.respondWith({ capabilities: {} });

            const support = await manager.getSynapseRustFeatureSupport();

            expect(support.openClaw).toBe(true);
            expect(support.friends).toBe(true);
            expect(support.extendedProfile).toBe(false);
        });
    });

    // ============ doesServerForceEncryptionForPreset ============

    describe("doesServerForceEncryptionForPreset", () => {
        it("should return true when the preset encryption flag is set", async () => {
            const mockClient = createMockClient();
            mockClient.getVersions.mockResolvedValue({
                versions: ["v1.11"],
                // The preset name "private_chat" has the "_chat" suffix stripped → "io.element.e2ee_forced.private"
                unstable_features: { "io.element.e2ee_forced.private": true },
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(mockClient as any, { transport });

            const result = await manager.doesServerForceEncryptionForPreset(Preset.PrivateChat);

            expect(result).toBe(true);
        });

        it("should return false when encryption flag is not present", async () => {
            const mockClient = createMockClient();
            mockClient.getVersions.mockResolvedValue({
                versions: ["v1.11"],
                unstable_features: {},
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(mockClient as any, { transport });

            const result = await manager.doesServerForceEncryptionForPreset(Preset.PublicChat);

            expect(result).toBe(false);
        });
    });

    // ============ doesServerSupportThread ============

    describe("doesServerSupportThread", () => {
        it("should return stable support for v1.4+", async () => {
            const mockClient = createMockClient();
            mockClient.getVersions.mockResolvedValue({ versions: ["v1.4", "v1.11"] });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(mockClient as any, { transport });

            const result = await manager.doesServerSupportThread();

            expect(result.threads).toBe(FeatureSupport.Stable);
            expect(result.list).toBe(FeatureSupport.Stable);
            expect(result.fwdPagination).toBe(FeatureSupport.Stable);
        });

        it("should check unstable features when v1.4 not available", async () => {
            const mockClient = createMockClient();
            mockClient.getVersions.mockResolvedValueOnce({ versions: ["v1.11"] }).mockResolvedValue({
                versions: ["v1.11"],
                unstable_features: { "org.matrix.msc3440.stable": true },
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(mockClient as any, { transport });

            const result = await manager.doesServerSupportThread();

            expect(result.threads).toBe(FeatureSupport.Stable);
        });
    });

    // ============ Sync helper methods ============

    describe("sync helper methods", () => {
        it("supportsThreads should return client option value", () => {
            const mockClient = createMockClient({ getClientOpts: vi.fn().mockReturnValue({ threadSupport: true }) });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(mockClient as any, { transport });

            expect(manager.supportsThreads()).toBe(true);
        });

        it("supportsThreads should default to false", () => {
            const mockClient = createMockClient();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(mockClient as any, { transport });

            expect(manager.supportsThreads()).toBe(false);
        });

        it("supportsIntentionalMentions should check client canSupport", () => {
            const mockClient = createMockClient();
            // ServerSupport.Stable = 0 → passes check `0 !== 2`
            mockClient.canSupport.set(Feature.IntentionalMentions, 0);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(mockClient as any, { transport });

            expect(manager.supportsIntentionalMentions()).toBe(true);
        });

        it("hasLazyLoadMembersEnabled should return client option", () => {
            const mockClient = createMockClient({ getClientOpts: vi.fn().mockReturnValue({ lazyLoadMembers: true }) });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(mockClient as any, { transport });

            expect(manager.hasLazyLoadMembersEnabled()).toBe(true);
        });

        it("supportsLocation should check client canSupport", () => {
            const mockClient = createMockClient();
            // ServerSupport.Stable = 0 → passes check `0 !== 2`
            mockClient.canSupport.set(Feature.Location, 0);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(mockClient as any, { transport });

            expect(manager.supportsLocation()).toBe(true);
        });
    });

    // ============ getVersions ============

    describe("getVersions", () => {
        it("should fetch and cache server versions", async () => {
            const authedRequest = vi.fn().mockResolvedValue({ versions: ["v1.11"] });
            const mockClient = createMockClient({ http: { authedRequest } });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(mockClient as any, { transport });

            const result = await manager.getVersions();

            expect(result.versions).toContain("v1.11");
            expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/_matrix/client/versions", undefined, undefined, {
                prefix: "",
            });
        });

        it("should return cached promise on subsequent calls", async () => {
            const authedRequest = vi.fn().mockResolvedValue({ versions: ["v1.11"] });
            const mockClient = createMockClient({ http: { authedRequest } });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(mockClient as any, { transport });

            await manager.getVersions();
            await manager.getVersions();

            expect(authedRequest).toHaveBeenCalledTimes(1);
        });
    });

    // ============ _unstable_getSharedRooms ============

    describe("_unstable_getSharedRooms", () => {
        it("should throw when server does not support the API", async () => {
            const mockClient = createMockClient();
            mockClient.getVersions.mockResolvedValue({
                versions: ["v1.11"],
                unstable_features: {},
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(mockClient as any, { transport });

            await expect(manager._unstable_getSharedRooms("@user:example.com")).rejects.toThrow(
                "Server does not support the Mutual Rooms API",
            );
        });

        it("should fetch shared rooms via query_mutual_rooms endpoint", async () => {
            const mockClient = createMockClient();
            mockClient.getVersions.mockResolvedValue({
                versions: ["v1.11"],
                unstable_features: { "uk.half-shot.msc2666.query_mutual_rooms": true },
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(mockClient as any, { transport });
            transport.respondWith({
                joined: ["!room1:example.com", "!room2:example.com"],
            });

            const rooms = await manager._unstable_getSharedRooms("@user:example.com");

            expect(rooms).toEqual(["!room1:example.com", "!room2:example.com"]);
            transport.expectCalledWith(Method.Get, "/uk.half-shot.msc2666/user/mutual_rooms");
        });
    });

    // ============ _unstable_getRTCTransports ============

    describe("_unstable_getRTCTransports", () => {
        it("should fetch RTC transports via the transport", async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(createMockClient() as any, { transport });
            transport.respondWith({ rtc_transports: [{ type: "stun", urls: ["stun:example.com"] }] });

            const result = await manager._unstable_getRTCTransports();

            expect(result).toHaveLength(1);
            expect(result[0]).toHaveProperty("type", "stun");
        });
    });

    // ============ FT-099: 扩展 capability key 解析 ============

    describe("FT-099: extended capability keys resolution", () => {
        it("should resolve burn_after_read from io.hula.burn_after_read capability", async () => {
            const mockClient = createMockClient();
            mockClient.getVersions.mockResolvedValue({ versions: ["v1.11"] });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(mockClient as any, { transport });
            transport.respondWith({
                capabilities: {
                    "io.hula.burn_after_read": { enabled: true },
                },
            });

            const support = await manager.getSynapseRustFeatureSupport();

            expect(support.burnAfterRead).toBe(true);
        });

        it("should resolve friends from io.hula.friends capability", async () => {
            const mockClient = createMockClient();
            mockClient.getVersions.mockResolvedValue({ versions: ["v1.11"] });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(mockClient as any, { transport });
            transport.respondWith({
                capabilities: {
                    "io.hula.friends": { enabled: true },
                },
            });

            const support = await manager.getSynapseRustFeatureSupport();

            expect(support.friends).toBe(true);
        });

        it("should resolve voice from io.hula.voice_extended capability", async () => {
            const mockClient = createMockClient();
            mockClient.getVersions.mockResolvedValue({ versions: ["v1.11"] });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(mockClient as any, { transport });
            transport.respondWith({
                capabilities: {
                    "io.hula.voice_extended": { enabled: true },
                },
            });

            const support = await manager.getSynapseRustFeatureSupport();

            expect(support.voice).toBe(true);
        });

        it("should resolve openclaw from openclaw capability", async () => {
            const mockClient = createMockClient();
            mockClient.getVersions.mockResolvedValue({ versions: ["v1.11"] });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(mockClient as any, { transport });
            transport.respondWith({
                capabilities: {
                    openclaw: { enabled: true },
                },
            });

            const support = await manager.getSynapseRustFeatureSupport();

            expect(support.openClaw).toBe(true);
        });

        it("should resolve aiConnection from ai_connection capability", async () => {
            const mockClient = createMockClient();
            mockClient.getVersions.mockResolvedValue({ versions: ["v1.11"] });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(mockClient as any, { transport });
            transport.respondWith({
                capabilities: {
                    ai_connection: { enabled: true },
                },
            });

            const support = await manager.getSynapseRustFeatureSupport();

            expect(support.aiConnection).toBe(true);
        });

        it("should resolve all extended capabilities simultaneously", async () => {
            const mockClient = createMockClient();
            mockClient.getVersions.mockResolvedValue({ versions: ["v1.11"] });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager = new ServerCapabilitiesManager(mockClient as any, { transport });
            transport.respondWith({
                capabilities: {
                    "io.hula.burn_after_read": { enabled: true },
                    "io.hula.friends": { enabled: true },
                    "io.hula.voice_extended": { enabled: true },
                    openclaw: { enabled: true },
                    ai_connection: { enabled: true },
                    "m.voice": { enabled: true },
                },
            });

            const support = await manager.getSynapseRustFeatureSupport();

            expect(support.burnAfterRead).toBe(true);
            expect(support.friends).toBe(true);
            expect(support.voice).toBe(true);
            expect(support.openClaw).toBe(true);
            expect(support.aiConnection).toBe(true);
        });
    });
});
