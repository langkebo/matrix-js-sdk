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

import { describe, it, expect, beforeEach, vi } from "vitest";

import { E2EEManager } from "../../src/e2ee/index";
import { Method } from "../../src/http-api/method";
import { FakeTransport } from "../test-utils/FakeTransport";

describe("E2EEManager", () => {
    let transport: FakeTransport;
    let e2eeManager: E2EEManager;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let trust: any;

    beforeEach(() => {
        transport = new FakeTransport();
        // Device-trust / verification calls are delegated to DeviceTrustManager,
        // which is the single owner of those contracts.
        trust = {
            requestVerification: vi.fn(),
            respondToVerification: vi.fn(),
            getVerificationStatus: vi.fn(),
            getDeviceTrustList: vi.fn(),
            getDeviceTrust: vi.fn(),
            getSecuritySummary: vi.fn(),
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        e2eeManager = new E2EEManager({ getDeviceTrustManager: () => trust } as any, { transport });
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

    // ============ Device Verification ============

    describe("requestDeviceVerification", () => {
        it("should delegate to DeviceTrustManager with the canonical body fields", async () => {
            const response = {
                request_token: "verify-token-123",
                token: "verify-token-123",
                status: "pending",
                expires_at: 1700000000000,
                methods_available: ["sas"],
            };
            trust.requestVerification.mockResolvedValue(response);

            const result = await e2eeManager.requestDeviceVerification({
                new_device_id: "DEVICE1",
                method: "sas",
            });

            expect(result.request_token).toBe("verify-token-123");
            expect(trust.requestVerification).toHaveBeenCalledWith({
                new_device_id: "DEVICE1",
                device_id: undefined,
                method: "sas",
            });
        });

        it("should reject if no device_id and no new_device_id", async () => {
            await expect(e2eeManager.requestDeviceVerification({})).rejects.toThrow(
                "device_id or new_device_id is required",
            );
            expect(trust.requestVerification).not.toHaveBeenCalled();
        });
    });

    describe("respondDeviceVerification", () => {
        it("should send approved=true for an explicit accept (not an action string)", async () => {
            trust.respondToVerification.mockResolvedValue({ success: true, trust_level: "verified" });

            const result = await e2eeManager.respondDeviceVerification({ token: "t1", approved: true });

            expect(trust.respondToVerification).toHaveBeenCalledWith("t1", true);
            expect(result.trust_level).toBe("verified");
        });

        it("should honour request_token as the token source", async () => {
            trust.respondToVerification.mockResolvedValue({ success: true, trust_level: "verified" });

            await e2eeManager.respondDeviceVerification({ request_token: "rt1", approved: true });

            expect(trust.respondToVerification).toHaveBeenCalledWith("rt1", true);
        });

        it("should normalise the legacy { action: 'accept' } form into approved=true", async () => {
            trust.respondToVerification.mockResolvedValue({ success: true, trust_level: "verified" });

            await e2eeManager.respondDeviceVerification({ token: "t2", action: "accept" });

            expect(trust.respondToVerification).toHaveBeenCalledWith("t2", true);
        });

        it("should reject when no token is supplied", async () => {
            await expect(e2eeManager.respondDeviceVerification({ approved: true })).rejects.toThrow(
                "request_token (or token) is required",
            );
            expect(trust.respondToVerification).not.toHaveBeenCalled();
        });
    });

    describe("getDeviceVerificationStatus", () => {
        it("should delegate and keep the backend's `status` field", async () => {
            trust.getVerificationStatus.mockResolvedValue({ status: "pending", token: "t1", request_token: "t1" });

            const result = await e2eeManager.getDeviceVerificationStatus("t1");

            expect(result.status).toBe("pending");
            expect(trust.getVerificationStatus).toHaveBeenCalledWith("t1");
        });

        it("should reject empty token", async () => {
            await expect(e2eeManager.getDeviceVerificationStatus("")).rejects.toThrow();
        });
    });

    // ============ Device Trust ============

    describe("getDeviceTrustList", () => {
        it("should delegate and return the backend's `devices` array (not a map)", async () => {
            const devices = [
                { device_id: "DEVICE1", trust_level: "verified", verified_at: 1700000000000 },
                { device_id: "DEVICE2", trust_level: "unverified" },
            ];
            trust.getDeviceTrustList.mockResolvedValue(devices);

            const result = await e2eeManager.getDeviceTrustList();

            expect(result).toEqual(devices);
            expect(Array.isArray(result)).toBe(true);
            // The old declaration was `Record<string, DeviceTrustInfo>` keyed by
            // device id, which never matched `{ devices: [...] }`.
            expect(result[0].trust_level).toBe("verified");
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
