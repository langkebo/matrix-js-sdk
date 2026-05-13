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
import { ClientPrefix } from "../../src/http-api/prefix.ts";

describe("NotificationsManager", () => {
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
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/notifications",
            opts,
            undefined,
            { prefix: ClientPrefix.V3 },
        );
    });

    it("should ack a notification with correct path", async () => {
        mockClient.http.authedRequest.mockResolvedValue({});

        const notificationId = "$event:example.org";
        await manager.ackNotification(notificationId);

        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Post,
            `/_matrix/client/v3/notifications/${encodeURIComponent(notificationId)}/ack`.replace("/_matrix/client/v3", ""),
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 },
        );
    });

    it("should throw error if notificationId is missing in ackNotification", async () => {
        await expect(manager.ackNotification("")).rejects.toThrow("notificationId is required");
    });
});
