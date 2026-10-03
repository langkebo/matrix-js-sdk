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

import { AdminPolicyManager } from "../../../../src/admin/sub-managers/admin-policy-manager";
import { Method } from "../../../../src/http-api/method";

describe("AdminPolicyManager", () => {
    let manager: AdminPolicyManager;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
        };
        manager = new AdminPolicyManager(mockClient);
    });

    it("getStatus() returns policy server status", async () => {
        mockClient.http.authedRequest.mockResolvedValue({
            enabled: true,
            endpoint: "https://policy.example.com",
            fail_mode: "fail_closed",
        });

        const result = await manager.getStatus();

        expect(result.enabled).toBe(true);
        expect(result.endpoint).toBe("https://policy.example.com");
        expect(result.fail_mode).toBe("fail_closed");
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(Method.Get, "/policy/status", undefined, undefined, {
            prefix: "/_synapse/admin/v1",
        });
    });

    it("getStatus() handles disabled policy server", async () => {
        mockClient.http.authedRequest.mockResolvedValue({
            enabled: false,
            endpoint: null,
            fail_mode: "fail_open",
        });

        const result = await manager.getStatus();

        expect(result.enabled).toBe(false);
        expect(result.endpoint).toBeNull();
        expect(result.fail_mode).toBe("fail_open");
    });

    it("check() validates request and returns policy result", async () => {
        mockClient.http.authedRequest.mockResolvedValue({
            allowed: false,
            result: "deny",
            reason: "policy violation",
        });

        const result = await manager.check({
            room_id: "!room:example.com",
            user_id: "@alice:example.com",
            action: "join",
        });

        expect(result.allowed).toBe(false);
        expect(result.result).toBe("deny");
        expect(result.reason).toBe("policy violation");
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/policy/check",
            undefined,
            {
                room_id: "!room:example.com",
                user_id: "@alice:example.com",
                action: "join",
            },
            { prefix: "/_synapse/admin/v1" },
        );
    });

    it("check() rejects invalid action", async () => {
        // 创建一个无效类型的测试
        const invalidRequest = {
            room_id: "!room:example.com",
            user_id: "@alice:example.com",
            action: "invalid_action" as "create" | "join" | "invite" | "send",
        };
        await expect(manager.check(invalidRequest)).rejects.toThrow("Invalid action");
    });

    it("check() rejects empty room_id", async () => {
        await expect(
            manager.check({
                room_id: "",
                user_id: "@alice:example.com",
                action: "join",
            }),
        ).rejects.toThrow("room_id must not be empty");
    });

    it("check() rejects empty user_id", async () => {
        await expect(
            manager.check({
                room_id: "!room:example.com",
                user_id: "",
                action: "join",
            }),
        ).rejects.toThrow("user_id must not be empty");
    });

    it("check() accepts all valid actions", async () => {
        mockClient.http.authedRequest.mockResolvedValue({ allowed: true, result: "allow" });

        for (const action of ["create", "join", "invite", "send"] as const) {
            await manager.check({ room_id: "!room:example.com", user_id: "@alice:example.com", action });
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/policy/check",
                undefined,
                expect.objectContaining({ action }),
                expect.objectContaining({ prefix: "/_synapse/admin/v1" }),
            );
        }
    });
});
