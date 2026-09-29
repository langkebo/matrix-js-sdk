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

import { AdminCleanupManager } from "../../../../src/admin/sub-managers/admin-cleanup-manager";
import { Method } from "../../../../src/http-api/method";

describe("AdminCleanupManager", () => {
    let manager: AdminCleanupManager;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
        };
        manager = new AdminCleanupManager(mockClient);
    });

    it("all() calls POST /cleanup/all", async () => {
        mockClient.http.authedRequest.mockResolvedValue({
            rooms: { rooms_deleted: 5, events_deleted: 1234 },
            tokens: {
                access_tokens_deleted: 10,
                refresh_tokens_deleted: 8,
                registration_tokens_deleted: 2,
                email_tokens_deleted: 1,
            },
        });

        const result = await manager.all({ min_age_ms: 86400000 });

        expect(result.rooms.rooms_deleted).toBe(5);
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/cleanup/all",
            undefined,
            { min_age_ms: 86400000 },
            { prefix: "/_synapse/admin/v1" },
        );
    });

    it("rooms() calls POST /cleanup/rooms", async () => {
        mockClient.http.authedRequest.mockResolvedValue({ rooms: 3 });

        const result = await manager.rooms({ min_age_ms: 604800000 });

        expect(result.rooms).toBe(3);
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/cleanup/rooms",
            undefined,
            { min_age_ms: 604800000 },
            { prefix: "/_synapse/admin/v1" },
        );
    });

    it("tokens() calls POST /cleanup/tokens", async () => {
        mockClient.http.authedRequest.mockResolvedValue({
            access_tokens_deleted: 5,
            refresh_tokens_deleted: 3,
        });

        const result = await manager.tokens();

        expect(result.access_tokens_deleted).toBe(5);
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/cleanup/tokens",
            undefined,
            undefined,
            { prefix: "/_synapse/admin/v1" },
        );
    });
});
