import { beforeEach, describe, expect, it, vi } from "vitest";

import { Method, ClientPrefix } from "../../src/http-api/index.ts";
import { UserReportManager } from "../../src/user-report/index.ts";

describe("UserReportManager", () => {
    let authedRequest: ReturnType<typeof vi.fn>;
    let manager: UserReportManager;

    beforeEach(() => {
        authedRequest = vi.fn();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        manager = new UserReportManager({ http: { authedRequest } } as any);
    });

    it("posts to /users/{userId}/report with the reason payload", async () => {
        authedRequest.mockResolvedValueOnce(undefined);

        await manager.reportUser("@bad:example.com", "spam");

        expect(authedRequest).toHaveBeenCalledTimes(1);
        expect(authedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/users/%40bad%3Aexample.com/report",
            undefined,
            {
                reason: "spam",
            },
            { prefix: ClientPrefix.V3 },
        );
    });

    it("includes room_id in the body when provided", async () => {
        authedRequest.mockResolvedValueOnce(undefined);

        await manager.reportUser("@bad:example.com", "harassment", "!room:example.com");

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/users/%40bad%3Aexample.com/report",
            undefined,
            {
                reason: "harassment",
                room_id: "!room:example.com",
            },
            { prefix: ClientPrefix.V3 },
        );
    });

    it("propagates 4xx errors from the backend", async () => {
        const httpError = Object.assign(new Error("Forbidden"), {
            httpStatus: 403,
            errcode: "M_FORBIDDEN",
        });
        authedRequest.mockRejectedValueOnce(httpError);

        await expect(manager.reportUser("@bad:example.com", "spam")).rejects.toMatchObject({
            httpStatus: 403,
            errcode: "M_FORBIDDEN",
        });
    });
});
