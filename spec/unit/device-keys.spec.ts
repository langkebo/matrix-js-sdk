import { describe, it, expect, beforeEach, vi } from "vitest";

import { DeviceKeysManager, DeviceKeysEvent } from "../../src/device-keys";

describe("DeviceKeysManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let manager: DeviceKeysManager;

    beforeEach(() => {
        // ⚠️ mockClient **故意不提供** getDeviceKeys / uploadDeviceKeys / hasDevice ——
        // 它们在本 fork 的 MatrixClient 上运行时并不存在。旧 spec 把它们 vi.fn() 到
        // client 上，于是"转发到不存在的东西"被掩盖。
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
            getUserDevices: vi.fn().mockResolvedValue({
                D1: { user_id: "@a:hs", device_id: "D1", algorithms: [], keys: {}, signatures: {} },
            }),
            uploadKeysRequest: vi.fn().mockResolvedValue({ one_time_key_counts: { signed_curve25519: 1 } }),
            getDeviceManager: () => ({
                getCachedDevice: (deviceId: string) => (deviceId === "D1" ? { device_id: "D1" } : null),
                getDevice: vi.fn().mockResolvedValue({ device_id: "D1" }),
            }),
        };
        manager = new DeviceKeysManager(mockClient);
    });

    it("covers key upload/query/claim and changes", async () => {
        const emitSpy = vi.spyOn(manager, "emit");
        mockClient.http.authedRequest
            .mockResolvedValueOnce({ one_time_key_counts: { signed_curve25519: 1 } })
            .mockResolvedValueOnce({ device_keys: { "@a:hs": { D1: {} } } })
            .mockResolvedValueOnce({ one_time_keys: { "@a:hs": { D1: {} } } })
            .mockResolvedValueOnce({ changed: ["@a:hs"], left: [] });

        await manager.uploadKeys({ oneTimeKeys: { "signed_curve25519:k1": { key: "k" } } });
        await manager.queryKeys({ device_keys: { "@a:hs": ["D1"] } });
        await manager.claimKeys({ one_time_keys: { "@a:hs": { D1: "signed_curve25519" } } });
        await manager.getKeyChanges("t1", "t2");

        expect(emitSpy).toHaveBeenCalledWith(DeviceKeysEvent.KeysUploaded, { signed_curve25519: 1 });
        expect(emitSpy).toHaveBeenCalledWith(DeviceKeysEvent.KeysQueried, { "@a:hs": { D1: {} } });
        expect(emitSpy).toHaveBeenCalledWith(DeviceKeysEvent.KeyClaimed, { "@a:hs": { D1: {} } });
        expect(emitSpy).toHaveBeenCalledWith(DeviceKeysEvent.DeviceListUpdated, ["@a:hs"], []);
    });

    it("covers room-key/device-signing/signature and proxy methods", async () => {
        const emitSpy = vi.spyOn(manager, "emit");
        mockClient.http.authedRequest
            .mockResolvedValueOnce({
                changed: [{ user_id: "@a:hs", device_id: "D1", device_data: { display_name: "Phone" } }],
                deleted: [{ user_id: "@b:hs", device_id: "OLD" }],
                left: [],
                stream_id: 1,
            })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ request_id: "r1" })
            .mockResolvedValueOnce({ requests: [{ request_id: "r1" }] })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ room_id: "!r:hs", algorithm: "a", session_id: "s", session_key: "k" })
            .mockResolvedValueOnce({});

        await expect(manager.updateDeviceList(["@a:hs"], "since1")).resolves.toEqual({
            changed: [{ user_id: "@a:hs", device_id: "D1", device_data: { display_name: "Phone" } }],
            deleted: [{ user_id: "@b:hs", device_id: "OLD" }],
            left: [],
            stream_id: 1,
        });
        await manager.uploadSignatures({ "@a:hs": { D1: { k: "v" } } });
        await manager.uploadDeviceSigning({});
        await expect(
            manager.createRoomKeyRequest({ room_id: "!r:hs", session_id: "s1", algorithm: "m.megolm.v1.aes-sha2" }),
        ).resolves.toEqual({ request_id: "r1" });
        await expect(manager.getRoomKeyRequests({ status: "pending" })).resolves.toEqual({
            requests: [{ request_id: "r1" }],
        });
        await manager.deleteRoomKeyRequest("r1");
        await expect(manager.getRoomKeyDistribution("!r:hs")).resolves.toEqual({
            room_id: "!r:hs",
            algorithm: "a",
            session_id: "s",
            session_key: "k",
        });
        await manager.sendToDevice("m.test", "t1", { "@a:hs": { D1: { body: "x" } } });
        expect(emitSpy).toHaveBeenCalledWith(DeviceKeysEvent.RoomKeyRequested, [{ request_id: "r1" }]);

        const deviceKeys = { user_id: "@a:hs", device_id: "D1", algorithms: [], keys: {}, signatures: {} };
        await expect(manager.uploadDeviceKeys(deviceKeys)).resolves.toEqual({
            one_time_key_counts: { signed_curve25519: 1 },
        });
        // ⚠️ 必须断言**入参形状**：`POST /keys/upload` 的 body 是 `{ device_keys: … }`。
        // 只断言返回值抓不到"少包一层" —— mock 无论收到什么都返回同一个对象（变异 M2 实测未转红）。
        expect(mockClient.uploadKeysRequest).toHaveBeenCalledWith({ device_keys: deviceKeys });
        await expect(manager.getUserDevices("@a:hs")).resolves.toHaveProperty("D1");
        expect(manager.hasDevice("D1")).toBe(true);
        await expect(manager.getDevice("D1")).resolves.toHaveProperty("device_id", "D1");
    });
});
