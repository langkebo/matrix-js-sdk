import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import { TelemetryManager } from "../../src/telemetry/index";

describe("TelemetryManager", () => {
    let mockClient: any;
    let telemetryManager: TelemetryManager;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
            getCrypto: vi.fn().mockReturnValue({}),
            supportsVoip: vi.fn().mockReturnValue(true),
            supportsThreads: vi.fn().mockReturnValue(true),
            version: "1.0.0",
        };
        telemetryManager = new TelemetryManager(mockClient);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe("constructor", () => {
        it("should initialize with default config", () => {
            expect(telemetryManager).toBeDefined();
            expect(telemetryManager.isEnabled()).toBe(false);
        });

        it("should initialize with custom config", () => {
            const manager = new TelemetryManager(mockClient, { enabled: true, sampleRate: 0.5 });
            expect(manager.isEnabled()).toBe(true);
        });
    });

    describe("configure", () => {
        it("should update config", () => {
            telemetryManager.configure({ enabled: true });
            expect(telemetryManager.isEnabled()).toBe(true);
        });

        it("should merge with existing config", () => {
            telemetryManager.configure({ enabled: true, endpoint: "https://example.com/telemetry" });
            expect(telemetryManager.isEnabled()).toBe(true);
        });
    });

    describe("enable/disable", () => {
        it("should enable telemetry", () => {
            telemetryManager.enable();
            expect(telemetryManager.isEnabled()).toBe(true);
        });

        it("should disable telemetry", () => {
            telemetryManager.enable();
            telemetryManager.disable();
            expect(telemetryManager.isEnabled()).toBe(false);
        });
    });

    describe("track", () => {
        it("should not track when disabled", () => {
            telemetryManager.track("test_event", { foo: "bar" });
            expect(telemetryManager.getPendingEvents()).toHaveLength(0);
        });

        it("should track event when enabled", () => {
            telemetryManager.enable();
            telemetryManager.track("test_event", { foo: "bar" });
            expect(telemetryManager.getPendingEvents()).toHaveLength(1);
        });

        it("should include timestamp in tracked event", () => {
            telemetryManager.enable();
            telemetryManager.track("test_event");
            const events = telemetryManager.getPendingEvents();
            expect(events[0].timestamp).toBeDefined();
        });
    });

    describe("trackMessageSent", () => {
        it("should track message sent event", () => {
            telemetryManager.enable();
            telemetryManager.trackMessageSent("!room:example.com", "m.text");
            const stats = telemetryManager.getUsageStats();
            expect(stats.messagesSent).toBe(1);
        });
    });

    describe("trackMessageReceived", () => {
        it("should track message received event", () => {
            telemetryManager.enable();
            telemetryManager.trackMessageReceived("!room:example.com", "m.text");
            const stats = telemetryManager.getUsageStats();
            expect(stats.messagesReceived).toBe(1);
        });
    });

    describe("trackRoomJoined", () => {
        it("should track room joined event", () => {
            telemetryManager.enable();
            telemetryManager.trackRoomJoined("!room:example.com");
            const stats = telemetryManager.getUsageStats();
            expect(stats.roomsJoined).toBe(1);
        });
    });

    describe("trackCall", () => {
        it("should track voice call", () => {
            telemetryManager.enable();
            telemetryManager.trackCall("voice");
            const stats = telemetryManager.getUsageStats();
            expect(stats.callsMade).toBe(1);
        });

        it("should track video call", () => {
            telemetryManager.enable();
            telemetryManager.trackCall("video");
            const stats = telemetryManager.getUsageStats();
            expect(stats.callsMade).toBe(1);
        });
    });

    describe("trackMediaUploaded", () => {
        it("should track media upload", () => {
            telemetryManager.enable();
            telemetryManager.trackMediaUploaded(1024, "image/png");
            const stats = telemetryManager.getUsageStats();
            expect(stats.mediaUploaded).toBe(1);
        });
    });

    describe("trackError", () => {
        it("should track error event", () => {
            telemetryManager.enable();
            const error = new Error("Test error");
            telemetryManager.trackError(error);
            const events = telemetryManager.getPendingEvents();
            expect(events).toHaveLength(1);
            expect(events[0].event).toBe("error");
        });
    });

    describe("getUsageStats", () => {
        it("should return copy of stats", () => {
            const stats1 = telemetryManager.getUsageStats();
            const stats2 = telemetryManager.getUsageStats();
            expect(stats1).not.toBe(stats2);
            expect(stats1).toEqual(stats2);
        });
    });

    describe("getSessionDuration", () => {
        it("should return positive duration", () => {
            const duration = telemetryManager.getSessionDuration();
            expect(duration).toBeGreaterThanOrEqual(0);
        });
    });

    describe("resetStats", () => {
        it("should reset all stats to zero", () => {
            telemetryManager.enable();
            telemetryManager.trackMessageSent("!room:example.com", "m.text");
            telemetryManager.resetStats();
            const stats = telemetryManager.getUsageStats();
            expect(stats.messagesSent).toBe(0);
        });
    });

    describe("flush", () => {
        it("should clear event queue", () => {
            telemetryManager.enable();
            telemetryManager.track("event1");
            telemetryManager.track("event2");
            telemetryManager.flush();
            expect(telemetryManager.getPendingEvents()).toHaveLength(0);
        });
    });

    describe("lifecycle", () => {
        it("start is a no-op and preserves pending events", () => {
            telemetryManager.enable();
            telemetryManager.track("event1");

            telemetryManager.start();

            expect(telemetryManager.getPendingEvents()).toHaveLength(1);
        });

        it("stop flushes the pending queue", () => {
            telemetryManager.enable();
            telemetryManager.track("event1");
            telemetryManager.track("event2");

            telemetryManager.stop();

            expect(telemetryManager.getPendingEvents()).toHaveLength(0);
        });
    });

    describe("getClientInfo", () => {
        it("should return client info", () => {
            const info = telemetryManager.getClientInfo();
            expect(info).toHaveProperty("version");
            expect(info).toHaveProperty("platform");
            expect(info).toHaveProperty("runtime");
            expect(info).toHaveProperty("features");
        });
    });

    describe("admin telemetry endpoints", () => {
        it("should fetch telemetry status", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({ enabled: true });

            await expect(telemetryManager.getServerStatus()).resolves.toEqual({ enabled: true });
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/telemetry/status",
                undefined,
                undefined,
                { prefix: "/_synapse/admin/v1" },
            );
        });

        it("should fetch telemetry attributes and metrics summary", async () => {
            mockClient.http.authedRequest
                .mockResolvedValueOnce({ attributes: { "service.name": "synapse-rust" } })
                .mockResolvedValueOnce({ total_metrics: 5 });

            await expect(telemetryManager.getServerAttributes()).resolves.toEqual({
                attributes: { "service.name": "synapse-rust" },
            });
            await expect(telemetryManager.getServerMetricsSummary()).resolves.toEqual({ total_metrics: 5 });

            expect(mockClient.http.authedRequest).toHaveBeenNthCalledWith(
                1,
                "GET",
                "/telemetry/attributes",
                undefined,
                undefined,
                { prefix: "/_synapse/admin/v1" },
            );
            expect(mockClient.http.authedRequest).toHaveBeenNthCalledWith(
                2,
                "GET",
                "/telemetry/metrics",
                undefined,
                undefined,
                { prefix: "/_synapse/admin/v1" },
            );
        });

        it("should fetch alerts with optional query params", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({ alerts: [] });

            await expect(
                telemetryManager.getServerAlerts({
                    status: "active",
                    severity: "critical",
                    refresh: false,
                }),
            ).resolves.toEqual({ alerts: [] });

            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/telemetry/alerts",
                {
                    status: "active",
                    severity: "critical",
                    refresh: "false",
                },
                undefined,
                { prefix: "/_synapse/admin/v1" },
            );
        });

        it("should acknowledge alerts and fetch health", async () => {
            mockClient.http.authedRequest
                .mockResolvedValueOnce({ alert_id: "alert-1", status: "acknowledged" })
                .mockResolvedValueOnce({ status: "ok", checks: [] });

            await expect(telemetryManager.acknowledgeServerAlert("alert-1")).resolves.toEqual({
                alert_id: "alert-1",
                status: "acknowledged",
            });
            await expect(telemetryManager.getServerHealth()).resolves.toEqual({ status: "ok", checks: [] });

            expect(mockClient.http.authedRequest).toHaveBeenNthCalledWith(
                1,
                "POST",
                "/telemetry/alerts/alert-1/ack",
                undefined,
                undefined,
                { prefix: "/_synapse/admin/v1" },
            );
            expect(mockClient.http.authedRequest).toHaveBeenNthCalledWith(
                2,
                "GET",
                "/telemetry/health",
                undefined,
                undefined,
                { prefix: "/_synapse/admin/v1" },
            );
        });

        it("should require an alert id when acknowledging alerts", async () => {
            await expect(telemetryManager.acknowledgeServerAlert("")).rejects.toThrow("Alert ID is required");
        });
    });
});
