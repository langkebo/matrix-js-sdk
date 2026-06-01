import { describe, expect, it, vi } from "vitest";

import { DehydratedDeviceManager } from "../../src/dehydrated-device";

describe("DehydratedDeviceManager", () => {
    it("defaults to supported for clients without centralized discovery", async () => {
        const manager = new DehydratedDeviceManager({} as ConstructorParameters<typeof DehydratedDeviceManager>[0]);

        await expect(manager.isSupported()).resolves.toBe(true);
    });

    it("uses centralized synapse-rust dehydrated-device discovery when available", async () => {
        const client = {
            doesServerAdvertiseSynapseRustFeature: vi.fn().mockResolvedValue(false),
        } as unknown as ConstructorParameters<typeof DehydratedDeviceManager>[0];
        const manager = new DehydratedDeviceManager(client);

        await expect(manager.isSupported()).resolves.toBe(false);
        expect(client.doesServerAdvertiseSynapseRustFeature).toHaveBeenCalledWith("org.matrix.msc3814");
    });
});
