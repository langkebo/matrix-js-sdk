import { describe, it, expect, beforeEach, vi } from "vitest";

import { CryptoEncryptionManager } from "../../src/crypto-encryption";

describe("CryptoEncryptionManager", () => {
    let mockClient: any;
    let manager: CryptoEncryptionManager;

    beforeEach(() => {
        mockClient = {
            getCrypto: vi.fn().mockReturnValue({}),
            isCryptoReady: vi.fn().mockReturnValue(true),
            deviceList: { devices: {} },
            encryptEvent: vi
                .fn()
                .mockResolvedValue({ event: {}, encryptedContent: { algorithm: "m.megolm.v1.aes-sha2" } }),
            decryptEvent: vi.fn().mockResolvedValue({ clearEvent: { body: "x" } }),
            getUserDevices: vi.fn().mockResolvedValue({ D1: {} }),
            setDeviceVerified: vi.fn().mockResolvedValue(undefined),
            markDeviceAsVerified: vi.fn().mockResolvedValue(undefined),
            markAllDevicesAsVerified: vi.fn().mockResolvedValue(undefined),
            getEncryptionInfoForRoom: vi.fn().mockResolvedValue({ algorithm: "m.megolm.v1.aes-sha2" }),
        };
        manager = new CryptoEncryptionManager(mockClient);
    });

    it("reads crypto readiness and device list", () => {
        expect(manager.isE2eEnabled()).toBe(true);
        expect(manager.getCrypto()).toEqual({});
        expect(manager.isCryptoReady()).toBe(true);
        expect(manager.getDeviceList()).toEqual({ devices: {} });
    });

    it("delegates encrypt/decrypt and device verification methods", async () => {
        await expect(manager.encryptEvent({} as any, {} as any)).resolves.toMatchObject({
            encryptedContent: { algorithm: "m.megolm.v1.aes-sha2" },
        });
        await expect(manager.decryptEvent({} as any)).resolves.toMatchObject({ clearEvent: { body: "x" } });
        await expect(manager.getUserDevices("@a:hs")).resolves.toEqual({ D1: {} });
        await manager.setDeviceVerified("@a:hs", "D1");
        await manager.markDeviceAsVerified("@a:hs", "D1");
        await manager.markAllDevicesAsVerified("@a:hs");
        await expect(manager.getEncryptionInfoForRoom("!r:hs")).resolves.toEqual({ algorithm: "m.megolm.v1.aes-sha2" });
    });
});
