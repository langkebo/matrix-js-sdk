import { describe, it, expect, beforeEach, vi } from "vitest";

import { PushRulesManager } from "../../src/push-rules";
import { PushRuleKind } from "../../src/@types/PushRules";

/*
 * PushRulesManager 是 `PushManager`（src/push/index.ts）的**委托层**，本身不持有实现。
 *
 * 历史：本模块原先逐个转发 `this.client.getPushRules()` / `getPushRule()` / `setPushRule()`
 * / `deletePushRule()` / `enablePushRule()` —— 这五个方法在本 fork 的 MatrixClient 上
 * **运行时并不存在**（类型表却声明了），调用即 TypeError。而旧 spec 把这些方法全部
 * `vi.fn()` 到 mockClient 上，于是"转发到不存在的东西"被测试掩盖，长期全绿。
 *
 * 因此本 spec 的判据是：**每一步都必须落到 PushManager 上对应的那个方法**，
 * 且 scope 恒为 `global`。若有人把委托写回 `this.client.X(...)`，本文件立刻报告
 * `getPushManager` 未被调用。
 */
describe("PushRulesManager（委托 PushManager）", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pushManager: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let manager: PushRulesManager;

    beforeEach(() => {
        pushManager = {
            getPushRules: vi.fn().mockResolvedValue({ global: {} }),
            getPushRule: vi.fn().mockResolvedValue({ rule_id: "r1", enabled: true }),
            updatePushRule: vi.fn().mockResolvedValue(undefined),
            deletePushRule: vi.fn().mockResolvedValue(undefined),
            setPushRuleEnabled: vi.fn().mockResolvedValue(undefined),
        };
        mockClient = {
            getPushManager: () => pushManager,
            pushRules: { global: { override: [] } },
        };
        manager = new PushRulesManager(mockClient);
    });

    it("读：getPushRules 直接委托 PushManager", async () => {
        await expect(manager.getPushRules()).resolves.toEqual({ global: {} });
        expect(pushManager.getPushRules).toHaveBeenCalledTimes(1);
    });

    it("读：getPushRule 补上 scope=global", async () => {
        await expect(manager.getPushRule(PushRuleKind.Override, "r1")).resolves.toEqual({
            rule_id: "r1",
            enabled: true,
        });
        expect(pushManager.getPushRule).toHaveBeenCalledWith("global", PushRuleKind.Override, "r1");
    });

    it("写：setPushRule 走 PushManager.updatePushRule（PUT 语义），scope=global", async () => {
        const body = { actions: ["notify"] as never };
        await manager.setPushRule(PushRuleKind.Override, "r1", body);
        expect(pushManager.updatePushRule).toHaveBeenCalledWith("global", PushRuleKind.Override, "r1", body);
    });

    it("写：deletePushRule / enablePushRule 各自落到对应的 PushManager 方法", async () => {
        await manager.deletePushRule(PushRuleKind.Override, "r1");
        await manager.enablePushRule(PushRuleKind.Override, "r1", false);

        expect(pushManager.deletePushRule).toHaveBeenCalledWith("global", PushRuleKind.Override, "r1");
        expect(pushManager.setPushRuleEnabled).toHaveBeenCalledWith("global", PushRuleKind.Override, "r1", false);
    });

    it("缓存读的是 client.pushRules 属性，不再发请求", () => {
        expect(manager.getPushRulesCached()).toEqual({ global: { override: [] } });
        expect(pushManager.getPushRules).not.toHaveBeenCalled();
    });

    it("没有任何方法再碰 client 上不存在的同名方法（回归守卫）", async () => {
        const body = { actions: ["notify"] as never };
        await manager.getPushRules();
        await manager.getPushRule(PushRuleKind.Override, "r1");
        await manager.setPushRule(PushRuleKind.Override, "r1", body);
        await manager.deletePushRule(PushRuleKind.Override, "r1");
        await manager.enablePushRule(PushRuleKind.Override, "r1", true);

        // mockClient 上**故意只提供** getPushManager + pushRules：
        // 若实现里还残留 `this.client.getPushRules()` 之类，这里会因 undefined 而 TypeError。
        for (const leaked of ["getPushRules", "getPushRule", "setPushRule", "deletePushRule", "enablePushRule"]) {
            expect(mockClient[leaked], `不应再直接调用 client.${leaked}`).toBeUndefined();
        }
        expect(pushManager.getPushRules).toHaveBeenCalled();
    });
});
