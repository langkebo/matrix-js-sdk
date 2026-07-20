import { describe, it, expect, beforeEach, vi } from "vitest";

import { ToDeviceManager } from "../../src/to-device";
import { MatrixError } from "../../src/http-api/errors";
import { Method } from "../../src/http-api/method";
import { ClientPrefix } from "../../src/http-api/prefix";

describe("ToDeviceManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let manager: ToDeviceManager;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
        };
        manager = new ToDeviceManager(mockClient);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (manager as any).retryDelay = 0;
    });

    it("sends to-device via PUT /sendToDevice with correct path and body", async () => {
        const body = { "@u:hs": { "DEV-1": { body: "x" } } };
        mockClient.http.authedRequest.mockResolvedValue({});

        const result = await manager.sendToDevice("m.room.encrypted", body, "tx1");

        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Put,
            "/sendToDevice/m.room.encrypted/tx1",
            undefined,
            { messages: body },
            expect.objectContaining({ prefix: ClientPrefix.V3 }),
        );
        expect(result.success).toBe(true);
    });

    it("reports success:false when authedRequest returns null", async () => {
        mockClient.http.authedRequest.mockResolvedValue(null);

        const result = await manager.sendToDevice("m.room.encrypted", { "@u:hs": { d: {} } }, "tx1");

        expect(result.success).toBe(false);
    });

    it("passes through failures object from response", async () => {
        const failures = { "@u:hs": { d: { error: "device gone" } } };
        mockClient.http.authedRequest.mockResolvedValue({ failures });

        const result = await manager.sendToDevice("m.room.encrypted", { "@u:hs": { d: {} } }, "tx1");

        expect(result.success).toBe(true);
        expect(result.failures).toEqual(failures);
    });

    it("sends encrypted to-device via same PUT path", async () => {
        const body = { "@u:hs": { "DEV-1": { body: "x" } } };
        mockClient.http.authedRequest.mockResolvedValue({});

        await manager.sendEncryptedToDevice("m.room.encrypted", body, "tx2");

        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Put,
            "/sendToDevice/m.room.encrypted/tx2",
            undefined,
            { messages: body },
            expect.objectContaining({ prefix: ClientPrefix.V3 }),
        );
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

    it("normalizes auth errors", async () => {
        mockClient.http.authedRequest.mockRejectedValue(
            new MatrixError({ errcode: "M_UNKNOWN_TOKEN", error: "bad token" }, 401, undefined),
        );
        await expect(manager.sendToDevice("a", { "@u:hs": { d: {} } }, "t1")).rejects.toMatchObject({
            name: "AuthError",
        });
    });

    it("normalizes forbidden errors to ApiError", async () => {
        mockClient.http.authedRequest.mockRejectedValue(
            new MatrixError({ errcode: "M_FORBIDDEN", error: "403" }, 403, undefined),
        );
        await expect(manager.sendToDevice("a", { "@u:hs": { d: {} } }, "t2")).rejects.toMatchObject({
            name: "ApiError",
        });
    });

    it("normalizes unknown errors to ApiError", async () => {
        mockClient.http.authedRequest.mockRejectedValue(new Error("oops"));
        await expect(manager.sendToDevice("a", { "@u:hs": { d: {} } }, "t3")).rejects.toMatchObject({
            name: "ApiError",
        });
    });

    it("resets request stats", async () => {
        mockClient.http.authedRequest.mockResolvedValue({});
        await manager.sendToDevice("a", { "@u:hs": { d: {} } }, "t");
        expect(manager.getRequestStats().total).toBeGreaterThan(0);
        manager.resetRequestStats();
        expect(manager.getRequestStats()).toEqual({ total: 0, successful: 0, failed: 0, retried: 0 });
    });
});
