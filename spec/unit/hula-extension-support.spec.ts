import { describe, expect, it, vi } from "vitest";

import { VoiceManager } from "../../src/voice";

describe("Hula extension feature discovery", () => {
    it("defaults the voice manager to unsupported for legacy clients (fail-closed)", async () => {
        const client = {} as ConstructorParameters<typeof VoiceManager>[0];

        // S-13：后端对这些能力没有对应路由，探测不可用时必须判为「不支持」，
        // 否则会误启用并打到 404。只有确认后端有路由的能力（SlidingSync / Friends）
        // 才保留 fail-open —— 见 docs/MSC_SEMANTICS.md 与 CLAUDE.md 常见陷阱。
        await expect(new VoiceManager(client).isSupported()).resolves.toBe(false);
    });

    it.each([["voice", VoiceManager, "org.matrix.msc3245"]] as const)(
        "uses centralized discovery for %s",
        async (_label, Manager, feature) => {
            const client = {
                doesServerAdvertiseSynapseRustFeature: vi.fn().mockResolvedValue(false),
            } as unknown as ConstructorParameters<typeof Manager>[0];
            const manager = new Manager(client);

            await expect(manager.isSupported()).resolves.toBe(false);
            expect(client.doesServerAdvertiseSynapseRustFeature).toHaveBeenCalledWith(feature);
        },
    );
});
