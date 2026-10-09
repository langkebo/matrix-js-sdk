import { describe, it, expect, beforeEach, vi } from "vitest";

import { RoomKeysManager } from "../../src/room-keys";
import { MatrixError } from "../../src/http-api/errors";

describe("RoomKeysManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let manager: RoomKeysManager;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
        };
        manager = new RoomKeysManager(mockClient);
    });

    it("gets room key requests with cache", async () => {
        mockClient.http.authedRequest.mockResolvedValue({ requests: [{ request_id: "r1" }] });
        const first = await manager.getRoomKeyRequests();
        const second = await manager.getRoomKeyRequests();
        expect(first.requests).toHaveLength(1);
        expect(second.requests).toHaveLength(1);
        expect(mockClient.http.authedRequest).toHaveBeenCalledTimes(1);

        await manager.getRoomKeyRequests(true);
        expect(mockClient.http.authedRequest).toHaveBeenCalledTimes(2);
    });

    it("creates request and cache/stat helpers", async () => {
        mockClient.http.authedRequest.mockResolvedValue({});
        await manager.createRoomKeyRequest({ algorithm: "m.megolm.v1.aes-sha2", room_id: "!r:hs", session_id: "s1" });
        expect(mockClient.http.authedRequest).toHaveBeenCalled();

        // 线上键必须覆盖后端的三个必填字段（`algorithm` / `room_id` / `session_id`）。
        // 缺 `algorithm` 会被后端判 400（方案文档 §9 P-10）。
        const sentBody = mockClient.http.authedRequest.mock.calls[0][3] as Record<string, unknown>;
        expect(sentBody).toMatchObject({
            algorithm: "m.megolm.v1.aes-sha2",
            room_id: "!r:hs",
            session_id: "s1",
        });

        expect(manager.getCacheStats().size).toBeGreaterThanOrEqual(0);
        expect(manager.getRequestStats().total).toBeGreaterThan(0);
        manager.clearCache();
        manager.resetRequestStats();
        expect(manager.getRequestStats().total).toBe(0);
    });

    it("fail-fast：缺 algorithm / room_id / session_id 时本地抛 ValidationError（不发出 400）", async () => {
        await expect(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager.createRoomKeyRequest({ room_id: "!r:hs", session_id: "s1" } as any),
        ).rejects.toMatchObject({ name: "ValidationError" });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await expect(manager.createRoomKeyRequest({ algorithm: "a", session_id: "s1" } as any)).rejects.toMatchObject({
            name: "ValidationError",
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await expect(manager.createRoomKeyRequest({ algorithm: "a", room_id: "!r:hs" } as any)).rejects.toMatchObject({
            name: "ValidationError",
        });
        expect(mockClient.http.authedRequest).not.toHaveBeenCalled();
    });

    it("normalizes auth/notfound/api errors", async () => {
        mockClient.http.authedRequest.mockRejectedValue(
            new MatrixError({ errcode: "M_UNKNOWN_TOKEN", error: "bad token" }, 401, undefined),
        );
        await expect(manager.getRoomKeyRequests(true)).rejects.toMatchObject({ name: "AuthError" });

        mockClient.http.authedRequest.mockRejectedValue(
            new MatrixError({ errcode: "M_NOT_FOUND", error: "404" }, 404, undefined),
        );
        await expect(manager.getRoomKeyRequests(true)).rejects.toMatchObject({ name: "NotFoundError" });

        mockClient.http.authedRequest.mockRejectedValue(
            new MatrixError({ errcode: "M_FORBIDDEN", error: "403" }, 403, undefined),
        );
        await expect(manager.getRoomKeyRequests(true)).rejects.toMatchObject({ name: "ApiError" });
    });

    it("deletes a room key request", async () => {
        mockClient.http.authedRequest.mockResolvedValue({});
        await manager.deleteRoomKeyRequest("req-123");
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            "DELETE",
            "/room_keys/request/req-123",
            undefined,
            undefined,
            { prefix: "/_matrix/client/v3" },
        );
    });

    it("validates requestId before delete", async () => {
        await expect(manager.deleteRoomKeyRequest("")).rejects.toThrow("requestId is required");
    });
});
