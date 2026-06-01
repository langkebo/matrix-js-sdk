import { describe, expect, it, vi } from "vitest";

import { AIConnectionManager } from "../../src/ai-connection";
import { OpenClawManager } from "../../src/open-claw";
import { VoiceManager } from "../../src/voice";

describe("Hula extension feature discovery", () => {
    it("defaults voice, openclaw, and ai-connection managers to supported for legacy clients", async () => {
        const client = {} as ConstructorParameters<typeof VoiceManager>[0];

        await expect(new VoiceManager(client).isSupported()).resolves.toBe(true);
        await expect(new OpenClawManager(client).isSupported()).resolves.toBe(true);
        await expect(new AIConnectionManager(client).isSupported()).resolves.toBe(true);
    });

    it.each([
        ["voice", VoiceManager, "org.matrix.msc3245"],
        ["openclaw", OpenClawManager, "openclaw"],
        ["ai-connection", AIConnectionManager, "ai_connection"],
    ] as const)("uses centralized discovery for %s", async (_label, Manager, feature) => {
        const client = {
            doesServerAdvertiseSynapseRustFeature: vi.fn().mockResolvedValue(false),
        } as unknown as ConstructorParameters<typeof Manager>[0];
        const manager = new Manager(client);

        await expect(manager.isSupported()).resolves.toBe(false);
        expect(client.doesServerAdvertiseSynapseRustFeature).toHaveBeenCalledWith(feature);
    });
});
