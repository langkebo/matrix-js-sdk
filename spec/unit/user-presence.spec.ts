import { beforeEach, describe, expect, it, vi } from "vitest";

import { Method } from "../../src/http-api/index.ts";
import { UserPresenceManager } from "../../src/user-presence/index.ts";
import { InvalidParamError } from "../../src/common/errors.ts";

describe("UserPresenceManager", () => {
    let authedRequest: ReturnType<typeof vi.fn>;
    let manager: UserPresenceManager;
    let getUserId: ReturnType<typeof vi.fn>;
    let isGuest: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        authedRequest = vi.fn();
        getUserId = vi.fn().mockReturnValue("@self:example.com");
        isGuest = vi.fn().mockReturnValue(false);
        manager = new UserPresenceManager({
            http: { authedRequest },
            getUserId,
            isGuest,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        manager.setRetryOptions({ maxRetries: 0 });
    });

    describe("getUserPresence", () => {
        it("GETs /presence/{userId}/status and caches the result", async () => {
            authedRequest.mockResolvedValueOnce({
                presence: "online",
                last_active_ago: 1234,
                status_msg: "hi",
                currently_active: true,
            });

            const events: unknown[] = [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager.on("presenceUpdated" as any, (p: unknown) => events.push(p));

            const res = await manager.getUserPresence("@alice:example.com");

            expect(res.presence).toBe("online");
            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/presence/%40alice%3Aexample.com/status",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
            expect(manager.getCachedPresence("@alice:example.com")).toEqual({
                presence: "online",
                lastActiveAgo: 1234,
                statusMsg: "hi",
                currentlyActive: true,
            });
            expect(events).toHaveLength(1);
        });

        it("throws InvalidParamError when userId missing", async () => {
            await expect(manager.getUserPresence("")).rejects.toBeInstanceOf(InvalidParamError);
            expect(authedRequest).not.toHaveBeenCalled();
        });

        it("propagates 404 errors", async () => {
            const err = Object.assign(new Error("Not Found"), {
                httpStatus: 404,
                errcode: "M_NOT_FOUND",
            });
            authedRequest.mockRejectedValueOnce(err);

            await expect(manager.getUserPresence("@x:example.com")).rejects.toMatchObject({
                httpStatus: 404,
                errcode: "M_NOT_FOUND",
            });
        });
    });

    describe("setPresence", () => {
        it("PUTs /presence/{self}/status with presence and status_msg", async () => {
            authedRequest.mockResolvedValueOnce({});

            await manager.setPresence("online", "writing tests");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/presence/%40self%3Aexample.com/status",
                undefined,
                { presence: "online", status_msg: "writing tests" },
                { prefix: "/_matrix/client/v3" },
            );
            expect(manager.getCachedPresence("@self:example.com")).toEqual({
                presence: "online",
                statusMsg: "writing tests",
            });
        });

        it("rejects invalid presence states", async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await expect(manager.setPresence("invalid" as any)).rejects.toBeInstanceOf(InvalidParamError);
            expect(authedRequest).not.toHaveBeenCalled();
        });

        it("rejects when no user is logged in", async () => {
            getUserId.mockReturnValueOnce(null);

            await expect(manager.setPresence("online")).rejects.toBeInstanceOf(InvalidParamError);
        });

        it("propagates 403 typed errors", async () => {
            const err = Object.assign(new Error("Forbidden"), {
                httpStatus: 403,
                errcode: "M_FORBIDDEN",
            });
            authedRequest.mockRejectedValueOnce(err);

            await expect(manager.setPresence("online")).rejects.toMatchObject({
                httpStatus: 403,
                errcode: "M_FORBIDDEN",
            });
        });
    });

    describe("subscribeToPresence", () => {
        it("POSTs /presence/list with the user_ids array and emits", async () => {
            authedRequest.mockResolvedValueOnce(undefined);
            const events: unknown[] = [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager.on("presenceSubscribed" as any, (p: unknown) => events.push(p));

            await manager.subscribeToPresence(["@a:e.com", "@b:e.com"]);

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/presence/list",
                undefined,
                { user_ids: ["@a:e.com", "@b:e.com"] },
                { prefix: "/_matrix/client/v3" },
            );
            expect(events).toEqual([{ userIds: ["@a:e.com", "@b:e.com"] }]);
        });

        it("rejects empty userIds", async () => {
            await expect(manager.subscribeToPresence([])).rejects.toBeInstanceOf(InvalidParamError);
        });
    });

    describe("isPresenceAvailable", () => {
        it("returns true for non-guest sessions", () => {
            expect(manager.isPresenceAvailable()).toBe(true);
        });

        it("returns false when the client is in guest mode", () => {
            isGuest.mockReturnValueOnce(true);
            expect(manager.isPresenceAvailable()).toBe(false);
        });
    });

    describe("clearPresenceCache", () => {
        it("removes all cached entries", async () => {
            authedRequest.mockResolvedValueOnce({ presence: "online" });
            await manager.getUserPresence("@a:e.com");
            expect(manager.getCachedPresence("@a:e.com")).not.toBeNull();

            manager.clearPresenceCache();

            expect(manager.getCachedPresence("@a:e.com")).toBeNull();
        });
    });
});
