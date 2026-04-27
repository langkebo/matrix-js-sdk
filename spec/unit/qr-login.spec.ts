import { describe, it, expect, beforeEach, vi } from "vitest";

import { QrLoginManager } from "../../src/qr-login/index";

describe("QrLoginManager", () => {
    let mockClient: any;
    let manager: QrLoginManager;
    let authedRequest: ReturnType<typeof vi.fn>;
    let request: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        authedRequest = vi.fn().mockResolvedValue({});
        request = vi.fn().mockResolvedValue({});
        mockClient = { http: { authedRequest, request } };
        manager = new QrLoginManager(mockClient);
    });

    it("getQrCode GETs /login/get_qr_code", async () => {
        authedRequest.mockResolvedValue({ transaction_id: "tx-1", mode: "login", challenge: "abc", expires_in: 300 });
        const res = await manager.getQrCode();
        expect(res.transaction_id).toBeDefined();
        expect(authedRequest.mock.calls[0][0]).toBe("GET");
        expect(authedRequest.mock.calls[0][1]).toBe("/login/get_qr_code");
    });

    it("startQrLogin POSTs to /login/qr/start (unauthenticated)", async () => {
        request.mockResolvedValue({ transaction_id: "tx-1" });
        await manager.startQrLogin({ device_id: "D1" } as any);
        expect(request.mock.calls[0][0]).toBe("POST");
        expect(request.mock.calls[0][1]).toBe("/login/qr/start");
        expect(request.mock.calls[0][3]).toEqual({ device_id: "D1" });
    });

    it("confirmQrLogin uses authedRequest", async () => {
        await manager.confirmQrLogin({ transaction_id: "tx-1" } as any);
        expect(authedRequest).toHaveBeenCalled();
    });

    it("getQrStatus GETs /login/qr/status/{txn}", async () => {
        request.mockResolvedValue({ status: "pending" });
        await manager.getQrStatus("tx-42");
        expect(request.mock.calls[0][0]).toBe("GET");
        expect(request.mock.calls[0][1]).toContain("tx-42");
    });

    it("invalidateQrLogin uses authedRequest", async () => {
        await manager.invalidateQrLogin({ transaction_id: "tx-1" } as any);
        expect(authedRequest).toHaveBeenCalled();
    });
});
