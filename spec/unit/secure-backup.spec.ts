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
import { SecureBackupManager } from "../../src/secure-backup/index";
import { Method } from "../../src/http-api/method";
import { ClientPrefix } from "../../src/http-api/prefix";

describe("SecureBackupManager", () => {
    let manager: SecureBackupManager;
    let mockHttp: { authedRequest: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        mockHttp = {
            authedRequest: vi.fn(),
        };
        const client = {
            http: mockHttp,
        } as any;
        manager = new SecureBackupManager(client);
    });

    describe("Secure Backup Operations", () => {
        it("should create secure backup", async () => {
            const mockResponse = {
                backup_id: "backup123",
                version: "1",
                algorithm: "m.megolm.v1.aes-sha2",
                auth_data: {},
                key_count: 0,
            };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.createSecureBackup("my-passphrase");

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/keys/backup/secure",
                undefined,
                { passphrase: "my-passphrase" },
                { prefix: ClientPrefix.V3 }
            );
            expect(result).toEqual(mockResponse);
        });

        it("should get secure backup", async () => {
            const mockResponse = {
                backup_id: "backup123",
                version: "1",
                algorithm: "m.megolm.v1.aes-sha2",
                auth_data: {},
                key_count: 100,
            };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.getSecureBackup("backup123");

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/keys/backup/secure/backup123",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
            expect(result).toEqual(mockResponse);
        });

        it("should delete secure backup", async () => {
            mockHttp.authedRequest.mockResolvedValue({});

            await manager.deleteSecureBackup("backup123");

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Delete,
                "/keys/backup/secure/backup123",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );
        });

        it("should add keys to secure backup", async () => {
            const mockResponse = { key_count: 5 };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const sessionKeys = [
                {
                    room_id: "!room:example.com",
                    session_id: "session1",
                    session_key: "key1",
                },
            ];
            const result = await manager.addKeysToSecureBackup("backup123", "my-passphrase", sessionKeys);

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/keys/backup/secure/backup123/keys",
                undefined,
                { passphrase: "my-passphrase", session_keys: sessionKeys },
                { prefix: ClientPrefix.V3 }
            );
            expect(result).toEqual(mockResponse);
        });

        it("should restore from secure backup", async () => {
            const mockResponse = {
                success: true,
                key_count: 100,
                message: "Restore completed",
            };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.restoreFromSecureBackup("backup123", "my-passphrase");

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/keys/backup/secure/backup123/restore",
                undefined,
                { passphrase: "my-passphrase" },
                { prefix: ClientPrefix.V3 }
            );
            expect(result).toEqual(mockResponse);
        });

        it("should verify secure backup", async () => {
            const mockResponse = { valid: true };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.verifySecureBackup("backup123", "my-passphrase");

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/keys/backup/secure/backup123/verify",
                undefined,
                { passphrase: "my-passphrase" },
                { prefix: ClientPrefix.V3 }
            );
            expect(result).toEqual(mockResponse);
        });
    });
});
