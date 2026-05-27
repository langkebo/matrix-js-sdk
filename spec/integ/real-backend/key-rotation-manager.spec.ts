import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { MatrixClient } from "../../../src/matrix";
import { extendMatrixClient as extendKeyRotationClient } from "../../../src/key-rotation/index";
import { ApiError } from "../../../src/errors";
import { TestConfig, getRealBackendVersionsUrl, isRealBackendReachable } from "./TestConfig";
import { createTestUser, registerTestUser } from "./auth-test-helpers";

extendKeyRotationClient();

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
            client = await registerTestUser(createTestUser("kr_primary"));
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
            // SDK type: { rotations: KeyRotationHistoryEntry[], next_batch?: string }
            expect(Array.isArray(history.rotations)).toBe(true);
            if (history.next_batch !== undefined) {
                expect(typeof history.next_batch).toBe("string");
            }

            for (const rotation of history.rotations) {
                // SDK type: { key_id: string, rotated_at: number, reason: string, previous_key_id?: string }
                expect(typeof rotation.key_id).toBe("string");
                expect(typeof rotation.rotated_at).toBe("number");
                expect(typeof rotation.reason).toBe("string");
                if (rotation.previous_key_id !== undefined) {
                    expect(typeof rotation.previous_key_id).toBe("string");
                }
            }

            const revoke = await manager.revokeKey({ key_id: "integration_test_key", reason: "integration_test" });
            // Backend contract: { success: boolean, revoked: number, message: string }
            expect(typeof revoke.success).toBe("boolean");
            expect(typeof revoke.revoked).toBe("number");
            expect(typeof revoke.message).toBe("string");
            expect(revoke.revoked).toBeGreaterThanOrEqual(0);

            const check = await manager.checkKeyValidity("integration_test_key");
            // Backend contract: { needs_rotation: boolean, last_rotation: number | null, interval_ms: number }
            expect(typeof check.needs_rotation).toBe("boolean");
            expect(typeof check.interval_ms).toBe("number");
            if (check.last_rotation !== null) {
                expect(typeof check.last_rotation).toBe("number");
            }
        },
        TestConfig.timeout.medium,
    );
});
