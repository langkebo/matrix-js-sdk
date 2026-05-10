import { beforeEach, describe, expect, it, vi } from "vitest";

import { Method } from "../../src/http-api/index.ts";
import { GuestEvent, GuestManager } from "../../src/guest/index.ts";

describe("GuestManager", () => {
    let request: ReturnType<typeof vi.fn>;
    let authedRequest: ReturnType<typeof vi.fn>;
    let getUserId: ReturnType<typeof vi.fn>;
    let manager: GuestManager;

    beforeEach(() => {
        request = vi.fn();
        authedRequest = vi.fn();
        getUserId = vi.fn().mockReturnValue("@g:e");
        manager = new GuestManager(
            { http: { request, authedRequest }, getUserId, getHomeserverUrl: () => "https://h" } as any,
            "https://h",
        );
        manager.setRetryOptions({ maxRetries: 0 });
    });

    describe("registerGuest", () => {
        it("POSTs /register with kind=guest and emits GuestRegistered", async () => {
            request.mockResolvedValueOnce({
                user_id: "@g:e",
                device_id: "D",
                access_token: "tok",
                expires_in: 60,
            });
            const emitted: unknown[] = [];
            manager.on(GuestEvent.GuestRegistered, (g) => emitted.push(g));

            await manager.registerGuest("D", "dn");

            expect(request).toHaveBeenCalledWith(
                Method.Post,
                "/register",
                undefined,
                { kind: "guest", device_id: "D", initial_device_display_name: "dn" },
                { prefix: "/_matrix/client/v3" },
            );
            expect(emitted).toHaveLength(1);
            expect(manager.getGuestInfo()).toMatchObject({ userId: "@g:e", accessToken: "tok" });
        });

        it("propagates error and emits GuestError", async () => {
            const err = Object.assign(new Error("Forbidden"), { httpStatus: 403, errcode: "M_FORBIDDEN" });
            request.mockRejectedValueOnce(err);
            const errors: unknown[] = [];
            manager.on(GuestEvent.GuestError, (e) => errors.push(e));

            await expect(manager.registerGuest()).rejects.toMatchObject({ httpStatus: 403 });
            expect(errors).toHaveLength(1);
        });
    });

    describe("loginGuest", () => {
        it("POSTs /login with type=m.login.guest and emits GuestLoggedIn", async () => {
            request.mockResolvedValueOnce({ user_id: "@g:e", device_id: "D", access_token: "tok" });
            const emitted: unknown[] = [];
            manager.on(GuestEvent.GuestLoggedIn, (g) => emitted.push(g));

            await manager.loginGuest();

            expect(request).toHaveBeenCalledWith(
                Method.Post,
                "/login",
                undefined,
                { type: "m.login.guest" },
                { prefix: "/_matrix/client/v3" },
            );
            expect(emitted).toHaveLength(1);
        });
    });

    describe("upgradeGuestAccount", () => {
        it("throws when no guest info exists", async () => {
            await expect(manager.upgradeGuestAccount("pw")).rejects.toThrow("No guest account to upgrade");
        });

        it("POSTs /account/password once a guest is registered", async () => {
            request.mockResolvedValueOnce({ user_id: "@g:e", device_id: "D", access_token: "tok" });
            await manager.registerGuest();
            authedRequest.mockResolvedValueOnce(undefined);

            await manager.upgradeGuestAccount("pw", { type: "m.login.dummy" });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/account/password",
                undefined,
                { password: "pw", auth: { type: "m.login.dummy" } },
                { prefix: "/_matrix/client/v3" },
            );
            expect(manager.getGuestInfo()).toBeNull();
        });
    });

    describe("getGuestInfoFromServer", () => {
        it("GETs /account/guest and emits GuestInfoReceived", async () => {
            authedRequest.mockResolvedValueOnce({
                guest: { user_id: "@g:e", device_id: "D", is_guest: true },
            });
            const emitted: unknown[] = [];
            manager.on(GuestEvent.GuestInfoReceived, (g) => emitted.push(g));

            await manager.getGuestInfoFromServer();

            expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/account/guest", undefined, undefined, {
                prefix: "/_matrix/client/v3",
            });
            expect(emitted).toHaveLength(1);
        });

        it("propagates 401 errors", async () => {
            const err = Object.assign(new Error("Unauthorized"), { httpStatus: 401 });
            authedRequest.mockRejectedValueOnce(err);

            await expect(manager.getGuestInfoFromServer()).rejects.toMatchObject({ httpStatus: 401 });
        });
    });

    describe("upgradeGuestAccountOnServer", () => {
        it("POSTs /account/guest/upgrade and emits GuestUpgraded", async () => {
            authedRequest.mockResolvedValueOnce({ user_id: "@u:e", access_token: "tok2" });
            const emitted: unknown[] = [];
            manager.on(GuestEvent.GuestUpgraded, (u) => emitted.push(u));

            await manager.upgradeGuestAccountOnServer({ username: "u", password: "pw" });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/account/guest/upgrade",
                undefined,
                { password: "pw", username: "u" },
                { prefix: "/_matrix/client/v3" },
            );
            expect(emitted).toEqual(["@u:e"]);
        });
    });

    describe("registerGuestOnServer", () => {
        it("POSTs /register/guest and emits GuestRegistered", async () => {
            request.mockResolvedValueOnce({ user_id: "@g:e", device_id: "D", access_token: "tok" });
            const emitted: unknown[] = [];
            manager.on(GuestEvent.GuestRegistered, (g) => emitted.push(g));

            await manager.registerGuestOnServer("D");

            expect(request).toHaveBeenCalledWith(
                Method.Post,
                "/register/guest",
                undefined,
                { device_id: "D" },
                { prefix: "/_matrix/client/v3" },
            );
            expect(emitted).toHaveLength(1);
        });
    });

    describe("canJoinRoom", () => {
        it("returns false for empty input", async () => {
            await expect(manager.canJoinRoom("")).resolves.toBe(false);
        });

        it("resolves an alias via /directory/room/{alias}", async () => {
            authedRequest.mockResolvedValueOnce({ room_id: "!r:e" });

            await expect(manager.canJoinRoom("#a:e")).resolves.toBe(true);
            expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/directory/room/%23a%3Ae", undefined, undefined, {
                prefix: "/_matrix/client/v3",
            });
        });

        it("returns false when alias lookup fails", async () => {
            authedRequest.mockRejectedValueOnce(Object.assign(new Error("nf"), { httpStatus: 404 }));
            await expect(manager.canJoinRoom("#a:e")).resolves.toBe(false);
        });
    });
});
