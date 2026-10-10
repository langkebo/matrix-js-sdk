import { beforeEach, describe, expect, it, vi } from "vitest";

import { OidcManager } from "../../src/oidc/manager";
import { Method } from "../../src/http-api/method";
import { ClientPrefix } from "../../src/http-api/prefix";

describe("OidcManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let manager: OidcManager;
    let request: ReturnType<typeof vi.fn>;
    let authedRequest: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        request = vi.fn().mockResolvedValue({});
        authedRequest = vi.fn().mockResolvedValue({});
        mockClient = {
            baseUrl: "https://hs.example.com/",
            http: { request, authedRequest },
        };
        manager = new OidcManager(mockClient);
        manager.setRetryOptions({ maxRetries: 0 });
    });

    it("authorize uses request() on the public v3 authorize route", async () => {
        request.mockResolvedValueOnce({ url: "https://issuer.example.com/authorize" });

        await manager.authorize({
            client_id: "client",
            redirect_uri: "https://app.example.com/callback",
            response_type: "code",
            scope: "openid profile",
            state: "state-1",
        });

        expect(request).toHaveBeenCalledWith(
            Method.Get,
            "/oidc/authorize",
            {
                client_id: "client",
                redirect_uri: "https://app.example.com/callback",
                response_type: "code",
                scope: "openid profile",
                state: "state-1",
            },
            undefined,
            { prefix: ClientPrefix.V3 },
        );
        expect(authedRequest).not.toHaveBeenCalled();
    });

    it("builtinLogin uses request() on the public v3 login route", async () => {
        request.mockResolvedValueOnce({ code: "auth-code" });

        await manager.builtinLogin({
            client_id: "client",
            redirect_uri: "https://app.example.com/callback",
            username: "alice",
            password: "secret",
        });

        expect(request).toHaveBeenCalledWith(
            Method.Post,
            "/oidc/login",
            undefined,
            {
                client_id: "client",
                redirect_uri: "https://app.example.com/callback",
                scope: "openid",
                state: undefined,
                nonce: undefined,
                code_verifier: undefined,
                username: "alice",
                password: "secret",
            },
            { prefix: ClientPrefix.V3 },
        );
    });

    it("ssoRedirect 是纯 URL 构造器：不发请求，返回可交给浏览器跳转的绝对地址（W-05）", () => {
        // 后端 `sso_redirect` 恒返回 302（oidc/sso.rs:108-137），旧实现当 JSON 读 `response.url`
        // ⇒ 恒 undefined。改成 URL 构造器后**不得再发任何请求**。
        const url = manager.ssoRedirect("https://app.example.com/after-login");

        expect(url).toBe(
            "https://hs.example.com/_matrix/client/v3/login/sso/redirect?redirectUrl=https%3A%2F%2Fapp.example.com%2Fafter-login",
        );
        expect(request).not.toHaveBeenCalled();
    });

    it("ssoRedirect 无 redirectUrl 时不拼查询串", () => {
        expect(manager.ssoRedirect()).toBe("https://hs.example.com/_matrix/client/v3/login/sso/redirect");
        expect(request).not.toHaveBeenCalled();
    });

    it("buildCallbackUrl binds the v3 callback route", () => {
        expect(manager.buildCallbackUrl("code-1", "state-1")).toBe(
            "https://hs.example.com/_matrix/client/v3/oidc/callback?code=code-1&state=state-1",
        );
    });
});
