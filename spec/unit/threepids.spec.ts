import { beforeEach, describe, expect, it, vi } from "vitest";

import { Method } from "../../src/http-api/index.ts";
import { ThreePidsManager } from "../../src/three-pids/index.ts";

describe("ThreePidsManager", () => {
    let authedRequest: ReturnType<typeof vi.fn>;
    let manager: ThreePidsManager;

    beforeEach(() => {
        authedRequest = vi.fn();
        manager = new ThreePidsManager({ http: { authedRequest } } as any);
        manager.setRetryOptions({ maxRetries: 0 });
    });

    describe("getThreePids", () => {
        it("GETs /account/3pid and returns the threepids list", async () => {
            authedRequest.mockResolvedValueOnce({
                threepids: [{ medium: "email", address: "a@b.com" }],
            });

            await expect(manager.getThreePids()).resolves.toEqual({
                threepids: [{ medium: "email", address: "a@b.com" }],
            });
            expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/account/3pid");
        });

        it("propagates 401 errors", async () => {
            const err = Object.assign(new Error("Unauthorized"), {
                httpStatus: 401,
                errcode: "M_MISSING_TOKEN",
            });
            authedRequest.mockRejectedValueOnce(err);

            await expect(manager.getThreePids()).rejects.toMatchObject({
                httpStatus: 401,
                errcode: "M_MISSING_TOKEN",
            });
        });
    });

    describe("addThreePidOnly", () => {
        it("POSTs to /account/3pid/add with client_secret + sid", async () => {
            authedRequest.mockResolvedValueOnce({});

            await manager.addThreePidOnly("secret", "sid-1");

            expect(authedRequest).toHaveBeenCalledWith(Method.Post, "/account/3pid/add", undefined, {
                client_secret: "secret",
                sid: "sid-1",
            });
        });

        it("propagates 400 typed errors", async () => {
            const err = Object.assign(new Error("Bad Request"), {
                httpStatus: 400,
                errcode: "M_THREEPID_AUTH_FAILED",
            });
            authedRequest.mockRejectedValueOnce(err);

            await expect(manager.addThreePidOnly("secret", "sid")).rejects.toMatchObject({
                httpStatus: 400,
                errcode: "M_THREEPID_AUTH_FAILED",
            });
        });
    });

    describe("bindThreePid", () => {
        it("POSTs /account/3pid/bind and emits threepid_bound", async () => {
            authedRequest.mockResolvedValueOnce({});
            const emitted: unknown[] = [];
            manager.on("threepid_bound" as any, (d: unknown) => emitted.push(d));

            await manager.bindThreePid("secret", "sid", "https://id.example.com", "id-token");

            expect(authedRequest).toHaveBeenCalledWith(Method.Post, "/account/3pid/bind", undefined, {
                client_secret: "secret",
                sid: "sid",
                id_server: "https://id.example.com",
                id_access_token: "id-token",
            });
            expect(emitted).toHaveLength(1);
        });

        it("does not emit when the backend rejects", async () => {
            authedRequest.mockRejectedValueOnce(Object.assign(new Error("nope"), { httpStatus: 403 }));
            const emitted: unknown[] = [];
            manager.on("threepid_bound" as any, (d: unknown) => emitted.push(d));

            await expect(manager.bindThreePid("secret", "sid", "https://id.example.com", null)).rejects.toMatchObject({
                httpStatus: 403,
            });
            expect(emitted).toEqual([]);
        });
    });

    describe("unbindThreePid", () => {
        it("POSTs /account/3pid/unbind and emits threepid_unbound", async () => {
            authedRequest.mockResolvedValueOnce({ id_server_unbind_result: "success" });
            const emitted: unknown[] = [];
            manager.on("threepid_unbound" as any, (d: unknown) => emitted.push(d));

            await manager.unbindThreePid("email", "a@b.com", "https://id.example.com");

            expect(authedRequest).toHaveBeenCalledWith(Method.Post, "/account/3pid/unbind", undefined, {
                medium: "email",
                address: "a@b.com",
                id_server: "https://id.example.com",
            });
            expect(emitted).toEqual([{ medium: "email", address: "a@b.com" }]);
        });
    });

    describe("deleteThreePid", () => {
        it("POSTs /account/3pid/delete and emits threepid_deleted", async () => {
            authedRequest.mockResolvedValueOnce({ id_server_unbind_result: "success" });
            const emitted: unknown[] = [];
            manager.on("threepid_deleted" as any, (d: unknown) => emitted.push(d));

            await manager.deleteThreePid("msisdn", "+441234567");

            expect(authedRequest).toHaveBeenCalledWith(Method.Post, "/account/3pid/delete", undefined, {
                medium: "msisdn",
                address: "+441234567",
                id_server: undefined,
            });
            expect(emitted).toEqual([{ medium: "msisdn", address: "+441234567" }]);
        });

        it("propagates 404 without emitting", async () => {
            authedRequest.mockRejectedValueOnce(
                Object.assign(new Error("Not Found"), { httpStatus: 404, errcode: "M_NOT_FOUND" }),
            );
            const emitted: unknown[] = [];
            manager.on("threepid_deleted" as any, (d: unknown) => emitted.push(d));

            await expect(manager.deleteThreePid("email", "a@b.com")).rejects.toMatchObject({
                httpStatus: 404,
                errcode: "M_NOT_FOUND",
            });
            expect(emitted).toEqual([]);
        });
    });
});
