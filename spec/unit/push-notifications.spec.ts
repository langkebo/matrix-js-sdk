import { describe, expect, it, vi, beforeEach } from "vitest";

import { PushNotificationsManager, type IPusher } from "../../src/push-notifications/index";

/*
 * mockClient **故意不提供** `getPushers` / `setPushers` / `removePusher` / `getPusherData`
 * —— 这 4 个方法在本 fork 的 MatrixClient 上运行时并不存在（类型表却声明了它们）。
 * 旧 spec 把它们全部 `vi.fn()` 到 client 上，于是"转发到不存在的东西"被测试掩盖、
 * 长期全绿。本文件只在 client 上挂 `getPushManager()`：实现若回退，立刻 TypeError。
 */
describe("PushNotificationsManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pushManager: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let manager: PushNotificationsManager;

    const pusher: IPusher = {
        pushkey: "key1",
        kind: "http",
        app_id: "app.id",
        app_display_name: "MyApp",
        device_display_name: "MyDevice",
        lang: "en",
        data: { url: "https://example.com/push" },
        device_id: "DEV1",
    };

    beforeEach(() => {
        pushManager = {
            getPushers: vi.fn().mockResolvedValue([pusher]),
            setPusher: vi.fn().mockResolvedValue(undefined),
            removePusher: vi.fn().mockResolvedValue(undefined),
        };
        mockClient = { getPushManager: () => pushManager };
        manager = new PushNotificationsManager(mockClient);
    });

    it("getPushers 把 PushManager 的数组包装成 {pushers}", async () => {
        await expect(manager.getPushers()).resolves.toEqual({ pushers: [pusher] });
        expect(pushManager.getPushers).toHaveBeenCalledTimes(1);
    });

    it("setPushers 逐个委托 setPusher（PushManager 一次只处理一个）", async () => {
        const second: IPusher = { ...pusher, pushkey: "key2" };

        await manager.setPushers([pusher, second]);

        expect(pushManager.setPusher).toHaveBeenCalledTimes(2);
        expect(pushManager.setPusher).toHaveBeenNthCalledWith(1, pusher);
        expect(pushManager.setPusher).toHaveBeenNthCalledWith(2, second);
    });

    it("removePusher 把对象拆成 (pushkey, app_id, device_id)", async () => {
        await manager.removePusher(pusher);

        expect(pushManager.removePusher).toHaveBeenCalledWith("key1", "app.id", "DEV1");
    });

    it("不再暴露 getPusherData —— 本 fork 与 Matrix 规范都没有这个能力", () => {
        expect((manager as unknown as Record<string, unknown>).getPusherData).toBeUndefined();
    });
});
