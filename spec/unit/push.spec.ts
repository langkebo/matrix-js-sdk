import { describe, it, expect, beforeEach, vi } from "vitest";

import { PushManager } from "../../src/push/index";
import { PushRuleKind, PushRuleActionName } from "../../src/@types/PushRules";

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
            setPushRuleActions: vi.fn().mockResolvedValue({}),
            getPushers: vi.fn().mockResolvedValue({ pushers: [] }),
            setPusher: vi.fn().mockResolvedValue({}),
            getCapabilities: vi.fn().mockResolvedValue({ push: { enabled: true, formats: ["event_id_only"] } }),
        };
        pushManager = new PushManager(mockClient);
    });

    describe("constructor", () => {
        it("should initialize correctly", () => {
            expect(pushManager).toBeDefined();
        });
    });

    describe("getPushRules", () => {
        it("should return push rules", async () => {
            const rules = await pushManager.getPushRules();
            expect(rules).toBeDefined();
            expect(rules.override).toHaveLength(1);
            expect(mockClient.getPushRules).toHaveBeenCalled();
        });
    });

    describe("getRulesByKind", () => {
        it("should return rules by kind", async () => {
            const rules = await pushManager.getRulesByKind("override");
            expect(rules).toHaveLength(1);
            expect(rules[0].rule_id).toBe("rule1");
        });
    });

    describe("addPushRule", () => {
        it("should add push rule", async () => {
            await pushManager.addPushRule('global', PushRuleKind.Override, "rule1", "pattern", [PushRuleActionName.Notify]);
            expect(mockClient.addPushRule).toHaveBeenCalledWith(
                'global',
                PushRuleKind.Override,
                "rule1",
                { pattern: "pattern", actions: [PushRuleActionName.Notify] }
            );
        });
    });

    describe("deletePushRule", () => {
        it("should delete push rule", async () => {
            await pushManager.deletePushRule('global', PushRuleKind.Override, "rule1");
            expect(mockClient.deletePushRule).toHaveBeenCalledWith('global', PushRuleKind.Override, "rule1");
        });
    });

    describe("setPushRuleEnabled", () => {
        it("should set push rule enabled", async () => {
            await pushManager.setPushRuleEnabled('global', PushRuleKind.Override, "rule1", false);
            expect(mockClient.setPushRuleEnabled).toHaveBeenCalledWith('global', PushRuleKind.Override, "rule1", false);
        });
    });

    describe("updatePushRuleActions", () => {
        it("should update rule actions", async () => {
            await pushManager.updatePushRuleActions('global', PushRuleKind.Override, "rule1", [PushRuleActionName.DontNotify]);
            expect(mockClient.setPushRuleActions).toHaveBeenCalledWith('global', PushRuleKind.Override, "rule1", [PushRuleActionName.DontNotify]);
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
            expect(ignored).toBe(false);
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

    describe("isRoomMuted", () => {
        it("should check if room is muted", async () => {
            const muted = await pushManager.isRoomMuted("!room:example.com");
            expect(muted).toBe(false);
        });
    });

    describe("getPushers", () => {
        it("should get pushers", async () => {
            const pushers = await pushManager.getPushers();
            expect(pushers).toEqual([]);
            expect(mockClient.getPushers).toHaveBeenCalled();
        });
    });

    describe("addPusher", () => {
        it("should add pusher", async () => {
            await pushManager.addPusher({
                app_id: "test",
                pushkey: "key123",
                kind: "http",
                app_display_name: "Test App",
            });
            expect(mockClient.setPusher).toHaveBeenCalled();
        });
    });

    describe("getCapabilities", () => {
        it("should get capabilities", async () => {
            const caps = await pushManager.getCapabilities();
            expect(caps.supports.push).toBe(true);
        });
    });

    describe("clearCache", () => {
        it("should clear cache", () => {
            pushManager.clearCache();
            expect(pushManager.getCachedPushers()).toEqual([]);
        });
    });

    describe("extendMatrixClient", () => {
        it("should export PushManager class", () => {
            const { PushManager } = require("../../src/push/index");
            expect(typeof PushManager).toBe("function");
        });

        it("should have correct prototype methods", () => {
            const { PushManager } = require("../../src/push/index");
            const manager = new PushManager({
                getPushRules: () => {},
                addPushRule: () => {},
                deletePushRule: () => {},
                setPushRuleEnabled: () => {},
                setPushRuleActions: () => {},
                getPushers: () => {},
                setPusher: () => {},
                getCapabilities: () => {}
            });
            expect(typeof manager.getPushRules).toBe("function");
            expect(typeof manager.addPushRule).toBe("function");
            expect(typeof manager.deletePushRule).toBe("function");
        });
    });
});