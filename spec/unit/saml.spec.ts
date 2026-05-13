import { describe, it, expect, beforeEach, vi } from "vitest";

import { SamlAuthManager } from "../../src/saml/index";
import { Method } from "../../src/http-api/method";
import { AdminPrefix, ClientPrefix } from "../../src/http-api/prefix";

describe("SamlAuthManager", () => {
    let mockClient: any;
    let manager: SamlAuthManager;
    let request: ReturnType<typeof vi.fn>;
    let authedRequest: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        request = vi.fn().mockResolvedValue({});
        authedRequest = vi.fn().mockResolvedValue({});
        mockClient = { http: { request, authedRequest } };
        manager = new SamlAuthManager(mockClient);
    });

    it("initiateLogin issues an HTTP request", async () => {
        request.mockResolvedValue({ redirect_url: "https://idp/" });
        authedRequest.mockResolvedValue({ redirect_url: "https://idp/" });
        const res = await manager.initiateLogin();
        expect(res).toBeTypeOf("object");
        const called = request.mock.calls.length + authedRequest.mock.calls.length;
        expect(called).toBeGreaterThan(0);
    });

    it("handleCallback sends SAML response body", async () => {
        request.mockResolvedValue({ access_token: "tok", user_id: "@u:x" });
        authedRequest.mockResolvedValue({ access_token: "tok", user_id: "@u:x" });
        const res = await manager.handleCallback("<saml>...</saml>", "relay");
        expect(res).toBeTypeOf("object");
    });

    it("logout calls backend", async () => {
        request.mockResolvedValue({ logged_out: true });
        const res = await manager.logout();
        expect(res).toBeTypeOf("object");
        expect(request).toHaveBeenCalledWith(Method.Get, "/logout/saml", undefined, undefined, {
            prefix: ClientPrefix.R0,
        });
    });

    it("getIdpMetadata fetches metadata", async () => {
        request.mockResolvedValue({ entityID: "urn:saml:idp" });
        authedRequest.mockResolvedValue({ entityID: "urn:saml:idp" });
        const res = await manager.getIdpMetadata();
        expect(res).toBeTypeOf("object");
    });

    it("handleLogoutCallback uses the public r0 route", async () => {
        await manager.handleLogoutCallback("<logout />");

        expect(request).toHaveBeenCalledWith(Method.Get, "/logout/saml/callback", { saml_response: "<logout />" }, undefined, {
            prefix: ClientPrefix.R0,
        });
    });

    it("refreshMetadata uses the admin v1 route", async () => {
        await manager.refreshMetadata();

        expect(authedRequest).toHaveBeenCalledWith(Method.Post, "/saml/metadata/refresh", undefined, undefined, {
            prefix: AdminPrefix.V1,
        });
    });

    it("adminLogout uses the admin v1 route", async () => {
        await manager.adminLogout({ user_id: "@alice:example.com" });

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/saml/logout",
            undefined,
            { user_id: "@alice:example.com" },
            { prefix: AdminPrefix.V1 },
        );
    });
});
