/// <reference lib="es2015" />
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { MatrixClient } from "../../../src/matrix";
import { extendMatrixClient } from "../../../src/device/index";
import { UIAError } from "../../../src/device/index";
import { TestConfig } from "./TestConfig";
import { loginWithDevice, safeLogout } from "./device-test-helpers";

extendMatrixClient();

function makePasswordAuthForUser(userId: string, session?: string) {
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

describe("Device Step2 (real-backend)", () => {
    let clientA: MatrixClient | null = null;
    let clientB: MatrixClient | null = null;
    let deviceBId: string;
    let primaryUserId: string;

    beforeAll(async () => {
        const primary = await loginWithDevice(TestConfig.testUser.deviceId);
        clientA = primary.client;
        primaryUserId = primary.userId;

        deviceBId = `SDK_TEST_DEVICE_B_${Date.now()}`;
        const secondary = await loginWithDevice(deviceBId);
        clientB = secondary.client;
    }, TestConfig.timeout.long);

    afterAll(async () => {
        if (clientB) {
            try {
                await safeLogout(clientB);
            } catch {}
            clientB = null;
        }
        if (clientA) {
            try {
                await safeLogout(clientA);
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
            expect(
                afterUpdate.find((d: { device_id: string; display_name?: string }) => d.device_id === deviceBId)
                    ?.display_name,
            ).toBe(newName);

            let deleted = false;
            try {
                await dm.deleteDevice(deviceBId);
                deleted = true;
            } catch (e) {
                if (e instanceof UIAError) {
                    const session = typeof e.data.session === "string" ? e.data.session : undefined;
                    expect(session, `missing UIA session: ${JSON.stringify(e.data)}`).toBeTruthy();

                    try {
                        await dm.deleteDevice(deviceBId, makePasswordAuthForUser(primaryUserId, session));
                        deleted = true;
                    } catch (retryError) {
                        if (retryError instanceof UIAError) {
                            throw new Error(`second delete still requires UIA: ${JSON.stringify(retryError.data)}`);
                        }
                        throw retryError;
                    }
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
