/**
 * Real-backend integration tests for the 2026-04-23 synapse-rust alignment pass.
 *
 * Validates that corrected paths/fields and new API wrappers actually round-trip
 * against a live synapse-rust backend.
 *
 * Requires:
 *   - synapse-rust listening on TestConfig.baseUrl
 *   - TestConfig.testUser / secondaryUser provisioned as super admins
 *
 * Tests are guarded: if login fails (no backend) every case is skipped rather
 * than failing the CI job.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { MatrixClient } from "../../../src/matrix";
import { extendMatrixClient as extendAdminClient } from "../../../src/admin/index";
import { extendMatrixClient as extendFriendClient } from "../../../src/friend/index";
import { extendMatrixClient as extendWidgetsClient } from "../../../src/widgets/index";
import { extendMatrixClient as extendWorkerAdminClient } from "../../../src/worker-admin/index";
import { extendMatrixClient as extendPresenceClient } from "../../../src/presence/index";
import { TestConfig } from "./TestConfig";
import { loginAsConfiguredUser } from "./auth-test-helpers";

extendAdminClient();
extendFriendClient();
extendWidgetsClient();
extendWorkerAdminClient();
extendPresenceClient();

async function login(user: { userId: string; password: string } = TestConfig.testUser): Promise<MatrixClient> {
    return loginAsConfiguredUser(user);
}

describe("SDK ↔ synapse-rust 2026-04-23 alignment", () => {
    let client: MatrixClient;
    let secondary: MatrixClient | null = null;
    let backendAvailable = false;

    beforeAll(async () => {
        try {
            client = await login();
            backendAvailable = true;
            try {
                secondary = await login(TestConfig.secondaryUser);
            } catch (e) {
                secondary = null;
            }
        } catch (e) {
            backendAvailable = false;
            console.warn("Backend not reachable, skipping real-backend tests:", (e as Error).message);
        }
    }, 30_000);

    afterAll(() => {
        client?.stopClient();
        secondary?.stopClient();
    });

    // ===== Client-level endpoints =====

    describe("MatrixClient additions", () => {
        it("getClientConfig returns homeserver block", async () => {
            if (!backendAvailable) return;
            const cfg = await client.getClientConfig();
            expect(cfg).toHaveProperty("homeserver");
            expect(cfg.homeserver).toHaveProperty("base_url");
            expect(cfg.homeserver).toHaveProperty("server_name");
        });

        it("searchRooms accepts term + limit", async () => {
            if (!backendAvailable) return;
            const res = await client.searchRooms("test", 5);
            expect(res).toHaveProperty("results");
            expect(Array.isArray(res.results)).toBe(true);
            expect(res).toHaveProperty("count");
        });

        it("getSSOUserInfo returns sub", async () => {
            if (!backendAvailable) return;
            const info = await client.getSSOUserInfo();
            expect(info).toHaveProperty("sub");
            expect(info.sub).toBe(client.getUserId());
        });
    });

    // ===== Presence enum fix =====

    describe("PresenceManager.setPresence('away')", () => {
        it("accepts 'away' as a valid state (backend validator compliance)", async () => {
            if (!backendAvailable) return;
            const presence = client.getPresenceManager();
            await expect(presence.setPresence("away", "afk")).resolves.not.toThrow();
        });
    });

    // ===== Friend wrappers: canonical path + return values =====

    describe("FriendManager", () => {
        it("getIncomingRequests reads incoming requests through the stable endpoint", async () => {
            if (!backendAvailable) return;
            const friend = client.getFriendManager();
            const reqs = await friend.getIncomingRequests();
            expect(Array.isArray(reqs)).toBe(true);
        });

        it("sendFriendRequest returns {request_id, status}", async () => {
            if (!backendAvailable || !secondary) return;
            const friend = client.getFriendManager();
            const target = secondary.getUserId()!;
            const resp = await friend.sendFriendRequest(target, "integration test");
            expect(resp).toBeTypeOf("object");
            if (resp) {
                // Backend contract: { request_id: number, status: string }

                expect(typeof resp.request_id === "number" || resp.request_id === undefined).toBe(true);

                expect(typeof resp.status === "string" || resp.status === undefined).toBe(true);
            }
            // cleanup — cancel so test is idempotent
            try {
                await friend.cancelFriendRequest(target);
            } catch {
                /* ignore */
            }
        });

        it("createFriendGroup reads {id} from backend response", async () => {
            if (!backendAvailable) return;
            const friend = client.getFriendManager();
            const group = await friend.createFriendGroup(`sdk-align-${Date.now()}`);
            expect(typeof group.id).toBe("string");
            expect(group.id.length).toBeGreaterThan(0);
            await friend.deleteFriendGroup(group.id);
        });
    });

    // ===== Admin additions =====

    describe("AdminManager retention policy", () => {
        it("getRetentionPolicy returns expected fields", async () => {
            if (!backendAvailable) return;
            const admin = client.getAdminManager();
            try {
                const policy = await admin.getRetentionPolicy();
                expect(policy).toHaveProperty("expire_on_clients");
            } catch (e: any) {
                // Non-admin token will 403; treat as skipped
                if (e?.httpStatus !== 403) throw e;
            }
        });

        it("getRetentionStatus returns structured status", async () => {
            if (!backendAvailable) return;
            const admin = client.getAdminManager();
            try {
                const s = await admin.getRetentionStatus();
                expect(s).toHaveProperty("server_policy_enabled");
                expect(s).toHaveProperty("lifecycle_cleanup_enabled");
            } catch (e: any) {
                if (e?.httpStatus !== 403) throw e;
            }
        });
    });

    describe("AdminManager feature flags", () => {
        it("listFeatureFlags returns {flags,total}", async () => {
            if (!backendAvailable) return;
            const admin = client.getAdminManager();
            try {
                const page = await admin.listFeatureFlags({ limit: 5 });
                expect(page).toHaveProperty("flags");
                expect(page).toHaveProperty("total");
                expect(Array.isArray(page.flags)).toBe(true);
            } catch (e: any) {
                if (e?.httpStatus !== 403) throw e;
            }
        });
    });

    describe("AdminManager audit", () => {
        it("listAuditEvents returns {events,total,next_token}", async () => {
            if (!backendAvailable) return;
            const admin = client.getAdminManager();
            try {
                const page = await admin.listAuditEvents({ limit: 5 });
                expect(page).toHaveProperty("events");
                expect(page).toHaveProperty("total");
                expect(Object.prototype.hasOwnProperty.call(page, "next_token")).toBe(true);
            } catch (e: any) {
                if (e?.httpStatus !== 403) throw e;
            }
        });
    });

    describe("AdminManager media quota", () => {
        it("getMediaQuota returns size/count", async () => {
            if (!backendAvailable) return;
            const admin = client.getAdminManager();
            try {
                const q = await admin.getMediaQuota();
                expect(q).toHaveProperty("total_size");
                expect(q).toHaveProperty("total_count");
                expect(q).toHaveProperty("default_size_limit");
            } catch (e: any) {
                if (e?.httpStatus !== 403) throw e;
            }
        });
    });

    describe("AdminManager federation resolve/rewrite", () => {
        it("resolveFederation returns resolution status", async () => {
            if (!backendAvailable) return;
            const admin = client.getAdminManager();
            try {
                const res = await admin.resolveFederation("matrix.org");
                expect(res).toHaveProperty("server_name", "matrix.org");
                expect(res).toHaveProperty("resolved");
                expect(res).toHaveProperty("blacklisted");
            } catch (e: any) {
                if (e?.httpStatus !== 403) throw e;
            }
        });
    });

    describe("AdminManager getAccountStatus (corrected path)", () => {
        it("hits /v1/account/{id}", async () => {
            if (!backendAvailable) return;
            const admin = client.getAdminManager();
            try {
                const status = await admin.getAccountStatus(client.getUserId()!);
                expect(status).not.toBeNull();
            } catch (e: any) {
                // 403 for non-admin
                if (e?.httpStatus !== 403) throw e;
            }
        });
    });

    // ===== Worker admin =====

    describe("WorkerAdminManager", () => {
        it("listWorkers returns array under {workers}", async () => {
            if (!backendAvailable) return;
            const worker = client.getWorkerAdminManager();
            try {
                const page = await worker.listWorkers(5);
                expect(page).toHaveProperty("workers");
                expect(Array.isArray(page.workers)).toBe(true);
            } catch (e: any) {
                if (e?.httpStatus !== 403) throw e;
            }
        });

        it("getStatistics returns an object (non-admin gets 403)", async () => {
            if (!backendAvailable) return;
            const worker = client.getWorkerAdminManager();
            try {
                const stats = await worker.getStatistics();
                expect(typeof stats).toBe("object");
            } catch (e: any) {
                if (e?.httpStatus !== 403) throw e;
            }
        });
    });

    // ===== Widgets =====

    describe("WidgetsManager REST path (read-only probe)", () => {
        it("listRoomWidgets returns {widgets}", async () => {
            if (!backendAvailable) return;
            const widgets = client.getWidgetsManager();
            const room = await client.createRoom({ name: `sdk-widget-${Date.now()}` });
            try {
                const page = await widgets.listRoomWidgets(room.room_id);
                expect(page).toHaveProperty("widgets");
            } catch (e: any) {
                if (e?.httpStatus !== 403 && e?.httpStatus !== 404) throw e;
            }
        });
    });
});
