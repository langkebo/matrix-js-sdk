import { describe, it, expect, beforeEach, vi } from "vitest";

import { DeviceKeysManager, DeviceKeysEvent } from "../../src/device-keys";

describe("DeviceKeysManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let trust: any;
    let manager: DeviceKeysManager;

    beforeEach(() => {
        trust = {
            requestVerification: vi.fn().mockResolvedValue({
                request_token: "tok-1",
                token: "tok-1",
                status: "pending",
                expires_at: 1700000000000,
                methods_available: ["sas"],
            }),
            respondToVerification: vi.fn().mockResolvedValue({ success: true, trust_level: "verified" }),
            getVerificationStatus: vi.fn().mockResolvedValue({ status: "not_found" }),
            getDeviceTrustList: vi.fn().mockResolvedValue([]),
            getDeviceTrust: vi.fn().mockResolvedValue(null),
            getSecuritySummary: vi.fn(),
        };
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
            getDeviceKeys: vi.fn().mockResolvedValue({
                D1: { user_id: "@a:hs", device_id: "D1", algorithms: [], keys: {}, signatures: {} },
            }),
            uploadDeviceKeys: vi.fn().mockResolvedValue({ one_time_key_counts: { signed_curve25519: 1 } }),
            getUserDevices: vi.fn().mockResolvedValue({
                D1: { user_id: "@a:hs", device_id: "D1", algorithms: [], keys: {}, signatures: {} },
            }),
            hasDevice: vi.fn().mockReturnValue(true),
            getDevice: vi
                .fn()
                .mockReturnValue({ user_id: "@a:hs", device_id: "D1", algorithms: [], keys: {}, signatures: {} }),
            getDeviceTrustManager: () => trust,
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

        await expect(manager.getDeviceKeys("@a:hs")).resolves.toHaveProperty("D1");
        await expect(
            manager.uploadDeviceKeys({ user_id: "@a:hs", device_id: "D1", algorithms: [], keys: {}, signatures: {} }),
        ).resolves.toEqual({
            one_time_key_counts: { signed_curve25519: 1 },
        });
        await expect(manager.getUserDevices("@a:hs")).resolves.toHaveProperty("D1");
        expect(manager.hasDevice("D1")).toBe(true);
        await expect(manager.getDevice("D1")).resolves.toHaveProperty("device_id", "D1");
    });

    it("delegates device verification helpers to DeviceTrustManager", async () => {
        await expect(manager.requestDeviceVerification("@a:hs", "D1")).resolves.toMatchObject({
            request_token: "tok-1",
        });
        await manager.respondDeviceVerification("tok-1", "accept");

        // Single authority: the manager must not hand-roll the request body any more.
        expect(trust.requestVerification).toHaveBeenCalledWith({ new_device_id: "D1", device_id: "D1" });
        expect(trust.respondToVerification).toHaveBeenCalledWith("tok-1", true);
        expect(mockClient.http.authedRequest).not.toHaveBeenCalled();
    });

    it("normalises the accept/reject/boolean argument into an `approved` boolean", async () => {
        await manager.respondDeviceVerification("tok-2", false);
        expect(trust.respondToVerification).toHaveBeenLastCalledWith("tok-2", false);

        await manager.respondDeviceVerification("tok-3", "accept");
        expect(trust.respondToVerification).toHaveBeenLastCalledWith("tok-3", true);

        await manager.respondDeviceVerification("tok-4", "reject");
        expect(trust.respondToVerification).toHaveBeenLastCalledWith("tok-4", false);
    });
});
