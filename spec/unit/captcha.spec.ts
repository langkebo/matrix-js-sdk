import { describe, it, expect, beforeEach, vi } from "vitest";

import { CaptchaManager } from "../../src/captcha/index";

describe("CaptchaManager", () => {
    let mockClient: any;
    let manager: CaptchaManager;
    let authedRequest: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        authedRequest = vi.fn().mockResolvedValue({});
        mockClient = { http: { authedRequest, request: authedRequest } };
        manager = new CaptchaManager(mockClient);
    });

    it("sendCaptcha POSTs a captcha challenge", async () => {
        authedRequest.mockResolvedValue({ captcha_id: "c1", type: "image" });
        const result: any = await (manager as any).sendCaptcha({
            target: "+8612345678900",
            type: "image",
        });
        expect(result).toBeTypeOf("object");
        expect(authedRequest).toHaveBeenCalled();
    });

    it("verifyCaptcha POSTs captchaId + code", async () => {
        authedRequest.mockResolvedValue({ verified: true });
        const result = await manager.verifyCaptcha("c1", "1234");
        expect(result).toBeTypeOf("object");
        const call = authedRequest.mock.calls[0];
        expect(call[0]).toBe("POST");
        expect(typeof call[1]).toBe("string");
    });

    it("getCaptchaStatus sends captcha_id as query param", async () => {
        authedRequest.mockResolvedValue({ status: "pending" });
        await manager.getCaptchaStatus("c1");
        expect(authedRequest.mock.calls[0][0]).toBe("GET");
        expect(authedRequest.mock.calls[0][1]).toBe("/register/captcha/status");
        expect(authedRequest.mock.calls[0][2]).toEqual({ captcha_id: "c1" });
    });
});
