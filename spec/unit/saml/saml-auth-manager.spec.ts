/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { describe, it, expect, vi } from "vitest";

import { SamlAuthManager } from "../../../src/saml/index";
import { Method } from "../../../src/http-api/method";
import { ClientPrefix, AdminPrefix } from "../../../src/http-api/prefix";
import type { MatrixClient } from "../../../src/client";

// ---- Mock helpers ----

function makeHttp() {
    const fn = vi.fn();
    fn.mockResolvedValue({ redirect_url: "https://redirect.example.org" });
    return fn;
}

function makeClient(http: ReturnType<typeof makeHttp>) {
    const client = {
        http: {
            request: http,
            downloadUrl: vi.fn(),
            authedRequest: http,
        },
        getHomeserverUrl: () => "https://example.org",
        doesServerSupportUnstableFeature: vi.fn().mockResolvedValue(false),
        casServiceInfo: undefined,
        getCasAuthManager: vi.fn(),
    } as unknown as MatrixClient;
    return client;
}

function makeTransport(http: ReturnType<typeof makeHttp>) {
    return {
        request: http,
    };
}

function makeManager(http?: ReturnType<typeof makeHttp>, useTransport = false) {
    const h = http ?? makeHttp();
    const client = makeClient(h);
    const opts = useTransport ? { transport: makeTransport(h) } : undefined;
    const mgr = new SamlAuthManager(client, opts);
    return { mgr, client, http: h };
}

describe("SamlAuthManager", () => {
    describe("initiateLogin", () => {
        it("posts to POST /login/sso/redirect/saml", async () => {
            const http = makeHttp();
            const { mgr } = makeManager(http, true);
            http.mockResolvedValue({ redirect_url: "https://redirect.example.org" });
            const result = await mgr.initiateLogin("https://app.example.org/login");
            expect(http.mock.calls[0][0]).toBe(Method.Post);
            expect(http.mock.calls[0][1]).toBe("/login/sso/redirect/saml");
            expect(http.mock.calls[0][3]).toEqual({ redirectUrl: "https://app.example.org/login" });
            expect(result).toBe("https://redirect.example.org");
        });
    });

    describe("getLoginRedirectUrl", () => {
        it("generates correct SAML login redirect URL", () => {
            const { mgr } = makeManager();
            const url = mgr.getLoginRedirectUrl("https://app.example.org/login");
            expect(url).toBe("https://example.org/_matrix/client/v3/login/sso/redirect/saml?redirectUrl=https%3A%2F%2Fapp.example.org%2Flogin");
        });

        it("generates URL without params when redirectUrl is empty", () => {
            const { mgr } = makeManager();
            const url = mgr.getLoginRedirectUrl("");
            expect(url).toBe("https://example.org/_matrix/client/v3/login/sso/redirect/saml");
        });
    });

    describe("initiateLoginGet", () => {
        it("GET /login/sso/redirect/saml returns SamlLoginResponse", async () => {
            const http = makeHttp();
            const { mgr } = makeManager(http, true);
            http.mockResolvedValue({ redirect_url: "https://redirect.example.org" });
            const result = await mgr.initiateLoginGet("https://app.example.org/login");
            expect(http.mock.calls[0][0]).toBe(Method.Get);
            expect(http.mock.calls[0][1]).toBe("/login/sso/redirect/saml");
            expect(result.redirect_url).toBe("https://redirect.example.org");
        });
    });

    describe("getLogoutRedirectUrl", () => {
        it("generates SAML logout URL", () => {
            const { mgr } = makeManager();
            const url = mgr.getLogoutRedirectUrl("https://app.example.org/goodbye");
            expect(url).toBe("https://example.org/_matrix/client/v3/logout/saml?redirectUrl=https%3A%2F%2Fapp.example.org%2Fgoodbye");
        });

        it("generates logout URL without params", () => {
            const { mgr } = makeManager();
            const url = mgr.getLogoutRedirectUrl();
            expect(url).toBe("https://example.org/_matrix/client/v3/logout/saml");
        });
    });

    describe("initiateLogout", () => {
        it("GET /logout/saml returns SamlLogoutResponse", async () => {
            const http = makeHttp();
            const { mgr } = makeManager(http, true);
            http.mockResolvedValue({ redirect_url: "https://logout.example.org" });
            const result = await mgr.initiateLogout("https://app.example.org/goodbye");
            expect(http.mock.calls[0][0]).toBe(Method.Get);
            expect(http.mock.calls[0][1]).toBe("/logout/saml");
            expect(http.mock.calls[0][2]).toEqual({ redirectUrl: "https://app.example.org/goodbye" });
            expect(result.redirect_url).toBe("https://logout.example.org");
        });
    });

    describe("handleCallback", () => {
        it("POST /login/saml/callback with SAMLResponse and RelayState", async () => {
            const http = makeHttp();
            const { mgr } = makeManager(http, true);
            http.mockResolvedValue({ user_id: "@alice:example.org" });
            await mgr.handleCallback("response123", "state456");
            expect(http.mock.calls[0][0]).toBe(Method.Post);
            expect(http.mock.calls[0][1]).toBe("/login/saml/callback");
            expect(http.mock.calls[0][3]).toEqual({ SAMLResponse: "response123", RelayState: "state456" });
        });
    });

    describe("getLoginCallback", () => {
        it("GET /login/saml/callback with params", async () => {
            const http = makeHttp();
            const { mgr } = makeManager(http, true);
            http.mockResolvedValue({ user_id: "@alice:example.org" });
            await mgr.getLoginCallback({ saml_response: "abc", relay_state: "xyz" });
            expect(http.mock.calls[0][0]).toBe(Method.Get);
            expect(http.mock.calls[0][1]).toBe("/login/saml/callback");
            expect(http.mock.calls[0][2]).toEqual({ saml_response: "abc", relay_state: "xyz" });
        });
    });

    describe("getSsoRedirect", () => {
        it("GET /login/sso/redirect/saml returns redirect_url", async () => {
            const http = makeHttp();
            const { mgr } = makeManager(http, true);
            http.mockResolvedValue({ redirect_url: "https://sso.example.org/start" });
            const result = await mgr.getSsoRedirect("https://app.example.org/login");
            expect(http.mock.calls[0][0]).toBe(Method.Get);
            expect(http.mock.calls[0][1]).toBe("/login/sso/redirect/saml");
            expect(result).toBe("https://sso.example.org/start");
        });
    });

    describe("logout", () => {
        it("GET /logout/saml returns SamlLogoutResponse", async () => {
            const http = makeHttp();
            const { mgr } = makeManager(http, true);
            http.mockResolvedValue({ redirect_url: "https://logout.example.org" });
            await mgr.logout("https://app.example.org/goodbye");
            expect(http.mock.calls[0][0]).toBe(Method.Get);
            expect(http.mock.calls[0][1]).toBe("/logout/saml");
        });
    });

    describe("handleLogoutCallback", () => {
        it("GET /logout/saml/callback", async () => {
            const http = makeHttp();
            const { mgr } = makeManager(http, true);
            http.mockResolvedValue({});
            await mgr.handleLogoutCallback();
            expect(http.mock.calls[0][0]).toBe(Method.Get);
            expect(http.mock.calls[0][1]).toBe("/logout/saml/callback");
        });
    });

    describe("getIdpMetadata", () => {
        it("GET /saml/metadata returns SamlMetadata", async () => {
            const http = makeHttp();
            const { mgr } = makeManager(http, true);
            http.mockResolvedValue({ entity_id: "https://idp.example.org" });
            const result = await mgr.getIdpMetadata();
            expect(http.mock.calls[0][0]).toBe(Method.Get);
            expect(http.mock.calls[0][1]).toBe("/saml/metadata");
            expect(result.entity_id).toBe("https://idp.example.org");
        });
    });

    describe("getSpMetadata", () => {
        it("GET /saml/sp_metadata returns SamlSpMetadata", async () => {
            const http = makeHttp();
            const { mgr } = makeManager(http, true);
            http.mockResolvedValue({ entity_id: "https://sp.example.org" });
            await mgr.getSpMetadata();
            expect(http.mock.calls[0][0]).toBe(Method.Get);
            expect(http.mock.calls[0][1]).toBe("/saml/sp_metadata");
        });
    });

    describe("admin config", () => {
        it("getAdminConfig uses GET /saml/config with admin prefix", async () => {
            const http = makeHttp();
            const { mgr } = makeManager(http, true);
            http.mockResolvedValue({ enabled: true });
            await mgr.getAdminConfig();
            expect(http.mock.calls[0][0]).toBe(Method.Get);
            expect(http.mock.calls[0][1]).toBe("/saml/config");
        });

        it("updateAdminConfig uses PUT /saml/config", async () => {
            const http = makeHttp();
            const { mgr } = makeManager(http, true);
            http.mockResolvedValue({ enabled: true });
            await mgr.updateAdminConfig({ enabled: true });
            expect(http.mock.calls[0][0]).toBe(Method.Put);
            expect(http.mock.calls[0][1]).toBe("/saml/config");
            expect(http.mock.calls[0][3]).toEqual({ enabled: true });
        });
    });

    describe("metadata refresh", () => {
        it("refreshMetadata uses POST /saml/metadata/refresh", async () => {
            const http = makeHttp();
            const { mgr } = makeManager(http, true);
            http.mockResolvedValue({ refreshed: true });
            await mgr.refreshMetadata();
            expect(http.mock.calls[0][0]).toBe(Method.Post);
            expect(http.mock.calls[0][1]).toBe("/saml/metadata/refresh");
        });
    });

    describe("user mappings", () => {
        it("getUserMappings passes limit and from", async () => {
            const http = makeHttp();
            const { mgr } = makeManager(http, true);
            http.mockResolvedValue({ mappings: [], total: 0 });
            await mgr.getUserMappings(10, "cursor");
            expect(http.mock.calls[0][0]).toBe(Method.Get);
            expect(http.mock.calls[0][1]).toBe("/saml/mappings");
            expect(http.mock.calls[0][2]).toEqual({ limit: 10, from: "cursor" });
        });

        it("getUserMapping fetches specific mapping", async () => {
            const http = makeHttp();
            const { mgr } = makeManager(http, true);
            http.mockResolvedValue({ name_id: "alice", localpart: "alice" });
            await mgr.getUserMapping("alice@idp.example.org");
            expect(http.mock.calls[0][0]).toBe(Method.Get);
            expect(http.mock.calls[0][1]).toBe("/saml/mapping/alice%40idp.example.org");
        });

        it("updateUserMapping updates via PUT", async () => {
            const http = makeHttp();
            const { mgr } = makeManager(http, true);
            http.mockResolvedValue({ name_id: "alice", localpart: "alice_new" });
            await mgr.updateUserMapping("alice@idp.example.org", { localpart: "alice_new" });
            expect(http.mock.calls[0][0]).toBe(Method.Put);
            expect(http.mock.calls[0][1]).toBe("/saml/mapping/alice%40idp.example.org");
            expect(http.mock.calls[0][3]).toEqual({ localpart: "alice_new" });
        });

        it("removeUserMapping deletes via DELETE", async () => {
            const http = makeHttp();
            const { mgr } = makeManager(http, true);
            http.mockResolvedValue({});
            await mgr.removeUserMapping("alice@idp.example.org");
            expect(http.mock.calls[0][0]).toBe(Method.Delete);
            expect(http.mock.calls[0][1]).toBe("/saml/mapping/alice%40idp.example.org");
        });
    });

    describe("adminLogout", () => {
        it("POST /saml Logout with user_id body", async () => {
            const http = makeHttp();
            const { mgr } = makeManager(http, true);
            http.mockResolvedValue({});
            await mgr.adminLogout("@alice:example.org");
            expect(http.mock.calls[0][0]).toBe(Method.Post);
            expect(http.mock.calls[0][1]).toBe("/saml/logout");
            expect(http.mock.calls[0][3]).toEqual({ user_id: "@alice:example.org" });
        });
    });
});
