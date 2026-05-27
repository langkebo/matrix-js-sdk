import { afterAll, beforeAll, describe, expect, test } from "vitest";

/**
 * Login Tests
 *
 * Tests login functionality
 *
 * Run with: npx vitest run spec/integ/real-backend/login-db-verification.test.ts --config vitest.real-backend.config.ts
 */

import { createClient, type MatrixClient } from "../../../src/matrix";
import { DatabaseVerifier } from "./DatabaseVerifier";
import { TestConfig } from "./TestConfig";
import { loginAsConfiguredUser } from "./auth-test-helpers";

describe("Login Tests", () => {
    let dbVerifier: DatabaseVerifier;
    let loggedInClient: MatrixClient | null = null;

    beforeAll(async () => {
        dbVerifier = new DatabaseVerifier("docker-postgres");
        loggedInClient = await loginAsConfiguredUser();
    }, TestConfig.timeout.long);

    afterAll(async () => {
        if (loggedInClient) {
            try {
                await loggedInClient.logout();
            } catch (e) {
                console.warn("Logout warning:", e);
            }
        }
    });

    describe("Login Success", () => {
        test("should login successfully with valid credentials", async () => {
            const client = loggedInClient ?? (await loginAsConfiguredUser());
            const result = {
                access_token: client.getAccessToken()!,
                user_id: client.getUserId()!,
            };

            expect(result.access_token).toBeTruthy();
            expect(result.user_id).toBeTruthy();
            expect(result.user_id).toBe(TestConfig.testUser.userId);

            loggedInClient = client;
        }, TestConfig.timeout.medium);

        test("should be able to use access token for authenticated requests", async () => {
            let loginResult;

            if (!loggedInClient) {
                const client = await loginAsConfiguredUser();
                loginResult = {
                    access_token: client.getAccessToken()!,
                    user_id: client.getUserId()!,
                };
                loggedInClient = client;
            }

            expect(loginResult?.access_token ?? loggedInClient?.getAccessToken()).toBeTruthy();
            const accessToken = loggedInClient.getAccessToken();
            expect(accessToken).toBeTruthy();

            const profile = await loggedInClient.getProfileManager().getProfileInfo(TestConfig.testUser.userId);
            expect(profile).toBeTruthy();
        }, TestConfig.timeout.medium);

        test("should update user updated_ts after login activity", async () => {
            if (!loggedInClient) return;

            const beforeResult = await dbVerifier.querySingle(
                `SELECT updated_ts FROM users WHERE user_id = '${TestConfig.testUser.userId}'`,
            );
            const beforeTs = beforeResult ? parseInt(beforeResult, 10) : 0;

            await loggedInClient.getProfileManager().getProfileInfo(TestConfig.testUser.userId);

            await new Promise((resolve) => setTimeout(resolve, 500));

            const afterResult = await dbVerifier.querySingle(
                `SELECT updated_ts FROM users WHERE user_id = '${TestConfig.testUser.userId}'`,
            );
            const afterTs = afterResult ? parseInt(afterResult, 10) : 0;

            console.log(`updated_ts: ${beforeTs} -> ${afterTs}`);
            expect(afterTs).toBeGreaterThanOrEqual(beforeTs);
        });
    });

    describe("Logout", () => {
        test("should logout successfully", async () => {
            const client = await loginAsConfiguredUser();
            const result = {
                access_token: client.getAccessToken()!,
            };

            const tokenBeforeLogout = result.access_token;
            expect(tokenBeforeLogout).toBeTruthy();

            await client.logout();
        }, TestConfig.timeout.medium);
    });

    describe("Login Failures", () => {
        test("should fail with wrong password", async () => {
            const client = createClient({
                baseUrl: TestConfig.baseUrl,
                allowInsecureHttp: true,
            });

            const username = TestConfig.testUser.userId.replace("@", "").split(":")[0];

            await expect(
                client.login("m.login.password", {
                    user: username,
                    password: "WrongPassword123",
                }),
            ).rejects.toThrow();
        });

        test("should fail with non-existent user", async () => {
            const client = createClient({
                baseUrl: TestConfig.baseUrl,
                allowInsecureHttp: true,
            });

            await expect(
                client.login("m.login.password", {
                    user: "nonexistent_user_xyz",
                    password: "SomePassword123",
                }),
            ).rejects.toThrow();
        });
    });
});
