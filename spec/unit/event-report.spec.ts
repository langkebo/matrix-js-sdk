import { beforeEach, describe, expect, it, vi } from "vitest";

import { EventReportManager } from "../../src/event-report/index";
import { Method } from "../../src/http-api/method";
import { AdminPrefix } from "../../src/http-api/prefix";
import { ValidationError } from "../../src/errors";

describe("EventReportManager", () => {
    let manager: EventReportManager;
    let mockAuthedRequest: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockAuthedRequest = vi.fn();
        manager = new EventReportManager({
            http: {
                authedRequest: mockAuthedRequest,
            },
        } as any);
    });

    it("lists reports with admin prefix and cursor query params", async () => {
        mockAuthedRequest.mockResolvedValueOnce([]);

        await manager.listReports({ limit: 50, since_id: 10, since_ts: 1234567890, since_score: 5 });

        expect(mockAuthedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/event_reports",
            { limit: 50, since_id: 10, since_ts: 1234567890, since_score: 5 },
            undefined,
            { prefix: AdminPrefix.V1 },
        );
    });

    it("fetches aggregate report count", async () => {
        mockAuthedRequest.mockResolvedValueOnce({ total_reports: 12 });

        const result = await manager.getReportsCount();

        expect(result).toEqual({ total_reports: 12 });
        expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/event_reports/count", undefined, undefined, {
            prefix: AdminPrefix.V1,
        });
    });

    it("getAllReports reuses the list route with validated query params", async () => {
        mockAuthedRequest.mockResolvedValueOnce([]);

        await manager.getAllReports({ limit: 20, since_id: 2 });

        expect(mockAuthedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/event_reports",
            { limit: 20, since_id: 2 },
            undefined,
            { prefix: AdminPrefix.V1 },
        );
    });

    it("fetches reports by event id", async () => {
        mockAuthedRequest.mockResolvedValueOnce([]);

        await manager.getReportsByEvent("$event:id");

        expect(mockAuthedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/event_reports/event/%24event%3Aid",
            undefined,
            undefined,
            { prefix: AdminPrefix.V1 },
        );
    });

    it("fetches reports by room id with validated room id", async () => {
        mockAuthedRequest.mockResolvedValueOnce([]);

        await manager.getReportsByRoom("!room:example.com", { limit: 25 });

        expect(mockAuthedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/event_reports/room/!room%3Aexample.com",
            { limit: 25 },
            undefined,
            { prefix: AdminPrefix.V1 },
        );
    });

    it("rejects invalid reporter user id", async () => {
        await expect(manager.getReportsByReporter("not-a-user-id")).rejects.toBeInstanceOf(ValidationError);
    });

    it("fetches reports by status", async () => {
        mockAuthedRequest.mockResolvedValueOnce([]);

        await manager.getReportsByStatus("resolved", { limit: 10 });

        expect(mockAuthedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/event_reports/status/resolved",
            { limit: 10 },
            undefined,
            { prefix: AdminPrefix.V1 },
        );
    });

    it("fetches count by status", async () => {
        mockAuthedRequest.mockResolvedValueOnce({ status: "open", count: 3 });

        const result = await manager.getStatusCount("open");

        expect(result).toEqual({ status: "open", count: 3 });
        expect(mockAuthedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/event_reports/status/open/count",
            undefined,
            undefined,
            { prefix: AdminPrefix.V1 },
        );
    });

    it("blocks and unblocks a reporter", async () => {
        mockAuthedRequest.mockResolvedValue({});

        await manager.blockUser("@alice:example.com", 1735689600000, "abuse");
        await manager.unblockUser("@alice:example.com");

        expect(mockAuthedRequest).toHaveBeenNthCalledWith(
            1,
            Method.Post,
            "/event_reports/rate_limit/%40alice%3Aexample.com/block",
            undefined,
            { blocked_until: 1735689600000, reason: "abuse" },
            { prefix: AdminPrefix.V1 },
        );
        expect(mockAuthedRequest).toHaveBeenNthCalledWith(
            2,
            Method.Post,
            "/event_reports/rate_limit/%40alice%3Aexample.com/unblock",
            undefined,
            undefined,
            { prefix: AdminPrefix.V1 },
        );
    });

    it("checks rate limit status", async () => {
        mockAuthedRequest.mockResolvedValueOnce({
            is_allowed: true,
            remaining_reports: 8,
            block_reason: null,
        });

        const result = await manager.checkRateLimit("@alice:example.com");

        expect(result).toEqual({
            is_allowed: true,
            remaining_reports: 8,
            block_reason: null,
        });
        expect(mockAuthedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/event_reports/rate_limit/%40alice%3Aexample.com",
            undefined,
            undefined,
            { prefix: AdminPrefix.V1 },
        );
    });

    it("creates a report on the admin v1 route", async () => {
        mockAuthedRequest.mockResolvedValueOnce({
            id: 1,
            event_id: "$event:id",
            room_id: "!room:example.com",
            reporter_user_id: "@admin:example.com",
            status: "open",
            score: 0,
            received_ts: 123,
        });

        await manager.createReport({
            event_id: "$event:id",
            room_id: "!room:example.com",
            reported_user_id: "@alice:example.com",
            reason: "spam",
        });

        expect(mockAuthedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/event_reports",
            undefined,
            {
                event_id: "$event:id",
                room_id: "!room:example.com",
                reported_user_id: "@alice:example.com",
                reason: "spam",
            },
            { prefix: AdminPrefix.V1 },
        );
    });

    it("fetches report detail and history by id", async () => {
        mockAuthedRequest.mockResolvedValueOnce({ id: 7 });
        mockAuthedRequest.mockResolvedValueOnce([{ id: 7 }]);

        await manager.getReport(7);
        await manager.getReportHistory(7);

        expect(mockAuthedRequest).toHaveBeenNthCalledWith(1, Method.Get, "/event_reports/7", undefined, undefined, {
            prefix: AdminPrefix.V1,
        });
        expect(mockAuthedRequest).toHaveBeenNthCalledWith(
            2,
            Method.Get,
            "/event_reports/7/history",
            undefined,
            undefined,
            { prefix: AdminPrefix.V1 },
        );
    });

    it("updates and moderates reports through admin action routes", async () => {
        mockAuthedRequest.mockResolvedValue({});

        await manager.updateReport(7, { status: "resolved", score: 10 });
        await manager.resolveReport(7, { resolution_reason: "handled" });
        await manager.dismissReport(7, { reason: "invalid" });
        await manager.escalateReport(7, { reason: "security" });
        await manager.deleteReport(7);

        expect(mockAuthedRequest).toHaveBeenNthCalledWith(
            1,
            Method.Put,
            "/event_reports/7",
            undefined,
            { status: "resolved", score: 10 },
            { prefix: AdminPrefix.V1 },
        );
        expect(mockAuthedRequest).toHaveBeenNthCalledWith(
            2,
            Method.Post,
            "/event_reports/7/resolve",
            undefined,
            { resolution_reason: "handled" },
            { prefix: AdminPrefix.V1 },
        );
        expect(mockAuthedRequest).toHaveBeenNthCalledWith(
            3,
            Method.Post,
            "/event_reports/7/dismiss",
            undefined,
            { reason: "invalid" },
            { prefix: AdminPrefix.V1 },
        );
        expect(mockAuthedRequest).toHaveBeenNthCalledWith(
            4,
            Method.Post,
            "/event_reports/7/escalate",
            undefined,
            { reason: "security" },
            { prefix: AdminPrefix.V1 },
        );
        expect(mockAuthedRequest).toHaveBeenNthCalledWith(5, Method.Delete, "/event_reports/7", undefined, undefined, {
            prefix: AdminPrefix.V1,
        });
    });

    it("fetches aggregate moderation stats", async () => {
        mockAuthedRequest.mockResolvedValueOnce({
            total: 10,
            open: 2,
            resolved: 3,
            dismissed: 4,
            escalated: 1,
        });

        const result = await manager.getStats();

        expect(result).toEqual({
            total: 10,
            open: 2,
            resolved: 3,
            dismissed: 4,
            escalated: 1,
        });
        expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/event_reports/stats", undefined, undefined, {
            prefix: AdminPrefix.V1,
        });
    });
});
