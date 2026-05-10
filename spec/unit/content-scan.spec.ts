import { beforeEach, describe, expect, it, vi } from "vitest";

import { Method } from "../../src/http-api/index.ts";
import { ContentScanManager } from "../../src/content-scan/index.ts";

describe("ContentScanManager", () => {
    let authedRequest: ReturnType<typeof vi.fn>;
    let manager: ContentScanManager;

    beforeEach(() => {
        authedRequest = vi.fn();
        manager = new ContentScanManager({ http: { authedRequest } } as any);
        // Disable retries for deterministic 4xx assertions.
        manager.setRetryOptions({ maxRetries: 0 });
    });

    describe("scanContent", () => {
        it("posts to /v1/moderation/scan with urls + optional threat_type", async () => {
            const wireResults = [
                { url: "mxc://a", status: "clean" as const },
                { url: "mxc://b", status: "threat" as const, threat_type: "malware" },
            ];
            authedRequest.mockResolvedValueOnce(wireResults);

            const out = await manager.scanContent(["mxc://a", "mxc://b"], "any");

            expect(out).toEqual(wireResults);
            expect(authedRequest).toHaveBeenCalledWith(Method.Post, "/v1/moderation/scan", undefined, {
                urls: ["mxc://a", "mxc://b"],
                threat_type: "any",
            });
        });

        it("propagates 4xx errors", async () => {
            const err = Object.assign(new Error("Bad Request"), {
                httpStatus: 400,
                errcode: "M_INVALID_PARAM",
            });
            authedRequest.mockRejectedValueOnce(err);

            await expect(manager.scanContent(["mxc://a"])).rejects.toMatchObject({
                httpStatus: 400,
                errcode: "M_INVALID_PARAM",
            });
            expect(authedRequest).toHaveBeenCalledTimes(1);
        });
    });

    describe("getScanStatus", () => {
        it("GETs /v1/moderation/scan/status", async () => {
            authedRequest.mockResolvedValueOnce({
                enabled: true,
                last_scan: 1700000000,
                total_scanned: 42,
            });

            await expect(manager.getScanStatus()).resolves.toEqual({
                enabled: true,
                last_scan: 1700000000,
                total_scanned: 42,
            });
            expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/v1/moderation/scan/status");
        });

        it("propagates 401 errors", async () => {
            const err = Object.assign(new Error("Unauthorized"), { httpStatus: 401, errcode: "M_MISSING_TOKEN" });
            authedRequest.mockRejectedValueOnce(err);

            await expect(manager.getScanStatus()).rejects.toMatchObject({
                httpStatus: 401,
                errcode: "M_MISSING_TOKEN",
            });
        });
    });

    describe("isContentScanned", () => {
        it("returns true when scanContent succeeds", async () => {
            authedRequest.mockResolvedValueOnce([{ url: "mxc://a", status: "clean" as const }]);
            await expect(manager.isContentScanned("mxc://a")).resolves.toBe(true);
        });

        it("swallows errors and returns false", async () => {
            authedRequest.mockRejectedValueOnce(new Error("boom"));
            await expect(manager.isContentScanned("mxc://a")).resolves.toBe(false);
        });
    });
});
