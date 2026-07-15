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

import { GlobalLogoutManager } from "../../../src/auth/global-logout";
import { Method, ClientPrefix } from "../../../src/http-api";

describe("GlobalLogoutManager", () => {
    let manager: GlobalLogoutManager;
    let mockClient: {
        http: {
            authedRequest: ReturnType<typeof vi.fn>;
        };
        getDeviceManager: ReturnType<typeof vi.fn>;
        deviceId: string;
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
                authedRequest: vi.fn().mockResolvedValue({}),
            },
            getDeviceManager: vi.fn().mockReturnValue(mockDeviceManager),
            deviceId: "DEVICE_1",
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        manager = new GlobalLogoutManager(mockClient as any);
    });

    describe("logoutAll", () => {
        it("should call logout/all endpoint", async () => {
            await manager.logoutAll();

            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/logout/all",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });
    });

    describe("getActiveSessions", () => {
        it("should return list of devices", async () => {
            const devices = await manager.getActiveSessions();

            expect(mockClient.getDeviceManager).toHaveBeenCalled();
            expect(devices).toHaveLength(2);
            expect(devices[0].deviceId).toBe("DEVICE_1");
        });
    });

    describe("logoutDevice", () => {
        it("should call delete device endpoint", async () => {
            await manager.logoutDevice("DEVICE_2");

            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                Method.Delete,
                "/devices/DEVICE_2",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });
    });

    describe("logoutOtherDevices", () => {
        it("should logout all devices except current", async () => {
            await manager.logoutOtherDevices();

            expect(mockClient.http.authedRequest).toHaveBeenCalledTimes(1);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                Method.Delete,
                "/devices/DEVICE_2",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });

        it("should not call http if only one device", async () => {
            const mockDeviceManager = {
                getDevices: vi.fn().mockResolvedValue([{ device_id: "DEVICE_1", display_name: "Device 1" }]),
            };
            mockClient.getDeviceManager.mockReturnValueOnce(mockDeviceManager);

            await manager.logoutOtherDevices();

            expect(mockClient.http.authedRequest).not.toHaveBeenCalled();
        });
    });
});
