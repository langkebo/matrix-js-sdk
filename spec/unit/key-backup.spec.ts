/*
Copyright 2024 The Matrix.org Foundation C.I.C.

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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { KeyBackupManager } from "../../src/key-backup/index";
import { Method } from "../../src/http-api/method";
import { ClientPrefix } from "../../src/http-api/prefix";

describe("KeyBackupManager", () => {
    let manager: KeyBackupManager;
    let mockHttp: { authedRequest: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        mockHttp = {
            authedRequest: vi.fn(),
        };
        const client = {
            http: mockHttp,
        } as any;
        manager = new KeyBackupManager(client);
    });

    describe("Version Management", () => {
        it("should get backup versions", async () => {
            const mockResponse = {
                versions: [
                    { version: "1", algorithm: "m.megolm.v1.aes-sha2", auth_data: {} },
                ],
            };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.getBackupVersions();

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/room_keys/version",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
            expect(result).toEqual(mockResponse);
        });

        it("should create backup version", async () => {
            const mockResponse = { version: "1" };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.createBackupVersion("m.megolm.v1.aes-sha2", { key: "value" });

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/room_keys/version",
                undefined,
                { algorithm: "m.megolm.v1.aes-sha2", auth_data: { key: "value" } },
                { prefix: ClientPrefix.V3 }
            );
            expect(result).toEqual(mockResponse);
            expect(manager.getCurrentVersion()).toBe("1");
        });

        it("should get backup version", async () => {
            const mockResponse = { version: "1", algorithm: "m.megolm.v1.aes-sha2", auth_data: {} };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.getBackupVersion("1");

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/room_keys/version/1",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
            expect(result).toEqual(mockResponse);
        });

        it("should update backup version", async () => {
            const mockResponse = { version: "1" };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.updateBackupVersion("1", { key: "new_value" });

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/room_keys/version/1",
                undefined,
                { auth_data: { key: "new_value" } },
                { prefix: ClientPrefix.V3 }
            );
            expect(result).toEqual(mockResponse);
        });

        it("should delete backup version", async () => {
            const mockResponse = { deleted: true, version: "1" };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            manager.setCurrentVersion("1");
            const result = await manager.deleteBackupVersion("1");

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Delete,
                "/room_keys/version/1",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
            expect(result).toEqual(mockResponse);
            expect(manager.getCurrentVersion()).toBeNull();
        });
    });

    describe("Key Read/Write", () => {
        it("should get all backup keys", async () => {
            const mockResponse = { rooms: {}, etag: "1" };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.getAllBackupKeys();

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/room_keys/keys",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
            expect(result).toEqual(mockResponse);
        });

        it("should get backup keys by version", async () => {
            const mockResponse = { rooms: {}, etag: "1" };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.getBackupKeys("1");

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/room_keys/keys/1",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
            expect(result).toEqual(mockResponse);
        });

        it("should get room backup keys", async () => {
            const mockResponse = { sessions: {} };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.getRoomBackupKeys("1", "!room:example.com");

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Get,
                expect.stringContaining("/room_keys/keys/1/"),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
            expect(result).toEqual(mockResponse);
        });

        it("should get session backup key", async () => {
            const mockResponse = { session_data: {} };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.getSessionBackupKey("1", "!room:example.com", "session1");

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Get,
                expect.stringContaining("/room_keys/keys/1/"),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
            expect(result).toEqual(mockResponse);
        });

        it("should upload session key", async () => {
            const mockResponse = { etag: "2" };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const sessionData = {
                first_message_index: 0,
                forwarded_count: 0,
                is_verified: true,
                session_data: { key: "value" },
            };
            const result = await manager.uploadSessionKey("1", "!room:example.com", "session1", sessionData);

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Put,
                expect.stringContaining("/room_keys/keys/1/"),
                undefined,
                sessionData,
                { prefix: ClientPrefix.V3 }
            );
            expect(result).toEqual(mockResponse);
        });

        it("should upload batch keys", async () => {
            const mockResponse = { count: 5, etag: "2" };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const keys = {
                "!room:example.com": {
                    sessions: {
                        session1: {
                            first_message_index: 0,
                            forwarded_count: 0,
                            is_verified: true,
                            session_data: { key: "value" },
                        },
                    },
                },
            };
            const result = await manager.uploadBatchKeys("1", keys);

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/room_keys/1/keys",
                undefined,
                keys,
                { prefix: ClientPrefix.V3 }
            );
            expect(result).toEqual(mockResponse);
        });
    });

    describe("Recovery and Verification", () => {
        it("should recover keys", async () => {
            const mockResponse = { rooms: {}, total_keys: 10, recovered_keys: 10 };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.recoverKeys("1", ["!room1:example.com"]);

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/room_keys/recover",
                undefined,
                { version: "1", rooms: ["!room1:example.com"] },
                { prefix: ClientPrefix.V3 }
            );
            expect(result).toEqual(mockResponse);
        });

        it("should get recovery progress", async () => {
            const mockResponse = {
                user_id: "@user:example.com",
                version: "1",
                total_keys: 100,
                recovered_keys: 50,
                status: "in_progress",
                started_ts: 1000000,
                updated_ts: 1000001,
            };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.getRecoveryProgress("1");

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/room_keys/recovery/1/progress",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
            expect(result).toEqual(mockResponse);
        });

        it("should verify backup", async () => {
            const mockResponse = {
                valid: true,
                algorithm: "m.megolm.v1.aes-sha2",
                auth_data: {},
                key_count: 100,
            };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.verifyBackup("1");

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/room_keys/verify/1",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
            expect(result).toEqual(mockResponse);
        });

        it("should batch recover", async () => {
            const mockResponse = {
                rooms: {},
                total_sessions: 50,
                has_more: false,
            };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.batchRecover("1", ["!room1:example.com"], 100);

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/room_keys/batch_recover",
                undefined,
                { version: "1", room_ids: ["!room1:example.com"], session_limit: 100 },
                { prefix: ClientPrefix.V3 }
            );
            expect(result).toEqual(mockResponse);
        });

        it("should recover room keys", async () => {
            const mockResponse = { sessions: {} };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.recoverRoomKeys("1", "!room:example.com");

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Get,
                expect.stringContaining("/room_keys/recover/1/"),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
            expect(result).toEqual(mockResponse);
        });

        it("should recover session key", async () => {
            const mockResponse = { session_data: {} };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.recoverSessionKey("1", "!room:example.com", "session1");

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Get,
                expect.stringContaining("/room_keys/recover/1/"),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
            expect(result).toEqual(mockResponse);
        });
    });

    describe("Export and Import", () => {
        it("should export keys", async () => {
            const mockResponse = {
                room_keys: [
                    { room_id: "!room:example.com", session_id: "session1", session_data: {} },
                ],
                version: "1",
            };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.exportKeys();

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/room_keys/export",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
            expect(result).toEqual(mockResponse);
        });

        it("should export keys by version", async () => {
            const mockResponse = {
                room_keys: [],
                version: "1",
            };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.exportKeysByVersion("1");

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/room_keys/export/1",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
            expect(result).toEqual(mockResponse);
        });

        it("should import keys", async () => {
            const mockResponse = { count: 5, failed: 0, total: 5 };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const roomKeys = [
                {
                    room_id: "!room:example.com",
                    session_id: "session1",
                    session_data: { key: "value" },
                    first_message_index: 0,
                    forwarded_count: 0,
                    is_verified: true,
                },
            ];
            const result = await manager.importKeys(roomKeys, "1");

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/room_keys/import",
                undefined,
                { room_keys: roomKeys, version: "1" },
                { prefix: ClientPrefix.V3 }
            );
            expect(result).toEqual(mockResponse);
        });

        it("should import keys to version", async () => {
            const mockResponse = { count: 5, failed: 0, total: 5 };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const roomKeys = [
                {
                    room_id: "!room:example.com",
                    session_id: "session1",
                    session_data: { key: "value" },
                    first_message_index: 0,
                    forwarded_count: 0,
                    is_verified: true,
                },
            ];
            const result = await manager.importKeysToVersion("1", roomKeys);

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/room_keys/import/1",
                undefined,
                { room_keys: roomKeys },
                { prefix: ClientPrefix.V3 }
            );
            expect(result).toEqual(mockResponse);
        });
    });

    describe("Helper Methods", () => {
        it("should get and set current version", () => {
            expect(manager.getCurrentVersion()).toBeNull();
            manager.setCurrentVersion("1");
            expect(manager.getCurrentVersion()).toBe("1");
            manager.setCurrentVersion(null);
            expect(manager.getCurrentVersion()).toBeNull();
        });

        it("should ensure backup version returns existing", async () => {
            mockHttp.authedRequest.mockResolvedValue({
                versions: [{ version: "2", algorithm: "m.megolm.v1.aes-sha2", auth_data: {} }],
            });

            const version = await manager.ensureBackupVersion();

            expect(version).toBe("2");
            expect(manager.getCurrentVersion()).toBe("2");
        });

        it("should ensure backup version creates new", async () => {
            mockHttp.authedRequest
                .mockResolvedValueOnce({ versions: [] })
                .mockResolvedValueOnce({ version: "1" });

            const version = await manager.ensureBackupVersion();

            expect(version).toBe("1");
            expect(manager.getCurrentVersion()).toBe("1");
        });
    });
});
