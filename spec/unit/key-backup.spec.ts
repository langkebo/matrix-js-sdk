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
import { MatrixError } from "../../src/http-api/errors";
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
            getUserId: () => "@user:example.com",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;
        manager = new KeyBackupManager(client);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (manager as any).maxRetries = 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (manager as any).retryDelay = 0;
    });

    describe("Version Management", () => {
        it("should get latest backup version", async () => {
            const mockResponse = {
                version: "1",
                algorithm: "m.megolm_backup.v1.curve25519-aes-sha2",
                auth_data: {},
                count: 3,
                etag: "etag-1",
            };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.getLatestBackupVersion();

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/room_keys/version",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result).toEqual(mockResponse);
        });

        it("should create backup version with optional UIA auth", async () => {
            const mockResponse = { version: "1" };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);
            const auth = {
                type: "m.login.password",
                session: "uia-session",
                password: "secret",
            };

            const result = await manager.createBackupVersion(
                "m.megolm_backup.v1.curve25519-aes-sha2",
                {
                    public_key: "value",
                },
                auth,
            );

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/room_keys/version",
                undefined,
                {
                    algorithm: "m.megolm_backup.v1.curve25519-aes-sha2",
                    auth_data: { public_key: "value" },
                    auth,
                },
                { prefix: ClientPrefix.V3 },
            );
            expect(result).toEqual(mockResponse);
            expect(manager.getCurrentVersion()).toBe("1");
        });

        it("should get specific backup version", async () => {
            const mockResponse = {
                version: "1",
                algorithm: "m.megolm_backup.v1.curve25519-aes-sha2",
                auth_data: {},
                count: 7,
                etag: "etag-7",
            };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.getBackupVersion("1");

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/room_keys/version/1",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result).toEqual(mockResponse);
        });
    });

    describe("Key Read/Write (Spec 兼容)", () => {
        it("should get all room keys", async () => {
            const mockResponse = { rooms: {} };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.getAllRoomKeys("1");

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/room_keys/keys",
                { version: "1" },
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result).toEqual(mockResponse);
        });

        it("should put all room keys", async () => {
            const mockResponse = { count: 10, etag: "tag" };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const body = { rooms: {} };
            const result = await manager.putAllRoomKeys("1", body);

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(Method.Put, "/room_keys/keys", { version: "1" }, body, {
                prefix: ClientPrefix.V3,
            });
            expect(result).toEqual(mockResponse);
        });

        it("should get session key", async () => {
            const mockResponse = { ciphertext: "abc", mac: "def", ephemeral: "ghi" };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.getSessionKey("1", "!room:abc", "session1");

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/room_keys/keys/!room%3Aabc/session1",
                { version: "1" },
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result).toEqual(mockResponse);
        });

        it("should put room keys for a specific room", async () => {
            const mockResponse = { count: 2, etag: "etag-room" };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const body = {
                sessions: {
                    sess1: {
                        first_message_index: 0,
                        forwarded_count: 0,
                        is_verified: true,
                        session_data: { ciphertext: "abc", mac: "def", ephemeral: "ghi" },
                    },
                },
            };

            const result = await manager.putRoomKeys("1", "!room:abc", body);

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/room_keys/keys/!room%3Aabc",
                { version: "1" },
                body,
                { prefix: ClientPrefix.V3 },
            );
            expect(result).toEqual(mockResponse);
        });

        it("should delete all room keys for a version", async () => {
            const mockResponse = { count: 10, etag: "etag-delete-all" };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            await expect(manager.deleteAllRoomKeys("1")).resolves.toEqual(mockResponse);
            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Delete,
                "/room_keys/keys",
                { version: "1" },
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });

        it("should delete room keys for a single room", async () => {
            const mockResponse = { count: 4, etag: "etag-delete-room" };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            await expect(manager.deleteRoomKeys("1", "!room:abc")).resolves.toEqual(mockResponse);
            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Delete,
                "/room_keys/keys/!room%3Aabc",
                { version: "1" },
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });

        it("should delete a single session key", async () => {
            const mockResponse = { count: 1, etag: "etag-delete-session" };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            await expect(manager.deleteSessionKey("1", "!room:abc", "session1")).resolves.toEqual(mockResponse);
            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Delete,
                "/room_keys/keys/!room%3Aabc/session1",
                { version: "1" },
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });
    });

    describe("Recovery and Progress", () => {
        it("should get recovery progress", async () => {
            const mockResponse = { version: "1", total_keys: 100, recovered_keys: 50 };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.getRecoveryProgress("1");

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/room_keys/recovery/1/progress",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result).toEqual(mockResponse);
        });

        it("should recover room keys", async () => {
            const mockResponse = { room_id: "!room:abc", sessions: [] };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.recoverRoomKeys("1", "!room:abc");

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/room_keys/recover/1/!room%3Aabc",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result).toEqual(mockResponse);
        });
    });

    describe("Import/Export", () => {
        it("should export keys by version", async () => {
            const mockResponse = { room_keys: [], version: "1" };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const result = await manager.exportKeys("1");

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/room_keys/export/1",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
            expect(result).toEqual(mockResponse);
        });

        it("should import keys to version", async () => {
            const mockResponse = { count: 5 };
            mockHttp.authedRequest.mockResolvedValue(mockResponse);

            const keys = [
                {
                    room_id: "!room:abc",
                    session_id: "s1",
                    session_data: { ciphertext: "c", ephemeral: "e", mac: "m" },
                    first_message_index: 0,
                    forwarded_count: 0,
                    is_verified: true,
                },
            ];
            const result = await manager.importKeys(keys, "1");

            expect(mockHttp.authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/room_keys/import/1",
                undefined,
                { room_keys: keys, version: "1" },
                { prefix: ClientPrefix.V3 },
            );
            expect(result).toEqual(mockResponse);
        });
    });

    describe("Error Handling", () => {
        it("should normalize and classify errors", async () => {
            mockHttp.authedRequest.mockRejectedValue(
                new MatrixError(
                    { errcode: "M_LIMIT_EXCEEDED", error: "slow down", retry_after_ms: 1000 },
                    429,
                    undefined,
                    undefined,
                    new Headers({ "x-trace-id": "trace-123" }),
                ),
            );

            await expect(manager.getLatestBackupVersion(true)).rejects.toMatchObject({
                name: "RetryableError",
                errorCode: "M_LIMIT_EXCEEDED",
                retryAfter: 1000,
                traceId: "trace-123",
                isRetryable: true,
            });
        });
    });
});
