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

import { describe, expect, it, vi, beforeEach } from "vitest";
import { DeviceTrustManager, DeviceTrustEvent } from "../../src/device-trust/index";
import { Method } from "../../src/http-api";

describe("DeviceTrustManager", () => {
    let mockClient: any;
    let deviceTrustManager: DeviceTrustManager;
    let mockAuthedRequest: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockAuthedRequest = vi.fn();
        mockClient = {
            http: {
                authedRequest: mockAuthedRequest,
            },
        };
        deviceTrustManager = new DeviceTrustManager(mockClient);
    });

    describe("requestVerification", () => {
        it("should request device verification", async () => {
            const response = {
                request_token: "token123",
                token: "verify_token",
                status: "pending" as const,
                expires_at: Date.now() + 300000,
                methods_available: ["sas" as const],
            };
            mockAuthedRequest.mockResolvedValue(response);

            const result = await deviceTrustManager.requestVerification({
                new_device_id: "DEVICE123",
                method: "sas",
            });

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/device_verification/request",
                undefined,
                {
                    new_device_id: "DEVICE123",
                    device_id: undefined,
                    method: "sas",
                },
                { prefix: "/_matrix/client/v3" }
            );
            expect(result).toEqual(response);
        });

        it("should emit VerificationRequested event", async () => {
            const response = {
                request_token: "token123",
                token: "verify_token",
                status: "pending" as const,
                expires_at: Date.now() + 300000,
                methods_available: ["sas" as const],
            };
            mockAuthedRequest.mockResolvedValue(response);

            const emitSpy = vi.spyOn(deviceTrustManager, "emit");
            await deviceTrustManager.requestVerification({ new_device_id: "DEVICE123" });

            expect(emitSpy).toHaveBeenCalledWith(DeviceTrustEvent.VerificationRequested, response);
        });

        it("should use default method if not specified", async () => {
            mockAuthedRequest.mockResolvedValue({
                request_token: "token123",
                token: "verify_token",
                status: "pending" as const,
                expires_at: Date.now() + 300000,
                methods_available: ["sas" as const],
            });

            await deviceTrustManager.requestVerification({ new_device_id: "DEVICE123" });

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/device_verification/request",
                undefined,
                expect.objectContaining({ method: "sas" }),
                { prefix: "/_matrix/client/v3" }
            );
        });
    });

    describe("respondToVerification", () => {
        it("should respond to verification request", async () => {
            const response = {
                success: true,
                trust_level: "verified" as const,
            };
            mockAuthedRequest.mockResolvedValue(response);

            const result = await deviceTrustManager.respondToVerification("token123", true);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/device_verification/respond",
                undefined,
                {
                    token: "token123",
                    approved: true,
                },
                { prefix: "/_matrix/client/v3" }
            );
            expect(result).toEqual(response);
        });

        it("should emit VerificationResponded event", async () => {
            const response = {
                success: true,
                trust_level: "verified" as const,
            };
            mockAuthedRequest.mockResolvedValue(response);

            const emitSpy = vi.spyOn(deviceTrustManager, "emit");
            await deviceTrustManager.respondToVerification("token123", true);

            expect(emitSpy).toHaveBeenCalledWith(DeviceTrustEvent.VerificationResponded, response);
        });

        it("should handle rejection", async () => {
            const response = {
                success: false,
                trust_level: "unverified" as const,
            };
            mockAuthedRequest.mockResolvedValue(response);

            const result = await deviceTrustManager.respondToVerification("token123", false);

            expect(result.success).toBe(false);
        });
    });

    describe("getVerificationStatus", () => {
        it("should get verification status", async () => {
            const response = {
                request_token: "token123",
                token: "verify_token",
                status: "approved" as const,
                expires_at: Date.now() + 300000,
                methods_available: ["sas" as const],
            };
            mockAuthedRequest.mockResolvedValue(response);

            const result = await deviceTrustManager.getVerificationStatus("token123");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/device_verification/status/token123",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v3" }
            );
            expect(result).toEqual(response);
        });
    });

    describe("getDeviceTrustList", () => {
        it("should get device trust list", async () => {
            const devices = [
                {
                    device_id: "DEVICE1",
                    trust_level: "verified" as const,
                    verified_at: Date.now(),
                },
                {
                    device_id: "DEVICE2",
                    trust_level: "unverified" as const,
                },
            ];
            mockAuthedRequest.mockResolvedValue({ devices });

            const result = await deviceTrustManager.getDeviceTrustList();

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/device_trust",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v3" }
            );
            expect(result).toEqual(devices);
        });

        it("should not cache device trust list by default", async () => {
            const devices = [
                {
                    device_id: "DEVICE1",
                    trust_level: "verified" as const,
                },
            ];
            mockAuthedRequest.mockResolvedValue({ devices });

            await deviceTrustManager.getDeviceTrustList();
            await deviceTrustManager.getDeviceTrustList();

            // getDeviceTrustList doesn't cache the full list, only individual devices
            expect(mockAuthedRequest).toHaveBeenCalledTimes(2);
        });

        it("should force refresh when requested", async () => {
            const devices = [
                {
                    device_id: "DEVICE1",
                    trust_level: "verified" as const,
                },
            ];
            mockAuthedRequest.mockResolvedValue({ devices });

            await deviceTrustManager.getDeviceTrustList();
            await deviceTrustManager.getDeviceTrustList(true);

            expect(mockAuthedRequest).toHaveBeenCalledTimes(2);
        });
    });

    describe("getDeviceTrust", () => {
        it("should get device trust info", async () => {
            const trustInfo = {
                device_id: "DEVICE1",
                trust_level: "verified" as const,
                verified_at: Date.now(),
                verified_by: "@alice:example.com",
            };
            mockAuthedRequest.mockResolvedValue(trustInfo);

            const result = await deviceTrustManager.getDeviceTrust("DEVICE1");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/device_trust/DEVICE1",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v3" }
            );
            expect(result).toEqual(trustInfo);
        });

        it("should return null for 404 errors", async () => {
            mockAuthedRequest.mockRejectedValue({ httpStatus: 404 });

            const result = await deviceTrustManager.getDeviceTrust("DEVICE1");

            expect(result).toBeNull();
        });

        it("should throw error for empty device ID", async () => {
            await expect(deviceTrustManager.getDeviceTrust("")).rejects.toThrow("Device ID is required");
        });

        it("should cache device trust info", async () => {
            const trustInfo = {
                device_id: "DEVICE1",
                trust_level: "verified" as const,
            };
            mockAuthedRequest.mockResolvedValue(trustInfo);

            await deviceTrustManager.getDeviceTrust("DEVICE1");
            await deviceTrustManager.getDeviceTrust("DEVICE1");

            expect(mockAuthedRequest).toHaveBeenCalledTimes(1);
        });
    });

    describe("getSecuritySummary", () => {
        it("should get security summary", async () => {
            const summary = {
                verified_devices: 2,
                unverified_devices: 1,
                blocked_devices: 0,
                has_cross_signing_master: true,
                security_score: 85,
                recommendations: ["Enable cross-signing"],
            };
            mockAuthedRequest.mockResolvedValue(summary);

            const result = await deviceTrustManager.getSecuritySummary();

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/security/summary",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v3" }
            );
            expect(result).toEqual(summary);
        });

        it("should emit SecuritySummaryUpdated event", async () => {
            const summary = {
                verified_devices: 2,
                unverified_devices: 1,
                blocked_devices: 0,
                has_cross_signing_master: true,
                security_score: 85,
                recommendations: [],
            };
            mockAuthedRequest.mockResolvedValue(summary);

            const emitSpy = vi.spyOn(deviceTrustManager, "emit");
            await deviceTrustManager.getSecuritySummary();

            expect(emitSpy).toHaveBeenCalledWith(DeviceTrustEvent.SecuritySummaryUpdated, summary);
        });

        it("should cache security summary", async () => {
            const summary = {
                verified_devices: 2,
                unverified_devices: 1,
                blocked_devices: 0,
                has_cross_signing_master: true,
                security_score: 85,
                recommendations: [],
            };
            mockAuthedRequest.mockResolvedValue(summary);

            await deviceTrustManager.getSecuritySummary();
            await deviceTrustManager.getSecuritySummary();

            expect(mockAuthedRequest).toHaveBeenCalledTimes(1);
        });
    });

    describe("isDeviceTrusted", () => {
        it("should return true for verified device", async () => {
            mockAuthedRequest.mockResolvedValue({
                device_id: "DEVICE1",
                trust_level: "verified",
            });

            const result = await deviceTrustManager.isDeviceTrusted("DEVICE1");

            expect(result).toBe(true);
        });

        it("should return true for cross-signed device", async () => {
            mockAuthedRequest.mockResolvedValue({
                device_id: "DEVICE1",
                trust_level: "cross_signed",
            });

            const result = await deviceTrustManager.isDeviceTrusted("DEVICE1");

            expect(result).toBe(true);
        });

        it("should return false for unverified device", async () => {
            mockAuthedRequest.mockResolvedValue({
                device_id: "DEVICE1",
                trust_level: "unverified",
            });

            const result = await deviceTrustManager.isDeviceTrusted("DEVICE1");

            expect(result).toBe(false);
        });

        it("should return false for non-existent device", async () => {
            mockAuthedRequest.mockRejectedValue({ httpStatus: 404 });

            const result = await deviceTrustManager.isDeviceTrusted("DEVICE1");

            expect(result).toBe(false);
        });
    });

    describe("isDeviceBlocked", () => {
        it("should return true for blacklisted device", async () => {
            mockAuthedRequest.mockResolvedValue({
                device_id: "DEVICE1",
                trust_level: "blacklisted",
            });

            const result = await deviceTrustManager.isDeviceBlocked("DEVICE1");

            expect(result).toBe(true);
        });

        it("should return false for non-blacklisted device", async () => {
            mockAuthedRequest.mockResolvedValue({
                device_id: "DEVICE1",
                trust_level: "verified",
            });

            const result = await deviceTrustManager.isDeviceBlocked("DEVICE1");

            expect(result).toBe(false);
        });
    });

    describe("Cache Management", () => {
        it("should clear all caches", async () => {
            mockAuthedRequest.mockResolvedValue({
                device_id: "DEVICE1",
                trust_level: "verified",
            });

            await deviceTrustManager.getDeviceTrust("DEVICE1");
            deviceTrustManager.clearCache();

            await deviceTrustManager.getDeviceTrust("DEVICE1");

            expect(mockAuthedRequest).toHaveBeenCalledTimes(2);
        });

        it("should get cache statistics", async () => {
            mockAuthedRequest.mockResolvedValue({
                device_id: "DEVICE1",
                trust_level: "verified",
            });

            await deviceTrustManager.getDeviceTrust("DEVICE1");
            await deviceTrustManager.getDeviceTrust("DEVICE1");

            const stats = deviceTrustManager.getCacheStats();

            expect(stats.deviceTrust.hits).toBe(1);
            expect(stats.deviceTrust.misses).toBe(1);
        });
    });

    describe("Request Statistics", () => {
        it("should track successful requests", async () => {
            mockAuthedRequest.mockResolvedValue({
                device_id: "DEVICE1",
                trust_level: "verified",
            });

            await deviceTrustManager.getDeviceTrust("DEVICE1", true);

            const stats = deviceTrustManager.getRequestStats();
            expect(stats.successful).toBe(1);
            expect(stats.total).toBe(1);
        });

        it("should reset request statistics", () => {
            deviceTrustManager.resetRequestStats();

            const stats = deviceTrustManager.getRequestStats();
            expect(stats.total).toBe(0);
            expect(stats.successful).toBe(0);
            expect(stats.failed).toBe(0);
        });
    });

    describe("Error Handling", () => {
        it("should throw normalized error on request failure", async () => {
            const error = new Error("Network error");
            mockAuthedRequest.mockRejectedValue(error);

            await expect(deviceTrustManager.requestVerification({ new_device_id: "DEVICE1" })).rejects.toThrow();
        });

        it("should handle empty device list", async () => {
            mockAuthedRequest.mockResolvedValue({ devices: [] });

            const result = await deviceTrustManager.getDeviceTrustList();

            expect(result).toEqual([]);
        });
    });
});
