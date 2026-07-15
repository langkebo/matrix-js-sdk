import { beforeEach, describe, expect, it, vi } from "vitest";

import { ValidationError } from "../../src/errors";
import { BackgroundUpdateManager } from "../../src/background-update/index";

describe("BackgroundUpdateManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let mockAuthedRequest: ReturnType<typeof vi.fn>;
    let manager: BackgroundUpdateManager;

    beforeEach(() => {
        mockAuthedRequest = vi.fn().mockResolvedValue({});
        mockClient = {
            http: {
                authedRequest: mockAuthedRequest,
            },
        };
        manager = new BackgroundUpdateManager(mockClient);
    });

    it("lists background updates with admin prefix and pagination query", async () => {
        await manager.listBackgroundUpdates({ limit: 25, from: "opaque-token" });

        expect(mockAuthedRequest).toHaveBeenCalledWith(
            "GET",
            "/background_updates",
            { limit: "25", from: "opaque-token" },
            undefined,
            { prefix: "/_synapse/admin/v1" },
        );
    });

    it("creates background updates and validates required fields", async () => {
        await manager.createBackgroundUpdate({
            job_name: "populate-search",
            job_type: "reindex",
            total_items: 100,
        });

        expect(mockAuthedRequest).toHaveBeenCalledWith(
            "POST",
            "/background_updates",
            undefined,
            {
                job_name: "populate-search",
                job_type: "reindex",
                total_items: 100,
            },
            { prefix: "/_synapse/admin/v1" },
        );

        await expect(manager.createBackgroundUpdate({ job_name: "", job_type: "reindex" })).rejects.toThrow(
            ValidationError,
        );
        await expect(manager.createBackgroundUpdate({ job_name: "populate-search", job_type: "" })).rejects.toThrow(
            ValidationError,
        );
    });

    it("fetches count, next, pending, running and status endpoints", async () => {
        await manager.getUpdateCount();
        await manager.getNextPendingUpdate();
        await manager.listPendingUpdates();
        await manager.listRunningUpdates();
        await manager.getStatus();

        expect(mockAuthedRequest).toHaveBeenNthCalledWith(1, "GET", "/background_updates/count", undefined, undefined, {
            prefix: "/_synapse/admin/v1",
        });
        expect(mockAuthedRequest).toHaveBeenNthCalledWith(2, "GET", "/background_updates/next", undefined, undefined, {
            prefix: "/_synapse/admin/v1",
        });
        expect(mockAuthedRequest).toHaveBeenNthCalledWith(
            3,
            "GET",
            "/background_updates/pending",
            undefined,
            undefined,
            { prefix: "/_synapse/admin/v1" },
        );
        expect(mockAuthedRequest).toHaveBeenNthCalledWith(
            4,
            "GET",
            "/background_updates/running",
            undefined,
            undefined,
            { prefix: "/_synapse/admin/v1" },
        );
        expect(mockAuthedRequest).toHaveBeenNthCalledWith(
            5,
            "GET",
            "/background_updates/status",
            undefined,
            undefined,
            { prefix: "/_synapse/admin/v1" },
        );
    });

    it("retries failed updates, cleans locks and fetches stats with day limit", async () => {
        await manager.retryFailedUpdates();
        await manager.cleanupLocks();
        await manager.getStats(14);

        expect(mockAuthedRequest).toHaveBeenNthCalledWith(
            1,
            "POST",
            "/background_updates/retry_failed",
            undefined,
            undefined,
            { prefix: "/_synapse/admin/v1" },
        );
        expect(mockAuthedRequest).toHaveBeenNthCalledWith(
            2,
            "POST",
            "/background_updates/cleanup_locks",
            undefined,
            undefined,
            { prefix: "/_synapse/admin/v1" },
        );
        expect(mockAuthedRequest).toHaveBeenNthCalledWith(
            3,
            "GET",
            "/background_updates/stats",
            { limit: "14" },
            undefined,
            { prefix: "/_synapse/admin/v1" },
        );
    });

    it("counts by status with encoded path and validates status", async () => {
        await manager.countByStatus("in progress");

        expect(mockAuthedRequest).toHaveBeenCalledWith(
            "GET",
            "/background_updates/status/in%20progress/count",
            undefined,
            undefined,
            { prefix: "/_synapse/admin/v1" },
        );

        await expect(manager.countByStatus("")).rejects.toThrow(ValidationError);
    });

    it("gets and deletes a single update with encoded job name", async () => {
        await manager.getUpdate("job/one");
        await manager.deleteUpdate("job/one");

        expect(mockAuthedRequest).toHaveBeenNthCalledWith(
            1,
            "GET",
            "/background_updates/job%2Fone",
            undefined,
            undefined,
            { prefix: "/_synapse/admin/v1" },
        );
        expect(mockAuthedRequest).toHaveBeenNthCalledWith(
            2,
            "DELETE",
            "/background_updates/job%2Fone",
            undefined,
            undefined,
            { prefix: "/_synapse/admin/v1" },
        );
    });

    it("starts, completes and cancels a job", async () => {
        await manager.startUpdate("job-a");
        await manager.completeUpdate("job-a");
        await manager.cancelUpdate("job-a");

        expect(mockAuthedRequest).toHaveBeenNthCalledWith(
            1,
            "POST",
            "/background_updates/job-a/start",
            undefined,
            undefined,
            { prefix: "/_synapse/admin/v1" },
        );
        expect(mockAuthedRequest).toHaveBeenNthCalledWith(
            2,
            "POST",
            "/background_updates/job-a/complete",
            undefined,
            undefined,
            { prefix: "/_synapse/admin/v1" },
        );
        expect(mockAuthedRequest).toHaveBeenNthCalledWith(
            3,
            "POST",
            "/background_updates/job-a/cancel",
            undefined,
            undefined,
            { prefix: "/_synapse/admin/v1" },
        );
    });

    it("posts progress and validates items_processed", async () => {
        await manager.updateProgress("job-a", { items_processed: 12, total_items: 40 });

        expect(mockAuthedRequest).toHaveBeenCalledWith(
            "POST",
            "/background_updates/job-a/progress",
            undefined,
            { items_processed: 12, total_items: 40 },
            { prefix: "/_synapse/admin/v1" },
        );

        await expect(
            manager.updateProgress("job-a", { items_processed: undefined as unknown as number }),
        ).rejects.toThrow(ValidationError);
    });

    it("fails an update and validates error_message", async () => {
        await manager.failUpdate("job-a", { error_message: "database timeout" });

        expect(mockAuthedRequest).toHaveBeenCalledWith(
            "POST",
            "/background_updates/job-a/fail",
            undefined,
            { error_message: "database timeout" },
            { prefix: "/_synapse/admin/v1" },
        );

        await expect(manager.failUpdate("job-a", { error_message: "" })).rejects.toThrow(ValidationError);
    });

    it("fetches history with optional limit", async () => {
        await manager.getHistory("job/a", { limit: 5 });

        expect(mockAuthedRequest).toHaveBeenCalledWith(
            "GET",
            "/background_updates/job%2Fa/history",
            { limit: "5" },
            undefined,
            { prefix: "/_synapse/admin/v1" },
        );
    });
});
