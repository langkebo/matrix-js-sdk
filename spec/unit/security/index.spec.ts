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

/**
 * `SecurityManager` 只保留有后端契约的能力。原先的
 * `getAccountStatus` / `isAccountLocked` / `isAccountSuspended` / `listLoginFailures`
 * 调的是**不存在**的端点（`/_synapse/admin/v1/account_status/{user_id}`、
 * `/_synapse/admin/v1/login/failures`，后端 ledger 零命中）⇒ 已删除，
 * 因此这里不再有对应的"假兜底"用例。
 */
describe("SecurityManager", () => {
    let manager: SecurityManager;
    let getDevices: ReturnType<typeof vi.fn>;
    let getDeviceVerificationStatus: ReturnType<typeof vi.fn>;
    let mockClient: Record<string, unknown>;

    const devices = [
        { device_id: "DEVICE_1", display_name: "Device 1" },
        { device_id: "DEVICE_2", display_name: "Device 2" },
    ];

    beforeEach(() => {
        getDevices = vi.fn().mockResolvedValue(devices);
        getDeviceVerificationStatus = vi.fn().mockResolvedValue({ isVerified: () => true });

        mockClient = {
            getDeviceManager: vi.fn().mockReturnValue({ getDevices }),
            getCrypto: vi.fn().mockReturnValue({ getDeviceVerificationStatus }),
            getUserId: vi.fn().mockReturnValue("@user:example.com"),
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        manager = new SecurityManager(mockClient as any);
    });

    describe("checkSessionSecurity", () => {
        it("returns secure when every device is verified via cross-signing", async () => {
            const result = await manager.checkSessionSecurity();

            expect(result.isSecure).toBe(true);
            expect(result.issues).toEqual([]);
            expect(getDeviceVerificationStatus).toHaveBeenCalledTimes(2);
        });

        it("returns insecure when no devices are known", async () => {
            getDevices.mockResolvedValue([]);

            const result = await manager.checkSessionSecurity();

            expect(result.isSecure).toBe(false);
            expect(result.issues).toContain("No devices found");
        });

        it("returns insecure when encryption is not enabled (device trust cannot be evaluated)", async () => {
            mockClient.getCrypto = vi.fn().mockReturnValue(undefined);

            const result = await manager.checkSessionSecurity();

            expect(result.isSecure).toBe(false);
            expect(result.issues).toContain(
                "Encryption is not enabled on this client; device trust cannot be evaluated",
            );
        });

        it("counts unverified devices using the crypto API (no always-true check)", async () => {
            // 第二个设备未通过交叉签名验证 ⇒ 必须被计入并判为不安全。
            getDeviceVerificationStatus.mockImplementation((_userId: string, deviceId: string) =>
                Promise.resolve({ isVerified: () => deviceId === "DEVICE_1" }),
            );

            const result = await manager.checkSessionSecurity();

            expect(result.isSecure).toBe(false);
            expect(result.issues).toContain("1 device(s) are not verified");
        });

        it("treats a missing verification status as unverified", async () => {
            getDeviceVerificationStatus.mockResolvedValue(null);

            const result = await manager.checkSessionSecurity();

            expect(result.isSecure).toBe(false);
            expect(result.issues).toContain("2 device(s) are not verified");
        });
    });
});
