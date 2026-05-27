import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { MatrixClient } from "../../../src/matrix";
import { TestConfig } from "./TestConfig";
import { loginWithDevice, safeLogout } from "./device-test-helpers";

// Manager extensions (including DeviceManager/AccountManager) are auto-initialized
// synchronously by createClient(), so no manual extendMatrixClient() call is needed.

describe("DeviceManager (real-backend)", () => {
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
        "can login and list devices",
        async () => {
            const devices = await client!.getDeviceManager().getDevices();
            expect(Array.isArray(devices)).toBe(true);
        },
        TestConfig.timeout.long,
    );
});
