import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createClient, type MatrixClient } from "../../../src/matrix";
import { extendMatrixClient, UIAError } from "../../../src/device/index";
import { TestConfig } from "./TestConfig";

extendMatrixClient();

function localpartFromMxid(userId: string): string {
    return userId.replace("@", "").split(":")[0];
}

async function loginWithDevice(deviceId: string): Promise<MatrixClient> {
    const client = createClient({
        baseUrl: TestConfig.baseUrl,
        allowInsecureHttp: true,
        deviceId,
    });

    const result = await client.login("m.login.password", {
        user: localpartFromMxid(TestConfig.testUser.userId),
        password: TestConfig.testUser.password,
        device_id: deviceId,
    });
    client.setAccessToken(result.access_token);
    return client;
}

function makePasswordAuth(session?: string) {
    return {
        type: "m.login.password",
        user: localpartFromMxid(TestConfig.testUser.userId),
        password: TestConfig.testUser.password,
        identifier: {
            type: "m.id.user",
            user: localpartFromMxid(TestConfig.testUser.userId),
        },
        ...(session ? { session } : {}),
    };
}

describe("DeviceManager.deleteDevices (real-backend)", () => {
    let clientA: MatrixClient | null = null;
    let clientB: MatrixClient | null = null;
    let clientC: MatrixClient | null = null;
    let deviceBId: string;
    let deviceCId: string;

    beforeAll(async () => {
        clientA = await loginWithDevice(TestConfig.testUser.deviceId);

        deviceBId = `SDK_TEST_DEVICE_B_${Date.now()}`;
        deviceCId = `SDK_TEST_DEVICE_C_${Date.now()}`;

        clientB = await loginWithDevice(deviceBId);
        clientC = await loginWithDevice(deviceCId);
    }, TestConfig.timeout.long);

    afterAll(async () => {
        for (const c of [clientB, clientC, clientA]) {
            if (!c) continue;
            try {
                await c.logout();
            } catch {}
        }
        clientA = null;
        clientB = null;
        clientC = null;
    }, TestConfig.timeout.long);

    it(
        "can bulk delete other devices (UIA if required)",
        async () => {
            const dm = clientA!.getDeviceManager();

            const before = await dm.getDevices();
            expect(before.some((d) => d.device_id === deviceBId)).toBe(true);
            expect(before.some((d) => d.device_id === deviceCId)).toBe(true);

            try {
                await dm.deleteDevices([deviceBId, deviceCId]);
            } catch (e) {
                if (e instanceof UIAError) {
                    await dm.deleteDevices({ devices: [deviceBId, deviceCId], auth: makePasswordAuth(e.data.session) });
                } else {
                    throw e;
                }
            }

            const after = await dm.getDevices();
            expect(after.some((d) => d.device_id === deviceBId)).toBe(false);
            expect(after.some((d) => d.device_id === deviceCId)).toBe(false);
        },
        TestConfig.timeout.long,
    );
});
