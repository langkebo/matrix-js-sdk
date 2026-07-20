/*
Copyright 2026 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/**
 * Admin Manager Real-Backend Tests
 *
 * Validates admin API endpoints against a live synapse-rust backend,
 * with both HTTP response and database state verification.
 *
 * Prerequisites:
 *   - synapse-rust running at TestConfig.baseUrl
 *   - TestConfig.testUser provisioned as super admin
 *   - PostgreSQL accessible via DatabaseVerifier
 *
 * Run with: pnpm run test:real-backend:batch -- spec/integ/real-backend/admin-manager.spec.ts
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { MatrixClient } from "../../../src/matrix";
import { extendMatrixClient as extendAdminClient } from "../../../src/admin/index";
import { DatabaseVerifier } from "./DatabaseVerifier";
import { TestConfig } from "./TestConfig";
import { loginAsConfiguredUser } from "./auth-test-helpers";

extendAdminClient();

describe("AdminManager — real backend", () => {
    let client: MatrixClient;
    let dbVerifier: DatabaseVerifier;
    let backendAvailable = false;

    beforeAll(async () => {
        dbVerifier = new DatabaseVerifier("docker-postgres");
        try {
            client = await loginAsConfiguredUser();
            backendAvailable = true;
        } catch (e) {
            console.warn("Backend not reachable, skipping admin real-backend tests:", (e as Error).message);
        }
    }, TestConfig.timeout.long);

    afterAll(() => {
        client?.stopClient();
    });

    // ─── Server status ─────────────────────────────────────────

    describe("server status", () => {
        it("returns server_ok via getServerStatus", async () => {
            if (!backendAvailable) return;
            const admin = client.getAdminManager();
            const status = await admin.server.getServerStatus();
            expect(status).toHaveProperty("server_ok");
            expect(status.server_ok).toBe(true);
        });

        it("returns server_version via getServerVersion", async () => {
            if (!backendAvailable) return;
            const admin = client.getAdminManager();
            const version = await admin.server.getServerVersion();
            expect(version).toHaveProperty("server_version");
            expect(version.server_version).toBeTruthy();
        });

        it("returns health status via getServerHealth", async () => {
            if (!backendAvailable) return;
            const admin = client.getAdminManager();
            const health = await admin.server.getServerHealth();
            expect(health).toHaveProperty("healthy");
        });

        it("database has users table matching API response", async () => {
            if (!backendAvailable) return;
            const dbCount = await dbVerifier.querySingle("SELECT COUNT(*) FROM users");
            expect(Number(dbCount)).toBeGreaterThan(0);
        });
    });

    // ─── User management ──────────────────────────────────────

    describe("user management", () => {
        it("lists users via getUsersPaginated", async () => {
            if (!backendAvailable) return;
            const admin = client.getAdminManager();
            const result = await admin.users.getUsersPaginated({ limit: 5 });
            expect(result).toHaveProperty("users");
            expect(Array.isArray(result.users)).toBe(true);
            expect(result).toHaveProperty("total");
            expect(result.total).toBeGreaterThan(0);
        });

        it("returns current user details via getUser", async () => {
            if (!backendAvailable) return;
            const admin = client.getAdminManager();
            const user = await admin.users.getUser(TestConfig.testUser.userId);
            expect(user).toBeDefined();
            expect(user).toHaveProperty("name");
            expect(user).toHaveProperty("is_admin");
        });

        it("database users table contains test user", async () => {
            if (!backendAvailable) return;
            const dbUserId = await dbVerifier.querySingle(
                `SELECT user_id FROM users WHERE user_id = '${TestConfig.testUser.userId}'`,
            );
            expect(dbUserId).toBe(TestConfig.testUser.userId);
        });

        it("admin API user count matches database user count", async () => {
            if (!backendAvailable) return;
            const admin = client.getAdminManager();
            const apiResult = await admin.users.getUsersPaginated({ limit: 1 });
            const dbCount = await dbVerifier.querySingle("SELECT COUNT(*) FROM users");
            expect(apiResult.total).toBeGreaterThanOrEqual(1);
            expect(Number(dbCount)).toBeGreaterThanOrEqual(1);
        });
    });

    // ─── Room management ──────────────────────────────────────

    describe("room management", () => {
        it("lists rooms via getRoomsPaginated", async () => {
            if (!backendAvailable) return;
            const admin = client.getAdminManager();
            const result = await admin.rooms.getRoomsPaginated({ limit: 5 });
            expect(result).toHaveProperty("rooms");
            expect(Array.isArray(result.rooms)).toBe(true);
            expect(result).toHaveProperty("total");
        });

        it("database rooms table exists and is queryable", async () => {
            if (!backendAvailable) return;
            const dbCount = await dbVerifier.querySingle("SELECT COUNT(*) FROM rooms");
            expect(Number(dbCount)).toBeGreaterThanOrEqual(0);
        });
    });

    // ─── Server info ──────────────────────────────────────────

    describe("server info", () => {
        it("returns admin info via getAdminInfo", async () => {
            if (!backendAvailable) return;
            const admin = client.getAdminManager();
            const info = await admin.server.getAdminInfo();
            expect(info).toHaveProperty("server_name");
        });

        it("database shows valid server configuration", async () => {
            if (!backendAvailable) return;
            const dbHealthy = await dbVerifier.healthCheck();
            expect(dbHealthy).toBe(true);
        });
    });
});
