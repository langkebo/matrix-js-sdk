import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createClient, type MatrixClient } from "../../../src/matrix";
import { extendMatrixClient } from "../../../src/device/index";
import { TestConfig } from "./TestConfig";

extendMatrixClient();

function localpartFromMxid(userId: string): string {
    return userId.replace("@", "").split(":")[0];
}

describe("DeviceManager.getDeviceListUpdates (real-backend)", () => {
    let client: MatrixClient | null = null;

    beforeAll(async () => {
        client = createClient({
            baseUrl: TestConfig.baseUrl,
            allowInsecureHttp: true,
            deviceId: TestConfig.testUser.deviceId,
        });

        const result = await client.login("m.login.password", {
            user: localpartFromMxid(TestConfig.testUser.userId),
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
        "returns a stable shape even if server responds with {}",
        async () => {
            const res = await client!.getDeviceManager().getDeviceListUpdates([TestConfig.testUser.userId]);
            expect(Array.isArray(res.changed)).toBe(true);
            expect(Array.isArray(res.left)).toBe(true);
        },
        TestConfig.timeout.long,
    );
});

