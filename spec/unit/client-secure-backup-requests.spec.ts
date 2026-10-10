import {
    buildSecureBackupPath,
    buildSecureBackupVerifyPath,
    buildSecureBackupKeysPath,
    buildSecureBackupRestorePath,
    createSecureBackupRequest,
    getSecureBackupRequest,
    verifySecureBackupPassphraseRequest,
    storeSecureBackupKeysRequest,
    restoreSecureBackupRequest,
    deleteSecureBackupRequest,
    getMyRoomsRequest,
    searchRoomsRequest,
    searchRecipientsRequest,
    getClientConfigRequest,
    getSSOUserInfoRequest,
} from "../../src/client-secure-backup-requests";
import { Method, ClientPrefix, VendorPrefix, MatrixError } from "../../src/http-api";

describe("client-secure-backup-requests", () => {
    const mockAuthedRequest = vi.fn();

    beforeEach(() => {
        mockAuthedRequest.mockReset();
        mockAuthedRequest.mockImplementation((method, path, queryParams, body, opts) => {
            return Promise.resolve({ method, path, queryParams, body, opts });
        });
    });

    describe("Path builders", () => {
        it("buildSecureBackupPath encodes backupId correctly", () => {
            const backupId = "backup-123";
            const path = buildSecureBackupPath(backupId);
            expect(path).toBe("/keys/backup/secure/backup-123");
        });

        it("buildSecureBackupVerifyPath encodes backupId correctly", () => {
            const backupId = "backup-456";
            const path = buildSecureBackupVerifyPath(backupId);
            expect(path).toBe("/keys/backup/secure/backup-456/verify");
        });

        it("buildSecureBackupKeysPath encodes backupId correctly", () => {
            const backupId = "backup-789";
            const path = buildSecureBackupKeysPath(backupId);
            expect(path).toBe("/keys/backup/secure/backup-789/keys");
        });

        it("buildSecureBackupRestorePath encodes backupId correctly", () => {
            const backupId = "backup-restore";
            const path = buildSecureBackupRestorePath(backupId);
            expect(path).toBe("/keys/backup/secure/backup-restore/restore");
        });
    });

    describe("Secure backup requests", () => {
        it("createSecureBackupRequest calls authedRequest with correct params", async () => {
            const algorithm = "m.megolm_backup.v1.curve25519-aes-sha2";
            const authData = { public_key: "curve25519-public-key" };
            await createSecureBackupRequest(algorithm, authData, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/keys/backup/secure",
                undefined,
                { algorithm, auth_data: authData },
                { prefix: ClientPrefix.V3 },
            );
        });

        it("getSecureBackupRequest calls authedRequest with correct params", async () => {
            const backupId = "backup-123";
            await getSecureBackupRequest(backupId, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/keys/backup/secure/backup-123",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });

        it("verifySecureBackupPassphraseRequest calls authedRequest with correct params", async () => {
            const backupId = "backup-456";
            const passphrase = "verify-pass";
            await verifySecureBackupPassphraseRequest(backupId, passphrase, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/keys/backup/secure/backup-456/verify",
                undefined,
                { passphrase },
                { prefix: ClientPrefix.V3 },
            );
        });

        it("storeSecureBackupKeysRequest calls authedRequest with correct params", async () => {
            const backupId = "backup-789";
            const sessionKeys = [{ key: "value" }, { key: "value2" }];
            await storeSecureBackupKeysRequest(backupId, sessionKeys, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/keys/backup/secure/backup-789/keys",
                undefined,
                { session_keys: sessionKeys },
                { prefix: ClientPrefix.V3 },
            );
        });

        it("restoreSecureBackupRequest calls authedRequest with correct params", async () => {
            const backupId = "backup-restore";
            await restoreSecureBackupRequest(backupId, undefined, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/keys/backup/secure/backup-restore/restore",
                undefined,
                {},
                { prefix: ClientPrefix.V3 },
            );
        });

        it("restoreSecureBackupRequest forwards the room scope filter when supplied", async () => {
            const rooms = ["!a:example.org", "!b:example.org"];
            await restoreSecureBackupRequest("backup-scoped", rooms, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/keys/backup/secure/backup-scoped/restore",
                undefined,
                { rooms },
                { prefix: ClientPrefix.V3 },
            );
        });

        it("deleteSecureBackupRequest calls authedRequest with correct params", async () => {
            const backupId = "backup-delete";
            await deleteSecureBackupRequest(backupId, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Delete,
                "/keys/backup/secure/backup-delete",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });
    });

    describe("Path builders - encoding edge cases", () => {
        it("percent-encodes reserved characters in backupId", () => {
            expect(buildSecureBackupPath("a/b c")).toBe("/keys/backup/secure/a%2Fb%20c");
            expect(buildSecureBackupVerifyPath("a/b c")).toBe("/keys/backup/secure/a%2Fb%20c/verify");
            expect(buildSecureBackupKeysPath("a/b c")).toBe("/keys/backup/secure/a%2Fb%20c/keys");
            expect(buildSecureBackupRestorePath("a/b c")).toBe("/keys/backup/secure/a%2Fb%20c/restore");
        });

        it("leaves unreserved characters untouched", () => {
            expect(buildSecureBackupPath("abc-123_XYZ.~")).toBe("/keys/backup/secure/abc-123_XYZ.~");
        });
    });

    describe("Create payload edge cases", () => {
        it("sends an empty algorithm verbatim (validation is the caller's job)", async () => {
            await createSecureBackupRequest("", {}, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/keys/backup/secure",
                undefined,
                { algorithm: "", auth_data: {} },
                { prefix: ClientPrefix.V3 },
            );
        });

        it("preserves non-ASCII room IDs in the restore scope without mangling", async () => {
            const rooms = ["!房间:example.org"];
            await restoreSecureBackupRequest("backup-1", rooms, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/keys/backup/secure/backup-1/restore",
                undefined,
                { rooms },
                { prefix: ClientPrefix.V3 },
            );
        });
    });

    describe("Session keys payload", () => {
        it("passes an empty session key list as an empty array", async () => {
            await storeSecureBackupKeysRequest("backup-1", [], mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/keys/backup/secure/backup-1/keys",
                undefined,
                { session_keys: [] },
                { prefix: ClientPrefix.V3 },
            );
        });

        it("keeps session key order and nested structure intact", async () => {
            const sessionKeys = [{ first: 1 }, { second: { nested: true } }];
            await storeSecureBackupKeysRequest("backup-1", sessionKeys, mockAuthedRequest);

            const callArgs = mockAuthedRequest.mock.calls[0];
            expect((callArgs[3] as { session_keys: unknown[] }).session_keys).toEqual(sessionKeys);
            expect((callArgs[3] as { session_keys: unknown[] }).session_keys[0]).toBe(sessionKeys[0]);
        });
    });

    describe("Non-backup request helpers", () => {
        it("getMyRoomsRequest uses vendor prefix", async () => {
            await getMyRoomsRequest(mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/my_rooms", undefined, undefined, {
                prefix: VendorPrefix,
            });
        });

        it("searchRoomsRequest posts search_term and limit", async () => {
            await searchRoomsRequest(mockAuthedRequest, "general", 10);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/search_rooms",
                undefined,
                { search_term: "general", limit: 10 },
                { prefix: VendorPrefix },
            );
        });

        it("searchRoomsRequest omits limit when not supplied", async () => {
            await searchRoomsRequest(mockAuthedRequest, "general");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/search_rooms",
                undefined,
                { search_term: "general", limit: undefined },
                { prefix: VendorPrefix },
            );
        });

        it("searchRecipientsRequest posts search_term and limit", async () => {
            await searchRecipientsRequest(mockAuthedRequest, "@alice", 5);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/search_recipients",
                undefined,
                { search_term: "@alice", limit: 5 },
                { prefix: VendorPrefix },
            );
        });

        it("getClientConfigRequest uses client v1 prefix", async () => {
            await getClientConfigRequest(mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/config/client", undefined, undefined, {
                prefix: ClientPrefix.V1,
            });
        });

        it("getSSOUserInfoRequest uses client v3 prefix", async () => {
            await getSSOUserInfoRequest(mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/login/sso/userinfo", undefined, undefined, {
                prefix: ClientPrefix.V3,
            });
        });
    });

    describe("Error propagation (backup failure branches)", () => {
        it("propagates 400 M_BAD_JSON when creating a backup with malformed payload", async () => {
            const err = new MatrixError({ errcode: "M_BAD_JSON", error: "bad json" }, 400);
            mockAuthedRequest.mockRejectedValue(err);

            await expect(createSecureBackupRequest("m.megolm_backup.v1", {}, mockAuthedRequest)).rejects.toThrow(err);
        });

        it("propagates 403 M_FORBIDDEN on wrong passphrase during verify", async () => {
            const err = new MatrixError({ errcode: "M_FORBIDDEN", error: "wrong passphrase" }, 403);
            mockAuthedRequest.mockRejectedValue(err);

            await expect(verifySecureBackupPassphraseRequest("backup-1", "wrong", mockAuthedRequest)).rejects.toThrow(
                err,
            );
        });

        it("propagates 404 M_NOT_FOUND when restoring a non-existent backup", async () => {
            const err = new MatrixError({ errcode: "M_NOT_FOUND", error: "no such backup" }, 404);
            mockAuthedRequest.mockRejectedValue(err);

            await expect(restoreSecureBackupRequest("missing", undefined, mockAuthedRequest)).rejects.toThrow(err);
        });

        it("propagates key-version mismatch (M_WRONG_ROOM_KEYS_VERSION) on restore", async () => {
            const err = new MatrixError({ errcode: "M_WRONG_ROOM_KEYS_VERSION", error: "wrong version" }, 400);
            mockAuthedRequest.mockRejectedValue(err);

            await expect(restoreSecureBackupRequest("backup-1", undefined, mockAuthedRequest)).rejects.toThrow(
                "wrong version",
            );
            expect((err as MatrixError).errcode).toBe("M_WRONG_ROOM_KEYS_VERSION");
        });

        it("propagates 401 M_UNKNOWN_TOKEN when the access token has expired", async () => {
            const err = new MatrixError({ errcode: "M_UNKNOWN_TOKEN", error: "expired" }, 401);
            mockAuthedRequest.mockRejectedValue(err);

            await expect(getSecureBackupRequest("backup-1", mockAuthedRequest)).rejects.toThrow(err);
        });

        it("propagates 500 on server failure while storing keys", async () => {
            const err = new MatrixError({ errcode: "M_UNKNOWN", error: "boom" }, 500);
            mockAuthedRequest.mockRejectedValue(err);

            await expect(storeSecureBackupKeysRequest("backup-1", [{}], mockAuthedRequest)).rejects.toThrow(err);
        });

        it("does not resolve when the transport rejects", async () => {
            mockAuthedRequest.mockRejectedValue(new Error("network down"));

            await expect(deleteSecureBackupRequest("backup-1", mockAuthedRequest)).rejects.toThrow("network down");
        });
    });
});
