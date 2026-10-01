import { describe, it, expect, beforeEach, vi } from "vitest";
import { FakeTransport } from "../test-utils/FakeTransport";
import { Method } from "../../src/http-api/method";
import { UnsupportedDelayedEventsEndpointError } from "../../src/errors";
import { UpdateDelayedEventAction } from "../../src/@types/requests";
import { buildUnstableFeaturePrefix, buildDelayedEventsPath } from "../../src/client-delayed-events";

const UNSTABLE_MSC4140_DELAYED_EVENTS = "org.matrix.msc4140";
const EXPECTED_PREFIX = buildUnstableFeaturePrefix(UNSTABLE_MSC4140_DELAYED_EVENTS);

describe("DelayedEventsManager", () => {
    let transport: FakeTransport;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let client: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let manager: any;

    beforeEach(async () => {
        transport = new FakeTransport();
        client = {
            doesServerSupportUnstableFeature: vi.fn().mockResolvedValue(true),
        };
        const { DelayedEventsManager } = await import("../../src/delayed-events/index");
        manager = new DelayedEventsManager(client, { transport });
    });

    // ==================== 管理操作 (action-in-BODY, 单次请求) ====================

    describe("management operations (SDK-BL-005: single action-in-BODY request, no fallback)", () => {
        // eslint-disable-next-line vitest/expect-expect
        it("cancelScheduledDelayedEvent should POST /delayed_events/{id} with {action:'cancel'}", async () => {
            transport.respondWith({});
            const delayId = "delay-1";

            await manager.cancelScheduledDelayedEvent(delayId);

            transport.expectCalledWithArgs(
                Method.Post,
                buildDelayedEventsPath(delayId),
                undefined,
                { action: UpdateDelayedEventAction.Cancel },
                { prefix: EXPECTED_PREFIX },
            );
        });

        // eslint-disable-next-line vitest/expect-expect
        it("restartScheduledDelayedEvent should POST with {action:'restart'}", async () => {
            transport.respondWith({});
            const delayId = "delay-2";

            await manager.restartScheduledDelayedEvent(delayId);

            transport.expectCalledWithArgs(
                Method.Post,
                buildDelayedEventsPath(delayId),
                undefined,
                { action: UpdateDelayedEventAction.Restart },
                { prefix: EXPECTED_PREFIX },
            );
        });

        // eslint-disable-next-line vitest/expect-expect
        it("sendScheduledDelayedEvent should POST with {action:'send'}", async () => {
            transport.respondWith({});
            const delayId = "delay-3";

            await manager.sendScheduledDelayedEvent(delayId);

            transport.expectCalledWithArgs(
                Method.Post,
                buildDelayedEventsPath(delayId),
                undefined,
                { action: UpdateDelayedEventAction.Send },
                { prefix: EXPECTED_PREFIX },
            );
        });

        it("should make exactly one request per management call (no action-in-PATH fallback)", async () => {
            transport.respondWith({});
            await manager.cancelScheduledDelayedEvent("delay-1");
            // SDK-BL-005: previously the fallback path issued a failed action-in-PATH
            // request before retrying action-in-BODY; now only one request is made.
            expect(transport.request).toHaveBeenCalledTimes(1);
        });

        // eslint-disable-next-line vitest/expect-expect
        it("should URL-encode the delay id in the path", async () => {
            transport.respondWith({});
            await manager.cancelScheduledDelayedEvent("delay/with/slash");

            transport.expectCalledWithArgs(
                Method.Post,
                "/delayed_events/delay%2Fwith%2Fslash",
                undefined,
                { action: UpdateDelayedEventAction.Cancel },
                { prefix: EXPECTED_PREFIX },
            );
        });
    });

    // ==================== 服务端能力校验 ====================

    describe("server support check", () => {
        it("should throw UnsupportedDelayedEventsEndpointError when server lacks MSC4140", async () => {
            client.doesServerSupportUnstableFeature.mockResolvedValue(false);

            await expect(manager.cancelScheduledDelayedEvent("delay-1")).rejects.toBeInstanceOf(
                UnsupportedDelayedEventsEndpointError,
            );
            expect(transport.request).not.toHaveBeenCalled();
        });

        it("should not send a request when support check fails", async () => {
            client.doesServerSupportUnstableFeature.mockResolvedValue(false);

            await expect(manager.sendScheduledDelayedEvent("delay-1")).rejects.toBeInstanceOf(
                UnsupportedDelayedEventsEndpointError,
            );
            expect(transport.request).not.toHaveBeenCalled();
        });
    });

    // ==================== 选项透传 ====================

    describe("request options pass-through", () => {
        it("should honor localTimeoutMs from requestOpts", async () => {
            transport.respondWith({});
            await manager.cancelScheduledDelayedEvent("delay-1", { localTimeoutMs: 12345 });

            const opts = transport.request.mock.calls[0][4];
            expect(opts?.localTimeoutMs).toBe(12345);
            expect(opts?.prefix).toBe(EXPECTED_PREFIX);
        });
    });

    // ==================== FT-084/FT-101: delayId 类型兼容 ====================
    // 后端 DelayedEvent.id 为 i64，JSON 响应 delay_id 返回 JSON number。
    // SDK 必须接受 number 类型的 delayId 而不抛 TypeError。

    describe("delayId type compatibility (FT-084/FT-101: backend returns i64)", () => {
        it("should accept number delayId without throwing TypeError", async () => {
            transport.respondWith({});
            // 后端 delay_id 为 i64 (JSON number)，SDK 不应在 requireNonEmptyString 处崩溃
            await manager.cancelScheduledDelayedEvent(12345);
            expect(transport.request).toHaveBeenCalledTimes(1);
        });

        // eslint-disable-next-line vitest/expect-expect
        it("should URL-encode number delayId correctly in path", async () => {
            transport.respondWith({});
            await manager.restartScheduledDelayedEvent(67890);

            transport.expectCalledWithArgs(
                Method.Post,
                "/delayed_events/67890",
                undefined,
                { action: UpdateDelayedEventAction.Restart },
                { prefix: EXPECTED_PREFIX },
            );
        });

        it("should accept string delayId (backward compat)", async () => {
            transport.respondWith({});
            await manager.sendScheduledDelayedEvent("delay-str-1");
            expect(transport.request).toHaveBeenCalledTimes(1);
        });

        it("should reject empty delayId (0)", async () => {
            await expect(manager.cancelScheduledDelayedEvent(0)).rejects.toThrow();
            expect(transport.request).not.toHaveBeenCalled();
        });
    });
});
