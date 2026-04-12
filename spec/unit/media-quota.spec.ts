import { describe, it, expect, beforeEach, vi } from "vitest";

import { MediaQuotaManager } from "../../src/media-quota";

describe("MediaQuotaManager", () => {
    let mockClient: any;
    let manager: MediaQuotaManager;

    beforeEach(() => {
        mockClient = {
            getMediaConfig: vi.fn().mockResolvedValue({ "m.upload.size": 1234 }),
            getUserId: vi.fn().mockReturnValue("@me:hs"),
            getUserStorageUsage: vi.fn().mockResolvedValue({ size: 500, ntFiles: 2 }),
            getRoom: vi.fn(),
            http: {
                authedRequest: vi.fn().mockResolvedValue({ alerts: [{ alert_id: "a1" }] }),
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

    it("handles usage and derived metrics", async () => {
        await expect(manager.getUserStorageUsage()).resolves.toEqual({ size: 500, ntFiles: 2 });
        await expect(manager.getUsedStorage()).resolves.toBe(500);
        await expect(manager.getStorageQuota()).resolves.toBe(500);
        await expect(manager.getStorageUsagePercent()).resolves.toBe(100);
        await expect(manager.hasStorageSpace(10000)).resolves.toBe(true);

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

        mockClient.getRoom.mockReturnValue(undefined);
        await expect(manager.getRoomMediaSize("!missing:hs")).resolves.toBe(0);
    });

    it("uses fallback values for swallowed errors", async () => {
        const e = new Error("boom");
        mockClient.getMediaConfig.mockRejectedValue(e);
        await expect(manager.getUploadSizeLimit()).resolves.toBe(10 * 1024 * 1024);
        await expect(manager.getUploadFileSizeLimit()).resolves.toBe(10 * 1024 * 1024);
        await expect(manager.getUploadSizeLimit(true)).rejects.toThrow("boom");

        mockClient.getUserId.mockReturnValue("@me:hs");
        mockClient.getUserStorageUsage.mockRejectedValue(e);
        await expect(manager.getUserStorageUsage()).resolves.toBeNull();
        await expect(manager.getUserStorageUsage(true)).rejects.toThrow("boom");
    });
});
