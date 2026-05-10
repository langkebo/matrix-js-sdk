import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createClient, type MatrixClient } from "../../../src/matrix";
import { extendMatrixClient as extendKeyRotationClient } from "../../../src/key-rotation/index";
import { ApiError } from "../../../src/errors";
import { TestConfig, getRealBackendVersionsUrl, isRealBackendReachable } from "./TestConfig";

extendKeyRotationClient();

type TestUserConfig = {
    localpart: string;
    password: string;
};

function createTestUser(localpartPrefix: string): TestUserConfig {
    return {
        localpart: `${localpartPrefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        password: "Test@123",
    };
}

async function registerUser(user: TestUserConfig): Promise<MatrixClient> {
    const registrationClient = createClient({ baseUrl: TestConfig.baseUrl, allowInsecureHttp: true });
    const result = await registrationClient.registerRequest({
        username: user.localpart,
        password: user.password,
        auth: { type: "m.login.dummy" },
    });

    return createClient({
        baseUrl: TestConfig.baseUrl,
        allowInsecureHttp: true,
        accessToken: result.access_token,
        userId: result.user_id,
        deviceId: result.device_id,
    });
}

async function expectApiError(
    promise: Promise<unknown>,
    expectedStatusCode: number,
    expectedCode: string,
): Promise<ApiError> {
    const error = await promise.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
        statusCode: expectedStatusCode,
        code: expectedCode,
    });
    return error as ApiError;
}

describe("KeyRotationManager real backend integration", () => {
    let client: MatrixClient;
    let backendAvailable = false;
    let setupError: unknown;

    beforeAll(async () => {
        if (!isRealBackendReachable()) {
            backendAvailable = false;
            setupError = new Error(`backend probe failed: ${getRealBackendVersionsUrl()}`);
            return;
        }

        try {
            client = await registerUser(createTestUser("kr_primary"));
            backendAvailable = true;
        } catch (error) {
            setupError = error;
            backendAvailable = false;
        }
    }, TestConfig.timeout.long);

    afterAll(async () => {
        await client?.logout?.().catch(() => undefined);
    });

    it(
        "should surface forbidden errors for client-api disabled key rotation endpoints",
        async () => {
            if (!backendAvailable) return;

            const manager = client.getKeyRotationManager();

            const statusError = await expectApiError(manager.getStatus(true), 403, "M_FORBIDDEN");
            expect(statusError.message).toContain("getStatus failed");

            const rotateError = await expectApiError(
                manager.rotateKey({ reason: "integration_test" }),
                403,
                "M_FORBIDDEN",
            );
            expect(rotateError.message).toContain("rotateKey failed");

            const configError = await expectApiError(
                manager.updateConfig({
                    auto_rotation_enabled: true,
                    rotation_period_ms: 3_600_000,
                }),
                403,
                "M_FORBIDDEN",
            );
            expect(configError.message).toContain("updateConfig failed");
        },
        TestConfig.timeout.medium,
    );

    it(
        "should match the live backend response fields for history, revoke and check endpoints",
        async () => {
            if (!backendAvailable) return;

            const manager = client.getKeyRotationManager();
            const deviceId = client.getDeviceId();
            expect(deviceId).toBeTruthy();

            const history = await manager.getRotationHistory(deviceId!);
            expect(history.device_id).toBe(deviceId);
            expect(Object.keys(history).sort()).toEqual(["device_id", "rotations"]);
            expect(Array.isArray(history.rotations)).toBe(true);

            for (const rotation of history.rotations) {
                expect(Object.keys(rotation).sort()).toEqual(["key_id", "rotated_ts"]);
                expect(rotation.key_id === null || typeof rotation.key_id === "string").toBe(true);
                expect(rotation.rotated_ts === null || typeof rotation.rotated_ts === "number").toBe(true);
            }

            const revoke = await manager.revokeKey({ key_id: "integration_test_key", reason: "integration_test" });
            expect(Object.keys(revoke).sort()).toEqual(["message", "revoked", "success"]);
            expect(revoke.success).toBe(true);
            expect(typeof revoke.revoked).toBe("number");
            expect(revoke.revoked).toBeGreaterThanOrEqual(0);
            expect(revoke.message).toContain("handled automatically");

            const check = await manager.checkKeyValidity();
            expect(Object.keys(check).sort()).toEqual(["interval_ms", "last_rotation", "needs_rotation"]);
            expect(typeof check.needs_rotation).toBe("boolean");
            expect(check.last_rotation === null || typeof check.last_rotation === "number").toBe(true);
            expect(typeof check.interval_ms).toBe("number");
            expect(check.interval_ms).toBeGreaterThan(0);
        },
        TestConfig.timeout.medium,
    );
});
