import { beforeEach, describe, expect, it, vi } from "vitest";

import { E2EEManager } from "../../src/e2ee/index";

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
        await manager.storeSecureBackupKeys("backup-1", { session_keys: [] });

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
            { session_keys: [] },
            expect.objectContaining({ prefix: "/_matrix/client/v3" }),
        );
    });

    it("requires algorithm and auth_data when creating secure backups", async () => {
        // algorithm + auth_data (client-derived key) is now the only valid shape
        mockClient.http.authedRequest.mockResolvedValueOnce({ backup_id: "b1" });
        await expect(
            manager.createSecureBackup({
                algorithm: "m.megolm_backup.v1.curve25519-aes-sha2",
                auth_data: { public_key: "curve25519-public-key" },
            }),
        ).resolves.toEqual({ backup_id: "b1" });

        // Missing auth_data → error
        await expect(
            manager.createSecureBackup({
                algorithm: "m.megolm_backup.v1.curve25519-aes-sha2",
            } as unknown as Parameters<typeof manager.createSecureBackup>[0]),
        ).rejects.toThrow("'algorithm' and 'auth_data' are required to create a secure backup");

        // Missing algorithm → error
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await expect(manager.createSecureBackup({ auth_data: {} } as any)).rejects.toThrow(
            "'algorithm' and 'auth_data' are required to create a secure backup",
        );

        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            "POST",
            "/keys/backup/secure",
            undefined,
            {
                algorithm: "m.megolm_backup.v1.curve25519-aes-sha2",
                auth_data: { public_key: "curve25519-public-key" },
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
});
