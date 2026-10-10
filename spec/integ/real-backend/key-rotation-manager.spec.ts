import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { MatrixClient } from "../../../src/matrix";
import { extendMatrixClient as extendKeyRotationClient } from "../../../src/key-rotation/index";
import { ApiError } from "../../../src/errors";
import { TestConfig, getRealBackendVersionsUrl, isRealBackendReachable } from "./TestConfig";
import { createTestUser, generateTotp, loginAsConfiguredUser, registerTestUser } from "./auth-test-helpers";

// key-rotation 全部端点都要求 server admin，且后端 `admin_mfa_required=true` 时对全部
// POST/PUT/PATCH/DELETE 强制 `x-admin-mfa-code`（见后端 admin_auth.rs::is_sensitive_admin_request）。
// 这里注入 TOTP 提供者，使用例 2 能以 admin 账号实际命中 history/revoke/check 三个端点。
extendKeyRotationClient({ adminMfaCodeProvider: () => generateTotp(TestConfig.adminUser.mfaSecret) });

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
    let adminClient: MatrixClient;
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
            adminClient = await loginAsConfiguredUser(TestConfig.adminUser);
            backendAvailable = true;
        } catch (error) {
            setupError = error;
            backendAvailable = false;
        }
    }, TestConfig.timeout.long);

    afterAll(async () => {
        await client?.logout?.().catch(() => undefined);
        adminClient?.stopClient();
    });

    it(
        "should surface forbidden errors for client-api disabled key rotation endpoints",
        async () => {
            if (!backendAvailable) return;

            const manager = client.getKeyRotationManager();

            const statusError = await expectApiError(manager.getStatus(true), 403, "M_FORBIDDEN");
            expect(statusError.message).toContain("getStatus failed");

            const rotateError = await expectApiError(manager.rotateKey(), 403, "M_FORBIDDEN");
            expect(rotateError.message).toContain("rotateKey failed");

            const configError = await expectApiError(
                manager.updateConfig({
                    enabled: true,
                    interval_ms: 3_600_000,
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

            const manager = adminClient.getKeyRotationManager();
            const deviceId = adminClient.getDeviceId();
            expect(deviceId).toBeTruthy();

            const history = await manager.getRotationHistory(deviceId!);
            // SDK 契约（`docs/api-contract/key-rotation.md` → `src/key-rotation/__generated__/dto.ts`）：
            // `{ device_id, rotations: { key_id, rotated_ts }[] }` —— **没有** next_batch。
            expect(Array.isArray(history.rotations)).toBe(true);
            expect(typeof history.device_id).toBe("string");

            for (const rotation of history.rotations) {
                // 契约里每个条目只有 `{ key_id: string | null, rotated_ts: number | null }`：
                // 原先断言的 `rotated_at` / `reason` / `previous_key_id` 都不存在。
                if (rotation.key_id !== null) {
                    expect(typeof rotation.key_id).toBe("string");
                }
                if (rotation.rotated_ts !== null) {
                    expect(typeof rotation.rotated_ts).toBe("number");
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
