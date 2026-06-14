import { describe, it, expect, beforeEach, vi } from "vitest";

import { CaptchaManager } from "../../src/captcha/index";
import { Method } from "../../src/http-api/method";
import { AdminPrefix, ClientPrefix } from "../../src/http-api/prefix";

type MockCaptchaClient = {
    http: {
        authedRequest: ReturnType<typeof vi.fn>;
        request: ReturnType<typeof vi.fn>;
    };
};

describe("CaptchaManager", () => {
    let mockClient: MockCaptchaClient;
    let manager: CaptchaManager;
    let authedRequest: ReturnType<typeof vi.fn>;
    let request: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        authedRequest = vi.fn().mockResolvedValue({});
        request = vi.fn().mockResolvedValue({});
        mockClient = { http: { authedRequest, request } };
        manager = new CaptchaManager(mockClient as unknown as ConstructorParameters<typeof CaptchaManager>[0]);
    });

    it("sendCaptcha POSTs a public captcha challenge on v3", async () => {
        request.mockResolvedValue({ captcha_id: "c1", captcha_type: "image", expires_in: 300 });
        const result = await manager.sendCaptcha("image", "+8612345678900");
        expect(result).toBeTypeOf("object");
        expect(request).toHaveBeenCalledWith(
            Method.Post,
            "/register/captcha/send",
            undefined,
            { captcha_type: "image", target: "+8612345678900" },
            { prefix: ClientPrefix.V3 },
        );
        expect(authedRequest).not.toHaveBeenCalled();
    });

    it("verifyCaptcha POSTs captchaId + code via public request", async () => {
        request.mockResolvedValue({ verified: true });
        const result = await manager.verifyCaptcha("c1", "1234");
        expect(result).toBeTypeOf("object");
        expect(request).toHaveBeenCalledWith(
            Method.Post,
            "/register/captcha/verify",
            undefined,
            { captcha_id: "c1", code: "1234" },
            { prefix: ClientPrefix.V3 },
        );
        expect(authedRequest).not.toHaveBeenCalled();
    });

    it("getCaptchaStatus sends captcha_id as public query param on v3", async () => {
        request.mockResolvedValue({ status: "pending" });
        await manager.getCaptchaStatus("c1");
        expect(request).toHaveBeenCalledWith(
            Method.Get,
            "/register/captcha/status",
            { captcha_id: "c1" },
            undefined,
            { prefix: ClientPrefix.V3 },
        );
        expect(authedRequest).not.toHaveBeenCalled();
    });

    it("allows callers to select the r0 public captcha route explicitly", async () => {
        request.mockResolvedValue({ verified: true });
        await manager.verifyCaptcha("c1", "1234", "r0");

        expect(request).toHaveBeenCalledWith(
            Method.Post,
            "/register/captcha/verify",
            undefined,
            { captcha_id: "c1", code: "1234" },
            { prefix: ClientPrefix.R0 },
        );
    });

    it("cleanupExpiredCaptchas uses the admin v1 route", async () => {
        authedRequest.mockResolvedValue({ cleaned_count: 42, message: "Cleaned up 42 expired captchas" });
        await manager.cleanupExpiredCaptchas();
        expect(authedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/captcha/cleanup",
            undefined,
            undefined,
            { prefix: AdminPrefix.V1 },
        );
    });
});
