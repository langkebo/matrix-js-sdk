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

import { AdminRoomManager } from "../../../../src/admin/sub-managers/admin-room-manager";

const ROOM = "!room:example.org";
const ENCODED_ROOM = "!room%3Aexample.org";

describe("AdminRoomManager.redactRoomEvents", () => {
    let manager: AdminRoomManager;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
        };
        mockClient.http.authedRequest.mockResolvedValue({ redacted: 0 });
        manager = new AdminRoomManager(mockClient);
    });

    it("POSTs to the C-S v3 admin redact path under the client prefix", async () => {
        await manager.redactRoomEvents(ROOM, { limit: 500 });

        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            "POST",
            `/admin/room/${ENCODED_ROOM}/redact`,
            undefined,
            { limit: 500 },
            { prefix: "/_matrix/client/v3" },
        );
    });

    // 回归守卫：该端点挂在 C-S v3 的 admin/ 子路径下，不是 /_synapse/admin/v1。
    // 若有人图省事改用 this.adminRequest()，前缀会被写死成 /_synapse/admin/v1，
    // 请求将打到不存在的路由上——这条断言就是为了钉住这一点。
    it("does not use the synapse admin prefix", async () => {
        await manager.redactRoomEvents(ROOM);

        const [, , , , opts] = mockClient.http.authedRequest.mock.calls[0];
        expect(opts.prefix).toBe("/_matrix/client/v3");
        expect(opts.prefix).not.toBe("/_synapse/admin/v1");
    });

    it("forwards before_ts / after_ts / reason to the request body", async () => {
        await manager.redactRoomEvents(ROOM, {
            before_ts: 1_700_000_000_000,
            after_ts: 1_600_000_000_000,
            reason: "abuse",
        });

        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            "POST",
            `/admin/room/${ENCODED_ROOM}/redact`,
            undefined,
            { before_ts: 1_700_000_000_000, after_ts: 1_600_000_000_000, reason: "abuse" },
            { prefix: "/_matrix/client/v3" },
        );
    });

    it("sends an empty body when no payload is supplied", async () => {
        await manager.redactRoomEvents(ROOM);

        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            "POST",
            `/admin/room/${ENCODED_ROOM}/redact`,
            undefined,
            {},
            { prefix: "/_matrix/client/v3" },
        );
    });

    it("returns the redacted count from the response", async () => {
        mockClient.http.authedRequest.mockResolvedValue({ redacted: 42 });

        await expect(manager.redactRoomEvents(ROOM)).resolves.toEqual({ redacted: 42 });
    });

    it("rejects a malformed room ID without hitting the network", async () => {
        await expect(manager.redactRoomEvents("not-a-room-id")).rejects.toThrow();
        expect(mockClient.http.authedRequest).not.toHaveBeenCalled();
    });

    it.each([0, -1, 10_001, 1.5, Number.NaN])(
        "rejects out-of-range limit %p without hitting the network",
        async (limit) => {
            await expect(manager.redactRoomEvents(ROOM, { limit })).rejects.toThrow(
                /limit must be an integer between 1 and 10000/,
            );
            expect(mockClient.http.authedRequest).not.toHaveBeenCalled();
        },
    );

    it.each([1, 10_000])("accepts the boundary limit %p", async (limit) => {
        await manager.redactRoomEvents(ROOM, { limit });

        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            "POST",
            `/admin/room/${ENCODED_ROOM}/redact`,
            undefined,
            { limit },
            { prefix: "/_matrix/client/v3" },
        );
    });

    it("percent-encodes the room ID in the path", async () => {
        // `=` 与 `:` 都是合法 localpart 字符，但 encodeURIComponent 会转义它们，
        // 所以这里既能通过校验、又能验证转义确实发生了。
        await manager.redactRoomEvents("!room=name:example.org");

        expect(mockClient.http.authedRequest.mock.calls[0][1]).toBe("/admin/room/!room%3Dname%3Aexample.org/redact");
    });
});
