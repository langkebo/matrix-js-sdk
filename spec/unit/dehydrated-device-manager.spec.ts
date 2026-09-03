import { describe, expect, it, vi, beforeEach } from "vitest";

import { DehydratedDeviceManager } from "../../src/dehydrated-device";
import { Method } from "../../src/http-api/method";
import { type MatrixClient } from "../../src/client";

function createMockClient(authedRequest?: ReturnType<typeof vi.fn>): MatrixClient {
    return {
        doesServerAdvertiseSynapseRustFeature: vi.fn().mockResolvedValue(true),
        http: {
            authedRequest: authedRequest ?? vi.fn().mockResolvedValue({}),
        },
    } as unknown as MatrixClient;
}

describe("DehydratedDeviceManager", () => {
    it("defaults to supported for clients without centralized discovery", async () => {
        const manager = new DehydratedDeviceManager({} as ConstructorParameters<typeof DehydratedDeviceManager>[0]);

        await expect(manager.isSupported()).resolves.toBe(true);
    });

    it("uses centralized synapse-rust dehydrated-device discovery when available", async () => {
        const client = {
            doesServerAdvertiseSynapseRustFeature: vi.fn().mockResolvedValue(false),
        } as unknown as ConstructorParameters<typeof DehydratedDeviceManager>[0];
        const manager = new DehydratedDeviceManager(client);

        await expect(manager.isSupported()).resolves.toBe(false);
        expect(client.doesServerAdvertiseSynapseRustFeature).toHaveBeenCalledWith("org.matrix.msc3814");
    });
});

// FT-102: DehydratedDeviceManager HTTP 方法与路径必须匹配后端路由
// 后端路由（assembly.rs）:
//   GET    /dehydrated_device              → get_dehydrated_device
//   PUT    /dehydrated_device              → put_dehydrated_device（创建/更新）
//   DELETE /dehydrated_device              → delete_dehydrated_device
//   GET    /dehydrated_device/status       → get_dehydrated_device_status
//   POST   /dehydrated_device/{device_id}/events → post_dehydrated_device_events
//
// 后端采用 MSC3814 "每用户单设备"模型：GET/PUT/DELETE 路径不含 device_id
describe("FT-102: DehydratedDeviceManager HTTP 方法与路径匹配后端路由", () => {
    let authedRequest: ReturnType<typeof vi.fn>;
    let manager: DehydratedDeviceManager;

    beforeEach(() => {
        authedRequest = vi.fn().mockResolvedValue({ device_id: "DEV123" });
        manager = new DehydratedDeviceManager(createMockClient(authedRequest));
    });

    it("createDevice 使用 PUT 方法（后端注册 PUT /dehydrated_device，非 POST）", async () => {
        await manager.createDevice({
            device_data: { algorithm: "m.megolm.v1", account: "test_account" },
        });

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Put, // 后端注册的是 PUT，不是 POST
            "/dehydrated_device",
            undefined,
            expect.objectContaining({
                device_data: expect.objectContaining({ algorithm: "m.megolm.v1" }),
            }),
            expect.objectContaining({
                prefix: "/_matrix/client/unstable/org.matrix.msc3814.v1",
            }),
        );
    });

    it("getDevice 使用 GET /dehydrated_device（路径不含 device_id，后端基于 auth_user.user_id）", async () => {
        authedRequest.mockResolvedValue({ device_id: "DEV123", device_data: { algorithm: "m.megolm.v1", account: "x" } });
        await manager.getDevice("DEV123");

        const call = authedRequest.mock.calls[0];
        expect(call[0]).toBe(Method.Get);
        expect(call[1]).toBe("/dehydrated_device"); // 不含 /DEV123
    });

    it("deleteDevice 使用 DELETE /dehydrated_device（路径不含 device_id）", async () => {
        authedRequest.mockResolvedValue({});
        await manager.deleteDevice("DEV123");

        const call = authedRequest.mock.calls[0];
        expect(call[0]).toBe(Method.Delete);
        expect(call[1]).toBe("/dehydrated_device"); // 不含 /DEV123
    });

    it("updateDeviceData 使用 PUT /dehydrated_device（路径不含 device_id）", async () => {
        authedRequest.mockResolvedValue({ device_id: "DEV123" });
        await manager.updateDeviceData("DEV123", {
            device_data: { algorithm: "m.megolm.v1", account: "new_account" },
        });

        const call = authedRequest.mock.calls[0];
        expect(call[0]).toBe(Method.Put);
        expect(call[1]).toBe("/dehydrated_device"); // 不含 /DEV123
    });

    it("claimDevice 使用 POST /dehydrated_device/{device_id}/events（后端后缀是 /events 非 /claim）", async () => {
        authedRequest.mockResolvedValue({});
        await manager.claimDevice("DEV123", {
            rehydrate_data: { algorithm: "m.megolm.v1", account: "rehydrate_data" },
        });

        const call = authedRequest.mock.calls[0];
        expect(call[0]).toBe(Method.Post);
        expect(call[1]).toBe("/dehydrated_device/DEV123/events"); // 后缀是 /events 不是 /claim
    });
});

// FT-121: DehydratedDeviceManager 缺少 status 端点封装
// 后端路由: GET /dehydrated_device/status → get_dehydrated_device_status, 返回 { exists: boolean }
describe("FT-121: DehydratedDeviceManager.getDeviceStatus 封装 status 端点", () => {
    let authedRequest: ReturnType<typeof vi.fn>;
    let manager: DehydratedDeviceManager;

    beforeEach(() => {
        authedRequest = vi.fn().mockResolvedValue({ exists: true });
        manager = new DehydratedDeviceManager(createMockClient(authedRequest));
    });

    it("getDeviceStatus 使用 GET /dehydrated_device/status（路径含 /status 后缀）", async () => {
        await manager.getDeviceStatus();

        const call = authedRequest.mock.calls[0];
        expect(call[0]).toBe(Method.Get);
        expect(call[1]).toBe("/dehydrated_device/status"); // 不是 /dehydrated_device
    });

    it("getDeviceStatus 使用 MSC3814 前缀", async () => {
        await manager.getDeviceStatus();

        const opts = authedRequest.mock.calls[0][4] as { prefix: string };
        expect(opts.prefix).toBe("/_matrix/client/unstable/org.matrix.msc3814.v1");
    });

    it("getDeviceStatus 返回 { exists: boolean }", async () => {
        authedRequest.mockResolvedValue({ exists: false });
        const result = await manager.getDeviceStatus();
        expect(result).toEqual({ exists: false });
    });
});
