import "../../src/key-backup/index";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { KeyBackupManager } from "../../src/key-backup/index";

describe("KeyBackupManager Integration Tests", () => {
    let keyBackupManager: KeyBackupManager;
    const mockClient: any = {};

    beforeEach(() => {
        // Setup mock client
        mockClient.getCapabilities = vi.fn().mockResolvedValue({
            "m.key_backup": {
                available: true,
                enabled: true,
                etag: '"123"',
                version: "1",
            },
        });

        mockClient.createKeyBackup = vi.fn().mockResolvedValue({
            version: "1",
            algorithm: "m.megolm_backup.v1",
        });

        mockClient.getKeyBackupInfo = vi.fn().mockResolvedValue({
            version: "1",
            algorithm: "m.megolm_backup.v1",
            auth_data: {
                public_key: "test_key",
            },
            count: 100,
            etag: '"100"',
        });

        mockClient.getKeyBackupVersions = vi.fn().mockResolvedValue({
            "1": {
                version: "1",
                algorithm: "m.megolm_backup.v1",
                created_on: "2024-01-01T00:00:00Z",
            },
        });

        mockClient.getKeyBackupSession = vi.fn().mockResolvedValue({
            session_data: {
                algorithm: "m.megolm.v1.curve25519-aes-sha2",
                ciphertext: "test_ciphertext",
                mac: "test_mac",
            },
        });

        mockClient.putKeyBackupSession = vi.fn().mockResolvedValue({});

        mockClient.deleteKeyBackup = vi.fn().mockResolvedValue({});

        mockClient.getKeyBackupKeys = vi.fn().mockResolvedValue({
            rooms: {
                "!room:example.com": {
                    sessions: {
                        session1: { session_data: "data1" },
                        session2: { session_data: "data2" },
                    },
                },
            },
        });

        keyBackupManager = new KeyBackupManager(mockClient);
    });

    describe("Backup Creation Flow", () => {
        it("should check if backup is available", async () => {
            const caps = await keyBackupManager.getCapabilities();
            expect(caps.available).toBe(true);
            expect(caps.enabled).toBe(true);
        });

        it("should create new backup", async () => {
            const backup = await keyBackupManager.createBackup("m.megolm_backup.v1", {
                public_key: "test_key",
            });
            expect(backup.version).toBe("1");
        });

        it("should get backup info", async () => {
            const info = await keyBackupManager.getBackupInfo();
            expect(info?.version).toBe("1");
            expect(info?.algorithm).toBe("m.megolm_backup.v1");
            expect(info?.count).toBe(100);
        });
    });

    describe("Key Backup and Restore", () => {
        it("should backup keys", async () => {
            await keyBackupManager.backupKeys("!room:example.com", "session1", {
                algorithm: "m.megolm.v1.curve25519-aes-sha2",
                ciphertext: "test",
                mac: "test_mac",
            });
            expect(mockClient.putKeyBackupSession).toHaveBeenCalled();
        });

        it("should retrieve backed up keys", async () => {
            const keys = await keyBackupManager.getBackupKeys("!room:example.com", "session1");
            expect(keys).toBeDefined();
            expect(mockClient.getKeyBackupSession).toHaveBeenCalledWith("1", "!room:example.com", "session1");
        });

        it("should check if keys exist", async () => {
            const exists = await keyBackupManager.checkKeys("!room:example.com", "session1");
            expect(exists).toBe(true);
        });

        it("should return false for non-existent keys", async () => {
            mockClient.getKeyBackupSession.mockRejectedValueOnce(new Error("Not found"));
            const exists = await keyBackupManager.checkKeys("!room:example.com", "nonexistent");
            expect(exists).toBe(false);
        });
    });

    describe("Backup Management", () => {
        it("should get all backup versions", async () => {
            const versions = await keyBackupManager.getBackupVersions();
            expect(versions).toHaveLength(1);
            expect(versions[0].version).toBe("1");
        });

        it("should delete backup", async () => {
            await keyBackupManager.deleteBackup("1");
            expect(mockClient.deleteKeyBackup).toHaveBeenCalledWith("1");
        });

        it("should restore backup", async () => {
            const result = await keyBackupManager.restoreBackup();
            expect(result).toBeDefined();
            expect(result.total).toBeGreaterThanOrEqual(0);
        });
    });

    describe("Error Handling", () => {
        it("should handle unavailable backup", async () => {
            mockClient.getCapabilities.mockResolvedValueOnce({});
            const caps = await keyBackupManager.getCapabilities();
            expect(caps.available).toBe(false);
        });

        it("should handle no backup versions", async () => {
            mockClient.getKeyBackupVersions.mockResolvedValueOnce({});
            const info = await keyBackupManager.getBackupInfo();
            expect(info).toBeNull();
        });
    });
});
