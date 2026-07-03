import { describe, it, expect, beforeEach, vi } from "vitest";
import { FakeTransport } from "../test-utils/FakeTransport";
import { VerificationManager } from "../../src/verification/index";
import { Method } from "../../src/http-api/method";
import { MatrixError } from "../../src/http-api/errors";

describe("VerificationManager", () => {
    let transport: FakeTransport;
    let manager: VerificationManager;

    beforeEach(() => {
        transport = new FakeTransport();
        manager = new VerificationManager({} as any, { transport });
    });

    // ─── startVerification ──────────────────────────────────────────

    it("startVerification should POST /keys/device_signing/verify_start", async () => {
        const req = { from_device: "DEVICE1", to_user: "@bob:example.com" };
        const resp = {
            transaction_id: "txn1",
            method: "m.sas.v1",
            key_agreement_protocol: ["curve25519"],
            hash: ["sha256"],
            short_authentication_string: ["emoji", "decimal"],
        };
        transport.respondWith(resp);
        const result = await manager.startVerification(req);
        expect(result).toEqual(resp);
        transport.expectCalledWith(Method.Post, "/keys/device_signing/verify_start");
    });

    it("startVerification should throw ValidationError when from_device is empty", async () => {
        await expect(
            manager.startVerification({ from_device: "", to_user: "@bob:example.com" }),
        ).rejects.toThrow("from_device is required");
    });

    it("startVerification should throw ValidationError when to_user is empty", async () => {
        await expect(
            manager.startVerification({ from_device: "DEVICE1", to_user: "" }),
        ).rejects.toThrow("to_user is required");
    });

    it("startVerification should reject on API failure", async () => {
        transport.rejectWith(new Error("API error"));
        await expect(
            manager.startVerification({ from_device: "DEVICE1", to_user: "@bob:example.com" }),
        ).rejects.toThrow();
    });

    // ─── acceptVerification ─────────────────────────────────────────

    it("acceptVerification should PUT /keys/device_signing/verify_accept", async () => {
        const req = { transaction_id: "txn1", key_agreement_protocol: "curve25519-hkdf-sha256", hash: "sha256" };
        const resp = {
            transaction_id: "txn1",
            method: "m.sas.v1",
            key_agreement_protocol: ["curve25519"],
            hash: ["sha256"],
            short_authentication_string: ["emoji"],
            commitment: "abc123",
        };
        transport.respondWith(resp);
        const result = await manager.acceptVerification(req);
        expect(result.commitment).toBe("abc123");
        transport.expectCalledWith(Method.Put, "/keys/device_signing/verify_accept");
    });

    it("acceptVerification should throw ValidationError when transaction_id is empty", async () => {
        await expect(
            manager.acceptVerification({
                transaction_id: "",
                key_agreement_protocol: "curve25519",
                hash: "sha256",
            }),
        ).rejects.toThrow("transaction_id is required");
    });

    // ─── exchangeKeys ───────────────────────────────────────────────

    it("exchangeKeys should POST /keys/device_signing/verify_key_agreement", async () => {
        const req = { transaction_id: "txn1", pubkey: "base64pubkey==" };
        const resp = {
            transaction_id: "txn1",
            confirmed: true,
            short_authentication_string: { emoji: ["🦋", "⭐"], decimal: { points: [1234, 5678] } },
        };
        transport.respondWith(resp);
        const result = await manager.exchangeKeys(req);
        expect(result.confirmed).toBe(true);
        expect(result.short_authentication_string.emoji).toHaveLength(2);
        transport.expectCalledWith(Method.Post, "/keys/device_signing/verify_key_agreement");
    });

    it("exchangeKeys should throw ValidationError when pubkey is empty", async () => {
        await expect(
            manager.exchangeKeys({ transaction_id: "txn1", pubkey: "" }),
        ).rejects.toThrow("pubkey is required");
    });

    // ─── confirmMac ──────────────────────────────────────────────────

    it("confirmMac should POST /keys/device_signing/verify_mac", async () => {
        const req = { transaction_id: "txn1", mac: "base64mac==" };
        transport.respondWith({ transaction_id: "txn1", verified: true });
        const result = await manager.confirmMac(req);
        expect(result.verified).toBe(true);
        transport.expectCalledWith(Method.Post, "/keys/device_signing/verify_mac");
    });

    it("confirmMac should throw ValidationError when mac is empty", async () => {
        await expect(
            manager.confirmMac({ transaction_id: "txn1", mac: "" }),
        ).rejects.toThrow("mac is required");
    });

    // ─── completeVerification ───────────────────────────────────────

    it("completeVerification should POST /keys/device_signing/verify_done", async () => {
        const req = { transaction_id: "txn1", mac: "base64mac==" };
        transport.respondWith({ transaction_id: "txn1" });
        const result = await manager.completeVerification(req);
        expect(result.transaction_id).toBe("txn1");
        transport.expectCalledWith(Method.Post, "/keys/device_signing/verify_done");
    });

    it("completeVerification should throw ValidationError when mac is empty", async () => {
        await expect(
            manager.completeVerification({ transaction_id: "txn1", mac: "" }),
        ).rejects.toThrow("mac is required");
    });

    // ─── cancelVerification ─────────────────────────────────────────

    it("cancelVerification should POST /keys/device_signing/verify_cancel", async () => {
        const req = { transaction_id: "txn1", code: "m.user", reason: "User cancelled" };
        const resp = { transaction_id: "txn1", state: "cancelled" as const, code: "m.user", reason: "User cancelled" };
        transport.respondWith(resp);
        const result = await manager.cancelVerification(req);
        expect(result.state).toBe("cancelled");
        transport.expectCalledWith(Method.Post, "/keys/device_signing/verify_cancel");
    });

    it("cancelVerification should throw ValidationError when code is empty", async () => {
        await expect(
            manager.cancelVerification({ transaction_id: "txn1", code: "", reason: "none" }),
        ).rejects.toThrow("code is required");
    });

    it("cancelVerification should throw ValidationError when reason is empty", async () => {
        await expect(
            manager.cancelVerification({ transaction_id: "txn1", code: "m.user", reason: "" }),
        ).rejects.toThrow("reason is required");
    });

    // ─── listPendingVerifications ──────────────────────────────────

    it("listPendingVerifications should GET /keys/device_signing/requests", async () => {
        const resp = {
            requests: [
                {
                    transaction_id: "txn1",
                    from_user: "@alice:example.com",
                    from_device: "DEV_A",
                    to_user: "@bob:example.com",
                    method: "m.sas.v1",
                    state: "pending",
                    created_ts: 1000,
                    updated_ts: 1001,
                },
            ],
        };
        transport.respondWith(resp);
        const result = await manager.listPendingVerifications();
        expect(result.requests).toHaveLength(1);
        expect(result.requests[0].from_user).toBe("@alice:example.com");
        transport.expectCalledWith(Method.Get, "/keys/device_signing/requests");
    });

    it("listPendingVerifications should return empty array on error", async () => {
        transport.rejectWith(new Error("Network error"));
        const result = await manager.listPendingVerifications();
        expect(result.requests).toEqual([]);
    });

    // ─── showQrCode ──────────────────────────────────────────────────

    it("showQrCode should GET /keys/qr_code/show", async () => {
        const resp = {
            transaction_id: "txn1",
            server_name: "example.com",
            user_id: "@alice:example.com",
            device_id: "DEV_A",
            device_ed25519_key: "ed25519:abc",
            device_curve25519_key: "curve25519:xyz",
        };
        transport.respondWith(resp);
        const result = await manager.showQrCode();
        expect(result.server_name).toBe("example.com");
        transport.expectCalledWith(Method.Get, "/keys/qr_code/show");
    });

    it("showQrCode should reject on API failure", async () => {
        transport.rejectWith(new Error("QR error"));
        await expect(manager.showQrCode()).rejects.toThrow();
    });

    // ─── scanQrCode ──────────────────────────────────────────────────

    it("scanQrCode should POST /keys/qr_code/scan", async () => {
        const req = {
            transaction_id: "txn1",
            server_name: "example.com",
            user_id: "@bob:example.com",
            device_id: "DEV_B",
            device_ed25519_key: "ed25519:abc",
            device_curve25519_key: "curve25519:xyz",
        };
        transport.respondWith({ transaction_id: "txn1", state: "verified" });
        const result = await manager.scanQrCode(req);
        expect(result.state).toBe("verified");
        transport.expectCalledWith(Method.Post, "/keys/qr_code/scan");
    });

    it("scanQrCode should throw ValidationError when server_name is empty", async () => {
        await expect(
            manager.scanQrCode({
                transaction_id: "txn1",
                server_name: "",
                user_id: "@bob:example.com",
                device_id: "DEV_B",
                device_ed25519_key: "ed25519:abc",
                device_curve25519_key: "curve25519:xyz",
            }),
        ).rejects.toThrow("server_name is required");
    });

    it("scanQrCode should throw ValidationError when device_id is empty", async () => {
        await expect(
            manager.scanQrCode({
                transaction_id: "txn1",
                server_name: "example.com",
                user_id: "@bob:example.com",
                device_id: "",
                device_ed25519_key: "ed25519:abc",
                device_curve25519_key: "curve25519:xyz",
            }),
        ).rejects.toThrow("device_id is required");
    });

    // ─── extendMatrixClient export ─────────────────────────────────

    it("should export VerificationManager class", () => {
        expect(typeof VerificationManager).toBe("function");
    });

    it("should have expected prototype methods", () => {
        expect(typeof manager.startVerification).toBe("function");
        expect(typeof manager.acceptVerification).toBe("function");
        expect(typeof manager.listPendingVerifications).toBe("function");
        expect(typeof manager.showQrCode).toBe("function");
    });
});
