import { beforeEach, describe, expect, it, vi } from "vitest";

import { CasManager } from "../../src/cas/index";
import { Method } from "../../src/http-api/method";
import { AdminPrefix } from "../../src/http-api/prefix";

describe("CasManager", () => {
    let mockClient: any;
    let manager: CasManager;
    let authedRequest: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        authedRequest = vi.fn().mockResolvedValue({});
        mockClient = {
            baseUrl: "https://hs.example.com/",
            http: { authedRequest },
        };
        manager = new CasManager(mockClient);
        manager.setRetryOptions({ maxRetries: 0 });
    });

    it("registerService uses the admin v1 route", async () => {
        authedRequest.mockResolvedValueOnce({ service_id: "svc", name: "CAS", service_url_pattern: "https://app/*" });

        await manager.registerService({
            service_id: "svc",
            name: "CAS",
            service_url_pattern: "https://app/*",
        });

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/cas/services",
            undefined,
            {
                service_id: "svc",
                name: "CAS",
                service_url_pattern: "https://app/*",
            },
            { prefix: AdminPrefix.V1 },
        );
    });

    it("listServices uses the admin v1 list route and returns arrays", async () => {
        authedRequest.mockResolvedValueOnce([{ service_id: "svc", name: "CAS", service_url_pattern: "https://app/*" }]);

        await expect(manager.listServices()).resolves.toEqual([
            { service_id: "svc", name: "CAS", service_url_pattern: "https://app/*" },
        ]);

        expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/cas/services", undefined, undefined, {
            prefix: AdminPrefix.V1,
        });
    });

    it("deleteService uses the admin v1 delete route with encoded service id", async () => {
        await manager.deleteService("svc/1");

        expect(authedRequest).toHaveBeenCalledWith(Method.Delete, "/cas/services/svc%2F1", undefined, undefined, {
            prefix: AdminPrefix.V1,
        });
    });

    it("setUserAttribute posts attributes on the admin v1 user route", async () => {
        authedRequest.mockResolvedValueOnce({
            user_id: "@alice:example.com",
            attribute_name: "department",
            attribute_value: "eng",
        });

        await expect(
            manager.setUserAttribute("@alice:example.com", {
                attribute_name: "department",
                attribute_value: "eng",
            }),
        ).resolves.toEqual({
            user_id: "@alice:example.com",
            attribute_name: "department",
            attribute_value: "eng",
        });

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/cas/users/%40alice%3Aexample.com/attributes",
            undefined,
            { attribute_name: "department", attribute_value: "eng" },
            { prefix: AdminPrefix.V1 },
        );
    });

    it("getUserAttributes reads attributes from the admin v1 user route", async () => {
        authedRequest.mockResolvedValueOnce([{ name: "department", value: "eng" }]);

        await expect(manager.getUserAttributes("@alice:example.com")).resolves.toEqual([
            { name: "department", value: "eng" },
        ]);

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/cas/users/%40alice%3Aexample.com/attributes",
            undefined,
            undefined,
            { prefix: AdminPrefix.V1 },
        );
    });

    it("buildLoginUrl binds the public login route", () => {
        expect(manager.buildLoginUrl("https://app.example.com/callback")).toBe(
            "https://hs.example.com/login?service=https%3A%2F%2Fapp.example.com%2Fcallback",
        );
    });

    it("buildLogoutUrl binds the public logout route", () => {
        expect(manager.buildLogoutUrl("https://app.example.com/bye")).toBe(
            "https://hs.example.com/logout?service=https%3A%2F%2Fapp.example.com%2Fbye",
        );
        expect(manager.buildLogoutUrl()).toBe("https://hs.example.com/logout");
    });

    it("buildValidateUrl binds CAS protocol validation routes", () => {
        expect(manager.buildValidateUrl("serviceValidate", "ST-1", "https://app.example.com/callback")).toBe(
            "https://hs.example.com/serviceValidate?ticket=ST-1&service=https%3A%2F%2Fapp.example.com%2Fcallback",
        );
        expect(manager.buildValidateUrl("proxyValidate", "PT-1", "https://app.example.com/callback")).toContain(
            "/proxyValidate?ticket=PT-1&service=",
        );
        expect(manager.buildValidateUrl("p3/serviceValidate", "ST-2", "https://app.example.com/callback")).toContain(
            "/p3/serviceValidate?ticket=ST-2&service=",
        );
        expect(manager.buildValidateUrl("proxy", "PGT-1", "https://app.example.com/callback")).toContain(
            "/proxy?ticket=PGT-1&service=",
        );
    });
});
