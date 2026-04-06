import { beforeEach, describe, expect, it, vi } from "vitest";

import { KeyBackupManager, type BackupVersionInfo, type RoomKeyBackup } from "../../src/key-backup/index";
import { Method } from "../../src/http-api/method.ts";
import { ClientPrefix } from "../../src/http-api/prefix.ts";

describe("KeyBackupManager", () => {
    let authedRequest: ReturnType<typeof vi.fn>;
    let keyBackupManager: KeyBackupManager;

    beforeEach(() => {
        authedRequest = vi.fn();
        keyBackupManager = new KeyBackupManager({ http: { authedRequest } } as any);
    });

    it("getBackupVersions calls /room_keys/version", async () => {
        const versions: BackupVersionInfo[] = [{ version: "1", algorithm: "m.megolm_backup.v1", auth_data: {} }];
        authedRequest.mockResolvedValueOnce({ versions });

        const result = await keyBackupManager.getBackupVersions();

        expect(result).toEqual({ versions });
        expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/room_keys/version", undefined, undefined, {
            prefix: ClientPrefix.V3,
        });
    });

    it("createBackupVersion calls POST /room_keys/version", async () => {
        authedRequest.mockResolvedValueOnce({ version: "1" });

        const result = await keyBackupManager.createBackupVersion("m.megolm_backup.v1", { public_key: "test_key" });

        expect(result).toEqual({ version: "1" });
        expect(authedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/room_keys/version",
            undefined,
            { algorithm: "m.megolm_backup.v1", auth_data: { public_key: "test_key" } },
            { prefix: ClientPrefix.V3 },
        );
    });

    it("getBackupVersion calls GET /room_keys/version/{version}", async () => {
        const versionInfo: BackupVersionInfo = { version: "1", algorithm: "m.megolm_backup.v1", auth_data: {} };
        authedRequest.mockResolvedValueOnce(versionInfo);

        const result = await keyBackupManager.getBackupVersion("1");

        expect(result).toEqual(versionInfo);
        expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/room_keys/version/1", undefined, undefined, {
            prefix: ClientPrefix.V3,
        });
    });

    it("deleteBackupVersion calls DELETE /room_keys/version/{version}", async () => {
        authedRequest.mockResolvedValueOnce({ deleted: true, version: "1" });

        const result = await keyBackupManager.deleteBackupVersion("1");

        expect(result).toEqual({ deleted: true, version: "1" });
        expect(authedRequest).toHaveBeenCalledWith(Method.Delete, "/room_keys/version/1", undefined, undefined, {
            prefix: ClientPrefix.V3,
        });
    });

    it("getAllBackupKeys calls GET /room_keys/keys", async () => {
        const keys: RoomKeyBackup = { rooms: {}, etag: '"1"' };
        authedRequest.mockResolvedValueOnce(keys);

        const result = await keyBackupManager.getAllBackupKeys();

        expect(result).toEqual(keys);
        expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/room_keys/keys", undefined, undefined, {
            prefix: ClientPrefix.V3,
        });
    });
});
