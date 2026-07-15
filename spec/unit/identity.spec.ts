import { beforeEach, describe, expect, it, vi } from "vitest";

import { Method, ClientPrefix } from "../../src/http-api/index.ts";
import { IdentityManager } from "../../src/identity/index.ts";

describe("IdentityManager", () => {
    let authedRequest: ReturnType<typeof vi.fn>;
    let manager: IdentityManager;

    beforeEach(() => {
        authedRequest = vi.fn();
        manager = new IdentityManager({
            http: { authedRequest },
            idBaseUrl: "https://id.example.com",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        manager.setRetryOptions({ maxRetries: 0 });
    });

    it("exposes the configured identity server URL", () => {
        expect(manager.getIdentityServerUrl()).toBe("https://id.example.com");
    });

    describe("lookup3pid", () => {
        it("GETs /_matrix/identity/v1/lookup with medium+address query", async () => {
            authedRequest.mockResolvedValueOnce({ mxid: "@alice:example.com" });

            await expect(manager.lookup3pid("email", "a@b.com")).resolves.toEqual({
                mxid: "@alice:example.com",
            });
            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/_matrix/identity/v1/lookup",
                {
                    medium: "email",
                    address: "a@b.com",
                },
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });

        it("propagates 404 errors", async () => {
            const err = Object.assign(new Error("Not Found"), {
                httpStatus: 404,
                errcode: "M_NOT_FOUND",
            });
            authedRequest.mockRejectedValueOnce(err);

            await expect(manager.lookup3pid("email", "missing@b.com")).rejects.toMatchObject({
                httpStatus: 404,
                errcode: "M_NOT_FOUND",
            });
        });
    });

    describe("store3pid", () => {
        it("POSTs to /_matrix/identity/v1/store-invite with medium+address+token", async () => {
            authedRequest.mockResolvedValueOnce({
                token: "t1",
                public_keys: ["k1"],
                display_name: "Alice",
            });

            await manager.store3pid("email", "a@b.com", "validation-token");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/_matrix/identity/v1/store-invite",
                undefined,
                {
                    medium: "email",
                    address: "a@b.com",
                    token: "validation-token",
                },
                { prefix: ClientPrefix.V3 },
            );
        });

        it("propagates 403 typed errors", async () => {
            const err = Object.assign(new Error("Forbidden"), {
                httpStatus: 403,
                errcode: "M_FORBIDDEN",
            });
            authedRequest.mockRejectedValueOnce(err);

            await expect(manager.store3pid("email", "a@b.com", "token")).rejects.toMatchObject({
                httpStatus: 403,
                errcode: "M_FORBIDDEN",
            });
        });
    });

    describe("requestVerificationToken", () => {
        it("POSTs to /validate/email/requestToken with email + sendAttempt", async () => {
            authedRequest.mockResolvedValueOnce({ sid: "sid-1" });

            await manager.requestVerificationToken("email", "a@b.com");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/_matrix/identity/v1/validate/email/requestToken",
                undefined,
                { email: "a@b.com", sendAttempt: 1 },
                { prefix: ClientPrefix.V3 },
            );
        });

        it("propagates 400 errors", async () => {
            const err = Object.assign(new Error("Bad Request"), {
                httpStatus: 400,
                errcode: "M_INVALID_PARAM",
            });
            authedRequest.mockRejectedValueOnce(err);

            await expect(manager.requestVerificationToken("email", "invalid")).rejects.toMatchObject({
                httpStatus: 400,
                errcode: "M_INVALID_PARAM",
            });
        });
    });

    describe("bind3pid", () => {
        it("POSTs to /3pid/bind with sid/client_secret/mxid", async () => {
            authedRequest.mockResolvedValueOnce({
                mxid: "@alice:example.com",
                address: "a@b.com",
                medium: "email",
            });

            await manager.bind3pid("email", "a@b.com", "@alice:example.com", "sid-token");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/_matrix/identity/v1/3pid/bind",
                undefined,
                {
                    sid: "sid-token",
                    client_secret: "@alice:example.com",
                    mxid: "@alice:example.com",
                },
                { prefix: ClientPrefix.V3 },
            );
        });

        it("propagates 401 errors", async () => {
            const err = Object.assign(new Error("Unauthorized"), {
                httpStatus: 401,
                errcode: "M_MISSING_TOKEN",
            });
            authedRequest.mockRejectedValueOnce(err);

            await expect(manager.bind3pid("email", "a@b.com", "@alice:example.com", "sid")).rejects.toMatchObject({
                httpStatus: 401,
                errcode: "M_MISSING_TOKEN",
            });
        });
    });
});
