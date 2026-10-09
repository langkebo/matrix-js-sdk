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
import { MatrixClient } from "../../src/client.ts";
import { NotificationsManager } from "../../src/notifications/index.ts";
import { Method } from "../../src/http-api/method.ts";
import { ClientPrefix, VendorPrefix } from "../../src/http-api/prefix.ts";

describe("NotificationsManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let manager: NotificationsManager;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
            getNotifTimelineSet: vi.fn(),
            setNotifTimelineSet: vi.fn(),
            resetNotifTimelineSet: vi.fn(),
            setLocalNotificationSettings: vi.fn(),
        };
        manager = new NotificationsManager(mockClient as MatrixClient);
    });

    it("should fetch notifications with correct path and params", async () => {
        const mockResponse = { notifications: [], next_token: "token" };
        mockClient.http.authedRequest.mockResolvedValue(mockResponse);

        const opts = { limit: 10, from: "start", only: "highlight" };
        const result = await manager.getNotifications(opts);

        expect(result).toBe(mockResponse);
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(Method.Get, "/notifications", opts, undefined, {
            prefix: ClientPrefix.V3,
        });
    });

    it("should ack a notification with correct path", async () => {
        mockClient.http.authedRequest.mockResolvedValue({});

        const notificationId = "$event:example.org";
        await manager.ackNotification(notificationId);

        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Post,
            `/_matrix/client/v3/notifications/${encodeURIComponent(notificationId)}/ack`.replace(
                "/_matrix/client/v3",
                "",
            ),
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 },
        );
    });

    it("should throw error if notificationId is missing in ackNotification", async () => {
        await expect(manager.ackNotification("")).rejects.toThrow("notificationId is required");
    });

    // ────────────────────────── push_notification 模块 ──────────────────────────
    // 覆盖 GET/POST /push/devices、DELETE /push/devices/{device_id}、POST /push/send。
    // 这四条来自 ledger 模块 `push_notification`（契约表 ./__generated__/route-table），
    // 与本 manager 原有的 push.rs 端点（/notifications）分属两张表，路径不得混淆。

    const sampleDevice = {
        device_id: "D1",
        push_type: "apns",
        platform: "android",
        enabled: true,
        created_ts: 1700000000000,
    };

    it("should list push devices from a bare array", async () => {
        mockClient.http.authedRequest.mockResolvedValue([sampleDevice]);

        const result = await manager.getPushDevices();

        expect(result).toEqual([sampleDevice]);
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(Method.Get, "/push/devices", undefined, undefined, {
            prefix: VendorPrefix,
        });
    });

    it("should tolerate a wrapped { devices } response", async () => {
        mockClient.http.authedRequest.mockResolvedValue({ devices: [sampleDevice] });

        await expect(manager.getPushDevices()).resolves.toEqual([sampleDevice]);
    });

    it("should register a push device with the request body verbatim", async () => {
        mockClient.http.authedRequest.mockResolvedValue(sampleDevice);

        const body = { device_id: "D1", push_token: "tok", push_type: "apns", platform: "android" };
        const result = await manager.registerPushDevice(body);

        expect(result).toEqual(sampleDevice);
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(Method.Post, "/push/devices", undefined, body, {
            prefix: VendorPrefix,
        });
    });

    it("should reject registerPushDevice when a required field is missing", async () => {
        await expect(manager.registerPushDevice({ device_id: "", push_token: "t", push_type: "apns" })).rejects.toThrow(
            "device_id is required",
        );
        await expect(manager.registerPushDevice({ device_id: "D", push_token: "", push_type: "apns" })).rejects.toThrow(
            "push_token is required",
        );
        await expect(manager.registerPushDevice({ device_id: "D", push_token: "t", push_type: "" })).rejects.toThrow(
            "push_type is required",
        );
    });

    it("should unregister a push device with an encoded device id", async () => {
        mockClient.http.authedRequest.mockResolvedValue({ message: "Device unregistered" });

        await manager.unregisterPushDevice("D/1");

        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Delete,
            `/push/devices/${encodeURIComponent("D/1")}`,
            undefined,
            undefined,
            { prefix: VendorPrefix },
        );
    });

    it("should reject unregisterPushDevice without a device id", async () => {
        await expect(manager.unregisterPushDevice("")).rejects.toThrow("deviceId is required");
    });

    it("should send a push notification", async () => {
        mockClient.http.authedRequest.mockResolvedValue({ message: "Notification queued" });

        const body = { title: "Hi", body: "There" };
        const result = await manager.sendPushNotification(body);

        expect(result).toEqual({ message: "Notification queued" });
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(Method.Post, "/push/send", undefined, body, {
            prefix: VendorPrefix,
        });
    });

    it("should reject sendPushNotification without title or body", async () => {
        await expect(manager.sendPushNotification({ title: "", body: "x" })).rejects.toThrow("title is required");
        await expect(manager.sendPushNotification({ title: "x", body: "" })).rejects.toThrow("body is required");
    });
});
