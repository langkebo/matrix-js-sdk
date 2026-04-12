import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createClient, type MatrixClient } from "../../../src/matrix";
import { extendMatrixClient } from "../../../src/device/index";
import { UIAError } from "../../../src/device/index";
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

describe("Device Step2 (real-backend)", () => {
    let clientA: MatrixClient | null = null;
    let clientB: MatrixClient | null = null;
    let deviceBId: string;

    beforeAll(async () => {
        clientA = await loginWithDevice(TestConfig.testUser.deviceId);

        deviceBId = `SDK_TEST_DEVICE_B_${Date.now()}`;
        clientB = await loginWithDevice(deviceBId);
    }, TestConfig.timeout.long);

    afterAll(async () => {
        if (clientB) {
            try {
                await clientB.logout();
            } catch {}
            clientB = null;
        }
        if (clientA) {
            try {
                await clientA.logout();
            } catch {}
            clientA = null;
        }
    }, TestConfig.timeout.long);

    it(
        "can update and delete another device (UIA if required)",
        async () => {
            const dm = clientA!.getDeviceManager();

            const before = await dm.getDevices();
            expect(before.some((d) => d.device_id === deviceBId)).toBe(true);

            const newName = `SDK Device B ${Date.now()}`;
            await dm.updateDevice(deviceBId, { display_name: newName });

            const afterUpdate = await dm.getDevices();
            expect(afterUpdate.find((d) => d.device_id === deviceBId)?.display_name).toBe(newName);

            let deleted = false;
            try {
                await dm.deleteDevice(deviceBId);
                deleted = true;
            } catch (e) {
                if (e instanceof UIAError) {
                    await dm.deleteDevice(deviceBId, {
                        type: "m.login.password",
                        user: localpartFromMxid(TestConfig.testUser.userId),
                        password: TestConfig.testUser.password,
                    });
                    deleted = true;
                } else {
                    throw e;
                }
            }

            expect(deleted).toBe(true);
            const afterDelete = await dm.getDevices();
            expect(afterDelete.some((d) => d.device_id === deviceBId)).toBe(false);
        },
        TestConfig.timeout.long,
    );
});
