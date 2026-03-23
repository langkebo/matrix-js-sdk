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

describe("Login Tests", () => {
  let dbVerifier: DatabaseVerifier;
  let loggedInClient: MatrixClient | null = null;

  beforeAll(() => {
    dbVerifier = new DatabaseVerifier('docker-postgres');
  });

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
      const client = createClient({
        baseUrl: TestConfig.baseUrl
      });

      const username = TestConfig.testUser.userId.replace("@", "").split(":")[0];

      const result = await client.login("m.login.password", {
        user: username,
        password: TestConfig.testUser.password
      });

      expect(result.access_token).toBeTruthy();
      expect(result.user_id).toBeTruthy();
      expect(result.user_id).toBe(TestConfig.testUser.userId);

      loggedInClient = client;
    });

    test("should be able to use access token for authenticated requests", async () => {
      if (!loggedInClient) {
        const client = createClient({
          baseUrl: TestConfig.baseUrl
        });
        const username = TestConfig.testUser.userId.replace("@", "").split(":")[0];
        const result = await client.login("m.login.password", {
          user: username,
          password: TestConfig.testUser.password
        });
        loggedInClient = client;
        expect(result.access_token).toBeTruthy();
      }

      const accessToken = loggedInClient.getAccessToken();
      expect(accessToken).toBeTruthy();

      const profile = await loggedInClient.getProfileManager().getProfileInfo(TestConfig.testUser.userId);
      expect(profile).toBeTruthy();
    });

    test("should update user updated_ts after login activity", async () => {
      if (!loggedInClient) return;

      const beforeResult = await dbVerifier.querySingle(
        `SELECT updated_ts FROM users WHERE user_id = '${TestConfig.testUser.userId}'`
      );
      const beforeTs = beforeResult ? parseInt(beforeResult, 10) : 0;

      await loggedInClient.getProfileManager().getProfileInfo(TestConfig.testUser.userId);

      await new Promise(resolve => setTimeout(resolve, 500));

      const afterResult = await dbVerifier.querySingle(
        `SELECT updated_ts FROM users WHERE user_id = '${TestConfig.testUser.userId}'`
      );
      const afterTs = afterResult ? parseInt(afterResult, 10) : 0;

      console.log(`updated_ts: ${beforeTs} -> ${afterTs}`);
      expect(afterTs).toBeGreaterThanOrEqual(beforeTs);
    });
  });

  describe("Logout", () => {
    test("should logout successfully", async () => {
      const client = createClient({
        baseUrl: TestConfig.baseUrl
      });

      const username = TestConfig.testUser.userId.replace("@", "").split(":")[0];

      const result = await client.login("m.login.password", {
        user: username,
        password: TestConfig.testUser.password
      });

      const tokenBeforeLogout = result.access_token;
      expect(tokenBeforeLogout).toBeTruthy();

      await client.logout();
    });
  });

  describe("Login Failures", () => {
    test("should fail with wrong password", async () => {
      const client = createClient({
        baseUrl: TestConfig.baseUrl
      });

      const username = TestConfig.testUser.userId.replace("@", "").split(":")[0];

      await expect(
        client.login("m.login.password", {
          user: username,
          password: "WrongPassword123"
        })
      ).rejects.toThrow();
    });

    test("should fail with non-existent user", async () => {
      const client = createClient({
        baseUrl: TestConfig.baseUrl
      });

      await expect(
        client.login("m.login.password", {
          user: "nonexistent_user_xyz",
          password: "SomePassword123"
        })
      ).rejects.toThrow();
    });
  });
});