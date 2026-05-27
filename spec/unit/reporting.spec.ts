import { beforeEach, describe, expect, it, vi } from "vitest";

import { Method } from "../../src/http-api/index.ts";
import { ReportingManager } from "../../src/reporting/index.ts";

describe("ReportingManager", () => {
    let authedRequest: ReturnType<typeof vi.fn>;
    let manager: ReportingManager;

    beforeEach(() => {
        authedRequest = vi.fn();
        manager = new ReportingManager({ http: { authedRequest } } as any);
        // Disable retries so 4xx-style assertions stay deterministic.
        manager.setRetryOptions({ maxRetries: 0 });
    });

    describe("reportRoom", () => {
        it("posts the reason to /rooms/{roomId}/report", async () => {
            authedRequest.mockResolvedValueOnce(undefined);

            await manager.reportRoom("!abuse:example.com", "spam");

            expect(authedRequest).toHaveBeenCalledTimes(1);
            expect(authedRequest).toHaveBeenCalledWith(Method.Post, "/rooms/!abuse%3Aexample.com/report", undefined, {
                reason: "spam",
            });
        });

        it("propagates 4xx errors from the backend without retrying", async () => {
            const httpError = Object.assign(new Error("Bad Request"), {
                httpStatus: 400,
                errcode: "M_INVALID_PARAM",
            });
            authedRequest.mockRejectedValueOnce(httpError);

            await expect(manager.reportRoom("!abuse:example.com", "spam")).rejects.toMatchObject({
                httpStatus: 400,
                errcode: "M_INVALID_PARAM",
            });
            expect(authedRequest).toHaveBeenCalledTimes(1);
        });
    });

    describe("reportEvent", () => {
        it("encodes both room and event ids into the path", async () => {
            authedRequest.mockResolvedValueOnce(undefined);

            await manager.reportEvent("!abuse:example.com", "$evt:example.com", -50, "spam");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/rooms/!abuse%3Aexample.com/report/%24evt%3Aexample.com",
                undefined,
                { score: -50, reason: "spam" },
            );
        });

        it("propagates errors", async () => {
            const httpError = Object.assign(new Error("Not Found"), {
                httpStatus: 404,
                errcode: "M_NOT_FOUND",
            });
            authedRequest.mockRejectedValueOnce(httpError);

            await expect(manager.reportEvent("!abuse:example.com", "$evt:example.com", -100, "spam")).rejects.toMatchObject({
                httpStatus: 404,
                errcode: "M_NOT_FOUND",
            });
        });
    });

    describe("reportUser", () => {
        it("posts the reason without a score field", async () => {
            authedRequest.mockResolvedValueOnce(undefined);

            await manager.reportUser("@bad:example.com", "harassment");

            expect(authedRequest).toHaveBeenCalledWith(Method.Post, "/users/%40bad%3Aexample.com/report", undefined, {
                reason: "harassment",
            });
        });

        it("propagates 401 errors", async () => {
            const httpError = Object.assign(new Error("Unauthorized"), {
                httpStatus: 401,
                errcode: "M_MISSING_TOKEN",
            });
            authedRequest.mockRejectedValueOnce(httpError);

            await expect(manager.reportUser("@bad:example.com", "spam")).rejects.toMatchObject({
                httpStatus: 401,
                errcode: "M_MISSING_TOKEN",
            });
        });
    });
});
