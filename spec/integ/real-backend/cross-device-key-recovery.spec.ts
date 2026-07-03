import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type MatrixClient } from "../../../src/matrix";
import type { IMegolmSessionData } from "../../../src/@types/crypto";
import { syncPromise } from "../../test-utils/test-utils";
import { TestConfig } from "./TestConfig";
import { loginAsConfiguredUser, sleep } from "./auth-test-helpers";

describe("Cross-device key recovery real backend integration", () => {
    const longHookTimeout = 120_000;
    let sourceClient: MatrixClient | null = null;
    let recoveryClient: MatrixClient | null = null;
    let backendAvailable = false;
    let setupError: unknown;

    let encryptedRoomId = "";
    let encryptedEventId = "";
    let encryptedMessageBody = "";
    let exportedKeys: IMegolmSessionData[] = [];

    async function startClientAndSync(client: MatrixClient): Promise<void> {
        client.startClient({ initialSyncLimit: 20 });
        await syncPromise(client, 1);
    }

    async function waitForRoom(
        client: MatrixClient,
        roomId: string,
        timeoutMs = TestConfig.timeout.long,
    ): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (client.getRoom(roomId)) {
                return;
            }
            await sleep(500);
        }
        throw new Error(`room ${roomId} did not appear within ${timeoutMs}ms`);
    }

    function getEventBody(client: MatrixClient, roomId: string, eventId: string): string {
        const room = client.getRoom(roomId);
        const event = room
            ?.getLiveTimeline()
            .getEvents()
            .find((item) => item.getId() === eventId);
        const clearBody = event?.getClearContent()?.body;
        const contentBody = event?.getContent()?.body;
        return typeof clearBody === "string" ? clearBody : typeof contentBody === "string" ? contentBody : "";
    }

    async function waitForEventBody(
        client: MatrixClient,
        roomId: string,
        eventId: string,
        expectedBody: string,
        timeoutMs = TestConfig.timeout.long,
    ): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const resolvedBody = getEventBody(client, roomId, eventId);
            if (resolvedBody === expectedBody) {
                return;
            }
            await sleep(750);
        }
        throw new Error(`event ${eventId} was not decrypted to expected body within ${timeoutMs}ms`);
    }

    beforeAll(async () => {
        try {
            sourceClient = await loginAsConfiguredUser({
                ...TestConfig.testUser,
                deviceId: "REAL_BACKEND_SOURCE_DEVICE",
            });

            await sourceClient.initRustCrypto({ useIndexedDB: false });
            await startClientAndSync(sourceClient);

            const room = await sourceClient.createRoom({
                name: `cross_device_recovery_${Date.now()}`,
                initial_state: [
                    {
                        type: "m.room.encryption",
                        state_key: "",
                        content: {
                            algorithm: "m.megolm.v1.aes-sha2",
                        },
                    },
                ],
            });

            encryptedRoomId = room.room_id;
            await waitForRoom(sourceClient, encryptedRoomId);

            await sleep(1000);

            encryptedMessageBody = `cross-device recovery probe ${Date.now()}`;
            const sendResult = await sourceClient.sendTextMessage(encryptedRoomId, encryptedMessageBody);
            encryptedEventId = sendResult.event_id;

            await waitForEventBody(sourceClient, encryptedRoomId, encryptedEventId, encryptedMessageBody);

            exportedKeys = (await sourceClient.getCrypto()?.exportRoomKeys()) ?? [];
            expect(exportedKeys.length).toBeGreaterThan(0);

            sourceClient.stopClient();
            await sourceClient.logout(true);
            sourceClient = null;

            backendAvailable = true;
        } catch (error) {
            setupError = error;
            backendAvailable = false;
        }
    }, longHookTimeout);

    afterAll(async () => {
        recoveryClient?.stopClient();
        await recoveryClient?.logout?.(true).catch(() => undefined);
    });

    it(
        "should import exported room keys on a new device and decrypt historical messages",
        async () => {
            expect(
                backendAvailable,
                `real backend should be reachable for this integration test: ${String(setupError)}`,
            ).toBe(true);
            expect(exportedKeys.length).toBeGreaterThan(0);

            recoveryClient = await loginAsConfiguredUser({
                ...TestConfig.testUser,
                deviceId: "REAL_BACKEND_RECOVERY_DEVICE",
            });
            await recoveryClient.initRustCrypto({ useIndexedDB: false });
            await startClientAndSync(recoveryClient);
            await waitForRoom(recoveryClient, encryptedRoomId);

            await sleep(1500);
            const bodyBeforeImport = getEventBody(recoveryClient, encryptedRoomId, encryptedEventId);
            expect(bodyBeforeImport).not.toBe(encryptedMessageBody);

            await recoveryClient.getCrypto()?.importRoomKeys(exportedKeys);

            await waitForEventBody(recoveryClient, encryptedRoomId, encryptedEventId, encryptedMessageBody);
        },
        longHookTimeout,
    );
});
