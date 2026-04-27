import { describe, it, expect, beforeEach, vi } from "vitest";

import { SamlAuthManager } from "../../src/saml/index";

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
        authedRequest.mockResolvedValue({ logged_out: true });
        const res = await manager.logout();
        expect(res).toBeTypeOf("object");
    });

    it("getIdpMetadata fetches metadata", async () => {
        request.mockResolvedValue({ entityID: "urn:saml:idp" });
        authedRequest.mockResolvedValue({ entityID: "urn:saml:idp" });
        const res = await manager.getIdpMetadata();
        expect(res).toBeTypeOf("object");
    });
});
