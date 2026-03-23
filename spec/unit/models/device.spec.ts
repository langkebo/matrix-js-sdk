import { describe, it, expect } from "vitest";

import { Device, DeviceVerification } from "../../../src/models/device";

describe("Device", () => {
    describe("constructor", () => {
        it("should create a device with required parameters", () => {
            const device = new Device({
                deviceId: "device1",
                userId: "@user:example.com",
                algorithms: ["algo1"],
                keys: new Map([["key1", "value1"]]),
            });

            expect(device.deviceId).toBe("device1");
            expect(device.userId).toBe("@user:example.com");
            expect(device.algorithms).toEqual(["algo1"]);
            expect(device.keys).toEqual(new Map([["key1", "value1"]]));
        });

        it("should default to unverified", () => {
            const device = new Device({
                deviceId: "device1",
                userId: "@user:example.com",
                algorithms: [],
                keys: new Map(),
            });

            expect(device.verified).toBe(DeviceVerification.Unverified);
        });

        it("should set verified status", () => {
            const device = new Device({
                deviceId: "device1",
                userId: "@user:example.com",
                algorithms: [],
                keys: new Map(),
                verified: DeviceVerification.Verified,
            });

            expect(device.verified).toBe(DeviceVerification.Verified);
        });

        it("should set blocked status", () => {
            const device = new Device({
                deviceId: "device1",
                userId: "@user:example.com",
                algorithms: [],
                keys: new Map(),
                verified: DeviceVerification.Blocked,
            });

            expect(device.verified).toBe(DeviceVerification.Blocked);
        });

        it("should set display name", () => {
            const device = new Device({
                deviceId: "device1",
                userId: "@user:example.com",
                algorithms: [],
                keys: new Map(),
                displayName: "My Device",
            });

            expect(device.displayName).toBe("My Device");
        });

        it("should set dehydrated flag", () => {
            const device = new Device({
                deviceId: "device1",
                userId: "@user:example.com",
                algorithms: [],
                keys: new Map(),
                dehydrated: true,
            });

            expect(device.dehydrated).toBe(true);
        });

        it("should default signatures to empty map", () => {
            const device = new Device({
                deviceId: "device1",
                userId: "@user:example.com",
                algorithms: [],
                keys: new Map(),
            });

            expect(device.signatures).toBeInstanceOf(Map);
            expect(device.signatures.size).toBe(0);
        });
    });

    describe("getFingerprint", () => {
        it("should return the Ed25519 key", () => {
            const device = new Device({
                deviceId: "device1",
                userId: "@user:example.com",
                algorithms: [],
                keys: new Map([["ed25519:device1", "fingerprint123"]]),
            });

            expect(device.getFingerprint()).toBe("fingerprint123");
        });

        it("should return undefined when no key", () => {
            const device = new Device({
                deviceId: "device1",
                userId: "@user:example.com",
                algorithms: [],
                keys: new Map(),
            });

            expect(device.getFingerprint()).toBeUndefined();
        });
    });

    describe("getIdentityKey", () => {
        it("should return the Curve25519 key", () => {
            const device = new Device({
                deviceId: "device1",
                userId: "@user:example.com",
                algorithms: [],
                keys: new Map([["curve25519:device1", "identity123"]]),
            });

            expect(device.getIdentityKey()).toBe("identity123");
        });

        it("should return undefined when no key", () => {
            const device = new Device({
                deviceId: "device1",
                userId: "@user:example.com",
                algorithms: [],
                keys: new Map(),
            });

            expect(device.getIdentityKey()).toBeUndefined();
        });
    });
});

describe("DeviceVerification", () => {
    it("should have correct values", () => {
        expect(DeviceVerification.Blocked).toBe(-1);
        expect(DeviceVerification.Unverified).toBe(0);
        expect(DeviceVerification.Verified).toBe(1);
    });
});
