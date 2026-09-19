import { beforeEach, describe, expect, it, vi } from "vitest";

import { E2EEManager } from "../../src/e2ee/index";
import { logger } from "../../src/logger";

describe("E2EEManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let manager: E2EEManager;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
        };
        manager = new E2EEManager(mockClient);
    });

    it("routes compat and v3-only endpoints through generated-compatible v3 paths", async () => {
        mockClient.http.authedRequest
            .mockResolvedValueOnce({ one_time_key_counts: { signed_curve25519: 1 } })
            .mockResolvedValueOnce({ requests: [] })
            .mockResolvedValueOnce({ key_count: 1 });

        await manager.uploadKeys({ oneTimeKeys: { "signed_curve25519:k1": { key: "abc" } } });
        await manager.listRoomKeyRequests();
        await manager.storeSecureBackupKeys("backup-1", { passphrase: "secret", session_keys: [] });

        expect(mockClient.http.authedRequest).toHaveBeenNthCalledWith(
            1,
            "POST",
            "/keys/upload",
            undefined,
            { oneTimeKeys: { "signed_curve25519:k1": { key: "abc" } } },
            expect.objectContaining({ prefix: "/_matrix/client/v3" }),
        );
        expect(mockClient.http.authedRequest).toHaveBeenNthCalledWith(
            2,
            "GET",
            "/room_keys/request",
            undefined,
            undefined,
            expect.objectContaining({ prefix: "/_matrix/client/v3" }),
        );
        expect(mockClient.http.authedRequest).toHaveBeenNthCalledWith(
            3,
            "POST",
            "/keys/backup/secure/backup-1/keys",
            undefined,
            { passphrase: "secret", session_keys: [] },
            expect.objectContaining({ prefix: "/_matrix/client/v3" }),
        );
    });

    it("requires device_id or new_device_id for verification requests", async () => {
        await expect(manager.requestDeviceVerification({})).rejects.toThrow("device_id or new_device_id is required");
    });

    it("forwards the canonical body fields to DeviceTrustManager, dropping user_id", async () => {
        const requestVerification = vi.fn().mockResolvedValue({
            request_token: "tok-1",
            token: "tok-1",
            status: "pending",
            expires_at: 1700000000000,
            methods_available: ["sas"],
        });
        mockClient.getDeviceTrustManager = () => ({ requestVerification });

        await expect(
            manager.requestDeviceVerification({
                new_device_id: "DEVICE1",
                method: "sas",
            }),
        ).resolves.toMatchObject({ request_token: "tok-1" });

        // DeviceTrustManager is the single owner of this endpoint's contract;
        // E2EEManager must not hand-roll the HTTP call any more (the old body
        // also leaked a `user_id` the backend ignores).
        expect(requestVerification).toHaveBeenCalledWith({
            new_device_id: "DEVICE1",
            device_id: undefined,
            method: "sas",
        });
        expect(mockClient.http.authedRequest).not.toHaveBeenCalled();
    });

    it("requires passphrase or algorithm when creating secure backups", async () => {
        // Algorithm-only (no passphrase) is now valid
        mockClient.http.authedRequest.mockResolvedValueOnce({ backup_id: "b1" });
        await expect(
            manager.createSecureBackup({
                algorithm: "m.megolm_backup.v1.curve25519-aes-sha2",
            }),
        ).resolves.toEqual({ backup_id: "b1" });

        // Both passphrase and algorithm
        mockClient.http.authedRequest.mockResolvedValueOnce({ backup_id: "b2" });
        await expect(
            manager.createSecureBackup({
                passphrase: "secret",
                algorithm: "m.megolm_backup.v1.curve25519-aes-sha2",
            }),
        ).resolves.toEqual({ backup_id: "b2" });

        // Neither passphrase nor algorithm → error
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await expect(manager.createSecureBackup({} as any)).rejects.toThrow(
            "Either passphrase or algorithm must be provided",
        );

        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            "POST",
            "/keys/backup/secure",
            undefined,
            {
                passphrase: "secret",
                algorithm: "m.megolm_backup.v1.curve25519-aes-sha2",
            },
            expect.objectContaining({ prefix: "/_matrix/client/v3" }),
        );
    });

    describe("getKeyHistory", () => {
        it("GETs /keys/history with optional pagination params", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                history: [{ id: "k1", created_ts: 1700000000 }],
                next_batch: "cursor-1",
            });

            const res = await manager.getKeyHistory({ limit: 50, from: "cursor-0" });

            expect(res).toEqual({
                history: [{ id: "k1", created_ts: 1700000000 }],
                next_batch: "cursor-1",
            });
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/keys/history",
                { limit: 50, from: "cursor-0" },
                undefined,
                expect.objectContaining({ prefix: "/_matrix/client/v3" }),
            );
        });

        it("works without pagination params", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({ history: [], next_batch: null });

            const res = await manager.getKeyHistory();

            expect(res.history).toEqual([]);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/keys/history",
                undefined,
                undefined,
                expect.objectContaining({ prefix: "/_matrix/client/v3" }),
            );
        });
    });

    describe("uploadKeysToDevice", () => {
        it("POSTs to /keys/upload/{deviceId} with the body", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                one_time_key_counts: { signed_curve25519: 5 },
            });

            const body = { oneTimeKeys: { "signed_curve25519:k1": { key: "abc" } } };
            const res = await manager.uploadKeysToDevice("DEVICE1", body);

            expect(res).toEqual({ one_time_key_counts: { signed_curve25519: 5 } });
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                "/keys/upload/DEVICE1",
                undefined,
                body,
                expect.objectContaining({ prefix: "/_matrix/client/v3" }),
            );
        });
    });

    it("falls back to a zeroed, correctly-shaped summary when the trust manager fails", async () => {
        const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
        const getSecuritySummary = vi.fn().mockRejectedValue(new Error("boom"));
        mockClient.getDeviceTrustManager = () => ({ getSecuritySummary });

        await expect(manager.getSecuritySummary()).resolves.toEqual({
            verified_devices: 0,
            unverified_devices: 0,
            blocked_devices: 0,
            has_cross_signing_master: false,
            security_score: 0,
            recommendations: [],
        });
        expect(getSecuritySummary).toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith("E2EEManager.getSecuritySummary failed", expect.any(Error));
    });
});
