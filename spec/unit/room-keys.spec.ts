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
        await manager.createRoomKeyRequest({ room_id: "!r:hs", session_id: "s1" });
        expect(mockClient.http.authedRequest).toHaveBeenCalled();

        expect(manager.getCacheStats().size).toBeGreaterThanOrEqual(0);
        expect(manager.getRequestStats().total).toBeGreaterThan(0);
        manager.clearCache();
        manager.resetRequestStats();
        expect(manager.getRequestStats().total).toBe(0);
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

    it("normalizes unknown errors", async () => {
        mockClient.http.authedRequest.mockRejectedValue(new Error("boom"));
        await expect(manager.getRoomKeyRequests(true)).rejects.toMatchObject({ name: "ApiError" });
    });
});
