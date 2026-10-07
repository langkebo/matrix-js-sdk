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

import { AdminNotificationManager } from "../../../../src/admin/sub-managers/admin-notification-manager";
import { Method } from "../../../../src/http-api/method";

describe("AdminNotificationManager", () => {
    let manager: AdminNotificationManager;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
        };
        manager = new AdminNotificationManager(mockClient);
    });

    it("list() returns {notifications, next_batch} (backend has no total, no next_token)", async () => {
        mockClient.http.authedRequest.mockResolvedValue({
            notifications: [
                {
                    id: 1,
                    title: "维护",
                    content: "02:00 维护",
                    notification_type: "maintenance",
                    priority: 0,
                    target_audience: "all",
                    target_user_ids: null,
                    starts_at: null,
                    expires_at: null,
                    is_enabled: true,
                    is_dismissable: true,
                    action_url: null,
                    action_text: null,
                    created_by: null,
                    created_ts: 1700000000000,
                    updated_ts: 1700000000000,
                },
            ],
            next_batch: "1700000000000|1",
        });

        const result = await manager.list({ limit: 10 });

        expect(result.notifications).toHaveLength(1);
        expect(result.notifications[0].title).toBe("维护");
        expect(result.next_batch).toBe("1700000000000|1");
        expect(result).not.toHaveProperty("total");
        expect(result).not.toHaveProperty("next_token");
        expect(result.notifications[0]).not.toHaveProperty("message");
        expect(result.notifications[0]).not.toHaveProperty("important");
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/notifications",
            { limit: "10" },
            undefined,
            { prefix: "/_synapse/admin/v1" },
        );
    });

    it("get() reads the notification object directly (backend does NOT wrap it)", async () => {
        // 后端 get_notification 返回 Json(json!(notification)) —— 裸对象，没有 {notification: …} 包装。
        mockClient.http.authedRequest.mockResolvedValue({
            id: 1,
            title: "维护",
            content: "02:00 维护",
            notification_type: "maintenance",
            priority: 0,
            target_audience: "all",
            target_user_ids: null,
            starts_at: null,
            expires_at: null,
            is_enabled: true,
            is_dismissable: true,
            action_url: null,
            action_text: null,
            created_by: null,
            created_ts: 1700000000000,
            updated_ts: 1700000000000,
        });

        const result = await manager.get(1);

        expect(result.id).toBe(1);
        expect(result.title).toBe("维护");
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/notifications/1",
            undefined,
            undefined,
            { prefix: "/_synapse/admin/v1" },
        );
    });

    it("create() sends the real CreateNotificationRequest shape (title/content) and reads a bare object back", async () => {
        mockClient.http.authedRequest.mockResolvedValue({
            id: 1,
            title: "维护",
            content: "02:00 维护",
            notification_type: "maintenance",
            priority: 0,
            target_audience: "all",
            target_user_ids: null,
            starts_at: null,
            expires_at: null,
            is_enabled: true,
            is_dismissable: true,
            action_url: null,
            action_text: null,
            created_by: null,
            created_ts: 1700000000000,
            updated_ts: 1700000000000,
        });

        const result = await manager.create({ title: "维护", content: "02:00 维护" });

        expect(result.id).toBe(1);
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/notifications",
            undefined,
            { title: "维护", content: "02:00 维护" },
            { prefix: "/_synapse/admin/v1" },
        );
    });

    it("update() sends real fields (title/content) and reads a bare object back", async () => {
        mockClient.http.authedRequest.mockResolvedValue({
            id: 1,
            title: "维护",
            content: "02:00 维护",
            notification_type: "maintenance",
            priority: 0,
            target_audience: "all",
            target_user_ids: null,
            starts_at: null,
            expires_at: null,
            is_enabled: true,
            is_dismissable: true,
            action_url: null,
            action_text: null,
            created_by: null,
            created_ts: 1700000000000,
            updated_ts: 1700000000000,
        });

        const result = await manager.update(1, { title: "维护（改）" });

        expect(result.title).toBe("维护");
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Put,
            "/notifications/1",
            undefined,
            { title: "维护（改）" },
            { prefix: "/_synapse/admin/v1" },
        );
    });

    it("delete() calls DELETE /notifications/{id}", async () => {
        mockClient.http.authedRequest.mockResolvedValue(undefined);

        await manager.delete(1);

        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Delete,
            "/notifications/1",
            undefined,
            undefined,
            { prefix: "/_synapse/admin/v1" },
        );
    });

    // ⚠️ 这条断言的是**既有行为**（不是契约）：后端注册的是
    // PUT /notifications/{notification_id}/deactivate，DELETE /notifications/deactivate 并不存在；
    // 该差异已登记在 path-contract-waivers.json（semantic-mismatch），故本轮不改行为。
    it("deactivate() calls DELETE /notifications/deactivate", async () => {
        mockClient.http.authedRequest.mockResolvedValue(undefined);

        await manager.deactivate();

        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Delete,
            "/notifications/deactivate",
            undefined,
            undefined,
            { prefix: "/_synapse/admin/v1" },
        );
    });
});
