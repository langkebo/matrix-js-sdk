import { describe, it, expect, beforeEach, vi } from "vitest";

import { MediaQuotaManager } from "../../src/media-quota";

describe("MediaQuotaManager", () => {
    let mockClient: any;
    let manager: MediaQuotaManager;

    beforeEach(() => {
        const authedRequest = vi.fn().mockImplementation((_method: string, path: string) => {
            if (path === "/quota/stats") {
                return Promise.resolve({
                    user_id: "@me:hs",
                    storage_bytes: 500,
                    media_count: 2,
                    limit_bytes: 2000,
                });
            }
            if (path === "/quota/check") {
                return Promise.resolve({
                    limit: 2000,
                    used: 500,
                    remaining: 1500,
                    rule: "user_quota",
                });
            }
            if (path === "/quota/alerts") {
                return Promise.resolve({ alerts: [{ alert_id: "a1" }] });
            }
            return Promise.resolve({});
        });
        mockClient = {
            getMediaConfig: vi.fn().mockResolvedValue({ "m.upload.size": 1234 }),
            getUserId: vi.fn().mockReturnValue("@me:hs"),
            getRoom: vi.fn(),
            http: {
                authedRequest,
            },
        };
        manager = new MediaQuotaManager(mockClient);
    });

    it("reads upload limits and size checks", async () => {
        await expect(manager.getUploadSizeLimit()).resolves.toBe(1234);
        await expect(manager.getUploadFileSizeLimit()).resolves.toBe(1234);
        await expect(manager.isFileSizeAllowed(1000)).resolves.toBe(true);
        await expect(manager.isFileSizeAllowed(1300)).resolves.toBe(false);
    });

    it("exposes direct quota/config wrappers", async () => {
        await expect(manager.getMediaConfig()).resolves.toEqual({ "m.upload.size": 1234 });
        await expect(manager.getMediaConfig(true)).resolves.toEqual({ "m.upload.size": 1234 });
        await expect(manager.checkQuota()).resolves.toEqual({
            limit: 2000,
            used: 500,
            remaining: 1500,
            rule: "user_quota",
        });
        await expect(manager.getQuotaStats()).resolves.toEqual({
            user_id: "@me:hs",
            storage_bytes: 500,
            media_count: 2,
            limit_bytes: 2000,
        });

        expect(mockClient.getMediaConfig).toHaveBeenNthCalledWith(1, false);
        expect(mockClient.getMediaConfig).toHaveBeenNthCalledWith(2, true);
    });

    it("handles usage and derived metrics", async () => {
        await expect(manager.getUserStorageUsage()).resolves.toEqual({ size: 500, ntFiles: 2 });
        await expect(manager.getUsedStorage()).resolves.toBe(500);
        await expect(manager.getStorageQuota()).resolves.toBe(2000);
        await expect(manager.getStorageUsagePercent()).resolves.toBe(25);
        await expect(manager.hasStorageSpace(1000)).resolves.toBe(true);
        await expect(manager.hasStorageSpace(2000)).resolves.toBe(false);

        mockClient.getUserId.mockReturnValue(null);
        await expect(manager.getUserStorageUsage()).resolves.toBeNull();
    });

    it("calculates room media size and quota alerts", async () => {
        mockClient.getRoom.mockReturnValue({
            timeline: [
                { getType: () => "m.room.message", getContent: () => ({ msgtype: "m.image", info: { size: 100 } }) },
                { getType: () => "m.room.message", getContent: () => ({ msgtype: "m.video", info: { size: 200 } }) },
                { getType: () => "m.room.message", getContent: () => ({ msgtype: "m.text" }) },
            ],
        });
        await expect(manager.getRoomMediaSize("!r:hs")).resolves.toBe(300);
        await expect(manager.getQuotaAlerts()).resolves.toEqual([{ alert_id: "a1" }]);
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith("GET", "/quota/alerts", undefined, undefined, {
            prefix: "/_matrix/media/v1",
        });

        mockClient.getRoom.mockReturnValue(undefined);
        await expect(manager.getRoomMediaSize("!missing:hs")).resolves.toBe(0);
    });

    it("uses fallback values for swallowed errors", async () => {
        const e = new Error("boom");
        mockClient.getMediaConfig.mockRejectedValue(e);
        await expect(manager.getUploadSizeLimit(false)).resolves.toBe(10 * 1024 * 1024);
        await expect(manager.getUploadFileSizeLimit(false)).resolves.toBe(10 * 1024 * 1024);
        await expect(manager.getUploadSizeLimit()).rejects.toThrow("boom");
        await expect(manager.isFileSizeAllowed(1)).resolves.toBe(true);

        mockClient.getUserId.mockReturnValue("@me:hs");
        mockClient.http.authedRequest.mockRejectedValue(e);
        await expect(manager.getUserStorageUsage(false)).resolves.toBeNull();
        await expect(manager.getUserStorageUsage()).rejects.toThrow("boom");
        await expect(manager.getStorageQuota()).resolves.toBe(0);
        await expect(manager.getStorageUsagePercent()).resolves.toBe(0);
        await expect(manager.hasStorageSpace(1)).resolves.toBe(true);
        await expect(manager.getUsedStorage()).resolves.toBe(0);
    });
});
