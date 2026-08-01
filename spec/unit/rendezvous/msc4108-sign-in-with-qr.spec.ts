import { describe, it, expect, vi } from "vitest";
import { MSC4108SignInWithQR } from "../../../src/rendezvous/MSC4108SignInWithQR";
import type { MatrixClient } from "../../../src/client";

describe("MSC4108SignInWithQR", () => {
    describe("generateQrLoginToken", () => {
        it("calls POST /login/qr_token with v1 prefix", async () => {
            const mockAuthedRequest = vi.fn().mockResolvedValue({
                login_token: "token123",
                expires_in_ms: 5000,
            });
            const mockClient = {
                http: { authedRequest: mockAuthedRequest },
            } as unknown as MatrixClient;

            // Constructor: (channel, didScanCode, client?, onFailure?)
            // channel can be a minimal mock — generateQrLoginToken doesn't use it
            const qr = new MSC4108SignInWithQR({} as never, true, mockClient);
            const result = await qr.generateQrLoginToken();

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                "POST",
                "/login/qr_token",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v1" },
            );
            expect(result.login_token).toBe("token123");
            expect(result.expires_in_ms).toBe(5000);
        });

        it("throws when client is not set (new device side)", async () => {
            const qr = new MSC4108SignInWithQR({} as never, false);
            await expect(qr.generateQrLoginToken()).rejects.toThrow();
        });
    });
});
