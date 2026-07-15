import { describe, expect, it, vi, beforeEach } from "vitest";

import { CrossSigningManager } from "../../src/cross-signing/index";
import { CrossSigningKey } from "../../src/crypto-api";

describe("CrossSigningManager", () => {
    let manager: CrossSigningManager;
    let mockCrypto: Record<string, ReturnType<typeof vi.fn>>;
    let client: { getCrypto: ReturnType<typeof vi.fn>; getUserId: ReturnType<typeof vi.fn> };

    function setupCrypto() {
        mockCrypto = {
            getCrossSigningStatus: vi.fn(),
            getUserVerificationStatus: vi.fn(),
            getCrossSigningKeyId: vi.fn(),
            isCrossSigningReady: vi.fn(),
            userHasCrossSigningKeys: vi.fn(),
            bootstrapCrossSigning: vi.fn(),
        };
        client = {
            getCrypto: vi.fn().mockReturnValue(mockCrypto),
            getUserId: vi.fn().mockReturnValue("@alice:example.org"),
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        manager = new CrossSigningManager(client as any);
    }

    beforeEach(() => {
        setupCrypto();
    });

    describe("checkCrossSigningStatus", () => {
        it("returns full status when crypto is available and verified", async () => {
            mockCrypto.getCrossSigningStatus.mockResolvedValue({ publicKeysOnDevice: true });
            mockCrypto.getUserVerificationStatus.mockResolvedValue({
                isCrossSigningVerified: () => true,
                wasCrossSigningVerified: () => true,
            });

            const result = await manager.checkCrossSigningStatus();

            expect(result).toEqual({
                crossSigningVerified: true,
                crossSigningVerifiedBefore: true,
                crossSigningTrusted: true,
            });
        });

        it("returns false status when crypto is unavailable", async () => {
            client.getCrypto.mockReturnValue(null);

            const result = await manager.checkCrossSigningStatus();

            expect(result).toEqual({
                crossSigningVerified: false,
                crossSigningVerifiedBefore: false,
                crossSigningTrusted: false,
            });
        });

        it("returns false verification when userId is null", async () => {
            client.getUserId.mockReturnValue(null);
            mockCrypto.getCrossSigningStatus.mockResolvedValue({ publicKeysOnDevice: false });

            const result = await manager.checkCrossSigningStatus();

            expect(result.crossSigningVerified).toBe(false);
            expect(result.crossSigningVerifiedBefore).toBe(false);
        });
    });

    describe("getCrossSigningKeys", () => {
        it("returns all three key IDs when crypto is available", async () => {
            mockCrypto.getCrossSigningKeyId
                .mockResolvedValueOnce("master-key-id")
                .mockResolvedValueOnce("self-signing-key-id")
                .mockResolvedValueOnce("user-signing-key-id");

            const result = await manager.getCrossSigningKeys();

            expect(result).toEqual({
                masterKey: "master-key-id",
                selfSigningKey: "self-signing-key-id",
                userSigningKey: "user-signing-key-id",
            });
            expect(mockCrypto.getCrossSigningKeyId).toHaveBeenCalledWith(CrossSigningKey.Master);
            expect(mockCrypto.getCrossSigningKeyId).toHaveBeenCalledWith(CrossSigningKey.SelfSigning);
            expect(mockCrypto.getCrossSigningKeyId).toHaveBeenCalledWith(CrossSigningKey.UserSigning);
        });

        it("returns nulls when crypto is unavailable", async () => {
            client.getCrypto.mockReturnValue(null);

            const result = await manager.getCrossSigningKeys();

            expect(result).toEqual({ masterKey: null, selfSigningKey: null, userSigningKey: null });
        });
    });

    describe("isCrossSigningReady", () => {
        it("returns true when crypto reports ready", async () => {
            mockCrypto.isCrossSigningReady.mockResolvedValue(true);
            const result = await manager.isCrossSigningReady();
            expect(result).toBe(true);
        });

        it("returns false when crypto is unavailable", async () => {
            client.getCrypto.mockReturnValue(null);
            const result = await manager.isCrossSigningReady();
            expect(result).toBe(false);
        });
    });

    describe("getUserCrossSigningKeys", () => {
        it("returns user keys with verified status", async () => {
            mockCrypto.userHasCrossSigningKeys.mockResolvedValue(true);
            mockCrypto.getUserVerificationStatus.mockResolvedValue({
                isCrossSigningVerified: () => true,
            });
            mockCrypto.getCrossSigningKeyId.mockResolvedValue("msk1");

            const result = await manager.getUserCrossSigningKeys("@bob:example.org");

            expect(result).toEqual({
                masterKey: "msk1",
                selfSigningKey: "msk1",
                userSigningKey: "msk1",
                verified: true,
            });
        });

        it("returns nulls when user has no cross signing keys", async () => {
            mockCrypto.userHasCrossSigningKeys.mockResolvedValue(false);
            mockCrypto.getUserVerificationStatus.mockResolvedValue({
                isCrossSigningVerified: () => false,
            });

            const result = await manager.getUserCrossSigningKeys("@bob:example.org");

            expect(result.masterKey).toBeNull();
            expect(result.verified).toBe(false);
        });

        it("returns nulls when crypto is unavailable", async () => {
            client.getCrypto.mockReturnValue(null);

            const result = await manager.getUserCrossSigningKeys("@bob:example.org");

            expect(result).toEqual({
                masterKey: null,
                selfSigningKey: null,
                userSigningKey: null,
                verified: false,
            });
        });
    });

    describe("checkAndTrustCrossSigning", () => {
        it("bootstraps cross signing via crypto", async () => {
            mockCrypto.bootstrapCrossSigning.mockResolvedValue(undefined);
            await manager.checkAndTrustCrossSigning();
            expect(mockCrypto.bootstrapCrossSigning).toHaveBeenCalledWith({});
        });

        it("is a no-op when crypto is unavailable", async () => {
            client.getCrypto.mockReturnValue(null);
            await expect(manager.checkAndTrustCrossSigning()).resolves.toBeUndefined();
        });
    });
});
