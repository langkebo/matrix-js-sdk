import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { MatrixClient } from "../../../src/matrix";
import { extendMatrixClient } from "../../../src/device/index";
import { TestConfig } from "./TestConfig";
import { loginWithDevice, safeLogout } from "./device-test-helpers";

extendMatrixClient();

describe("DeviceManager.getDeviceListUpdates (real-backend)", () => {
    let client: MatrixClient | null = null;

    beforeAll(async () => {
        client = (await loginWithDevice(TestConfig.testUser.deviceId)).client;
    }, TestConfig.timeout.long);

    afterAll(async () => {
        if (!client) return;
        try {
            await safeLogout(client);
        } finally {
            client = null;
        }
    }, TestConfig.timeout.long);

    it(
        "returns a stable shape even if server responds with {}",
        async () => {
            const res = await client!.getDeviceManager().getDeviceListUpdates([TestConfig.testUser.userId]);
            expect(Array.isArray(res.changed)).toBe(true);
            expect(Array.isArray(res.left)).toBe(true);
        },
        TestConfig.timeout.long,
    );
});
