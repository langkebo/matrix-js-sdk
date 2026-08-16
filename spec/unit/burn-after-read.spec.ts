import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { BurnAfterReadManager, BurnAfterReadEvent } from "../../src/burn-after-read/index";
import { AuthError, NotFoundError, RetryableError, ApiError, ValidationError } from "../../src/errors";
import { MatrixError } from "../../src/http-api/errors";
import { Method } from "../../src/http-api/method";
import { ClientPrefix, VendorPrefix } from "../../src/http-api/prefix";
import { getOrCreateManager } from "../../src/client-infra/manager-registry";

type MockBurnAfterReadClient = {
    getUserId: ReturnType<typeof vi.fn>;
    doesServerAdvertiseSynapseRustFeature?: ReturnType<typeof vi.fn>;
    http: {
        authedRequest: ReturnType<typeof vi.fn>;
    };
};

function createMockClient(
    authedRequest?: ReturnType<typeof vi.fn>,
    burnAfterReadSupported?: boolean,
): MockBurnAfterReadClient & ConstructorParameters<typeof BurnAfterReadManager>[0] {
    return {
        getUserId: vi.fn().mockReturnValue("@alice:test"),
        doesServerAdvertiseSynapseRustFeature:
            burnAfterReadSupported === undefined ? undefined : vi.fn().mockResolvedValue(burnAfterReadSupported),
        http: {
            authedRequest: authedRequest ?? vi.fn().mockResolvedValue({}),
        },
    } as MockBurnAfterReadClient & ConstructorParameters<typeof BurnAfterReadManager>[0];
}

function createMatrixError(status: number, errcode: string, message: string): MatrixError {
    return new MatrixError({ errcode, error: message }, status);
}

describe("BurnAfterReadManager", () => {
    let authedRequest: ReturnType<typeof vi.fn>;
    let manager: BurnAfterReadManager;

    beforeEach(() => {
        authedRequest = vi.fn().mockResolvedValue({
            enabled: true,
            burn_after_ms: 60000,
        });
        manager = new BurnAfterReadManager(createMockClient(authedRequest));
    });

    afterEach(() => {
        manager.stop();
    });

    describe("constructor and configuration", () => {
        it("initializes with default config", () => {
            const config = manager.getConfig();
            expect(config.enabled).toBe(true);
            expect(config.default_expire_time).toBe(60000);
            expect(config.max_expire_time).toBe(86400000);
            expect(config.min_expire_time).toBe(1000);
            expect(config.encrypt_content).toBe(false);
        });

        it("accepts custom config", () => {
            const custom = new BurnAfterReadManager(createMockClient(), {
                enabled: false,
                default_expire_time: 30000,
                max_expire_time: 3600000,
                encrypt_content: true,
            });
            const config = custom.getConfig();
            expect(config.enabled).toBe(false);
            expect(config.default_expire_time).toBe(30000);
            expect(config.max_expire_time).toBe(3600000);
            expect(config.encrypt_content).toBe(true);
            custom.stop();
        });

        it("setConfig validates burn time", () => {
            expect(() => manager.setConfig({ default_expire_time: 0 })).toThrow(ValidationError);
            expect(() => manager.setConfig({ default_expire_time: -1 })).toThrow(ValidationError);
            expect(() => manager.setConfig({ default_expire_time: 999999999 })).toThrow(ValidationError);
        });

        it("setConfig accepts valid burn time", () => {
            manager.setConfig({ default_expire_time: 30000 });
            expect(manager.getConfig().default_expire_time).toBe(30000);
        });

        it("getBurnConfig returns the same configuration shape as getConfig", () => {
            manager.setConfig({ enabled: false, default_expire_time: 30000 });

            expect(manager.getBurnConfig()).toEqual(manager.getConfig());
        });
    });

    describe("enableBurn", () => {
        it("sends PUT request with correct path and prefix", async () => {
            await manager.enableBurn("!room:test");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/rooms/!room%3Atest/burn",
                undefined,
                { enabled: true, burn_after_ms: 60000 },
                { prefix: VendorPrefix },
            );
        });

        it("sends custom burn_after_ms", async () => {
            await manager.enableBurn("!room:test", 30000);

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/rooms/!room%3Atest/burn",
                undefined,
                { enabled: true, burn_after_ms: 30000 },
                { prefix: VendorPrefix },
            );
        });

        it("defaults to vendor prefix when no version specified", async () => {
            manager = new BurnAfterReadManager(createMockClient(authedRequest, true));

            await manager.enableBurn("!room:test");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/rooms/!room%3Atest/burn",
                undefined,
                { enabled: true, burn_after_ms: 60000 },
                { prefix: VendorPrefix },
            );
        });

        it("respects an explicit v1 version even when burn-after-read support is advertised", async () => {
            manager = new BurnAfterReadManager(createMockClient(authedRequest, true));

            await manager.enableBurn("!room:test", undefined, "v1");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/rooms/!room%3Atest/burn",
                undefined,
                { enabled: true, burn_after_ms: 60000 },
                { prefix: ClientPrefix.V1 },
            );
        });

        it("caches room settings after enable", async () => {
            authedRequest.mockResolvedValue({ enabled: true, burn_after_ms: 45000 });
            await manager.enableBurn("!room:test", 45000);

            const settings = manager.getRoomSettings("!room:test");
            expect(settings).toEqual({ enabled: true, burn_after_ms: 45000 });
        });

        it("emits SettingsChanged event", async () => {
            const listener = vi.fn();
            manager.on(BurnAfterReadEvent.SettingsChanged, listener);

            await manager.enableBurn("!room:test");

            expect(listener).toHaveBeenCalledWith("!room:test", { enabled: true, burn_after_ms: 60000 });
        });

        it("throws ValidationError for empty roomId", async () => {
            await expect(manager.enableBurn("")).rejects.toThrow(ValidationError);
        });

        it("throws ValidationError for invalid burn time", async () => {
            await expect(manager.enableBurn("!room:test", 0)).rejects.toThrow(ValidationError);
            await expect(manager.enableBurn("!room:test", -1)).rejects.toThrow(ValidationError);
            await expect(manager.enableBurn("!room:test", 999999999)).rejects.toThrow(ValidationError);
        });

        it("normalizes MatrixError to AuthError on 401", async () => {
            authedRequest.mockRejectedValue(createMatrixError(401, "M_UNKNOWN_TOKEN", "Token expired"));

            await expect(manager.enableBurn("!room:test")).rejects.toThrow(AuthError);
        });

        it("normalizes MatrixError to NotFoundError on 404", async () => {
            authedRequest.mockRejectedValue(createMatrixError(404, "M_NOT_FOUND", "Not found"));

            await expect(manager.enableBurn("!room:test")).rejects.toThrow(NotFoundError);
        });

        it("normalizes MatrixError to RetryableError on 429", async () => {
            authedRequest.mockRejectedValue(createMatrixError(429, "M_LIMIT_EXCEEDED", "Rate limited"));

            await expect(manager.enableBurn("!room:test")).rejects.toThrow(RetryableError);
        });

        it("normalizes MatrixError to RetryableError on 500", async () => {
            authedRequest.mockRejectedValue(createMatrixError(500, "M_UNKNOWN", "Internal error"));

            await expect(manager.enableBurn("!room:test")).rejects.toThrow(RetryableError);
        });

        it("normalizes MatrixError to ApiError on 400", async () => {
            authedRequest.mockRejectedValue(createMatrixError(400, "M_BAD_JSON", "Bad request"));

            await expect(manager.enableBurn("!room:test")).rejects.toThrow(ApiError);
        });
    });

    describe("disableBurn", () => {
        it("sends PUT request with enabled=false", async () => {
            authedRequest.mockResolvedValue({ enabled: false, burn_after_ms: 60000 });

            await manager.disableBurn("!room:test");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/rooms/!room%3Atest/burn",
                undefined,
                { enabled: false },
                { prefix: VendorPrefix },
            );
        });

        it("throws ValidationError for empty roomId", async () => {
            await expect(manager.disableBurn("")).rejects.toThrow(ValidationError);
        });
    });

    describe("getBurnSettings", () => {
        it("sends GET request with correct path", async () => {
            authedRequest.mockResolvedValue({ enabled: true, burn_after_ms: 45000 });

            const settings = await manager.getBurnSettings("!room:test");

            expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/rooms/!room%3Atest/burn", undefined, undefined, {
                prefix: VendorPrefix,
            });
            expect(settings).toEqual({ enabled: true, burn_after_ms: 45000 });
        });

        it("returns defaults when server returns partial response", async () => {
            authedRequest.mockResolvedValue({});

            const settings = await manager.getBurnSettings("!room:test");

            expect(settings).toEqual({ enabled: false, burn_after_ms: 60000 });
        });
    });

    describe("getPendingBurns", () => {
        it("sends GET request to pending endpoint", async () => {
            authedRequest.mockResolvedValue({
                events: [
                    { event_id: "$ev1", created_at: 1000, delete_at: 61000 },
                    { event_id: "$ev2", created_at: 2000, delete_at: 62000 },
                ],
            });

            const pending = await manager.getPendingBurns("!room:test");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/rooms/!room%3Atest/burn/pending",
                undefined,
                undefined,
                { prefix: VendorPrefix },
            );
            expect(pending).toHaveLength(2);
            expect(pending[0].event_id).toBe("$ev1");
        });

        it("returns empty array when no events", async () => {
            authedRequest.mockResolvedValue({});

            const pending = await manager.getPendingBurns("!room:test");

            expect(pending).toEqual([]);
        });
    });

    describe("markBurnRead", () => {
        it("sends POST request to mark message as read", async () => {
            authedRequest.mockResolvedValue({ success: true, will_delete_at: 1700000000000 });

            const result = await manager.markBurnRead("!room:test", "$event1");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/rooms/!room%3Atest/burn/%24event1",
                undefined,
                undefined,
                { prefix: VendorPrefix },
            );
            expect(result.success).toBe(true);
            expect(result.will_delete_at).toBe(1700000000000);
        });

        it("validates required parameters", async () => {
            await expect(manager.markBurnRead("", "$event1")).rejects.toThrow(ValidationError);
            await expect(manager.markBurnRead("!room:test", "")).rejects.toThrow(ValidationError);
        });

        it("emits MessageRead event for cached message", async () => {
            authedRequest.mockResolvedValue({ event_id: "$event1" });

            await manager.sendMessage({
                room_id: "!room:test",
                content: { body: "secret", msgtype: "m.text" },
            });

            const listener = vi.fn();
            manager.on(BurnAfterReadEvent.MessageRead, listener);

            authedRequest.mockResolvedValue({ success: true, will_delete_at: Date.now() + 60000 });

            await manager.markBurnRead("!room:test", "$event1");

            expect(listener).toHaveBeenCalledWith("$event1", expect.any(Number));
        });
    });

    describe("cancelBurn", () => {
        it("sends DELETE request", async () => {
            authedRequest.mockResolvedValue({ success: true });

            const result = await manager.cancelBurn("!room:test", "$event1");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Delete,
                "/rooms/!room%3Atest/burn/%24event1",
                undefined,
                undefined,
                { prefix: VendorPrefix },
            );
            expect(result.success).toBe(true);
        });

        it("emits BurnCancelled event and clears local timer", async () => {
            const listener = vi.fn();
            manager.on(BurnAfterReadEvent.BurnCancelled, listener);

            await manager.cancelBurn("!room:test", "$event1");

            expect(listener).toHaveBeenCalledWith("$event1");
        });
    });

    describe("setBurnConfig", () => {
        it("sends PUT request with default_burn_ms", async () => {
            authedRequest.mockResolvedValue({ default_burn_ms: 90000 });

            const result = await manager.setBurnConfig(90000);

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/user/burn/config",
                undefined,
                { default_burn_ms: 90000 },
                { prefix: VendorPrefix },
            );
            expect(result.default_burn_ms).toBe(90000);
        });

        it("updates local config from server response", async () => {
            authedRequest.mockResolvedValue({ default_burn_ms: 45000 });

            await manager.setBurnConfig(60000);

            expect(manager.getConfig().default_expire_time).toBe(45000);
        });

        it("validates burn time", async () => {
            await expect(manager.setBurnConfig(0)).rejects.toThrow(ValidationError);
            await expect(manager.setBurnConfig(-1)).rejects.toThrow(ValidationError);
        });
    });

    describe("getBurnStats", () => {
        it("sends GET request and returns stats", async () => {
            authedRequest.mockResolvedValue({
                total_burned: 10,
                total_pending: 3,
                rooms_with_burn_enabled: 2,
            });

            const stats = await manager.getBurnStats();

            expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/user/burn/stats", undefined, undefined, {
                prefix: VendorPrefix,
            });
            expect(stats).toEqual({
                total_burned: 10,
                total_pending: 3,
                rooms_with_burn_enabled: 2,
            });
        });

        it("returns zeros for missing fields", async () => {
            authedRequest.mockResolvedValue({});

            const stats = await manager.getBurnStats();

            expect(stats).toEqual({
                total_burned: 0,
                total_pending: 0,
                rooms_with_burn_enabled: 0,
            });
        });
    });

    describe("sendMessage", () => {
        it("sends message with burn_after_read metadata", async () => {
            authedRequest.mockResolvedValue({ event_id: "$new_event" });

            const result = await manager.sendMessage({
                room_id: "!room:test",
                content: { body: "secret message", msgtype: "m.text" },
            });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Put,
                expect.stringContaining("/rooms/!room%3Atest/send/m.room.message/"),
                undefined,
                expect.objectContaining({
                    "m.burn_after_read": { expires_in: 60000 },
                    body: "secret message",
                }),
                { prefix: ClientPrefix.V3 },
            );

            expect(result.event_id).toBe("$new_event");
            expect(result.expires_in).toBe(60000);
            expect(result.expires_at).toBeGreaterThan(0);
        });

        it("sends message with custom expires_in", async () => {
            authedRequest.mockResolvedValue({ event_id: "$new_event" });

            await manager.sendMessage({
                room_id: "!room:test",
                content: { body: "secret" },
                expires_in: 30000,
            });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Put,
                expect.any(String),
                undefined,
                expect.objectContaining({
                    "m.burn_after_read": { expires_in: 30000 },
                }),
                { prefix: ClientPrefix.V3 },
            );
        });

        it("sends message with encryption flag", async () => {
            authedRequest.mockResolvedValue({ event_id: "$new_event" });

            await manager.sendMessage({
                room_id: "!room:test",
                content: { body: "secret" },
                encrypt: true,
            });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Put,
                expect.any(String),
                undefined,
                expect.objectContaining({
                    "m.burn_after_read": { expires_in: 60000, encrypted: true },
                }),
                { prefix: ClientPrefix.V3 },
            );
        });

        it("caches message locally and emits MessageSent", async () => {
            authedRequest.mockResolvedValue({ event_id: "$sent_event" });
            const listener = vi.fn();
            manager.on(BurnAfterReadEvent.MessageSent, listener);

            await manager.sendMessage({
                room_id: "!room:test",
                content: { body: "secret" },
            });

            expect(listener).toHaveBeenCalledWith(
                expect.objectContaining({
                    event_id: "$sent_event",
                    room_id: "!room:test",
                    is_encrypted: false,
                }),
            );

            const cached = manager.getCachedMessage("$sent_event");
            expect(cached).not.toBeNull();
            expect(cached!.expires_in).toBe(60000);
        });

        it("throws ValidationError when disabled", async () => {
            manager.setConfig({ enabled: false });

            await expect(
                manager.sendMessage({
                    room_id: "!room:test",
                    content: { body: "secret" },
                }),
            ).rejects.toThrow(ValidationError);
        });

        it("throws ValidationError for missing room_id", async () => {
            await expect(
                manager.sendMessage({
                    room_id: "",
                    content: { body: "secret" },
                }),
            ).rejects.toThrow(ValidationError);
        });

        it("throws ValidationError for missing content", async () => {
            await expect(
                manager.sendMessage({
                    room_id: "!room:test",
                    content: null as unknown as Parameters<typeof manager.sendMessage>[0]["content"],
                }),
            ).rejects.toThrow(ValidationError);
        });

        it("throws ValidationError for invalid expires_in", async () => {
            await expect(
                manager.sendMessage({
                    room_id: "!room:test",
                    content: { body: "secret" },
                    expires_in: 0,
                }),
            ).rejects.toThrow(ValidationError);
        });

        it("emits BurnError on failure", async () => {
            authedRequest.mockRejectedValue(createMatrixError(500, "M_UNKNOWN", "Server error"));
            const listener = vi.fn();
            manager.on(BurnAfterReadEvent.BurnError, listener);

            await expect(
                manager.sendMessage({
                    room_id: "!room:test",
                    content: { body: "secret" },
                }),
            ).rejects.toThrow(RetryableError);

            expect(listener).toHaveBeenCalledWith("", expect.any(RetryableError));
        });
    });

    describe("burnMessage", () => {
        it("sends redact request for cached message", async () => {
            authedRequest.mockResolvedValue({ event_id: "$to_burn" });

            await manager.sendMessage({
                room_id: "!room:test",
                content: { body: "secret" },
            });

            authedRequest.mockResolvedValue({});
            const listener = vi.fn();
            manager.on(BurnAfterReadEvent.MessageBurned, listener);

            await manager.burnMessage("$to_burn");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Put,
                expect.stringContaining("/rooms/!room%3Atest/redact/%24to_burn/"),
                undefined,
                { reason: "Burn after read" },
                { prefix: ClientPrefix.V3 },
            );

            expect(listener).toHaveBeenCalledWith("$to_burn", expect.any(Number));
            expect(manager.getCachedMessage("$to_burn")).toBeNull();
        });

        it("skips silently when message not in cache", async () => {
            await manager.burnMessage("$nonexistent");

            expect(authedRequest).not.toHaveBeenCalledWith(
                Method.Put,
                expect.any(String),
                expect.anything(),
                expect.anything(),
                expect.anything(),
            );
        });

        it("throws ValidationError for empty eventId", async () => {
            await expect(manager.burnMessage("")).rejects.toThrow(ValidationError);
        });
    });

    describe("markAsRead", () => {
        it("updates read_at and emits MessageRead for cached message", async () => {
            authedRequest.mockResolvedValue({ event_id: "$msg1" });
            await manager.sendMessage({
                room_id: "!room:test",
                content: { body: "secret" },
            });

            const listener = vi.fn();
            manager.on(BurnAfterReadEvent.MessageRead, listener);

            await manager.markAsRead("!room:test", "$msg1");

            expect(listener).toHaveBeenCalledWith("$msg1", expect.any(Number));

            const msg = manager.getCachedMessage("$msg1");
            expect(msg!.read_at).toBeGreaterThan(0);
        });

        it("does nothing for unknown message", async () => {
            const listener = vi.fn();
            manager.on(BurnAfterReadEvent.MessageRead, listener);

            await manager.markAsRead("!room:test", "$unknown");

            expect(listener).not.toHaveBeenCalled();
        });
    });

    describe("local cache accessors", () => {
        it("getBurnAfterReadMessage returns a cached message by id", async () => {
            authedRequest.mockResolvedValue({ event_id: "$msg1" });

            await manager.sendMessage({
                room_id: "!room:test",
                content: { body: "secret" },
            });

            await expect(manager.getBurnAfterReadMessage("$msg1")).resolves.toEqual(
                expect.objectContaining({
                    event_id: "$msg1",
                    room_id: "!room:test",
                }),
            );
        });

        it("getPendingLocalBurns proxies to filtered local messages", async () => {
            authedRequest.mockResolvedValueOnce({ event_id: "$room1" });
            authedRequest.mockResolvedValueOnce({ event_id: "$room2" });

            await manager.sendMessage({ room_id: "!room1:test", content: { body: "a" } });
            await manager.sendMessage({ room_id: "!room2:test", content: { body: "b" } });

            await expect(manager.getPendingLocalBurns("!room1:test")).resolves.toEqual([
                expect.objectContaining({
                    event_id: "$room1",
                    room_id: "!room1:test",
                }),
            ]);
        });
    });

    describe("cancelLocalBurn", () => {
        it("clears timer and resets expires for cached message", async () => {
            authedRequest.mockResolvedValue({ event_id: "$msg1" });
            await manager.sendMessage({
                room_id: "!room:test",
                content: { body: "secret" },
            });

            const listener = vi.fn();
            manager.on(BurnAfterReadEvent.BurnCancelled, listener);

            await manager.cancelLocalBurn("$msg1");

            expect(listener).toHaveBeenCalledWith("$msg1");

            const msg = manager.getCachedMessage("$msg1");
            expect(msg!.expires_at).toBeUndefined();
            expect(msg!.expires_in).toBeUndefined();
        });
    });

    describe("extendBurnTime", () => {
        it("extends expiration time for cached message", async () => {
            authedRequest.mockResolvedValue({ event_id: "$msg1" });
            await manager.sendMessage({
                room_id: "!room:test",
                content: { body: "secret" },
                expires_in: 30000,
            });

            await manager.extendBurnTime("$msg1", 10000);

            const msg = manager.getCachedMessage("$msg1");
            expect(msg!.expires_in).toBe(40000);
            expect(msg!.expires_at).toBeGreaterThan(0);
        });

        it("throws NotFoundError for unknown message", async () => {
            await expect(manager.extendBurnTime("$unknown", 10000)).rejects.toThrow(NotFoundError);
        });

        it("throws ValidationError for non-positive additionalTime", async () => {
            await expect(manager.extendBurnTime("$msg1", 0)).rejects.toThrow(ValidationError);
            await expect(manager.extendBurnTime("$msg1", -1)).rejects.toThrow(ValidationError);
        });

        it("throws ValidationError when extended time exceeds max", async () => {
            authedRequest.mockResolvedValue({ event_id: "$msg1" });
            await manager.sendMessage({
                room_id: "!room:test",
                content: { body: "secret" },
                expires_in: 86000000,
            });

            await expect(manager.extendBurnTime("$msg1", 500000)).rejects.toThrow(ValidationError);
        });
    });

    describe("isBurnEnabled", () => {
        it("returns false without probing room settings when the server does not advertise burn-after-read", async () => {
            manager = new BurnAfterReadManager(createMockClient(authedRequest, false));

            const result = await manager.isBurnEnabled("!room:test");

            expect(result).toBe(false);
            expect(authedRequest).not.toHaveBeenCalled();
        });

        it("checks room settings when the server advertises burn-after-read", async () => {
            manager = new BurnAfterReadManager(createMockClient(authedRequest, true));
            authedRequest.mockResolvedValue({ enabled: true, burn_after_ms: 60000 });

            const result = await manager.isBurnEnabled("!room:test");

            expect(result).toBe(true);
            expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/rooms/!room%3Atest/burn", undefined, undefined, {
                prefix: VendorPrefix,
            });
        });

        it("returns cached settings when available", async () => {
            authedRequest.mockResolvedValue({ enabled: true, burn_after_ms: 60000 });
            await manager.enableBurn("!room:test");

            const result = await manager.isBurnEnabled("!room:test");

            expect(result).toBe(true);
        });

        it("falls back to API when no cache", async () => {
            authedRequest.mockResolvedValue({ enabled: false, burn_after_ms: 60000 });

            const result = await manager.isBurnEnabled("!room:test");

            expect(result).toBe(false);
        });

        it("falls back to config.enabled on API error", async () => {
            authedRequest.mockRejectedValue(new Error("Network error"));

            const result = await manager.isBurnEnabled("!room:test");

            expect(result).toBe(true);
        });

        it("falls back to config.enabled when feature discovery fails", async () => {
            const client = createMockClient(authedRequest, true);
            client.doesServerAdvertiseSynapseRustFeature.mockRejectedValue(new Error("versions unavailable"));
            manager = new BurnAfterReadManager(client);
            authedRequest.mockRejectedValue(new Error("Network error"));

            const result = await manager.isBurnEnabled("!room:test");

            expect(result).toBe(true);
        });
    });

    describe("compatibility aliases", () => {
        it("enableBurnAfterRead enables the feature and delegates to enableBurn", async () => {
            const enableBurnSpy = vi.spyOn(manager, "enableBurn").mockResolvedValue({
                enabled: true,
                burn_after_ms: 45000,
            });

            await manager.enableBurnAfterRead("!room:test", 45000);

            expect(manager.getConfig().enabled).toBe(true);
            expect(manager.getConfig().default_expire_time).toBe(45000);
            expect(enableBurnSpy).toHaveBeenCalledWith("!room:test", 45000);
        });

        it("disableBurnAfterRead disables the feature and delegates to disableBurn", async () => {
            const disableBurnSpy = vi.spyOn(manager, "disableBurn").mockResolvedValue({
                enabled: false,
                burn_after_ms: 60000,
            });

            await manager.disableBurnAfterRead("!room:test");

            expect(manager.getConfig().enabled).toBe(false);
            expect(disableBurnSpy).toHaveBeenCalledWith("!room:test");
        });
    });

    describe("lifecycle management", () => {
        it("start() does not throw", () => {
            expect(() => manager.start()).not.toThrow();
        });

        it("clearCache() clears all internal state", async () => {
            authedRequest.mockResolvedValue({ event_id: "$msg1" });
            await manager.sendMessage({
                room_id: "!room:test",
                content: { body: "secret" },
            });

            expect(manager.getCachedMessages()).toHaveLength(1);

            manager.clearCache();

            expect(manager.getCachedMessages()).toHaveLength(0);
            expect(manager.getActiveBurnCount()).toBe(0);
        });

        it("stop() clears all state and removes listeners", async () => {
            authedRequest.mockResolvedValue({ event_id: "$msg1" });
            await manager.sendMessage({
                room_id: "!room:test",
                content: { body: "secret" },
            });

            const listener = vi.fn();
            manager.on(BurnAfterReadEvent.MessageBurned, listener);

            manager.stop();

            expect(manager.getCachedMessages()).toHaveLength(0);
            expect(manager.getActiveBurnCount()).toBe(0);
        });
    });

    describe("request statistics", () => {
        it("tracks request stats via BaseManager", async () => {
            authedRequest.mockResolvedValue({ enabled: true, burn_after_ms: 60000 });

            await manager.enableBurn("!room:test");

            const stats = manager.getRequestStats();
            expect(stats.total).toBeGreaterThan(0);
            expect(stats.successful).toBeGreaterThan(0);
        });
    });

    describe("URL prefix correctness", () => {
        it("uses VendorPrefix for burn settings endpoints", async () => {
            authedRequest.mockResolvedValue({ enabled: true, burn_after_ms: 60000 });

            await manager.enableBurn("!room:test");
            await manager.disableBurn("!room:test");
            await manager.getBurnSettings("!room:test");
            await manager.getPendingBurns("!room:test");
            await manager.markBurnRead("!room:test", "$ev1");
            await manager.cancelBurn("!room:test", "$ev1");
            await manager.setBurnConfig(60000);
            await manager.getBurnStats();

            const calls = authedRequest.mock.calls;
            for (const call of calls) {
                const prefixArg = call[4];
                expect(prefixArg).toEqual({ prefix: VendorPrefix });
            }
        });

        it("uses ClientPrefix.V3 for message send and redact", async () => {
            authedRequest.mockResolvedValue({ event_id: "$ev1" });

            await manager.sendMessage({
                room_id: "!room:test",
                content: { body: "secret" },
            });

            const sendCall = authedRequest.mock.calls[0];
            expect(sendCall[4]).toEqual({ prefix: ClientPrefix.V3 });
        });

        it("uses ClientPrefix enum values for prefix", async () => {
            authedRequest.mockResolvedValue({ enabled: true, burn_after_ms: 60000 });

            await manager.enableBurn("!room:test");

            const calls = authedRequest.mock.calls;
            for (const call of calls) {
                const prefixArg = call[4];
                if (typeof prefixArg === "object" && prefixArg !== null) {
                    expect([VendorPrefix, ClientPrefix.V3]).toContain(prefixArg.prefix);
                }
            }
        });
    });

    describe("singleton pattern via extendMatrixClient", () => {
        it("getOrCreateManager ensures same instance for same key", () => {
            const client = createMockClient();

            const instance1 = getOrCreateManager(
                client,
                "BurnAfterReadManager",
                () => new BurnAfterReadManager(client),
            );
            const instance2 = getOrCreateManager(
                client,
                "BurnAfterReadManager",
                () => new BurnAfterReadManager(client),
            );

            expect(instance1).toBe(instance2);
        });
    });

    describe("edge cases", () => {
        it("handles special characters in room ID", async () => {
            authedRequest.mockResolvedValue({ enabled: true, burn_after_ms: 60000 });

            await manager.enableBurn("!room+special:test");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/rooms/!room%2Bspecial%3Atest/burn",
                undefined,
                expect.any(Object),
                expect.any(Object),
            );
        });

        it("handles special characters in event ID", async () => {
            authedRequest.mockResolvedValue({ success: true, will_delete_at: 0 });

            await manager.markBurnRead("!room:test", "$event/with:special+chars");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                expect.stringContaining("/rooms/!room%3Atest/burn/"),
                undefined,
                undefined,
                expect.any(Object),
            );
        });

        it("getBurnAfterReadMessages filters by roomId", async () => {
            authedRequest.mockResolvedValueOnce({ event_id: "$ev1" });
            authedRequest.mockResolvedValueOnce({ event_id: "$ev2" });

            await manager.sendMessage({ room_id: "!room1:test", content: { body: "a" } });
            await manager.sendMessage({ room_id: "!room2:test", content: { body: "b" } });

            const room1Messages = await manager.getBurnAfterReadMessages("!room1:test");
            expect(room1Messages).toHaveLength(1);
            expect(room1Messages[0].room_id).toBe("!room1:test");

            const allMessages = await manager.getBurnAfterReadMessages();
            expect(allMessages).toHaveLength(2);
        });

        it("validateBurnTime rejects NaN and Infinity", () => {
            expect(() => manager.setConfig({ default_expire_time: NaN })).toThrow(ValidationError);
            expect(() => manager.setConfig({ default_expire_time: Infinity })).toThrow(ValidationError);
            expect(() => manager.setConfig({ default_expire_time: -Infinity })).toThrow(ValidationError);
        });
    });
});
