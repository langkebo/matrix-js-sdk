import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { PushManager, PushEvent } from "../../src/push/index";
import { InvalidParamError } from "../../src/common/errors.ts";
import { AuthError, NotFoundError, RetryableError, ApiError } from "../../src/errors";
import { PushRuleKind, PushRuleActionName, TweakName } from "../../src/@types/PushRules";

describe("PushManager", () => {
    let mockClient: any;
    let pushManager: PushManager;

    const createMockClient = () => ({
        http: {
            authedRequest: vi.fn().mockImplementation((method: any, path: string) => {
                if (path === "/pushers") {
                    return Promise.resolve({
                        pushers: [
                            {
                                pushkey: "key1",
                                kind: "http",
                                app_id: "com.example.app",
                                app_display_name: "Test App",
                                device_display_name: "Device",
                                lang: "en",
                            },
                        ],
                    });
                }
                if (path === "/pushers/set") {
                    return Promise.resolve({});
                }
                if (path === "/pushrules") {
                    return Promise.resolve({
                        global: {
                            override: [{ rule_id: "rule1", enabled: true, actions: ["notify"] }],
                            content: [],
                            room: [],
                            sender: [],
                            underride: [],
                        },
                    });
                }
                if (path.startsWith("/pushrules/")) {
                    if (path.includes("/enabled")) {
                        return Promise.resolve({ enabled: true });
                    }
                    if (path.includes("/actions")) {
                        return Promise.resolve({});
                    }
                    return Promise.resolve({
                        rule_id: "test-rule",
                        enabled: true,
                        actions: ["notify"],
                    });
                }
                if (path === "/notifications") {
                    return Promise.resolve({
                        notifications: [
                            {
                                event_id: "$event1",
                                room_id: "!room:example.com",
                                ts: 1234567890,
                                read: false,
                            },
                        ],
                        next_token: "token123",
                    });
                }
                if (path.includes("/ack")) {
                    return Promise.resolve({});
                }
                return Promise.resolve({});
            }),
        },
        getUserId: vi.fn().mockReturnValue("@test:example.com"),
    });

    beforeEach(() => {
        mockClient = createMockClient();
        pushManager = new PushManager(mockClient);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("Constructor", () => {
        it("should initialize with empty state", () => {
            expect(pushManager.getCachedPushers()).toEqual([]);
            expect(pushManager.getCachedPushRules()).toBeNull();
        });
    });

    // ==================== Pushers ====================

    describe("getPushers", () => {
        it("should get pushers successfully", async () => {
            const pushers = await pushManager.getPushers();
            expect(pushers).toHaveLength(1);
            expect(pushers[0].pushkey).toBe("key1");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith("GET", "/pushers", undefined, undefined, {
                prefix: "/_matrix/client/v3",
            });
        });

        it("should emit PushersUpdated event", async () => {
            const listener = vi.fn();
            pushManager.on(PushEvent.PushersUpdated, listener);
            await pushManager.getPushers();
            expect(listener).toHaveBeenCalledWith(
                expect.arrayContaining([expect.objectContaining({ pushkey: "key1" })]),
            );
        });

        it("should throw AuthError on 401", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce({
                message: "Unauthorized",
                httpStatus: 401,
                errcode: "M_UNKNOWN_TOKEN",
            });
            await expect(pushManager.getPushers()).rejects.toThrow(AuthError);
        });

        it("should emit PushError event on failure", async () => {
            const errorListener = vi.fn();
            pushManager.on(PushEvent.PushError, errorListener);
            for (let i = 0; i < 5; i++) {
                mockClient.http.authedRequest.mockRejectedValueOnce({
                    message: "Server error",
                    httpStatus: 500,
                });
            }
            vi.useFakeTimers();
            const promise = pushManager.getPushers();
            promise.catch(() => {});
            await vi.runAllTimersAsync();
            vi.useRealTimers();
            await expect(promise).rejects.toThrow(RetryableError);
            expect(errorListener).toHaveBeenCalled();
        });
    });

    describe("setPusher", () => {
        it("should set pusher successfully", async () => {
            await pushManager.setPusher({
                pushkey: "new-key",
                app_id: "com.test.app",
                app_display_name: "Test",
                device_display_name: "Device",
                device_id: "test-device",
                lang: "en",
                kind: "http",
            });
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                "/pushers/set",
                undefined,
                expect.objectContaining({ pushkey: "new-key" }),
                { prefix: "/_matrix/client/v3" },
            );
        });

        it("should throw InvalidParamError when pushkey is missing", async () => {
            await expect(
                pushManager.setPusher({
                    app_id: "test",
                    app_display_name: "Test",
                    device_display_name: "Device",
                    lang: "en",
                } as any),
            ).rejects.toThrow(InvalidParamError);
        });

        it("should throw InvalidParamError when app_id is missing", async () => {
            await expect(
                pushManager.setPusher({
                    pushkey: "key",
                    app_display_name: "Test",
                    device_display_name: "Device",
                    lang: "en",
                } as any),
            ).rejects.toThrow(InvalidParamError);
        });
    });

    describe("removePusher", () => {
        it("should remove pusher successfully", async () => {
            await pushManager.removePusher("key1", "com.example.app", "test-device");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                "/pushers/set",
                undefined,
                expect.objectContaining({
                    pushkey: "key1",
                    app_id: "com.example.app",
                    kind: null,
                    device_id: "test-device",
                }),
                { prefix: "/_matrix/client/v3" },
            );
        });

        it("should throw InvalidParamError when pushkey is missing", async () => {
            await expect(pushManager.removePusher("", "app")).rejects.toThrow(InvalidParamError);
        });

        it("should throw InvalidParamError when appId is missing", async () => {
            await expect(pushManager.removePusher("key", "")).rejects.toThrow(InvalidParamError);
        });
    });

    // ==================== Push Rules ====================

    describe("getPushRules", () => {
        it("should get push rules successfully", async () => {
            const rules = await pushManager.getPushRules();
            expect(rules).toBeDefined();
            expect(rules.global).toBeDefined();
        });

        it("should emit PushRulesUpdated event", async () => {
            const listener = vi.fn();
            pushManager.on(PushEvent.PushRulesUpdated, listener);
            await pushManager.getPushRules();
            expect(listener).toHaveBeenCalled();
        });
    });

    describe("getPushRulesByScope", () => {
        it("should get rules by scope", async () => {
            const rules = await pushManager.getPushRulesByScope("global");
            expect(rules).toBeDefined();
        });

        it("should throw InvalidParamError when scope is missing", async () => {
            await expect(pushManager.getPushRulesByScope("")).rejects.toThrow(InvalidParamError);
        });

        it("should URL encode scope", async () => {
            await pushManager.getPushRulesByScope("global/device");
            const call = mockClient.http.authedRequest.mock.calls[0];
            expect(call[1]).toContain(encodeURIComponent("global/device"));
        });
    });

    describe("getPushRulesByKind", () => {
        it("should get rules by kind", async () => {
            await pushManager.getPushRulesByKind("global", PushRuleKind.Override);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                expect.stringContaining("/pushrules/global/"),
                undefined,
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
        });

        it("should throw InvalidParamError when scope is missing", async () => {
            await expect(pushManager.getPushRulesByKind("", PushRuleKind.Override)).rejects.toThrow(InvalidParamError);
        });

        it("should throw InvalidParamError when kind is missing", async () => {
            await expect(pushManager.getPushRulesByKind("global", "" as any)).rejects.toThrow(InvalidParamError);
        });
    });

    describe("getPushRule", () => {
        it("should get single push rule", async () => {
            const rule = await pushManager.getPushRule("global", PushRuleKind.Override, "rule1");
            expect(rule).toBeDefined();
        });

        it("should throw on 404 by default", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce({
                httpStatus: 404,
                errcode: "M_NOT_FOUND",
            });
            await expect(pushManager.getPushRule("global", PushRuleKind.Override, "nonexistent")).rejects.toThrow();
        });

        it("should return null on 404 when throwOnError is false", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce({
                httpStatus: 404,
                errcode: "M_NOT_FOUND",
            });
            const rule = await pushManager.getPushRule("global", PushRuleKind.Override, "nonexistent", false);
            expect(rule).toBeNull();
        });

        it("should throw InvalidParamError when parameters are missing", async () => {
            await expect(pushManager.getPushRule("", PushRuleKind.Override, "rule")).rejects.toThrow(InvalidParamError);
            await expect(pushManager.getPushRule("global", "" as any, "rule")).rejects.toThrow(InvalidParamError);
            await expect(pushManager.getPushRule("global", PushRuleKind.Override, "")).rejects.toThrow(
                InvalidParamError,
            );
        });
    });

    describe("createPushRule", () => {
        it("should create push rule with POST", async () => {
            await pushManager.createPushRule("global", PushRuleKind.ContentSpecific, "keyword", {
                actions: [PushRuleActionName.Notify],
                pattern: "test",
            });
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                expect.stringContaining("/pushrules/global/content/keyword"),
                undefined,
                expect.objectContaining({ actions: [PushRuleActionName.Notify], pattern: "test" }),
                { prefix: "/_matrix/client/v3" },
            );
        });

        it("should throw InvalidParamError when actions are missing", async () => {
            await expect(
                pushManager.createPushRule("global", PushRuleKind.ContentSpecific, "rule", {
                    actions: [],
                }),
            ).rejects.toThrow(InvalidParamError);
        });
    });

    describe("updatePushRule", () => {
        it("should update push rule with PUT", async () => {
            await pushManager.updatePushRule("global", PushRuleKind.Override, "rule1", {
                actions: [PushRuleActionName.DontNotify],
            });
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "PUT",
                expect.stringContaining("/pushrules/global/override/rule1"),
                undefined,
                expect.objectContaining({ actions: [PushRuleActionName.DontNotify] }),
                { prefix: "/_matrix/client/v3" },
            );
        });
    });

    describe("deletePushRule", () => {
        it("should delete push rule", async () => {
            await pushManager.deletePushRule("global", PushRuleKind.Override, "rule1");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "DELETE",
                expect.stringContaining("/pushrules/global/override/rule1"),
                undefined,
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
        });
    });

    describe("getPushRuleEnabled", () => {
        it("should get rule enabled status", async () => {
            const enabled = await pushManager.getPushRuleEnabled("global", PushRuleKind.Override, "rule1");
            expect(enabled).toBe(true);
        });

        it("should throw on 404 by default", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce({
                httpStatus: 404,
                errcode: "M_NOT_FOUND",
            });
            await expect(
                pushManager.getPushRuleEnabled("global", PushRuleKind.Override, "nonexistent"),
            ).rejects.toThrow();
        });

        it("should return false on 404 when throwOnError is false", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce({
                httpStatus: 404,
                errcode: "M_NOT_FOUND",
            });
            const enabled = await pushManager.getPushRuleEnabled("global", PushRuleKind.Override, "nonexistent", false);
            expect(enabled).toBe(false);
        });
    });

    describe("setPushRuleEnabled", () => {
        it("should set rule enabled status", async () => {
            await pushManager.setPushRuleEnabled("global", PushRuleKind.Override, "rule1", false);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "PUT",
                expect.stringContaining("/enabled"),
                undefined,
                { enabled: false },
                { prefix: "/_matrix/client/v3" },
            );
        });
    });

    describe("setPushRuleActions", () => {
        it("should set rule actions", async () => {
            await pushManager.setPushRuleActions("global", PushRuleKind.Override, "rule1", [
                PushRuleActionName.Notify,
                { set_tweak: TweakName.Highlight, value: true },
            ]);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "PUT",
                expect.stringContaining("/actions"),
                undefined,
                { actions: [PushRuleActionName.Notify, { set_tweak: TweakName.Highlight, value: true }] },
                { prefix: "/_matrix/client/v3" },
            );
        });

        it("should throw InvalidParamError when actions are empty", async () => {
            await expect(pushManager.setPushRuleActions("global", PushRuleKind.Override, "rule1", [])).rejects.toThrow(
                InvalidParamError,
            );
        });
    });

    // ==================== Notifications ====================

    describe("getNotifications", () => {
        it("should get notifications without params", async () => {
            const result = await pushManager.getNotifications();
            expect(result.notifications).toHaveLength(1);
            expect(result.next_token).toBe("token123");
        });

        it("should preserve zero-valued notification limits", async () => {
            await pushManager.getNotifications({ limit: 0 });
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/notifications",
                { limit: "0" },
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
        });

        it("should get notifications with params", async () => {
            await pushManager.getNotifications({ limit: 10, from: "token", only: "highlight" });
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/notifications",
                { limit: "10", from: "token", only: "highlight" },
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
        });

        it("should throw RetryableError on 5xx", async () => {
            for (let i = 0; i < 5; i++) {
                mockClient.http.authedRequest.mockRejectedValueOnce({
                    message: "Error",
                    httpStatus: 500,
                });
            }
            vi.useFakeTimers();
            const promise = pushManager.getNotifications();
            promise.catch(() => {});
            await vi.runAllTimersAsync();
            vi.useRealTimers();
            await expect(promise).rejects.toThrow(RetryableError);
        });
    });

    describe("ackNotification", () => {
        it("should ack notification", async () => {
            await pushManager.ackNotification("notif123");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                expect.stringContaining("/notifications/notif123/ack"),
                undefined,
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
        });

        it("should throw InvalidParamError when notificationId is missing", async () => {
            await expect(pushManager.ackNotification("")).rejects.toThrow(InvalidParamError);
        });

        it("should throw on 404 by default", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce({
                httpStatus: 404,
                errcode: "M_NOT_FOUND",
            });
            await expect(pushManager.ackNotification("nonexistent")).rejects.toThrow();
        });

        it("should return silently on 404 when throwOnError is false", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce({
                httpStatus: 404,
                errcode: "M_NOT_FOUND",
            });
            await expect(pushManager.ackNotification("nonexistent", false)).resolves.toBeUndefined();
        });
    });

    // ==================== Convenience Methods ====================

    describe("muteRoom", () => {
        it("should mute room", async () => {
            await pushManager.muteRoom("!room:example.com");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                expect.stringContaining("/pushrules/global/room/"),
                undefined,
                expect.objectContaining({ actions: ["dont_notify"] }),
                { prefix: "/_matrix/client/v3" },
            );
        });
    });

    describe("unmuteRoom", () => {
        it("should unmute room", async () => {
            await pushManager.unmuteRoom("!room:example.com");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "DELETE",
                expect.stringContaining("/pushrules/global/room/"),
                undefined,
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
        });
    });

    describe("addKeywordHighlight", () => {
        it("should add keyword highlight", async () => {
            await pushManager.addKeywordHighlight("important");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                expect.stringContaining("/pushrules/global/content/important"),
                undefined,
                expect.objectContaining({ pattern: "important" }),
                { prefix: "/_matrix/client/v3" },
            );
        });
    });

    describe("removeKeywordHighlight", () => {
        it("should remove keyword highlight", async () => {
            await pushManager.removeKeywordHighlight("important");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "DELETE",
                expect.stringContaining("/pushrules/global/content/important"),
                undefined,
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
        });
    });

    describe("ignoreSender", () => {
        it("should ignore sender", async () => {
            await pushManager.ignoreSender("@user:example.com");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                expect.stringContaining("/pushrules/global/sender/"),
                undefined,
                expect.objectContaining({ actions: ["dont_notify"] }),
                { prefix: "/_matrix/client/v3" },
            );
        });
    });

    describe("unignoreSender", () => {
        it("should unignore sender", async () => {
            await pushManager.unignoreSender("@user:example.com");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "DELETE",
                expect.stringContaining("/pushrules/global/sender/"),
                undefined,
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
        });
    });

    // ==================== Lifecycle ====================

    describe("start", () => {
        it("should initialize on start", async () => {
            await pushManager.start();
            expect(mockClient.http.authedRequest).toHaveBeenCalledTimes(2);
        });

        it("should not reinitialize if already started", async () => {
            await pushManager.start();
            mockClient.http.authedRequest.mockClear();
            await pushManager.start();
            expect(mockClient.http.authedRequest).not.toHaveBeenCalled();
        });
    });

    describe("stop", () => {
        it("should clear state on stop", async () => {
            await pushManager.getPushers();
            await pushManager.getPushRules();
            pushManager.stop();
            expect(pushManager.getCachedPushers()).toEqual([]);
            expect(pushManager.getCachedPushRules()).toBeNull();
        });
    });

    describe("clearCache", () => {
        it("should clear cache", async () => {
            await pushManager.getPushers();
            await pushManager.getPushRules();
            pushManager.clearCache();
            expect(pushManager.getCachedPushers()).toEqual([]);
            expect(pushManager.getCachedPushRules()).toBeNull();
        });
    });

    // ==================== Error Handling ====================

    describe("Error handling", () => {
        it("should classify 401 as AuthError", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce({
                message: "Unauthorized",
                httpStatus: 401,
            });
            await expect(pushManager.getPushers()).rejects.toThrow(AuthError);
        });

        it("should classify M_UNKNOWN_TOKEN as AuthError", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce({
                message: "Token unknown",
                errcode: "M_UNKNOWN_TOKEN",
            });
            await expect(pushManager.getPushers()).rejects.toThrow(AuthError);
        });

        it("should classify 404 as NotFoundError", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce({
                message: "Not found",
                httpStatus: 404,
            });
            await expect(
                pushManager.setPusher({
                    pushkey: "key",
                    app_id: "app",
                    app_display_name: "Test",
                    device_display_name: "Device",
                    lang: "en",
                    device_id: "test-device",
                }),
            ).rejects.toThrow(NotFoundError);
        });

        it("should classify other errors as ApiError", async () => {
            mockClient.http.authedRequest.mockRejectedValueOnce({
                message: "Forbidden",
                httpStatus: 403,
                errcode: "M_FORBIDDEN",
            });
            await expect(pushManager.getPushers()).rejects.toThrow(ApiError);
        });
    });
});
