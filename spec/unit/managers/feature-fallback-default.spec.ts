/**
 * 验证：未实现 capability 的 manager 在探测失败时必须返回 false，绝不能误判支持。
 * 防止 S-13 安全默认值被未来回滚成"老式 fallback=true"。
 */

import { describe, expect, it } from "vitest";

import { VoiceManager } from "../../../src/voice/index";
import { WidgetsManager } from "../../../src/widgets/index";
import { DehydratedDeviceManager } from "../../../src/dehydrated-device/index";
import type { MatrixClient } from "../../../src/client";

function makeClientWithoutDiscovery(): MatrixClient {
    return {} as unknown as MatrixClient;
}

describe("feature fallback default (S-13: must default to unsupported)", () => {
    it("VoiceManager.isSupported() 在无能力探测时返回 false", async () => {
        const m = new VoiceManager(makeClientWithoutDiscovery());
        await expect(m.isSupported()).resolves.toBe(false);
    });

    it("WidgetsManager.isSupported() 在无能力探测时返回 false", async () => {
        const m = new WidgetsManager(makeClientWithoutDiscovery());
        await expect(m.isSupported()).resolves.toBe(false);
    });

    it("DehydratedDeviceManager.isSupported() 在无能力探测时返回 false", async () => {
        const m = new DehydratedDeviceManager(makeClientWithoutDiscovery());
        await expect(m.isSupported()).resolves.toBe(false);
    });
});
