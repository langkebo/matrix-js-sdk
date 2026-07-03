import { beforeEach, describe, expect, it, vi } from "vitest";

import { ValidationError } from "../../src/errors";
import { logger } from "../../src/logger";
import { VerificationManager } from "../../src/verification/index";

type MockVerificationClient = {
    http: {
        authedRequest: ReturnType<typeof vi.fn>;
    };
};

describe("VerificationManager", () => {
    let mockClient: MockVerificationClient;
    let manager: VerificationManager;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
        };

        vi.spyOn(logger, "warn").mockImplementation(() => undefined);
        manager = new VerificationManager(
            mockClient as unknown as ConstructorParameters<typeof VerificationManager>[0],
        );
    });

    it("routes verification start to the generated-compatible v1 contract path", async () => {
        mockClient.http.authedRequest.mockResolvedValueOnce({ transaction_id: "txn-1" });

        await manager.startVerification({
            from_device: "DEVICE",
            to_user: "@alice:example.org",
            method: "m.sas.v1",
        });

        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            "POST",
            "/keys/device_signing/verify_start",
            undefined,
            {
                from_device: "DEVICE",
                to_user: "@alice:example.org",
                method: "m.sas.v1",
            },
            expect.objectContaining({ prefix: "/_matrix/client/v1" }),
        );
    });

    it("allows callers to select generated-compatible v3 and r0 contract paths explicitly", async () => {
        mockClient.http.authedRequest
            .mockResolvedValueOnce({ transaction_id: "txn-v3" })
            .mockResolvedValueOnce({ transaction_id: "txn-r0" });

        await manager.startVerification(
            {
                from_device: "DEVICE",
                to_user: "@alice:example.org",
                method: "m.sas.v1",
            },
            "v3",
        );
        await manager.showQrCode("r0");

        expect(mockClient.http.authedRequest).toHaveBeenNthCalledWith(
            1,
            "POST",
            "/keys/device_signing/verify_start",
            undefined,
            {
                from_device: "DEVICE",
                to_user: "@alice:example.org",
                method: "m.sas.v1",
            },
            expect.objectContaining({ prefix: "/_matrix/client/v3" }),
        );
        expect(mockClient.http.authedRequest).toHaveBeenNthCalledWith(
            2,
            "GET",
            "/keys/qr_code/show",
            undefined,
            undefined,
            expect.objectContaining({ prefix: "/_matrix/client/r0" }),
        );
    });

    it("routes accept, key agreement, mac, done, and cancel to their contract paths", async () => {
        mockClient.http.authedRequest
            .mockResolvedValueOnce({ transaction_id: "txn-1" })
            .mockResolvedValueOnce({ transaction_id: "txn-1", confirmed: true })
            .mockResolvedValueOnce({ transaction_id: "txn-1", verified: true })
            .mockResolvedValueOnce({ transaction_id: "txn-1" })
            .mockResolvedValueOnce({ transaction_id: "txn-1", state: "cancelled" });

        await manager.acceptVerification({
            transaction_id: "txn-1",
            key_agreement_protocol: "curve25519-hkdf-sha256",
            hash: "sha256",
        });
        await manager.exchangeKeys({
            transaction_id: "txn-1",
            pubkey: "pubkey",
        });
        await manager.confirmMac({
            transaction_id: "txn-1",
            mac: "abcdef",
        });
        await manager.completeVerification({
            transaction_id: "txn-1",
            mac: "abcdef",
        });
        await manager.cancelVerification({
            transaction_id: "txn-1",
            code: "m.user",
            reason: "Cancelled by user",
        });

        expect(mockClient.http.authedRequest).toHaveBeenNthCalledWith(
            1,
            "PUT",
            "/keys/device_signing/verify_accept",
            undefined,
            {
                transaction_id: "txn-1",
                key_agreement_protocol: "curve25519-hkdf-sha256",
                hash: "sha256",
            },
            expect.objectContaining({ prefix: "/_matrix/client/v1" }),
        );
        expect(mockClient.http.authedRequest).toHaveBeenNthCalledWith(
            2,
            "POST",
            "/keys/device_signing/verify_key_agreement",
            undefined,
            {
                transaction_id: "txn-1",
                pubkey: "pubkey",
            },
            expect.objectContaining({ prefix: "/_matrix/client/v1" }),
        );
        expect(mockClient.http.authedRequest).toHaveBeenNthCalledWith(
            3,
            "POST",
            "/keys/device_signing/verify_mac",
            undefined,
            {
                transaction_id: "txn-1",
                mac: "abcdef",
            },
            expect.objectContaining({ prefix: "/_matrix/client/v1" }),
        );
        expect(mockClient.http.authedRequest).toHaveBeenNthCalledWith(
            4,
            "POST",
            "/keys/device_signing/verify_done",
            undefined,
            {
                transaction_id: "txn-1",
                mac: "abcdef",
            },
            expect.objectContaining({ prefix: "/_matrix/client/v1" }),
        );
        expect(mockClient.http.authedRequest).toHaveBeenNthCalledWith(
            5,
            "POST",
            "/keys/device_signing/verify_cancel",
            undefined,
            {
                transaction_id: "txn-1",
                code: "m.user",
                reason: "Cancelled by user",
            },
            expect.objectContaining({ prefix: "/_matrix/client/v1" }),
        );
    });

    it("routes pending requests and qr helpers to their contract paths", async () => {
        mockClient.http.authedRequest
            .mockResolvedValueOnce({ requests: [] })
            .mockResolvedValueOnce({ transaction_id: "txn-qr" })
            .mockResolvedValueOnce({ transaction_id: "txn-qr", state: "pending" });

        await manager.listPendingVerifications();
        await manager.showQrCode();
        await manager.scanQrCode({
            transaction_id: "txn-qr",
            server_name: "example.org",
            user_id: "@alice:example.org",
            device_id: "DEVICE",
            device_ed25519_key: "ed25519",
            device_curve25519_key: "curve25519",
        });

        expect(mockClient.http.authedRequest).toHaveBeenNthCalledWith(
            1,
            "GET",
            "/keys/device_signing/requests",
            undefined,
            undefined,
            expect.objectContaining({ prefix: "/_matrix/client/v1" }),
        );
        expect(mockClient.http.authedRequest).toHaveBeenNthCalledWith(
            2,
            "GET",
            "/keys/qr_code/show",
            undefined,
            undefined,
            expect.objectContaining({ prefix: "/_matrix/client/v1" }),
        );
        expect(mockClient.http.authedRequest).toHaveBeenNthCalledWith(
            3,
            "POST",
            "/keys/qr_code/scan",
            undefined,
            {
                transaction_id: "txn-qr",
                server_name: "example.org",
                user_id: "@alice:example.org",
                device_id: "DEVICE",
                device_ed25519_key: "ed25519",
                device_curve25519_key: "curve25519",
            },
            expect.objectContaining({ prefix: "/_matrix/client/v1" }),
        );
    });

    it("returns an empty list when listing requests fails", async () => {
        mockClient.http.authedRequest.mockRejectedValueOnce(new Error("boom"));

        await expect(manager.listPendingVerifications()).resolves.toEqual({ requests: [] });
        expect(logger.warn).toHaveBeenCalledWith(
            "VerificationManager.listPendingVerifications failed",
            expect.any(Error),
        );
    });

    it("rejects empty required fields before issuing HTTP calls", async () => {
        await expect(
            manager.startVerification({
                from_device: "",
                to_user: "@alice:example.org",
            }),
        ).rejects.toBeInstanceOf(ValidationError);

        await expect(
            manager.scanQrCode({
                transaction_id: "txn-qr",
                server_name: "",
                user_id: "@alice:example.org",
                device_id: "DEVICE",
                device_ed25519_key: "ed25519",
                device_curve25519_key: "curve25519",
            }),
        ).rejects.toBeInstanceOf(ValidationError);

        expect(mockClient.http.authedRequest).not.toHaveBeenCalled();
    });
});
