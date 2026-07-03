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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { FakeTransport } from "../test-utils/FakeTransport";
import { SamlAuthManager } from "../../src/saml/index";
import { Method } from "../../src/http-api/method";

describe("SamlAuthManager", () => {
    let transport: FakeTransport;
    let manager: SamlAuthManager;
    let mockClient: any;

    beforeEach(() => {
        transport = new FakeTransport();
        mockClient = {
            getHomeserverUrl: vi.fn().mockReturnValue("https://matrix.test"),
        };
        manager = new SamlAuthManager(mockClient, { transport });
    });

    describe("client prefix endpoints", () => {
        it("initiateLogin should POST /login/sso/redirect/saml and return redirect_url", async () => {
            transport.respondWith({ redirect_url: "https://idp.test/saml" });

            const result = await manager.initiateLogin("https://app.test/callback");

            expect(result).toBe("https://idp.test/saml");
            expect(transport.request).toHaveBeenCalledWith(
                Method.Post,
                "/login/sso/redirect/saml",
                undefined,
                { redirectUrl: "https://app.test/callback" },
                expect.objectContaining({ prefix: "/_matrix/client/r0" }),
            );
        });

        it("handleCallback should POST /login/saml/callback with SAMLResponse", async () => {
            transport.respondWith({ access_token: "abc123", user_id: "@alice:example.com" });

            const result = await manager.handleCallback("<saml>response</saml>", "relay-state-123");

            expect(result.access_token).toBe("abc123");
            expect(transport.request).toHaveBeenCalledWith(
                Method.Post,
                "/login/saml/callback",
                undefined,
                { SAMLResponse: "<saml>response</saml>", RelayState: "relay-state-123" },
                expect.objectContaining({ prefix: "/_matrix/client/r0" }),
            );
        });

        it("getLoginCallback should GET /login/saml/callback with query params", async () => {
            transport.respondWith({ access_token: "abc456", user_id: "@bob:example.com" });

            const result = await manager.getLoginCallback({ SAMLResponse: "encoded", RelayState: "relay" });

            expect(result.access_token).toBe("abc456");
            expect(transport.request).toHaveBeenCalledWith(
                Method.Get,
                "/login/saml/callback",
                { SAMLResponse: "encoded", RelayState: "relay" },
                undefined,
                expect.objectContaining({ prefix: "/_matrix/client/r0" }),
            );
        });

        it("getSsoRedirect should GET /login/sso/redirect/saml and return redirect_url", async () => {
            transport.respondWith({ redirect_url: "https://idp.test/saml?sp=app" });

            const result = await manager.getSsoRedirect("https://app.test/callback");

            expect(result).toBe("https://idp.test/saml?sp=app");
            expect(transport.request).toHaveBeenCalledWith(
                Method.Get,
                "/login/sso/redirect/saml",
                { redirectUrl: "https://app.test/callback" },
                undefined,
                expect.objectContaining({ prefix: "/_matrix/client/r0" }),
            );
        });

        it("logout should GET /logout/saml", async () => {
            transport.respondWith({});

            const result = await manager.logout("https://app.test/bye");

            expect(result).toEqual({});
            expect(transport.request).toHaveBeenCalledWith(
                Method.Get,
                "/logout/saml",
                { redirectUrl: "https://app.test/bye" },
                undefined,
                expect.objectContaining({ prefix: "/_matrix/client/r0" }),
            );
        });

        it("getIdpMetadata should GET /saml/metadata", async () => {
            transport.respondWith({ entityId: "https://idp.test/metadata", ssoUrl: "https://idp.test/sso" });

            const result = await manager.getIdpMetadata();

            expect(result.entityId).toBe("https://idp.test/metadata");
            expect(transport.request).toHaveBeenCalledWith(
                Method.Get,
                "/saml/metadata",
                undefined,
                undefined,
                expect.objectContaining({ prefix: "/_matrix/client/r0" }),
            );
        });

        it("getSpMetadata should GET /saml/sp_metadata", async () => {
            transport.respondWith({ entityId: "https://sp.test/metadata", acsUrl: "https://sp.test/acs" });

            const result = await manager.getSpMetadata();

            expect(result.entityId).toBe("https://sp.test/metadata");
            expect(transport.request).toHaveBeenCalledWith(
                Method.Get,
                "/saml/sp_metadata",
                undefined,
                undefined,
                expect.objectContaining({ prefix: "/_matrix/client/r0" }),
            );
        });

        it("getLoginRedirectUrl should return a URL with encoded redirectUrl parameter", () => {
            const url = manager.getLoginRedirectUrl("https://app.test/callback");
            expect(url).toBe(
                "https://matrix.test/_matrix/client/r0/login/sso/redirect/saml?redirectUrl=https%3A%2F%2Fapp.test%2Fcallback",
            );
        });
    });

    describe("admin prefix endpoints", () => {
        it("getAdminConfig should GET /saml/config with admin prefix", async () => {
            transport.respondWith({ enabled: true, entity_id: "https://sp.test" });

            const result = await manager.getAdminConfig();

            expect(result.enabled).toBe(true);
            expect(transport.request).toHaveBeenCalledWith(
                Method.Get,
                "/saml/config",
                undefined,
                undefined,
                expect.objectContaining({ prefix: "/_synapse/admin/v1" }),
            );
        });

        it("updateAdminConfig should PUT /saml/config with body", async () => {
            const config = { enabled: true };
            transport.respondWith({ enabled: true, entity_id: "https://sp.test" });

            const result = await manager.updateAdminConfig(config);

            expect(result.enabled).toBe(true);
            expect(transport.request).toHaveBeenCalledWith(
                Method.Put,
                "/saml/config",
                undefined,
                config,
                expect.objectContaining({ prefix: "/_synapse/admin/v1" }),
            );
        });

        it("refreshMetadata should POST /saml/metadata/refresh", async () => {
            transport.respondWith({ status: "ok" });

            const result = await manager.refreshMetadata();

            expect(result).toEqual({ status: "ok" });
            expect(transport.request).toHaveBeenCalledWith(
                Method.Post,
                "/saml/metadata/refresh",
                undefined,
                undefined,
                expect.objectContaining({ prefix: "/_synapse/admin/v1" }),
            );
        });

        it("getUserMappings should GET /saml/mappings with limit and from", async () => {
            transport.respondWith({ mappings: [], total: 0, next_token: "next" });

            const result = await manager.getUserMappings(10, "tok_abc");

            expect(result).toEqual({ mappings: [], total: 0, next_token: "next" });
            expect(transport.request).toHaveBeenCalledWith(
                Method.Get,
                "/saml/mappings",
                { limit: 10, from: "tok_abc" },
                undefined,
                expect.objectContaining({ prefix: "/_synapse/admin/v1" }),
            );
        });

        it("getUserMappings without params should omit query params", async () => {
            transport.respondWith({ mappings: [] });

            await manager.getUserMappings();

            expect(transport.request).toHaveBeenCalledWith(
                Method.Get,
                "/saml/mappings",
                {},
                undefined,
                expect.objectContaining({ prefix: "/_synapse/admin/v1" }),
            );
        });

        it("getUserMapping should GET /saml/mapping/{nameId}", async () => {
            transport.respondWith({ name_id: "saml|alice", user_id: "@alice:example.com" });

            const result = await manager.getUserMapping("saml|alice");

            expect(result.name_id).toBe("saml|alice");
            expect(transport.request).toHaveBeenCalledWith(
                Method.Get,
                "/saml/mapping/saml%7Calice",
                undefined,
                undefined,
                expect.objectContaining({ prefix: "/_synapse/admin/v1" }),
            );
        });

        it("updateUserMapping should PUT /saml/mapping/{nameId} with body", async () => {
            const mapping = { user_id: "@alice:example.com" };
            transport.respondWith({ name_id: "saml|alice", user_id: "@alice:example.com" });

            const result = await manager.updateUserMapping("saml|alice", mapping);

            expect(result.user_id).toBe("@alice:example.com");
            expect(transport.request).toHaveBeenCalledWith(
                Method.Put,
                "/saml/mapping/saml%7Calice",
                undefined,
                mapping,
                expect.objectContaining({ prefix: "/_synapse/admin/v1" }),
            );
        });

        it("removeUserMapping should DELETE /saml/mapping/{nameId}", async () => {
            transport.respondWith({});

            await manager.removeUserMapping("saml|alice");

            expect(transport.request).toHaveBeenCalledWith(
                Method.Delete,
                "/saml/mapping/saml%7Calice",
                undefined,
                undefined,
                expect.objectContaining({ prefix: "/_synapse/admin/v1" }),
            );
        });

        it("adminLogout should POST /saml/logout with user_id", async () => {
            transport.respondWith({});

            await manager.adminLogout("@user:example.com");

            expect(transport.request).toHaveBeenCalledWith(
                Method.Post,
                "/saml/logout",
                undefined,
                { user_id: "@user:example.com" },
                expect.objectContaining({ prefix: "/_synapse/admin/v1" }),
            );
        });
    });

    describe("URL prefix integrity", () => {
        it("should not embed prefix in the path for client endpoints", async () => {
            transport.respondWith({ redirect_url: "https://idp.test" });

            await manager.initiateLogin();

            const call = transport.request.mock.calls[0];
            const path = call[1];
            const opts = call[4];

            expect(path).not.toContain("_matrix/client");
            expect(opts!.prefix).toBe("/_matrix/client/r0");
        });

        it("should not embed prefix in the path for admin endpoints", async () => {
            transport.respondWith({ enabled: true });

            await manager.getAdminConfig();

            const call = transport.request.mock.calls[0];
            const path = call[1];
            const opts = call[4];

            expect(path).not.toContain("_synapse/admin");
            expect(opts!.prefix).toBe("/_synapse/admin/v1");
        });
    });

    describe("handleLogoutCallback", () => {
        it("should GET /logout/saml/callback", async () => {
            transport.respondWith({});

            await manager.handleLogoutCallback();

            expect(transport.request).toHaveBeenCalledWith(
                Method.Get,
                "/logout/saml/callback",
                undefined,
                undefined,
                expect.objectContaining({ prefix: "/_matrix/client/r0" }),
            );
        });
    });
});
