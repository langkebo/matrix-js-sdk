import { describe, expect, it, vi } from "vitest";

import { type MatrixClient } from "../../src/client";
import { Method } from "../../src/http-api/method";
import { ClientPrefix } from "../../src/http-api/prefix";
import {
    doesClientAdvertiseSynapseRustFeature,
    resolveSynapseRustFeatureSupport,
    ServerCapabilitiesManager,
    SynapseRustFeature,
} from "../../src/server-capabilities";
import { type Capabilities } from "../../src/serverCapabilities";

describe("ServerCapabilitiesManager", () => {
    it("fetches capabilities through the v3 client prefix", async () => {
        const authedRequest = vi.fn().mockResolvedValue({
            capabilities: {
                "m.change_password": { enabled: true },
            },
        });
        const client = {
            http: { authedRequest },
            canSupport: new Map(),
        } as unknown as MatrixClient;
        const manager = new ServerCapabilitiesManager(client);

        await expect(manager.getServerCapabilities()).resolves.toEqual({
            "m.change_password": { enabled: true },
        });

        expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/capabilities", undefined, undefined, {
            prefix: ClientPrefix.V3,
        });
    });

    it("resolves synapse-rust feature support from versions and capability aliases", () => {
        const capabilities: Capabilities = {
            "io.hula.sliding_sync": { enabled: true },
            "io.hula.widget": { enabled: true },
            "io.hula.burn_after_read": true,
            "io.hula.friends": { enabled: false },
            "m.voice": { enabled: true },
            "openclaw": { enabled: true },
            "ai_connection": { enabled: true },
        };

        expect(
            resolveSynapseRustFeatureSupport(
                {
                    versions: ["v1.13"],
                    unstable_features: {
                        [SynapseRustFeature.ExtendedProfile]: true,
                        [SynapseRustFeature.DehydratedDevice]: true,
                        [SynapseRustFeature.Friends]: true,
                    },
                },
                capabilities,
            ),
        ).toEqual({
            extendedProfile: true,
            slidingSync: true,
            dehydratedDevice: true,
            widget: true,
            burnAfterRead: true,
            friends: true,
            voice: true,
            openClaw: true,
            aiConnection: true,
        });
    });

    it("falls back when a MatrixClient does not expose centralized synapse-rust discovery", async () => {
        await expect(doesClientAdvertiseSynapseRustFeature({}, SynapseRustFeature.Friends, true)).resolves.toBe(true);
    });

    it("falls back when centralized synapse-rust discovery fails", async () => {
        const onError = vi.fn();
        const client = {
            doesServerAdvertiseSynapseRustFeature: vi.fn().mockRejectedValue(new Error("versions unavailable")),
        };

        await expect(
            doesClientAdvertiseSynapseRustFeature(client, SynapseRustFeature.Friends, false, onError),
        ).resolves.toBe(false);
        expect(onError).toHaveBeenCalled();
    });

    it("checks advertised synapse-rust features against both versions and capabilities", async () => {
        const client = {
            getVersions: vi.fn().mockResolvedValue({
                versions: ["v1.13"],
                unstable_features: {
                    [SynapseRustFeature.Widget]: false,
                },
            }),
            http: {
                authedRequest: vi.fn().mockResolvedValue({
                    capabilities: {
                        "io.hula.widget": { enabled: true },
                    },
                }),
            },
            canSupport: new Map(),
        } as unknown as MatrixClient;
        const manager = new ServerCapabilitiesManager(client);

        await expect(manager.doesServerAdvertiseSynapseRustFeature(SynapseRustFeature.Widget)).resolves.toBe(true);
    });

    it("keeps versions-based support when authenticated capabilities are unavailable", async () => {
        const client = {
            getVersions: vi.fn().mockResolvedValue({
                versions: ["v1.13"],
                unstable_features: {
                    [SynapseRustFeature.SlidingSync]: true,
                },
            }),
            http: {
                authedRequest: vi.fn().mockRejectedValue(new Error("missing token")),
            },
            canSupport: new Map(),
        } as unknown as MatrixClient;
        const manager = new ServerCapabilitiesManager(client);

        await expect(manager.doesServerAdvertiseSynapseRustFeature(SynapseRustFeature.SlidingSync)).resolves.toBe(true);
        await expect(manager.getSynapseRustFeatureSupport()).resolves.toMatchObject({
            slidingSync: true,
            burnAfterRead: false,
        });
    });

    it("returns the full synapse-rust feature matrix for callers", async () => {
        const client = {
            getVersions: vi.fn().mockResolvedValue({
                versions: ["v1.13"],
                unstable_features: {
                    [SynapseRustFeature.ExtendedProfile]: true,
                    [SynapseRustFeature.SlidingSync]: true,
                    [SynapseRustFeature.DehydratedDevice]: false,
                        [SynapseRustFeature.Widget]: false,
                        [SynapseRustFeature.BurnAfterRead]: false,
                        [SynapseRustFeature.Friends]: false,
                        [SynapseRustFeature.Voice]: false,
                        [SynapseRustFeature.OpenClaw]: false,
                        [SynapseRustFeature.AIConnection]: false,
                    },
                }),
            http: {
                authedRequest: vi.fn().mockResolvedValue({
                    capabilities: {
                        "io.hula.burn_after_read": { enabled: true },
                        "io.hula.voice_extended": { enabled: true },
                        "openclaw": { enabled: true },
                        "ai_connection": { enabled: true },
                    },
                }),
            },
            canSupport: new Map(),
        } as unknown as MatrixClient;
        const manager = new ServerCapabilitiesManager(client);

        await expect(manager.getSynapseRustFeatureSupport()).resolves.toEqual({
            extendedProfile: true,
            slidingSync: true,
            dehydratedDevice: false,
            widget: false,
            burnAfterRead: true,
            friends: false,
            voice: true,
            openClaw: true,
            aiConnection: true,
        });
    });
});
