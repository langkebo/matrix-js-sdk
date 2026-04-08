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

import { SecurityManager } from "../../../src/security/index";

describe("SecurityManager", () => {
    let manager: SecurityManager;
    let mockClient: {
        http: {
            authedRequest: ReturnType<typeof vi.fn>;
        };
        getDeviceManager: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        const mockDeviceManager = {
            getDevices: vi.fn().mockResolvedValue([
                { device_id: "DEVICE_1", display_name: "Device 1" },
                { device_id: "DEVICE_2", display_name: "Device 2" },
            ]),
        };

        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
            getDeviceManager: vi.fn().mockReturnValue(mockDeviceManager),
        };
        manager = new SecurityManager(mockClient as any);
    });

    describe("getAccountStatus", () => {
        it("should return account status when successful", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                locked: false,
                suspended: false,
                verified: true,
            });

            const status = await manager.getAccountStatus("@user:example.com");

            expect(status).toEqual({
                locked: false,
                suspended: false,
                verified: true,
            });
        });

        it("should return null when API fails", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("API Error"));

            const status = await manager.getAccountStatus("@user:example.com");

            expect(status).toBeNull();
        });
    });

    describe("isAccountLocked", () => {
        it("should return true when account is locked", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                locked: true,
                suspended: false,
                verified: false,
            });

            const isLocked = await manager.isAccountLocked("@user:example.com");

            expect(isLocked).toBe(true);
        });

        it("should return false when account is not locked", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                locked: false,
                suspended: false,
                verified: false,
            });

            const isLocked = await manager.isAccountLocked("@user:example.com");

            expect(isLocked).toBe(false);
        });
    });

    describe("isAccountSuspended", () => {
        it("should return true when account is suspended", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                locked: false,
                suspended: true,
                verified: false,
            });

            const isSuspended = await manager.isAccountSuspended("@user:example.com");

            expect(isSuspended).toBe(true);
        });
    });

    describe("listLoginFailures", () => {
        it("should return list of login failures", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                failures: {
                    "2009-02-13T23:31:30.000Z": [{ ip: "192.168.1.1", userAgent: "Mozilla/5.0" }],
                    "2009-02-13T23:31:31.000Z": [{ ip: "192.168.1.2" }],
                },
            });

            const result = await manager.listLoginFailures();

            expect(result).toEqual([
                { timestamp: 1234567890000, ip: "192.168.1.1", userAgent: "Mozilla/5.0" },
                { timestamp: 1234567891000, ip: "192.168.1.2", userAgent: undefined },
            ]);
        });

        it("should return empty array when API fails", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("API Error"));

            const result = await manager.listLoginFailures();

            expect(result).toEqual([]);
        });
    });

    describe("checkSessionSecurity", () => {
        it("should return isSecure true when devices exist", async () => {
            const result = await manager.checkSessionSecurity();

            expect(result.isSecure).toBe(true);
            expect(result.issues).toEqual([]);
        });

        it("should return isSecure false when no devices", async () => {
            const mockDeviceManager = {
                getDevices: vi.fn().mockResolvedValue([]),
            };
            mockClient.getDeviceManager.mockReturnValueOnce(mockDeviceManager);

            const result = await manager.checkSessionSecurity();

            expect(result.isSecure).toBe(false);
            expect(result.issues).toContain("No devices found");
        });
    });
});
