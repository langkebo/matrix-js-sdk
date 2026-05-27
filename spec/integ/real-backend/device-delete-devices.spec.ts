import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { MatrixClient } from "../../../src/matrix";
import { extendMatrixClient, UIAError } from "../../../src/device/index";
import { TestConfig } from "./TestConfig";
import { loginWithDevice, safeLogout } from "./device-test-helpers";

extendMatrixClient();

const BULK_DEVICE_TIMEOUT = TestConfig.timeout.long * 3;

function makePasswordAuth(userId: string, session?: string) {
    return {
        type: "m.login.password",
        user: userId,
        password: TestConfig.testUser.password,
        identifier: {
            type: "m.id.user",
            user: userId,
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
    let primaryUserId: string;

    beforeAll(async () => {
        const primary = await loginWithDevice(TestConfig.testUser.deviceId);
        clientA = primary.client;
        primaryUserId = primary.userId;

        deviceBId = `SDK_TEST_DEVICE_B_${Date.now()}`;
        deviceCId = `SDK_TEST_DEVICE_C_${Date.now()}`;

        clientB = (await loginWithDevice(deviceBId)).client;
        clientC = (await loginWithDevice(deviceCId)).client;
    }, BULK_DEVICE_TIMEOUT);

    afterAll(async () => {
        for (const c of [clientB, clientC, clientA]) {
            if (!c) continue;
            try {
                await safeLogout(c);
            } catch {}
        }
        clientA = null;
        clientB = null;
        clientC = null;
    }, BULK_DEVICE_TIMEOUT);

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
                    await dm.deleteDevices({
                        devices: [deviceBId, deviceCId],
                        auth: makePasswordAuth(primaryUserId, e.data.session),
                    });
                } else {
                    throw e;
                }
            }

            const after = await dm.getDevices();
            expect(after.some((d) => d.device_id === deviceBId)).toBe(false);
            expect(after.some((d) => d.device_id === deviceCId)).toBe(false);
        },
        BULK_DEVICE_TIMEOUT,
    );
});
