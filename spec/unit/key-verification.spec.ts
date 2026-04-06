import { beforeEach, describe, expect, it, vi } from "vitest";

import { KeyVerificationManager } from "../../src/key-verification/index";
import {
    extendMatrixClientWithManagers,
    resetManagerExtensions,
} from "../../src/manager-extensions/index";
import { MatrixClient } from "../../src/client";

describe("KeyVerificationManager", () => {
    let client: any;
    let manager: KeyVerificationManager;

    beforeEach(() => {
        client = {
            getDeviceId: vi.fn().mockReturnValue("DEVICE"),
            startDeviceSigningVerification: vi.fn().mockResolvedValue({ transaction_id: "txn-start" }),
            acceptDeviceSigningVerification: vi.fn().mockResolvedValue({ transaction_id: "txn-accept" }),
            sendDeviceSigningVerificationKeyAgreement: vi
                .fn()
                .mockResolvedValue({ transaction_id: "txn-key", confirmed: false }),
            confirmDeviceSigningVerificationMac: vi.fn().mockResolvedValue({ transaction_id: "txn-mac", verified: true }),
            completeDeviceSigningVerification: vi.fn().mockResolvedValue({ transaction_id: "txn-done" }),
            cancelDeviceSigningVerification: vi.fn().mockResolvedValue({
                transaction_id: "txn-cancel",
                state: "cancelled",
                code: "m.user",
                reason: "Cancelled by user",
            }),
            getVerificationRequests: vi.fn().mockResolvedValue({ requests: [] }),
        };

        manager = new KeyVerificationManager(client);
        resetManagerExtensions();
        delete (MatrixClient.prototype as any).getKeyVerificationManager;
        delete (MatrixClient.prototype as any).getRoomKeySharingManager;
    });

    it("routes verification start helpers to the existing HTTP endpoint", async () => {
        await manager.requestVerification("@alice:test", ["m.sas.v1"]);
        await manager.requestRoomKeyVerification("!room:test", "@bob:test", "r0");
        await manager.beginKeyVerification("m.qr_code.show.v1", "@carol:test", "CAROL", "r0");

        expect(client.startDeviceSigningVerification).toHaveBeenNthCalledWith(
            1,
            {
                from_device: "DEVICE",
                to_user: "@alice:test",
                method: "m.sas.v1",
            },
            "v1",
        );
        expect(client.startDeviceSigningVerification).toHaveBeenNthCalledWith(
            2,
            {
                from_device: "DEVICE",
                to_user: "@bob:test",
                method: "sas",
            },
            "r0",
        );
        expect(client.startDeviceSigningVerification).toHaveBeenNthCalledWith(
            3,
            {
                from_device: "DEVICE",
                to_user: "@carol:test",
                to_device: "CAROL",
                method: "m.qr_code.show.v1",
            },
            "r0",
        );
    });

    it("uses the typed cancel endpoint with default code and reason", async () => {
        await manager.cancelKeyVerification("txn-1");

        expect(client.cancelDeviceSigningVerification).toHaveBeenCalledWith(
            {
                transaction_id: "txn-1",
                code: "m.user",
                reason: "Cancelled by user",
            },
            "v1",
        );
    });

    it("supports custom cancel metadata and request listing versions", async () => {
        await manager.cancelKeyVerification("txn-2", "Timed out", "m.timeout", "r0");
        await manager.getVerificationRequests("r0");
        await manager.getVerificationRequests("@ignored:test", "v1");

        expect(client.cancelDeviceSigningVerification).toHaveBeenCalledWith(
            {
                transaction_id: "txn-2",
                code: "m.timeout",
                reason: "Timed out",
            },
            "r0",
        );
        expect(client.getVerificationRequests).toHaveBeenNthCalledWith(1, "r0");
        expect(client.getVerificationRequests).toHaveBeenNthCalledWith(2, "v1");
    });

    it("registers key verification and room key sharing managers through unified extensions", async () => {
        await extendMatrixClientWithManagers({
            includeAdmin: false,
            includeAccount: false,
            includeAccountData: false,
            includeAuth: false,
            includeCapabilities: false,
            includeCryptoKeys: false,
            includeKeyVerification: true,
            includeDiscovery: false,
            includeExternalService: false,
            includeGlobalLogout: false,
            includeDm: false,
            includeGuest: false,
            includeInviteBlocklist: false,
            includeMedia: false,
            includeMessage: false,
            includePush: false,
            includeQrLogin: false,
            includeRendering: false,
            includeRoom: false,
            includeRoomKeySharing: true,
            includeRoomSummary: false,
            includeRoomList: false,
            includeSecurity: false,
            includeStickyEvent: false,
            includeFriend: false,
            includeSpace: false,
            includeSending: false,
            includePresence: false,
            includeFederation: false,
            includeDevice: false,
            includeProfile: false,
            includeSamlAuth: false,
            includeThirdParty: false,
            includeTyping: false,
            includeUser: false,
            includeUserReport: false,
            includeVoice: false,
        });

        expect(typeof MatrixClient.prototype.getKeyVerificationManager).toBe("function");
        expect(typeof MatrixClient.prototype.getRoomKeySharingManager).toBe("function");
    });
});
