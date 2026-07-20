import { afterAll, describe, expect, it } from "vitest";

import { type MatrixClient, createClient } from "../../../src/matrix";
import { deriveRecoveryKeyFromPassphrase } from "../../../src/crypto-api/key-passphrase";
import { syncPromise } from "../../test-utils/test-utils";
import { TestConfig } from "./TestConfig";
import { createTestUser, localpartFromMxid, sleep, withRateLimitRetry } from "./auth-test-helpers";

describe("Cross-device passphrase recovery real backend integration", () => {
    const longHookTimeout = 120_000;
    const passphrase = `CrossDevicePassphrase!${Date.now()}`;

    let sourceClient: MatrixClient | null = null;
    let recoveryClient: MatrixClient | null = null;

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

    async function waitForBackedUpKeys(client: MatrixClient, timeoutMs = longHookTimeout): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const backupInfo = await client.getCrypto()?.getKeyBackupInfo();
            if ((backupInfo?.count ?? 0) > 0) {
                return;
            }
            await sleep(1000);
        }
        throw new Error(`room keys were not uploaded to backup within ${timeoutMs}ms`);
    }

    async function loginWithSecretStoragePassphrase(
        userId: string,
        password: string,
        deviceId: string,
    ): Promise<MatrixClient> {
        const client = createClient({
            baseUrl: TestConfig.baseUrl,
            allowInsecureHttp: true,
            deviceId,
            cryptoCallbacks: {
                getSecretStorageKey: async ({ keys }) => {
                    for (const keyId of Object.keys(keys)) {
                        const keyInfo = keys[keyId];
                        const passphraseInfo = keyInfo.passphrase;
                        if (!passphraseInfo) {
                            continue;
                        }
                        const privateKey = await deriveRecoveryKeyFromPassphrase(
                            passphrase,
                            passphraseInfo.salt,
                            passphraseInfo.iterations,
                            passphraseInfo.bits,
                        );
                        return [keyId, privateKey];
                    }
                    return null;
                },
            },
        });

        const username = localpartFromMxid(userId);
        const result = await withRateLimitRetry(async () => {
            return await client.loginRequest({
                type: "m.login.password",
                user: username,
                password,
                device_id: deviceId,
            });
        });

        client.setAccessToken(result.access_token);
        return client;
    }

    async function registerUserWithSecretStoragePassphrase(localpart: string, password: string): Promise<MatrixClient> {
        const registrationClient = createClient({ baseUrl: TestConfig.baseUrl, allowInsecureHttp: true });

        const result = await withRateLimitRetry(async () => {
            return await registrationClient.registerRequest({
                username: localpart,
                password,
                auth: { type: "m.login.dummy" },
            });
        });

        return createClient({
            baseUrl: TestConfig.baseUrl,
            allowInsecureHttp: true,
            accessToken: result.access_token,
            userId: result.user_id,
            deviceId: result.device_id,
            cryptoCallbacks: {
                getSecretStorageKey: async ({ keys }) => {
                    for (const keyId of Object.keys(keys)) {
                        const keyInfo = keys[keyId];
                        const passphraseInfo = keyInfo.passphrase;
                        if (!passphraseInfo) {
                            continue;
                        }
                        const privateKey = await deriveRecoveryKeyFromPassphrase(
                            passphrase,
                            passphraseInfo.salt,
                            passphraseInfo.iterations,
                            passphraseInfo.bits,
                        );
                        return [keyId, privateKey];
                    }
                    return null;
                },
            },
        });
    }

    afterAll(async () => {
        sourceClient?.stopClient();
        recoveryClient?.stopClient();
        await sourceClient?.logout?.(true).catch(() => undefined);
        await recoveryClient?.logout?.(true).catch(() => undefined);
    });

    it(
        "restores historical encrypted messages on a new device after unlocking 4S with a passphrase",
        async () => {
            const user = createTestUser("sdk_passphrase_recovery");
            sourceClient = await registerUserWithSecretStoragePassphrase(user.localpart, user.password);

            await sourceClient.initRustCrypto({ useIndexedDB: false });
            await startClientAndSync(sourceClient);

            const sourceCrypto = sourceClient.getCrypto();
            expect(sourceCrypto).toBeDefined();

            const generatedRecoveryKey = await sourceCrypto!.createRecoveryKeyFromPassphrase(passphrase);
            await sourceCrypto!.bootstrapSecretStorage({
                setupNewSecretStorage: true,
                setupNewKeyBackup: true,
                setupNewKeyBackupAuth: {
                    type: "m.login.password",
                    user: sourceClient.getUserId()!,
                    password: user.password,
                },
                createSecretStorageKey: async () => generatedRecoveryKey,
            });

            const room = await sourceClient.createRoom({
                name: `cross_device_passphrase_recovery_${Date.now()}`,
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

            const encryptedRoomId = room.room_id;
            await waitForRoom(sourceClient, encryptedRoomId);
            await sleep(1000);

            const encryptedMessageBody = `cross-device passphrase recovery probe ${Date.now()}`;
            const sendResult = await sourceClient.sendTextMessage(encryptedRoomId, encryptedMessageBody);
            const encryptedEventId = sendResult.event_id;

            await waitForEventBody(sourceClient, encryptedRoomId, encryptedEventId, encryptedMessageBody);
            await waitForBackedUpKeys(sourceClient);

            const userId = sourceClient.getUserId()!;
            sourceClient.stopClient();
            await sourceClient.logout(true);
            sourceClient = null;

            recoveryClient = await loginWithSecretStoragePassphrase(
                userId,
                user.password,
                `REAL_BACKEND_PASSPHRASE_RECOVERY_${Date.now()}`,
            );
            await recoveryClient.initRustCrypto({ useIndexedDB: false });
            await startClientAndSync(recoveryClient);
            await waitForRoom(recoveryClient, encryptedRoomId);

            await sleep(1500);
            const bodyBeforeRestore = getEventBody(recoveryClient, encryptedRoomId, encryptedEventId);
            expect(bodyBeforeRestore).not.toBe(encryptedMessageBody);

            const recoveryCrypto = recoveryClient.getCrypto();
            expect(recoveryCrypto).toBeDefined();

            await recoveryCrypto!.checkKeyBackupAndEnable();
            await recoveryCrypto!.loadSessionBackupPrivateKeyFromSecretStorage();

            const importResult = await recoveryCrypto!.restoreKeyBackup();
            expect(importResult.imported).toBeGreaterThan(0);
            expect(importResult.total).toBeGreaterThanOrEqual(importResult.imported);

            await waitForEventBody(
                recoveryClient,
                encryptedRoomId,
                encryptedEventId,
                encryptedMessageBody,
                longHookTimeout,
            );
        },
        longHookTimeout,
    );
});
