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

import { AdminExternalServiceManager } from "../../../../src/admin/sub-managers/admin-external-service-manager";

describe("AdminExternalServiceManager", () => {
    let manager: AdminExternalServiceManager;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
        };
        manager = new AdminExternalServiceManager(mockClient);
    });

    it("listServices returns services with backend field names", async () => {
        mockClient.http.authedRequest.mockResolvedValue([
            {
                as_id: "srv1",
                service_type: "webhook",
                service_id: "wh1",
                display_name: "My Webhook",
                is_enabled: true,
                is_healthy: true,
                created_ts: 1700000000,
            },
        ]);
        const result = await manager.listServices();
        expect(result).toHaveLength(1);
        expect(result[0].as_id).toBe("srv1");
        expect(result[0].service_type).toBe("webhook");
    });

    it("listServices passes service_type filter", async () => {
        mockClient.http.authedRequest.mockResolvedValue([]);
        await manager.listServices("openclaw");
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            "GET",
            "/external_services",
            { service_type: "openclaw" },
            undefined,
            { prefix: "/_synapse/admin/v1" },
        );
    });

    it("listServices omits filter when serviceType is 'all'", async () => {
        mockClient.http.authedRequest.mockResolvedValue([]);
        await manager.listServices("all");
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            "GET",
            "/external_services",
            undefined,
            undefined,
            { prefix: "/_synapse/admin/v1" },
        );
    });

    it("registerService POSTs payload and returns created service", async () => {
        const payload = {
            service_type: "webhook",
            service_id: "wh1",
            display_name: "My Webhook",
        };
        const created = {
            as_id: "srv1",
            service_type: "webhook",
            service_id: "wh1",
            display_name: "My Webhook",
            is_enabled: true,
            is_healthy: false,
            created_ts: 1700000000,
        };
        mockClient.http.authedRequest.mockResolvedValue(created);
        const result = await manager.registerService(payload);
        expect(result).toEqual(created);
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            "POST",
            "/external_services",
            undefined,
            payload,
            { prefix: "/_synapse/admin/v1" },
        );
    });

    it("updateService PUTs payload to /external_services/{asId}", async () => {
        const payload = { is_enabled: false };
        const updated = {
            as_id: "srv1",
            service_type: "webhook",
            service_id: "wh1",
            display_name: "My Webhook",
            is_enabled: false,
            is_healthy: true,
            created_ts: 1700000000,
        };
        mockClient.http.authedRequest.mockResolvedValue(updated);
        const result = await manager.updateService("srv1", payload);
        expect(result).toEqual(updated);
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            "PUT",
            "/external_services/srv1",
            undefined,
            payload,
            { prefix: "/_synapse/admin/v1" },
        );
    });

    it("updateService URL-encodes asId", async () => {
        mockClient.http.authedRequest.mockResolvedValue({});
        await manager.updateService("a/b c", { is_enabled: true });
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            "PUT",
            "/external_services/a%2Fb%20c",
            undefined,
            { is_enabled: true },
            { prefix: "/_synapse/admin/v1" },
        );
    });

    it("deleteService DELETEs /external_services/{asId}", async () => {
        mockClient.http.authedRequest.mockResolvedValue(undefined);
        await manager.deleteService("srv1");
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            "DELETE",
            "/external_services/srv1",
            undefined,
            undefined,
            { prefix: "/_synapse/admin/v1" },
        );
    });

    it("getAllHealth returns health list", async () => {
        const healthList = [
            {
                service_id: "wh1",
                service_type: "webhook",
                is_healthy: true,
                last_check_ts: 1700000000,
                last_success_ts: 1700000000,
                last_error: null,
                consecutive_failures: 0,
            },
        ];
        mockClient.http.authedRequest.mockResolvedValue(healthList);
        const result = await manager.getAllHealth();
        expect(result).toEqual(healthList);
        expect(result[0].service_id).toBe("wh1");
    });

    it("getServiceHealth returns health for a service", async () => {
        const health = {
            service_id: "wh1",
            service_type: "webhook",
            is_healthy: true,
            last_check_ts: 1700000000,
            last_success_ts: 1700000000,
            last_error: null,
            consecutive_failures: 0,
        };
        mockClient.http.authedRequest.mockResolvedValue(health);
        const result = await manager.getServiceHealth("srv1");
        expect(result).toEqual(health);
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            "GET",
            "/external_services/srv1/health",
            undefined,
            undefined,
            { prefix: "/_synapse/admin/v1" },
        );
    });

    it("getServiceHealth returns null on 404", async () => {
        const notFound = Object.assign(new Error("Not Found"), { httpStatus: 404 });
        mockClient.http.authedRequest.mockRejectedValue(notFound);
        const result = await manager.getServiceHealth("missing");
        expect(result).toBeNull();
    });

    it("getServiceHealth rethrows non-404 errors", async () => {
        const serverError = Object.assign(new Error("Internal"), { httpStatus: 500 });
        mockClient.http.authedRequest.mockRejectedValue(serverError);
        await expect(manager.getServiceHealth("srv1")).rejects.toThrow();
    });

    it("checkServiceHealth POSTs to /external_services/{asId}/health/check", async () => {
        const checkResult = { as_id: "srv1", is_healthy: true };
        mockClient.http.authedRequest.mockResolvedValue(checkResult);
        const result = await manager.checkServiceHealth("srv1");
        expect(result).toEqual(checkResult);
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            "POST",
            "/external_services/srv1/health/check",
            undefined,
            undefined,
            { prefix: "/_synapse/admin/v1" },
        );
    });
});
