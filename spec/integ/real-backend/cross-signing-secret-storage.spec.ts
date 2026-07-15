import { afterAll, describe, expect, it } from "vitest";

import { type MatrixClient, createClient } from "../../../src/matrix";
import { extendMatrixClient as extendE2EEClient } from "../../../src/e2ee/index";
import { extendMatrixClient as extendCrossSigningClient } from "../../../src/cross-signing/index";
import { CrossSigningKey } from "../../../src/crypto-api";
import { extendMatrixClient as extendSecretStorageClient } from "../../../src/secret-storage/index";
import { syncPromise } from "../../test-utils/test-utils";
import { TestConfig } from "./TestConfig";
import { createTestUser, registerTestUser } from "./auth-test-helpers";

extendE2EEClient();
extendCrossSigningClient();
extendSecretStorageClient();

describe("Cross-signing + secret storage real backend integration", () => {
    let client: MatrixClient | undefined;

    afterAll(async () => {
        client?.stopClient();
        await client?.logout?.(true).catch(() => undefined);
    });

    it(
        "bootstraps secret storage and exports cross-signing private keys into 4S",
        async () => {
            const user = createTestUser("sdk_cs_ssss");
            const registeredClient = await registerTestUser(user);

            const cachedSecretStorageKeys = new Map<string, Uint8Array>();

            client = createClient({
                baseUrl: TestConfig.baseUrl,
                allowInsecureHttp: true,
                accessToken: registeredClient.getAccessToken()!,
                userId: registeredClient.getUserId()!,
                deviceId: registeredClient.getDeviceId()!,
                cryptoCallbacks: {
                    getSecretStorageKey: async ({ keys }) => {
                        for (const keyId of Object.keys(keys)) {
                            const privateKey = cachedSecretStorageKeys.get(keyId);
                            if (privateKey) {
                                return [keyId, privateKey];
                            }
                        }
                        return null;
                    },
                    cacheSecretStorageKey: (keyId, _keyInfo, key) => {
                        cachedSecretStorageKeys.set(keyId, key);
                    },
                },
            });

            await client.initRustCrypto({ useIndexedDB: false });
            client.startClient({ initialSyncLimit: 20 });
            await syncPromise(client, 1);

            const crypto = client.getCrypto();
            expect(crypto).toBeDefined();
            expect(await crypto!.isSecretStorageReady()).toBe(false);
            expect(await crypto!.isCrossSigningReady()).toBe(false);

            const generatedRecoveryKey = await crypto!.createRecoveryKeyFromPassphrase(
                `CrossSigningSecretStorage!${Date.now()}`,
            );

            await crypto!.bootstrapSecretStorage({
                setupNewSecretStorage: true,
                createSecretStorageKey: async () => generatedRecoveryKey,
            });

            // Even though secret storage is "bootstrapped", it's not "ready" yet because
            // we haven't stored the cross-signing keys in it.
            const status = await crypto!.getSecretStorageStatus();
            expect(status.ready).toBe(false);
            expect(status.defaultKeyId).toBeTruthy();

            const defaultKeyId = await client.secretStorage.getDefaultKeyId();
            expect(defaultKeyId).toBeTruthy();
            expect(await client.secretStorage.hasKey(defaultKeyId!)).toBe(true);

            const secretStorageKeys = await client.getSecretStorageKeys();
            expect(secretStorageKeys[defaultKeyId!]).toBe("m.secret_storage.v1.aes-hmac-sha2");

            const defaultKeyAccountData = await client.getAccountDataFromServer("m.secret_storage.default_key");
            expect(defaultKeyAccountData?.key).toBe(defaultKeyId);

            const keyDescription = await client.getAccountDataFromServer(`m.secret_storage.key.${defaultKeyId!}`);
            expect(keyDescription?.algorithm).toBe("m.secret_storage.v1.aes-hmac-sha2");
            expect(keyDescription?.iv).toBeTypeOf("string");
            expect(keyDescription?.mac).toBeTypeOf("string");

            await crypto!.bootstrapCrossSigning({
                authUploadDeviceSigningKeys: async (makeRequest) => {
                    try {
                        return await makeRequest(null);
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    } catch (e: any) {
                        if (e.errcode === "M_UIA_REQUIRED") {
                            const session = e.data.session;
                            return await makeRequest({
                                type: "m.login.password",
                                identifier: {
                                    type: "m.id.user",
                                    user: registeredClient.getUserId()!,
                                },
                                password: user.password,
                                session,
                            });
                        }
                        throw e;
                    }
                },
            });

            expect(await crypto!.isCrossSigningReady()).toBe(true);
            expect(await crypto!.isSecretStorageReady()).toBe(true);

            const finalStatus = await crypto!.getSecretStorageStatus();
            expect(finalStatus.ready).toBe(true);
            expect(finalStatus.secretStorageKeyValidityMap["m.cross_signing.master"]).toBe(true);
            expect(finalStatus.secretStorageKeyValidityMap["m.cross_signing.self_signing"]).toBe(true);
            expect(finalStatus.secretStorageKeyValidityMap["m.cross_signing.user_signing"]).toBe(true);

            const masterKeyId = await crypto!.getCrossSigningKeyId(CrossSigningKey.Master);
            const selfSigningKeyId = await crypto!.getCrossSigningKeyId(CrossSigningKey.SelfSigning);
            const userSigningKeyId = await crypto!.getCrossSigningKeyId(CrossSigningKey.UserSigning);

            expect(masterKeyId).toBeTruthy();
            expect(selfSigningKeyId).toBeTruthy();
            expect(userSigningKeyId).toBeTruthy();

            const crossSigningStatus = await client.getCrossSigningManager().checkCrossSigningStatus();
            expect(crossSigningStatus.crossSigningTrusted).toBe(true);

            const crossSigningKeys = await client.getCrossSigningManager().getCrossSigningKeys();
            expect(crossSigningKeys.masterKey).toBe(masterKeyId);
            expect(crossSigningKeys.selfSigningKey).toBe(selfSigningKeyId);
            expect(crossSigningKeys.userSigningKey).toBe(userSigningKeyId);

            expect(await client.getSecret("m.cross_signing.master")).toBeTruthy();
            expect(await client.getSecret("m.cross_signing.self_signing")).toBeTruthy();
            expect(await client.getSecret("m.cross_signing.user_signing")).toBeTruthy();

            expect(await client.getSecretStorageManager().hasSecret("m.cross_signing.master")).toBe(true);
        },
        TestConfig.timeout.long,
    );
});
