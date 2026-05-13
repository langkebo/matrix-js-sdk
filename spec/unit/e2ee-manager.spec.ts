import { beforeEach, describe, expect, it, vi } from "vitest";

import { E2EEManager } from "../../src/e2ee/index";
import { logger } from "../../src/logger";

describe("E2EEManager", () => {
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

        await manager.uploadKeys({ one_time_keys: { "signed_curve25519:k1": { key: "abc" } } });
        await manager.listRoomKeyRequests();
        await manager.storeSecureBackupKeys("backup-1", { passphrase: "secret", session_keys: [] });

        expect(mockClient.http.authedRequest).toHaveBeenNthCalledWith(
            1,
            "POST",
            "/keys/upload",
            undefined,
            { one_time_keys: { "signed_curve25519:k1": { key: "abc" } } },
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

    it("accepts backend-compatible verification request bodies without user_id", async () => {
        mockClient.http.authedRequest.mockResolvedValueOnce({ token: "tok-1" });

        await expect(
            manager.requestDeviceVerification({
                new_device_id: "DEVICE1",
                method: "sas",
            }),
        ).resolves.toEqual({ token: "tok-1" });

        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            "POST",
            "/device_verification/request",
            undefined,
            {
                new_device_id: "DEVICE1",
                method: "sas",
            },
            expect.objectContaining({ prefix: "/_matrix/client/v3" }),
        );
    });

    it("requires passphrase rather than algorithm when creating secure backups", async () => {
        mockClient.http.authedRequest.mockResolvedValueOnce({ backup_id: "b1" });

        await expect(manager.createSecureBackup({ algorithm: "m.megolm_backup.v1.curve25519-aes-sha2" })).rejects.toThrow(
            "passphrase is required",
        );

        await expect(
            manager.createSecureBackup({
                passphrase: "secret",
                algorithm: "m.megolm_backup.v1.curve25519-aes-sha2",
            }),
        ).resolves.toEqual({ backup_id: "b1" });

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

    it("returns an empty object when security summary fetch fails", async () => {
        const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
        mockClient.http.authedRequest.mockRejectedValueOnce(new Error("boom"));

        await expect(manager.getSecuritySummary()).resolves.toEqual({});
        expect(warnSpy).toHaveBeenCalledWith("E2EEManager.getSecuritySummary failed", expect.any(Error));
    });
});
