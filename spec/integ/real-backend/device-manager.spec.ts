import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createClient, type MatrixClient } from "../../../src/matrix";
import { extendMatrixClient } from "../../../src/device/index";
import { TestConfig } from "./TestConfig";

extendMatrixClient();

describe("DeviceManager (real-backend)", () => {
    let client: MatrixClient | null = null;

    beforeAll(async () => {
        client = createClient({
            baseUrl: TestConfig.baseUrl,
            allowInsecureHttp: true,
            deviceId: TestConfig.testUser.deviceId,
        });

        const username = TestConfig.testUser.userId.replace("@", "").split(":")[0];
        const result = await client.login("m.login.password", {
            user: username,
            password: TestConfig.testUser.password,
            device_id: TestConfig.testUser.deviceId,
        });
        client.setAccessToken(result.access_token);
    }, TestConfig.timeout.long);

    afterAll(async () => {
        if (!client) return;
        try {
            await client.logout();
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
