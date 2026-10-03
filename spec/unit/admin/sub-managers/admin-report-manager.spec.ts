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

import { AdminReportManager } from "../../../../src/admin/sub-managers/admin-report-manager";
import { Method } from "../../../../src/http-api/method";

describe("AdminReportManager", () => {
    let manager: AdminReportManager;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
        };
        manager = new AdminReportManager(mockClient);
    });

    it("listAll() returns paginated reports", async () => {
        mockClient.http.authedRequest.mockResolvedValue({
            reports: [
                {
                    id: 1,
                    room_id: "!room:example.com",
                    event_id: "$event1",
                    user_id: "@user:example.com",
                    reported_user_id: null,
                    reason: "spam",
                    content: "Description",
                    status: "open",
                    score: -50,
                    received_ts: 1700000000000,
                },
            ],
            total: 1,
        });

        const result = await manager.listAll({ limit: 10 });

        expect(result.reports).toHaveLength(1);
        expect(result.reports[0].id).toBe(1);
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(Method.Get, "/reports", { limit: "10" }, undefined, {
            prefix: "/_synapse/admin/v1",
        });
    });

    it("get() returns single report", async () => {
        const report = {
            id: 1,
            room_id: "!room:example.com",
            event_id: "$event1",
            user_id: "@user:example.com",
            reported_user_id: null,
            reason: "spam",
            content: "Description",
            status: "open",
            score: -50,
            received_ts: 1700000000000,
        };
        mockClient.http.authedRequest.mockResolvedValue(report);

        const result = await manager.get(1);

        expect(result.id).toBe(1);
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(Method.Get, "/reports/1", undefined, undefined, {
            prefix: "/_synapse/admin/v1",
        });
    });

    it("delete() calls DELETE /reports/{id}", async () => {
        mockClient.http.authedRequest.mockResolvedValue(undefined);

        await manager.delete(1);

        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(Method.Delete, "/reports/1", undefined, undefined, {
            prefix: "/_synapse/admin/v1",
        });
    });

    it("getByRoom() returns room reports", async () => {
        mockClient.http.authedRequest.mockResolvedValue({
            reports: [
                {
                    id: 1,
                    room_id: "!room:example.com",
                    event_id: "$event1",
                    user_id: "@user:example.com",
                    reported_user_id: null,
                    reason: "spam",
                    content: "Description",
                    status: "open",
                    score: -50,
                    received_ts: 1700000000000,
                },
            ],
            total: 1,
        });

        const result = await manager.getByRoom("!room:example.com", { limit: 10 });

        expect(result.reports).toHaveLength(1);
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/rooms/!room%3Aexample.com/reports",
            { limit: "10" },
            undefined,
            { prefix: "/_synapse/admin/v1" },
        );
    });

    it("getRoomReport() returns single room report", async () => {
        const report = {
            id: 1,
            room_id: "!room:example.com",
            event_id: "$event1",
            user_id: "@user:example.com",
            reported_user_id: null,
            reason: "spam",
            content: "Description",
            status: "open",
            score: -50,
            received_ts: 1700000000000,
        };
        mockClient.http.authedRequest.mockResolvedValue(report);

        const result = await manager.getRoomReport("!room:example.com", 1);

        expect(result.id).toBe(1);
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/rooms/!room%3Aexample.com/reports/1",
            undefined,
            undefined,
            { prefix: "/_synapse/admin/v1" },
        );
    });

    it("deleteRoomReport() calls DELETE /rooms/{roomId}/reports/{id}", async () => {
        mockClient.http.authedRequest.mockResolvedValue(undefined);

        await manager.deleteRoomReport("!room:example.com", 1);

        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Delete,
            "/rooms/!room%3Aexample.com/reports/1",
            undefined,
            undefined,
            { prefix: "/_synapse/admin/v1" },
        );
    });
});
