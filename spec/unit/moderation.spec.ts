import { describe, expect, it, beforeEach } from "vitest";

import { FakeTransport } from "../test-utils/FakeTransport";
import { ModerationManager, type ScannerInfo } from "../../src/moderation/index";
import { Method } from "../../src/http-api/method";
import { MatrixError } from "../../src/http-api/errors";

describe("ModerationManager", () => {
    let transport: FakeTransport;
    let manager: ModerationManager;

    const roomId = "!test:example.org";
    const eventId = "$event123";

    function createManager(retryOpts = {}) {
        transport = new FakeTransport();
        manager = new ModerationManager({} as any, { transport, ...retryOpts });
    }

    beforeEach(() => {
        createManager();
    });

    describe("reportEvent", () => {
        it("sends POST to report an event", async () => {
            transport.respondWith(undefined);
            await manager.reportEvent(roomId, eventId, { reason: "spam", score: -10 });
            expect(transport.request).toHaveBeenCalled();
            transport.expectCalledWith(
                Method.Post,
                `/rooms/${encodeURIComponent(roomId)}/report/${encodeURIComponent(eventId)}`,
            );
        });

        it("sends report body with reason and score", async () => {
            transport.respondWith(undefined);
            await manager.reportEvent(roomId, eventId, { reason: "inappropriate", score: -5 });
            expect(transport.request).toHaveBeenCalledWith(
                Method.Post,
                `/rooms/${encodeURIComponent(roomId)}/report/${encodeURIComponent(eventId)}`,
                undefined,
                { reason: "inappropriate", score: -5 },
                expect.objectContaining({ prefix: "/_matrix/client/v3" }),
            );
        });

        it("wraps errors with normalizeError", async () => {
            createManager({ maxRetries: 0 });
            const err = new MatrixError({ errcode: "M_UNKNOWN", error: "fail" }, 500, undefined);
            transport.rejectWith(err);
            await expect(manager.reportEvent(roomId, eventId, {})).rejects.toThrow();
        });
    });

    describe("reportRoom", () => {
        it("sends POST to report a room", async () => {
            transport.respondWith(undefined);
            await manager.reportRoom(roomId, { reason: "offensive" });
            expect(transport.request).toHaveBeenCalled();
            transport.expectCalledWith(Method.Post, `/rooms/${encodeURIComponent(roomId)}/report`);
        });

        it("wraps errors with normalizeError", async () => {
            createManager({ maxRetries: 0 });
            transport.rejectWith(new MatrixError({ errcode: "M_FORBIDDEN", error: "denied" }, 403, undefined));
            await expect(manager.reportRoom(roomId, {})).rejects.toThrow();
        });
    });

    describe("updateReportScore", () => {
        it("sends PUT to update report score", async () => {
            transport.respondWith(undefined);
            await manager.updateReportScore(roomId, eventId, 42);
            transport.expectCalledWith(
                Method.Put,
                `/rooms/${encodeURIComponent(roomId)}/report/${encodeURIComponent(eventId)}/score`,
            );
            expect(transport.request).toHaveBeenCalledWith(
                Method.Put,
                expect.any(String),
                undefined,
                { score: 42 },
                expect.objectContaining({ prefix: "/_matrix/client/v3" }),
            );
        });

        it("wraps errors with normalizeError", async () => {
            createManager({ maxRetries: 0 });
            transport.rejectWith(new Error("network"));
            await expect(manager.updateReportScore(roomId, eventId, 0)).rejects.toThrow();
        });
    });

    describe("getScannerInfo", () => {
        it("sends GET to fetch scanner info", async () => {
            const scannerInfo: ScannerInfo = {
                enabled: true,
                version: "1.2.3",
                supported_algorithms: ["sha256", "blake2b"],
            };
            transport.respondWith(scannerInfo);
            const result = await manager.getScannerInfo(roomId, eventId);
            expect(result).toEqual(scannerInfo);
            transport.expectCalledWith(
                Method.Get,
                `/rooms/${encodeURIComponent(roomId)}/report/${encodeURIComponent(eventId)}/scanner_info`,
            );
        });

        it("wraps errors with normalizeError", async () => {
            createManager({ maxRetries: 0 });
            transport.rejectWith(new MatrixError({ errcode: "M_NOT_FOUND", error: "not found" }, 404, undefined));
            await expect(manager.getScannerInfo(roomId, eventId)).rejects.toThrow();
        });
    });
});
