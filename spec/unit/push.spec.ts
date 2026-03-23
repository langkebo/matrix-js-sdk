import "../../src/push/index";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { PushManager } from "../../src/push/index";

describe("PushManager", () => {
    let mockClient: any;
    let pushManager: PushManager;

    beforeEach(() => {
        mockClient = {
            getPushRules: vi.fn().mockResolvedValue({
                override: [{ rule_id: "rule1", enabled: true, actions: ["notify"] }],
                content: [],
                room: [],
                sender: [],
                underride: [],
            }),
            addPushRule: vi.fn().mockResolvedValue({}),
            deletePushRule: vi.fn().mockResolvedValue({}),
            setPushRuleEnabled: vi.fn().mockResolvedValue({}),
            updatePushRuleActions: vi.fn().mockResolvedValue({}),
            getPushers: vi.fn().mockResolvedValue({ pushers: [] }),
            setPusher: vi.fn().mockResolvedValue({}),
            getCapabilities: vi.fn().mockResolvedValue({ push: { enabled: true, formats: ["event_id_only"] } }),
            submitNotification: vi.fn().mockResolvedValue({}),
        };
        pushManager = new PushManager(mockClient);
    });

    describe("getPushRules", () => {
        it("should get all push rules", async () => {
            const rules = await pushManager.getPushRules();
            expect(rules).toBeDefined();
            expect(rules.override).toBeDefined();
        });
    });

    describe("getRulesByKind", () => {
        it("should get rules by kind", async () => {
            const rules = await pushManager.getRulesByKind("override");
            expect(Array.isArray(rules)).toBe(true);
        });
    });

    describe("addPushRule", () => {
        it("should add push rule", async () => {
            await pushManager.addPushRule("override", "rule1", "pattern", ["notify"]);
            expect(mockClient.addPushRule).toHaveBeenCalledWith("override", "rule1", {
                pattern: "pattern",
                actions: ["notify"],
            });
        });
    });

    describe("deletePushRule", () => {
        it("should delete push rule", async () => {
            await pushManager.deletePushRule("override", "rule1");
            expect(mockClient.deletePushRule).toHaveBeenCalledWith("override", "rule1");
        });
    });

    describe("setPushRuleEnabled", () => {
        it("should enable/disable push rule", async () => {
            await pushManager.setPushRuleEnabled("override", "rule1", false);
            expect(mockClient.setPushRuleEnabled).toHaveBeenCalledWith("override", "rule1", false);
        });
    });

    describe("updatePushRuleActions", () => {
        it("should update rule actions", async () => {
            await pushManager.updatePushRuleActions("override", "rule1", ["dont_notify"]);
            expect(mockClient.updatePushRuleActions).toHaveBeenCalledWith("override", "rule1", ["dont_notify"]);
        });
    });

    describe("ignoreUser", () => {
        it("should ignore user", async () => {
            await pushManager.ignoreUser("@user:example.com");
            expect(mockClient.addPushRule).toHaveBeenCalled();
        });
    });

    describe("unignoreUser", () => {
        it("should unignore user", async () => {
            await pushManager.unignoreUser("@user:example.com");
            expect(mockClient.deletePushRule).toHaveBeenCalled();
        });
    });

    describe("isUserIgnored", () => {
        it("should check if user is ignored", async () => {
            const ignored = await pushManager.isUserIgnored("@user:example.com");
            expect(typeof ignored).toBe("boolean");
        });
    });

    describe("addKeywordHighlight", () => {
        it("should add keyword highlight", async () => {
            await pushManager.addKeywordHighlight("important");
            expect(mockClient.addPushRule).toHaveBeenCalled();
        });
    });

    describe("muteRoom", () => {
        it("should mute room", async () => {
            await pushManager.muteRoom("!room:example.com");
            expect(mockClient.addPushRule).toHaveBeenCalled();
        });
    });

    describe("unmuteRoom", () => {
        it("should unmute room", async () => {
            await pushManager.unmuteRoom("!room:example.com");
            expect(mockClient.deletePushRule).toHaveBeenCalled();
        });
    });

    describe("getPushers", () => {
        it("should get pushers", async () => {
            const pushers = await pushManager.getPushers();
            expect(Array.isArray(pushers)).toBe(true);
        });
    });

    describe("addPusher", () => {
        it("should add pusher", async () => {
            await pushManager.addPusher({
                app_id: "app1",
                pushkey: "key1",
                kind: "http",
                lang: "en",
            });
            expect(mockClient.setPusher).toHaveBeenCalled();
        });
    });

    describe("getCapabilities", () => {
        it("should get push capabilities", async () => {
            const caps = await pushManager.getCapabilities();
            expect(caps.push).toBe(true);
            expect(caps.formats).toContain("event_id_only");
        });
    });

    describe("start/stop", () => {
        it("should start and stop without errors", () => {
            expect(() => {
                pushManager.start();
                pushManager.stop();
            }).not.toThrow();
        });
    });
});
