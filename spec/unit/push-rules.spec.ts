import { describe, it, expect, beforeEach, vi } from "vitest";

import { PushRulesManager } from "../../src/push-rules";

describe("PushRulesManager", () => {
    let mockClient: any;
    let manager: PushRulesManager;

    beforeEach(() => {
        mockClient = {
            getPushRules: vi.fn().mockResolvedValue({ global: {} }),
            getPushRule: vi.fn().mockResolvedValue({ rule_id: "r1", enabled: true }),
            setPushRule: vi.fn().mockResolvedValue(undefined),
            deletePushRule: vi.fn().mockResolvedValue(undefined),
            enablePushRule: vi.fn().mockResolvedValue(undefined),
            pushRules: { global: { override: [] } },
        };
        manager = new PushRulesManager(mockClient);
    });

    it("gets push rules and single rule", async () => {
        await expect(manager.getPushRules()).resolves.toEqual({ global: {} });
        await expect(manager.getPushRule("override", "r1")).resolves.toEqual({ rule_id: "r1", enabled: true });
    });

    it("sets/deletes/enables push rules and reads cache", async () => {
        const body = { actions: ["notify"] };
        await manager.setPushRule("override", "r1", body);
        await manager.deletePushRule("override", "r1");
        await manager.enablePushRule("override", "r1", false);

        expect(mockClient.setPushRule).toHaveBeenCalledWith("override", "r1", body);
        expect(mockClient.deletePushRule).toHaveBeenCalledWith("override", "r1");
        expect(mockClient.enablePushRule).toHaveBeenCalledWith("override", "r1", false);
        expect(manager.getPushRulesCached()).toEqual({ global: { override: [] } });
    });
});
