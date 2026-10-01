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
} from "../../src/client-secure-backup-requests";
import { Method, ClientPrefix } from "../../src/http-api";

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
            const passphrase = "test-passphrase";
            await createSecureBackupRequest(passphrase, mockAuthedRequest);
            
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/keys/backup/secure",
                undefined,
                { passphrase },
                { prefix: ClientPrefix.V3 }
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
                { prefix: ClientPrefix.V3 }
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
                { prefix: ClientPrefix.V3 }
            );
        });

        it("storeSecureBackupKeysRequest calls authedRequest with correct params", async () => {
            const backupId = "backup-789";
            const passphrase = "keys-pass";
            const sessionKeys = [{ key: "value" }, { key: "value2" }];
            await storeSecureBackupKeysRequest(backupId, passphrase, sessionKeys, mockAuthedRequest);
            
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/keys/backup/secure/backup-789/keys",
                undefined,
                { passphrase, session_keys: sessionKeys },
                { prefix: ClientPrefix.V3 }
            );
        });

        it("restoreSecureBackupRequest calls authedRequest with correct params", async () => {
            const backupId = "backup-restore";
            const passphrase = "restore-pass";
            await restoreSecureBackupRequest(backupId, passphrase, mockAuthedRequest);
            
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/keys/backup/secure/backup-restore/restore",
                undefined,
                { passphrase },
                { prefix: ClientPrefix.V3 }
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
                { prefix: ClientPrefix.V3 }
            );
        });
    });
});
