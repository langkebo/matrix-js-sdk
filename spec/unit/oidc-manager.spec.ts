import { beforeEach, describe, expect, it, vi } from "vitest";

import { OidcManager } from "../../src/oidc/manager";
import { Method } from "../../src/http-api/method";
import { ClientPrefix } from "../../src/http-api/prefix";

describe("OidcManager", () => {
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

    it("discover uses the public well-known endpoint", async () => {
        request.mockResolvedValueOnce({ issuer: "https://issuer.example.com" });

        await manager.discover();

        expect(request).toHaveBeenCalledWith(Method.Get, "/.well-known/openid-configuration", undefined, undefined, {
            prefix: "",
        });
        expect(authedRequest).not.toHaveBeenCalled();
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

    it("ssoRedirect uses request() on the public v3 redirect route", async () => {
        request.mockResolvedValueOnce({ url: "https://issuer.example.com/sso" });

        await manager.ssoRedirect("https://app.example.com/after-login");

        expect(request).toHaveBeenCalledWith(
            Method.Get,
            "/login/sso/redirect",
            { redirectUrl: "https://app.example.com/after-login" },
            undefined,
            { prefix: ClientPrefix.V3 },
        );
    });

    it("buildCallbackUrl binds the v3 callback route", () => {
        expect(manager.buildCallbackUrl("code-1", "state-1")).toBe(
            "https://hs.example.com/_matrix/client/v3/oidc/callback?code=code-1&state=state-1",
        );
    });
});
