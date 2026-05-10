import { describe, it, expect, beforeEach, vi } from "vitest";

import { DeviceManager, DeviceEvent, UIAError } from "../../src/device/index";
import { MatrixError } from "../../src/http-api/errors.ts";

describe("DeviceManager", () => {
    let mockClient: any;
    let deviceManager: DeviceManager;
    const mockDevices = [
        {
            device_id: "device1",
            display_name: "Test Device 1",
            last_seen_ip: "192.168.1.1",
            last_seen_ts: 1234567890,
            user_id: "@test:example.com",
        },
        {
            device_id: "device2",
            display_name: "Test Device 2",
            last_seen_ip: "192.168.1.2",
            last_seen_ts: 1234567891,
            user_id: "@test:example.com",
        },
    ];

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
            deviceId: "device1",
            userId: "@test:example.com",
            credentials: {
                userId: "@test:example.com",
                deviceId: "device1",
            },
        };
        deviceManager = new DeviceManager(mockClient);
    });

    describe("constructor", () => {
        it("should initialize with client deviceId", () => {
            expect(deviceManager.getCurrentDeviceId()).toBe("device1");
        });
    });

    describe("getDevices", () => {
        it("should fetch devices from server", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                devices: mockDevices,
            });

            const devices = await deviceManager.getDevices();

            expect(devices).toHaveLength(2);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/devices",
                undefined,
                undefined,
                expect.objectContaining({ prefix: "/_matrix/client/v3" }),
            );
        });

        it("should emit DevicesUpdated event", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                devices: mockDevices,
            });

            const emitSpy = vi.spyOn(deviceManager, "emit");
            await deviceManager.getDevices();

            expect(emitSpy).toHaveBeenCalledWith(DeviceEvent.DevicesUpdated, expect.any(Array));
        });

        it("should handle errors and emit DeviceError", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce(new Error("Network error"));

            const emitSpy = vi.spyOn(deviceManager, "emit");
            await expect(deviceManager.getDevices()).rejects.toThrow("Network error");

            expect(emitSpy).toHaveBeenCalledWith(DeviceEvent.DeviceError, expect.any(Error));
        });
    });

    describe("getDevice", () => {
        it("should fetch single device from server", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce(mockDevices[0]);

            const device = await deviceManager.getDevice("device1");

            expect(device?.device_id).toBe("device1");
            expect(device?.display_name).toBe("Test Device 1");
        });

        it("should return cached device if available", async () => {
            // First fetch to cache
            mockClient.http.authedRequest.mockResolvedValueOnce({
                devices: mockDevices,
            });
            await deviceManager.getDevices();

            // Second call should use cache
            mockClient.http.authedRequest.mockClear();
            const device = await deviceManager.getDevice("device1");

            expect(device?.device_id).toBe("device1");
            expect(mockClient.http.authedRequest).not.toHaveBeenCalled();
        });

        it("should throw on 404 error by default", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Not found" }, 404);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(deviceManager.getDevice("device1")).rejects.toThrow();
        });

        it("should return null on 404 error when throwOnError is false", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Not found" }, 404);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            const device = await deviceManager.getDevice("device1", false, false);

            expect(device).toBeNull();
        });

        it("should throw error for empty deviceId", async () => {
            await expect(deviceManager.getDevice("")).rejects.toThrow();
        });
    });

    describe("updateDevice", () => {
        it("should update device successfully", async () => {
            // First cache the device
            mockClient.http.authedRequest.mockResolvedValueOnce({
                devices: mockDevices,
            });
            await deviceManager.getDevices();

            // Now update - mock returns empty success
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            const emitSpy = vi.spyOn(deviceManager, "emit");
            await deviceManager.updateDevice("device1", { display_name: "New Name" });

            expect(emitSpy).toHaveBeenCalledWith(DeviceEvent.DeviceUpdated, expect.any(Object));
        });

        it("should throw error for empty deviceId", async () => {
            await expect(deviceManager.updateDevice("", { display_name: "New Name" })).rejects.toThrow();
        });

        it("should throw error when no updates provided", async () => {
            await expect(deviceManager.updateDevice("device1", {})).rejects.toThrow();
        });

        it("should throw UIAError for auth required", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce({
                errcode: "M_UIA_REQUIRED",
                data: { flows: [{ stages: ["m.login.password"] }] },
            });

            await expect(deviceManager.updateDevice("device1", { display_name: "New Name" })).rejects.toThrow(UIAError);
        });
    });

    describe("setDeviceDetails", () => {
        it("should call updateDevice", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            mockClient.http.authedRequest.mockResolvedValueOnce({
                devices: mockDevices,
            });
            await deviceManager.getDevices();

            await deviceManager.setDeviceDetails("device1", { display_name: "Test" });
            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });
    });

    describe("getDeviceListUpdates", () => {
        it("should call the contract path", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                changed: [],
                left: [],
            });

            await deviceManager.getDeviceListUpdates(["@alice:example.org"]);

            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                expect.anything(),
                "/keys/device_list_updates",
                undefined,
                { users: ["@alice:example.org"] },
                expect.objectContaining({ prefix: "/_matrix/client/v3" }),
            );
        });

        it("should reject empty user arrays", async () => {
            await expect(deviceManager.getDeviceListUpdates([])).rejects.toThrow("Users array is required");
        });
    });

    describe("deleteDevice", () => {
        it("should delete device successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            // First cache the device
            mockClient.http.authedRequest.mockResolvedValueOnce({
                devices: mockDevices,
            });
            await deviceManager.getDevices();

            const emitSpy = vi.spyOn(deviceManager, "emit");
            await deviceManager.deleteDevice("device2");

            expect(emitSpy).toHaveBeenCalledWith(DeviceEvent.DeviceDeleted, "device2");
        });

        it("should throw error for empty deviceId", async () => {
            await expect(deviceManager.deleteDevice("")).rejects.toThrow();
        });

        it("should throw error when deleting current device", async () => {
            await expect(deviceManager.deleteDevice("device1")).rejects.toThrow("Cannot delete the current device");
        });

        it("should throw UIAError for auth required", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce({
                errcode: "M_UIA_REQUIRED",
                data: { flows: [{ stages: ["m.login.password"] }] },
            });

            await expect(deviceManager.deleteDevice("device2")).rejects.toThrow(UIAError);
        });
    });

    describe("deleteDevices", () => {
        it("should delete multiple devices", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            // First cache the devices
            mockClient.http.authedRequest.mockResolvedValueOnce({
                devices: mockDevices,
            });
            await deviceManager.getDevices();

            const emitSpy = vi.spyOn(deviceManager, "emit");
            await deviceManager.deleteDevices(["device2"]);

            expect(emitSpy).toHaveBeenCalledWith(DeviceEvent.DeviceDeleted, "device2");
        });

        it("should throw error for empty device list", async () => {
            await expect(deviceManager.deleteDevices([])).rejects.toThrow();
        });

        it("should throw error when current device in list", async () => {
            await expect(deviceManager.deleteDevices(["device1"])).rejects.toThrow("Cannot delete the current device");
        });
    });

    describe("renameDevice", () => {
        it("should rename device", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            mockClient.http.authedRequest.mockResolvedValueOnce({
                devices: mockDevices,
            });
            await deviceManager.getDevices();

            await deviceManager.renameDevice("device1", "New Device Name");
            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });
    });

    describe("getCurrentDeviceId", () => {
        it("should return current device id", () => {
            expect(deviceManager.getCurrentDeviceId()).toBe("device1");
        });
    });

    describe("getCurrentDevice", () => {
        it("should return null when no device cached", () => {
            expect(deviceManager.getCurrentDevice()).toBeNull();
        });

        it("should return current device when cached", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                devices: mockDevices,
            });
            await deviceManager.getDevices();

            const device = deviceManager.getCurrentDevice();
            expect(device?.device_id).toBe("device1");
        });
    });

    describe("getCachedDevices", () => {
        it("should return empty array when not cached", () => {
            expect(deviceManager.getCachedDevices()).toHaveLength(0);
        });

        it("should return cached devices", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                devices: mockDevices,
            });
            await deviceManager.getDevices();

            expect(deviceManager.getCachedDevices()).toHaveLength(2);
        });
    });

    describe("getCachedDevice", () => {
        it("should return null for unknown device", () => {
            expect(deviceManager.getCachedDevice("unknown")).toBeNull();
        });

        it("should return cached device", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                devices: mockDevices,
            });
            await deviceManager.getDevices();

            const device = deviceManager.getCachedDevice("device1");
            expect(device?.device_id).toBe("device1");
        });
    });

    describe("getOtherDevices", () => {
        it("should return all devices except current", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                devices: mockDevices,
            });
            await deviceManager.getDevices();

            const otherDevices = deviceManager.getOtherDevices();
            expect(otherDevices).toHaveLength(1);
            expect(otherDevices[0].device_id).toBe("device2");
        });
    });

    describe("start/stop", () => {
        it("should start and fetch devices", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                devices: mockDevices,
            });

            await deviceManager.start();
            expect(deviceManager.getCachedDevices()).toHaveLength(2);
        });

        it("should not re-fetch if already initialized", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                devices: mockDevices,
            });

            await deviceManager.start();
            await deviceManager.start();

            expect(mockClient.http.authedRequest).toHaveBeenCalledTimes(1);
        });

        it("should stop and clear cache", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                devices: mockDevices,
            });

            await deviceManager.start();
            deviceManager.stop();

            expect(deviceManager.getCachedDevices()).toHaveLength(0);
        });
    });
});
