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

import { describe, it, expect, beforeEach } from "vitest";

import { E2EEManager } from "../../src/e2ee/index";
import { Method } from "../../src/http-api/method";
import { FakeTransport } from "../test-utils/FakeTransport";

describe("E2EEManager", () => {
    let transport: FakeTransport;
    let e2eeManager: E2EEManager;

    beforeEach(() => {
        transport = new FakeTransport();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        e2eeManager = new E2EEManager({} as any, { transport });
    });

    // ============ Key Management ============

    describe("uploadKeys", () => {
        it("should upload device keys", async () => {
            transport.respondWith({ one_time_key_counts: { signed_curve25519: 50 } });

            const result = await e2eeManager.uploadKeys({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                deviceKeys: { algorithms: ["m.olm.v1.curve25519-aes-sha2"] } as any,
            });

            expect(result.one_time_key_counts).toEqual({ signed_curve25519: 50 });
            transport.expectCalledWith(Method.Post, "/keys/upload");
        });
    });

    describe("queryKeys", () => {
        it("should query device keys", async () => {
            transport.respondWith({
                device_keys: { "@alice:example.com": {} },
                failures: {},
            });

            const result = await e2eeManager.queryKeys({
                device_keys: { "@alice:example.com": [] },
            });

            expect(result.device_keys).toBeDefined();
            transport.expectCalledWith(Method.Post, "/keys/query");
        });
    });

    describe("claimKeys", () => {
        it("should claim one-time keys", async () => {
            transport.respondWith({
                one_time_keys: { "@alice:example.com": {} },
                failures: {},
            });

            const result = await e2eeManager.claimKeys({
                one_time_keys: { "@alice:example.com": { DEVICE1: "signed_curve25519" } },
            });

            expect(result.one_time_keys).toBeDefined();
            transport.expectCalledWith(Method.Post, "/keys/claim");
        });
    });

    describe("getKeyChanges", () => {
        it("should get key changes between tokens", async () => {
            transport.respondWith({ changed: ["@alice:example.com"], left: [] });

            const result = await e2eeManager.getKeyChanges({ from: "t1", to: "t2" });

            expect(result.changed).toEqual(["@alice:example.com"]);
            transport.expectCalledWithArgs(Method.Get, "/keys/changes", { from: "t1", to: "t2" }, undefined, {
                prefix: "/_matrix/client/v3",
            });
        });

        it("should get key changes with empty params", async () => {
            transport.respondWith({ changed: [], left: [] });

            const result = await e2eeManager.getKeyChanges();

            expect(result.changed).toEqual([]);
        });
    });

    // ============ Room Key Requests ============

    describe("listRoomKeyRequests", () => {
        it("should list room key requests", async () => {
            transport.respondWith({
                requests: [
                    {
                        request_id: "req1",
                        room_id: "!room:example.com",
                        session_id: "s1",
                        algorithm: "m.megolm.v1.aes-sha2",
                        state: "pending",
                    },
                ],
            });

            const result = await e2eeManager.listRoomKeyRequests();

            expect(result.requests).toHaveLength(1);
            expect(result.requests[0].request_id).toBe("req1");
            transport.expectCalledWithArgs(Method.Get, "/room_keys/request", undefined, undefined, {
                prefix: "/_matrix/client/v3",
            });
        });
    });

    describe("deleteRoomKeyRequest", () => {
        it("should delete a room key request", async () => {
            expect.assertions(0);
            transport.respondWith(undefined);

            await e2eeManager.deleteRoomKeyRequest("req1");

            transport.expectCalledWithArgs(Method.Delete, "/room_keys/request/req1", undefined, undefined, {
                prefix: "/_matrix/client/v3",
            });
        });
    });

    // ============ Secure Backup ============

    describe("getSecureBackupList", () => {
        it("should get secure backup list", async () => {
            transport.respondWith({
                backups: [
                    {
                        backup_id: "backup1",
                        algorithm: "m.megolm_backup.v1.curve25519-aes-sha2",
                        auth_data: {},
                        version: "1",
                    },
                ],
            });

            const result = await e2eeManager.getSecureBackupList();

            expect(result.backups).toHaveLength(1);
            transport.expectCalledWithArgs(Method.Get, "/keys/backup/secure", undefined, undefined, {
                prefix: "/_matrix/client/v3",
            });
        });
    });

    describe("getSecureBackup", () => {
        it("should get a specific secure backup", async () => {
            transport.respondWith({
                backup_id: "backup1",
                algorithm: "m.megolm_backup.v1.curve25519-aes-sha2",
                auth_data: {},
                version: "1",
            });

            const result = await e2eeManager.getSecureBackup("backup1");

            expect(result.backup_id).toBe("backup1");
        });
    });
});
