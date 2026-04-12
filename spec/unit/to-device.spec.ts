import { describe, it, expect, beforeEach, vi } from "vitest";

import { ToDeviceManager } from "../../src/to-device";
import { MatrixError } from "../../src/http-api/errors";

describe("ToDeviceManager", () => {
    let mockClient: any;
    let manager: ToDeviceManager;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
        };
        manager = new ToDeviceManager(mockClient);
        (manager as any).retryDelay = 0;
    });

    it("sends to-device and encrypted to-device", async () => {
        mockClient.http.authedRequest.mockResolvedValue({ success: true });
        const body = { "@u:hs": { "DEV-1": { body: "x" } } };
        await expect(manager.sendToDevice("m.room.encrypted", body, "tx1")).resolves.toEqual({ success: true });
        await expect(manager.sendEncryptedToDevice("m.room.encrypted", body, "tx2")).resolves.toEqual({
            success: true,
        });
        expect(manager.getRequestStats().successful).toBe(2);
    });

    it("sends batch and reports per-item failures", async () => {
        mockClient.http.authedRequest.mockResolvedValueOnce({ success: true }).mockRejectedValueOnce(new Error("boom"));
        const res = await manager.sendBatchToDevice([
            { eventType: "a", batch: { "@u:hs": { d: {} } } },
            { eventType: "b", batch: { "@u:hs": { d: {} } } },
        ]);
        expect(res).toHaveLength(2);
        expect(res[0].success).toBe(true);
        expect(res[1].success).toBe(false);
    });

    it("normalizes auth/api/unknown errors", async () => {
        mockClient.http.authedRequest.mockRejectedValue(
            new MatrixError({ errcode: "M_UNKNOWN_TOKEN", error: "bad token" }, 401, undefined),
        );
        await expect(manager.sendToDevice("a", { "@u:hs": { d: {} } }, "t1")).rejects.toMatchObject({
            name: "AuthError",
        });

        mockClient.http.authedRequest.mockRejectedValue(
            new MatrixError({ errcode: "M_FORBIDDEN", error: "403" }, 403, undefined),
        );
        await expect(manager.sendToDevice("a", { "@u:hs": { d: {} } }, "t2")).rejects.toMatchObject({
            name: "ApiError",
        });

        mockClient.http.authedRequest.mockRejectedValue(new Error("oops"));
        await expect(manager.sendToDevice("a", { "@u:hs": { d: {} } }, "t3")).rejects.toMatchObject({
            name: "ApiError",
        });
    });

    it("resets request stats", async () => {
        mockClient.http.authedRequest.mockResolvedValue({ success: true });
        await manager.sendToDevice("a", { "@u:hs": { d: {} } }, "t");
        expect(manager.getRequestStats().total).toBeGreaterThan(0);
        manager.resetRequestStats();
        expect(manager.getRequestStats()).toEqual({ total: 0, successful: 0, failed: 0, retried: 0 });
    });
});
