import { beforeEach, describe, expect, it, vi } from "vitest";

import { Method } from "../../src/http-api/index.ts";
import { ClientPrefix } from "../../src/http-api/prefix.ts";
import { NotificationsManager } from "../../src/notifications/index.ts";

describe("NotificationsManager", () => {
    let authedRequest: ReturnType<typeof vi.fn>;
    let manager: NotificationsManager;

    beforeEach(() => {
        authedRequest = vi.fn();
        manager = new NotificationsManager({ http: { authedRequest } } as any);
        manager.setRetryOptions({ maxRetries: 0 });
    });

    describe("getNotifications", () => {
        it("GETs /notifications under the v3 client prefix with no query params", async () => {
            authedRequest.mockResolvedValueOnce({ notifications: [] });

            await expect(manager.getNotifications()).resolves.toEqual({ notifications: [] });
            expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/notifications", undefined, undefined, {
                prefix: ClientPrefix.V3,
            });
        });

        it("forwards from/limit/only as query params", async () => {
            authedRequest.mockResolvedValueOnce({ notifications: [], next_token: "t2" });

            await manager.getNotifications({ from: "t1", limit: 25, only: "highlight" });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/notifications",
                { from: "t1", limit: 25, only: "highlight" },
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });

        it("rejects out-of-range limits via AdminValidators", async () => {
            await expect(manager.getNotifications({ limit: 0 })).rejects.toThrow(/Limit/i);
            expect(authedRequest).not.toHaveBeenCalled();
        });

        it("propagates 401 errors", async () => {
            const err = Object.assign(new Error("Unauthorized"), {
                httpStatus: 401,
                errcode: "M_MISSING_TOKEN",
            });
            authedRequest.mockRejectedValueOnce(err);

            await expect(manager.getNotifications({ limit: 10 })).rejects.toMatchObject({
                httpStatus: 401,
                errcode: "M_MISSING_TOKEN",
            });
        });
    });
});
