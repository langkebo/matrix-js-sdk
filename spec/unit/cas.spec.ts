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
import { CasManager } from "../../src/cas/index";
import { Method } from "../../src/http-api/method";

describe("CasManager", () => {
    let transport: FakeTransport;
    let manager: CasManager;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;

    beforeEach(() => {
        transport = new FakeTransport();
        mockClient = {
            getHomeserverUrl: vi.fn().mockReturnValue("https://matrix.test"),
        };
        manager = new CasManager(mockClient, { transport });
    });

    describe("synapse_admin prefix (default)", () => {
        it("listServices should send GET /cas/services with admin prefix", async () => {
            transport.respondWith({
                services: [{ id: "1", name: "Test", service_url: "https://sso.test", enabled: true }],
            });

            const result = await manager.listServices();

            expect(result.services).toHaveLength(1);
            expect(result.services[0].name).toBe("Test");
            expect(transport.request).toHaveBeenCalledWith(
                Method.Get,
                "/cas/services",
                undefined,
                undefined,
                expect.objectContaining({ prefix: "/_synapse/admin/v1" }),
            );
        });

        it("createService should send POST /cas/services with body（键名对齐后端 RegisterServiceBody）", async () => {
            // 后端 `RegisterServiceBody` 必填 `service_id` / `name` / `service_url_pattern`；
            // 缺必填或键名不符（如旧的 `service_url`）会被判 400。见方案文档 §9 P-09。
            const data = {
                service_id: "my-service",
                name: "My Service",
                service_url_pattern: "https://sso.example.com",
            };
            transport.respondWith({ id: "svc1", name: "My Service" });

            const result = await manager.createService(data);

            expect(result.id).toBe("svc1");
            expect(transport.request).toHaveBeenCalledWith(
                Method.Post,
                "/cas/services",
                undefined,
                data,
                expect.objectContaining({ prefix: "/_synapse/admin/v1" }),
            );
            // 钉住"发出的是后端声明的键"：不得出现旧键名
            const sentBody = (transport.request as ReturnType<typeof vi.fn>).mock.calls[0][3] as Record<
                string,
                unknown
            >;
            expect(Object.keys(sentBody).sort()).toEqual(["name", "service_id", "service_url_pattern"]);
        });

        it("deleteService should send DELETE /cas/services/{id}", async () => {
            transport.respondWith({ id: "svc1" });

            const result = await manager.deleteService("svc1");

            expect(result.id).toBe("svc1");
            expect(transport.request).toHaveBeenCalledWith(
                Method.Delete,
                "/cas/services/svc1",
                undefined,
                undefined,
                expect.objectContaining({ prefix: "/_synapse/admin/v1" }),
            );
        });

        it("deleteService should throw if serviceId is empty", async () => {
            await expect(manager.deleteService("")).rejects.toThrow("serviceId is required");
        });

        it("getUserAttributes should send GET /cas/users/{userId}/attributes", async () => {
            transport.respondWith({ user_id: "@alice:example.com", attributes: { email: ["alice@test.com"] } });

            const result = await manager.getUserAttributes("@alice:example.com");

            expect(result.user_id).toBe("@alice:example.com");
            expect(transport.request).toHaveBeenCalledWith(
                Method.Get,
                "/cas/users/%40alice%3Aexample.com/attributes",
                undefined,
                undefined,
                expect.objectContaining({ prefix: "/_synapse/admin/v1" }),
            );
        });

        it("getUserAttributes should throw if userId is empty", async () => {
            await expect(manager.getUserAttributes("")).rejects.toThrow("userId is required");
        });

        it("setUserAttributes should send POST /cas/users/{userId}/attributes with body", async () => {
            const data = { attributes: { email: ["bob@test.com"] } };
            transport.respondWith({ user_id: "@bob:example.com", attributes: { email: ["bob@test.com"] } });

            const result = await manager.setUserAttributes("@bob:example.com", data);

            expect(result.user_id).toBe("@bob:example.com");
            expect(transport.request).toHaveBeenCalledWith(
                Method.Post,
                "/cas/users/%40bob%3Aexample.com/attributes",
                undefined,
                data,
                expect.objectContaining({ prefix: "/_synapse/admin/v1" }),
            );
        });
    });

    describe("cas prefix", () => {
        it("服务管理面只认 `synapse_admin`；传 `cas` 现在是**编译错误**（P-13）", async () => {
            // 后端把服务/用户属性管理**只**注册在 `/_synapse/admin/v1/cas/…`，
            // `/_synapse/cas` 下只有协议面（cas.rs 路由表）⇒ 旧版本传 "cas" 必然 404。
            // 收窄 `CasServicePrefix` 后由 tsc 兜住：若哪天有人把 "cas" 加回联合类型，
            // 下面这行会从「预期报错」变成「不该报错」⇒ `pnpm lint:types` 立刻变红。
            // 用 `if (false)` 包住是为了**不真的发请求**（类型检查照样发生）。
            const casPrefixMustNotTypecheck = async (): Promise<void> => {
                // @ts-expect-error "cas" 不再是服务管理面的合法前缀
                await manager.listServices("cas");
            };
            expect(typeof casPrefixMustNotTypecheck).toBe("function");

            transport.respondWith({ services: [] });
            await manager.listServices("synapse_admin");
            expect(transport.request).toHaveBeenCalledWith(
                Method.Get,
                "/cas/services",
                undefined,
                undefined,
                expect.objectContaining({ prefix: "/_synapse/admin/v1" }),
            );
        });

        it("显式传 `synapse_admin` 与省略参数等价（路径与前缀都不变）", async () => {
            transport.respondWith({ services: [] });
            await manager.createService(
                { service_id: "svc", name: "S", service_url_pattern: "https://s.example.com" },
                "synapse_admin",
            );
            expect(transport.request).toHaveBeenCalledWith(
                Method.Post,
                "/cas/services",
                undefined,
                { service_id: "svc", name: "S", service_url_pattern: "https://s.example.com" },
                expect.objectContaining({ prefix: "/_synapse/admin/v1" }),
            );
        });

        it("serviceValidate should send GET /serviceValidate with query params", async () => {
            transport.respondWith({
                serviceResponse: { authenticationSuccess: { user: "alice" } },
            });

            const result = await manager.serviceValidate("https://app.test", "ST-123");

            expect(result.serviceResponse.authenticationSuccess?.user).toBe("alice");
            expect(transport.request).toHaveBeenCalledWith(
                Method.Get,
                "/serviceValidate",
                { service: "https://app.test", ticket: "ST-123" },
                undefined,
                expect.objectContaining({ prefix: "/_synapse/cas" }),
            );
        });

        it("serviceValidate should throw if service is empty", async () => {
            await expect(manager.serviceValidate("")).rejects.toThrow("service is required");
        });

        it("proxyValidate should send GET /proxyValidate with query params", async () => {
            transport.respondWith({
                serviceResponse: { authenticationSuccess: { user: "bob" } },
            });

            const result = await manager.proxyValidate("https://app.test", "PT-456", "https://pgt.test");

            expect(result.serviceResponse.authenticationSuccess?.user).toBe("bob");
            expect(transport.request).toHaveBeenCalledWith(
                Method.Get,
                "/proxyValidate",
                { service: "https://app.test", ticket: "PT-456", pgtUrl: "https://pgt.test" },
                undefined,
                expect.objectContaining({ prefix: "/_synapse/cas" }),
            );
        });

        it("p3ServiceValidate should send GET /p3/serviceValidate with query params", async () => {
            transport.respondWith({
                serviceResponse: { authenticationSuccess: { user: "charlie" } },
            });

            const result = await manager.p3ServiceValidate("https://app.test", undefined, undefined, true);

            expect(result.serviceResponse.authenticationSuccess?.user).toBe("charlie");
            expect(transport.request).toHaveBeenCalledWith(
                Method.Get,
                "/p3/serviceValidate",
                { service: "https://app.test", renew: "true" },
                undefined,
                expect.objectContaining({ prefix: "/_synapse/cas" }),
            );
        });

        it("proxy 下发后端声明的 query 键名 `target_service`（非 targetService）", async () => {
            // 后端 `ProxyQuery` 是 `{ target_service, pgt }`：发 `targetService` 会因
            // `target_service` 缺失而 400（方案文档 §9 P-07）。
            transport.respondWith({ proxyTicket: "PT-789" });

            const result = await manager.proxy("https://target.test", "PGT-123");

            expect(result.proxyTicket).toBe("PT-789");
            expect(transport.request).toHaveBeenCalledWith(
                Method.Get,
                "/proxy",
                { target_service: "https://target.test", pgt: "PGT-123" },
                undefined,
                expect.objectContaining({ prefix: "/_synapse/cas" }),
            );
        });

        it("proxy 无 pgt 时不发送 pgt 键（保持既有行为，不引入必填）", async () => {
            transport.respondWith({ proxyTicket: "PT-1" });

            await manager.proxy("https://target.test");

            const sentQuery = (transport.request as ReturnType<typeof vi.fn>).mock.calls[0][2] as Record<
                string,
                unknown
            >;
            expect(sentQuery).toEqual({ target_service: "https://target.test" });
        });

        it("handleLogout should send GET /logout with cas prefix", async () => {
            transport.respondWith({});

            await manager.handleLogout();

            expect(transport.request).toHaveBeenCalledWith(
                Method.Get,
                "/logout",
                undefined,
                undefined,
                expect.objectContaining({ prefix: "/_synapse/cas" }),
            );
        });
    });

    describe("getLoginUrl", () => {
        it("should return the CAS login URL without redirect", () => {
            const url = manager.getLoginUrl();
            expect(url).toBe("https://matrix.test/_synapse/cas/login");
        });

        it("should return the CAS login URL with redirect", () => {
            const url = manager.getLoginUrl("https://app.example.com/callback");
            expect(url).toBe(
                "https://matrix.test/_synapse/cas/login?redirectUrl=https%3A%2F%2Fapp.example.com%2Fcallback",
            );
        });
    });

    describe("URL prefix integrity", () => {
        it("should not embed prefix in the path for admin endpoints", async () => {
            transport.respondWith({ services: [] });

            await manager.listServices();

            const call = transport.request.mock.calls[0];
            const path = call[1];
            const opts = call[4];

            expect(path).not.toContain("_synapse/admin");
            expect(opts!.prefix).toBe("/_synapse/admin/v1");
        });

        it("should not embed prefix in the path for cas endpoints", async () => {
            transport.respondWith({
                serviceResponse: { authenticationSuccess: { user: "alice" } },
            });

            await manager.serviceValidate("https://test");

            const call = transport.request.mock.calls[0];
            const path = call[1];
            const opts = call[4];

            expect(path).not.toContain("_synapse/cas");
            expect(opts!.prefix).toBe("/_synapse/cas");
        });
    });
});
