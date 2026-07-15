import { beforeEach, describe, expect, it, vi } from "vitest";

import { Method, ClientPrefix } from "../../src/http-api/index.ts";
import { PasswordResetManager } from "../../src/password-reset/index.ts";

describe("PasswordResetManager", () => {
    let authedRequest: ReturnType<typeof vi.fn>;
    let request: ReturnType<typeof vi.fn>;
    let manager: PasswordResetManager;

    beforeEach(() => {
        authedRequest = vi.fn();
        request = vi.fn();
        manager = new PasswordResetManager({
            http: { authedRequest, request },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        manager.setRetryOptions({ maxRetries: 0 });
    });

    describe("setPassword", () => {
        it("posts auth + new password to /account/password and emits password_changed", async () => {
            authedRequest.mockResolvedValueOnce({});
            const events: unknown[] = [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager.on("password_changed" as any, () => events.push("changed"));

            await expect(
                manager.setPassword(
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    { type: "m.login.password", user: "@alice:example.com", password: "old" } as any,
                    "n3w-pass",
                    true,
                ),
            ).resolves.toEqual({});

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/account/password",
                undefined,
                {
                    auth: { type: "m.login.password", user: "@alice:example.com", password: "old" },
                    new_password: "n3w-pass",
                    logout_devices: true,
                },
                { prefix: ClientPrefix.V3 },
            );
            expect(events).toEqual(["changed"]);
        });

        it("propagates 401 errors and does not emit password_changed", async () => {
            const err = Object.assign(new Error("Unauthorized"), {
                httpStatus: 401,
                errcode: "M_FORBIDDEN",
            });
            authedRequest.mockRejectedValueOnce(err);
            const events: unknown[] = [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager.on("password_changed" as any, () => events.push("changed"));

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await expect(manager.setPassword({} as any, "n3w-pass")).rejects.toMatchObject({
                httpStatus: 401,
                errcode: "M_FORBIDDEN",
            });
            expect(events).toEqual([]);
        });
    });

    describe("requestPasswordEmailToken", () => {
        it("POSTs to /account/password/email/requestToken via http.request", async () => {
            request.mockResolvedValueOnce({ sid: "sid1", submit_url: "https://example.com" });
            const events: unknown[] = [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager.on("password_reset_token_requested" as any, (d: unknown) => events.push(d));

            const out = await manager.requestPasswordEmailToken("a@b.com", "secret", 1, "https://next");

            expect(out).toEqual({ sid: "sid1", submit_url: "https://example.com" });
            expect(request).toHaveBeenCalledTimes(1);
            const [method, path, , body] = request.mock.calls[0];
            expect(method).toBe(Method.Post);
            expect(path).toBe("/account/password/email/requestToken");
            expect(body).toMatchObject({
                email: "a@b.com",
                client_secret: "secret",
                send_attempt: 1,
                next_link: "https://next",
            });
            expect(events).toEqual([{ type: "email" }]);
        });

        it("propagates 4xx errors without emitting", async () => {
            const err = Object.assign(new Error("Bad Request"), {
                httpStatus: 400,
                errcode: "M_THREEPID_IN_USE",
            });
            request.mockRejectedValueOnce(err);
            const events: unknown[] = [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager.on("password_reset_token_requested" as any, (d: unknown) => events.push(d));

            await expect(manager.requestPasswordEmailToken("a@b.com", "secret", 1)).rejects.toMatchObject({
                httpStatus: 400,
                errcode: "M_THREEPID_IN_USE",
            });
            expect(events).toEqual([]);
        });
    });

    describe("requestPasswordMsisdnToken", () => {
        it("POSTs to /account/password/msisdn/requestToken via http.request", async () => {
            request.mockResolvedValueOnce({ sid: "sid-msisdn", submit_url: "https://example.com/msisdn" });
            const events: unknown[] = [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager.on("password_reset_token_requested" as any, (d: unknown) => events.push(d));

            const out = await manager.requestPasswordMsisdnToken("GB", "07123456789", "secret", 2, "https://next");

            expect(out).toEqual({ sid: "sid-msisdn", submit_url: "https://example.com/msisdn" });
            expect(request).toHaveBeenCalledTimes(1);
            const [method, path, , body] = request.mock.calls[0];
            expect(method).toBe(Method.Post);
            expect(path).toBe("/account/password/msisdn/requestToken");
            expect(body).toMatchObject({
                country: "GB",
                phone_number: "07123456789",
                client_secret: "secret",
                send_attempt: 2,
                next_link: "https://next",
            });
            expect(events).toEqual([{ type: "msisdn" }]);
        });
    });
});
