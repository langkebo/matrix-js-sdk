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

    it("list() returns paginated notifications", async () => {
        mockClient.http.authedRequest.mockResolvedValue({
            notifications: [
                { id: 1, message: "Test", important: false, sent_ts: null, created_ts: 1700000000000, expired: false },
            ],
            total: 1,
        });

        const result = await manager.list({ limit: 10 });

        expect(result.notifications).toHaveLength(1);
        expect(result.total).toBe(1);
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/notifications",
            { limit: "10" },
            undefined,
            { prefix: "/_synapse/admin/v1" },
        );
    });

    it("get() returns single notification", async () => {
        const notification = {
            id: 1,
            message: "Test",
            important: false,
            sent_ts: null,
            created_ts: 1700000000000,
            expired: false,
        };
        mockClient.http.authedRequest.mockResolvedValue({ notification });

        const result = await manager.get(1);

        expect(result.id).toBe(1);
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/notifications/1",
            undefined,
            undefined,
            { prefix: "/_synapse/admin/v1" },
        );
    });

    it("create() returns created notification", async () => {
        const notification = {
            id: 2,
            message: "New",
            important: true,
            sent_ts: null,
            created_ts: 1700000001000,
            expired: false,
        };
        mockClient.http.authedRequest.mockResolvedValue({ notification });

        const result = await manager.create({ message: "New", important: true });

        expect(result.id).toBe(2);
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/notifications",
            undefined,
            { message: "New", important: true },
            { prefix: "/_synapse/admin/v1" },
        );
    });

    it("update() returns updated notification", async () => {
        const notification = {
            id: 1,
            message: "Updated",
            important: true,
            sent_ts: null,
            created_ts: 1700000000000,
            expired: false,
        };
        mockClient.http.authedRequest.mockResolvedValue({ notification });

        const result = await manager.update(1, { message: "Updated" });

        expect(result.message).toBe("Updated");
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Put,
            "/notifications/1",
            undefined,
            { message: "Updated" },
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
