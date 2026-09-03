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
import { FakeTransport } from "../test-utils/FakeTransport";
import { DehydratedDeviceManager } from "../../src/dehydrated-device/index";
import { Method } from "../../src/http-api/method";

describe("DehydratedDeviceManager", () => {
    let transport: FakeTransport;
    let manager: DehydratedDeviceManager;

    beforeEach(() => {
        transport = new FakeTransport();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        manager = new DehydratedDeviceManager({} as any, { transport });
    });

    describe("createDevice", () => {
        it("should create a dehydrated device", async () => {
            const data = {
                device_data: { algorithm: "test_algo", account: "test_account" },
                initial_device_display_name: "Test Device",
            };
            transport.respondWith({ device_id: "dev123" });

            const result = await manager.createDevice(data);

            expect(result.device_id).toBe("dev123");
            transport.expectCalledWith(Method.Put, "/dehydrated_device");
        });

        it("should throw if device_data is missing", async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await expect(manager.createDevice({ device_data: null as any })).rejects.toThrow("device_data is required");
        });

        it("should throw if device_data.algorithm is empty", async () => {
            const data = { device_data: { algorithm: "", account: "test_account" } };
            await expect(manager.createDevice(data)).rejects.toThrow("device_data.algorithm is required");
        });

        it("should throw if device_data.account is empty", async () => {
            const data = { device_data: { algorithm: "test_algo", account: "" } };
            await expect(manager.createDevice(data)).rejects.toThrow("device_data.account is required");
        });
    });

    describe("getDevice", () => {
        it("should get a dehydrated device by ID", async () => {
            transport.respondWith({ device_id: "dev123", device_data: { algorithm: "test", account: "test" } });

            const result = await manager.getDevice("dev123");

            expect(result.device_id).toBe("dev123");
            transport.expectCalledWith(Method.Get, "/dehydrated_device");
        });

        it("should throw if deviceId is empty", async () => {
            await expect(manager.getDevice("")).rejects.toThrow("deviceId is required");
        });
    });

    describe("getDevices", () => {
        it("should list all dehydrated devices", async () => {
            transport.respondWith({ devices: [{ device_id: "dev1" }, { device_id: "dev2" }] });

            const result = await manager.getDevices();

            expect(result.devices).toHaveLength(2);
            transport.expectCalledWith(Method.Get, "/dehydrated_device");
        });
    });

    describe("claimDevice", () => {
        const validData = { rehydrate_data: { algorithm: "test_algo", account: "test_account" } };

        it("should claim a dehydrated device", async () => {
            transport.respondWith({ success: true });

            const result = await manager.claimDevice("dev123", validData);

            expect(result).toEqual({ success: true });
            transport.expectCalledWith(Method.Post, "/dehydrated_device/dev123/events");
        });

        it("should throw if deviceId is empty", async () => {
            await expect(manager.claimDevice("", validData)).rejects.toThrow("deviceId is required");
        });

        it("should throw if rehydrate_data is missing", async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await expect(manager.claimDevice("dev123", { rehydrate_data: null as any })).rejects.toThrow(
                "rehydrate_data is required",
            );
        });

        it("should throw if rehydrate_data.algorithm is empty", async () => {
            const data = { rehydrate_data: { algorithm: "", account: "test" } };
            await expect(manager.claimDevice("dev123", data)).rejects.toThrow("rehydrate_data.algorithm is required");
        });
    });

    describe("updateDeviceData", () => {
        it("should update device data", async () => {
            const data = { device_data: { algorithm: "new_algo", account: "new_account" } };
            transport.respondWith({ device_id: "dev123" });

            const result = await manager.updateDeviceData("dev123", data);

            expect(result.device_id).toBe("dev123");
            transport.expectCalledWith(Method.Put, "/dehydrated_device");
        });

        it("should throw if deviceId is empty", async () => {
            const data = { device_data: { algorithm: "test", account: "test" } };
            await expect(manager.updateDeviceData("", data)).rejects.toThrow("deviceId is required");
        });
    });

    describe("deleteDevice", () => {
        it("should delete a dehydrated device", async () => {
            expect.assertions(0);
            transport.respondWith({});

            await manager.deleteDevice("dev123");

            transport.expectCalledWith(Method.Delete, "/dehydrated_device");
        });

        it("should throw if deviceId is empty", async () => {
            await expect(manager.deleteDevice("")).rejects.toThrow("deviceId is required");
        });
    });

    describe("getDeviceEvent", () => {
        it("should get the initial device event", async () => {
            transport.respondWith({ algorithm: "test", account: "test" });

            const result = await manager.getDeviceEvent("dev123");

            expect(result).toEqual({ algorithm: "test", account: "test" });
            transport.expectCalledWith(Method.Get, "/dehydrated_device/dev123/initial_device");
        });

        it("should throw if deviceId is empty", async () => {
            await expect(manager.getDeviceEvent("")).rejects.toThrow("deviceId is required");
        });
    });
});
