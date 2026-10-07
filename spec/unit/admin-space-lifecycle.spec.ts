/*
 * admin / space 的覆盖缺口补测：生命周期方法 + MatrixClient 便捷访问器。
 *
 * 这两个模块的覆盖率分别卡在 69.00（floor 70）与 75.71（floor 77），未覆盖的全是
 * **文件末尾那一块**：
 *   · `AdminManager.stop()` / `SpaceManager.stop()`  —— 清理子 manager 的转发监听器；
 *   · `SpaceManager.getMetrics() / clearCache() / start()`；
 *   · 两个 `extendMatrixClient()` 往 `MatrixClient.prototype` 上挂的 20+ 个便捷访问器。
 *
 * 后一类此前完全没有测试：admin.spec.ts 里那个 `describe("extendMatrixClient")`
 * 只断言了"类能导出、原型上有三个方法"，**从未真正调用 extendMatrixClient()**，
 * 所以挂原型的那 30 条语句一条都没被执行过。
 *
 * 这里沿用 room-summary-facade.spec.ts 的成熟做法：`extendMatrixClient()` 之后用
 * `MatrixClient.prototype.X.call(fakeClient)` 直接驱动，不必实例化真实 MatrixClient。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { MatrixClient } from "../../src/client";
import { AdminEvent, AdminManager, extendMatrixClient as extendAdmin } from "../../src/admin/index";
import { extendMatrixClient as extendSpace, SpaceEvent, SpaceManager } from "../../src/space/index";

/* eslint-disable @typescript-eslint/no-explicit-any */

describe("admin / space：生命周期与客户端便捷访问器", () => {
    let fakeClient: any;

    beforeEach(() => {
        // 便捷访问器内部会调 `this.getAdminManager()`，所以 this 必须能沿原型链找到它们。
        // 用 Object.create(MatrixClient.prototype) 拿一个"只有原型方法、不跑构造函数"的
        // 轻量 client —— 与真实调用链一致，又不必起一个真的 MatrixClient。
        extendAdmin();
        extendSpace();
        fakeClient = Object.create(MatrixClient.prototype);
    });

    describe("AdminManager.stop()", () => {
        // 各子 manager 的事件类型互不相同，数组元素会退化成不可调用的联合 —— 标 any[]
        const subManagersOf = (m: AdminManager): any[] => [
            m.users,
            m.rooms,
            m.server,
            m.federation,
            m.media,
            m.config,
            m.externalService,
            m.cleanup,
            m.notifications,
            m.reports,
            m.policy,
        ];

        it("清空全部子 manager 的监听器（防 stop() 后事件泄漏）", () => {
            const admin = new AdminManager(fakeClient);
            const subs = subManagersOf(admin);
            for (const sub of subs) {
                sub.on(AdminEvent.AdminError, () => {});
            }
            for (const sub of subs) {
                expect(sub.listenerCount(AdminEvent.AdminError)).toBeGreaterThan(0);
            }

            admin.stop();

            for (const sub of subs) {
                expect(sub.listenerCount(AdminEvent.AdminError)).toBe(0);
            }
        });
    });

    describe("admin extendMatrixClient()", () => {
        const accessors = [
            "getAdminManager",
            "getAdminUserManager",
            "getAdminRoomManager",
            "getAdminServerManager",
            "getAdminFederationManager",
            "getAdminMediaManager",
            "getAdminConfigManager",
            "getAdminCleanupManager",
            "getAdminNotificationManager",
            "getAdminReportManager",
            "getAdminPolicyManager",
            "getAdminBackgroundUpdates",
            "getAdminEventReports",
            "getAdminModules",
            "getAdminSaml",
            "getAdminCas",
            "getAdminFeatureFlags",
            "getAdminRetention",
            "getAdminTelemetry",
        ];

        it("把全部便捷访问器挂到 MatrixClient.prototype", () => {
            for (const name of accessors) {
                expect(typeof (MatrixClient.prototype as any)[name], name).toBe("function");
            }
        });

        it("getAdminManager 是单例（同一 client 复用同一实例）", () => {
            const a = (MatrixClient.prototype as any).getAdminManager.call(fakeClient);
            const b = (MatrixClient.prototype as any).getAdminManager.call(fakeClient);
            expect(a).toBe(b);
            expect(a).toBeInstanceOf(AdminManager);
        });

        it("每个子访问器返回的正是 AdminManager 上对应的子 manager", () => {
            const get = (name: string) => (MatrixClient.prototype as any)[name].call(fakeClient);
            const admin = get("getAdminManager");

            expect(get("getAdminUserManager")).toBe(admin.users);
            expect(get("getAdminRoomManager")).toBe(admin.rooms);
            expect(get("getAdminServerManager")).toBe(admin.server);
            expect(get("getAdminFederationManager")).toBe(admin.federation);
            expect(get("getAdminMediaManager")).toBe(admin.media);
            expect(get("getAdminConfigManager")).toBe(admin.config);
            expect(get("getAdminCleanupManager")).toBe(admin.cleanup);
            expect(get("getAdminNotificationManager")).toBe(admin.notifications);
            expect(get("getAdminReportManager")).toBe(admin.reports);
            expect(get("getAdminPolicyManager")).toBe(admin.policy);
            expect(get("getAdminBackgroundUpdates")).toBe(admin.backgroundUpdates);
            expect(get("getAdminEventReports")).toBe(admin.eventReports);
            expect(get("getAdminModules")).toBe(admin.modules);
            expect(get("getAdminSaml")).toBe(admin.saml);
            expect(get("getAdminCas")).toBe(admin.cas);
            expect(get("getAdminFeatureFlags")).toBe(admin.featureFlags);
            expect(get("getAdminRetention")).toBe(admin.retention);
            expect(get("getAdminTelemetry")).toBe(admin.telemetry);
        });
    });

    describe("SpaceManager 生命周期", () => {
        it("getMetrics 聚合缓存与请求统计", () => {
            const space = new SpaceManager(fakeClient);
            const metrics = space.getMetrics();

            expect(metrics.cache.query).toHaveProperty("total");
            expect(metrics.cache.hierarchy).toBeDefined();
            expect(metrics.requests).toEqual({ total: 0, successful: 0, failed: 0, retried: 0 });
        });

        it("clearCache / start 都会清空查询缓存", () => {
            const space = new SpaceManager(fakeClient);
            const clear = vi.spyOn(space.query, "clearCache");

            space.clearCache();
            expect(clear).toHaveBeenCalledTimes(1);

            space.start();
            expect(clear).toHaveBeenCalledTimes(2);
        });

        it("stop 清空查询缓存并移除全部子 manager 监听器", () => {
            const space = new SpaceManager(fakeClient);
            const subs = [space.lifecycle, space.query, space.child, space.member, space.hierarchy];
            const clear = vi.spyOn(space.query, "clearCache");

            for (const sub of subs) {
                sub.on(SpaceEvent.SpaceError, () => {});
            }
            for (const sub of subs) {
                expect(sub.listenerCount(SpaceEvent.SpaceError)).toBeGreaterThan(0);
            }

            space.stop();

            expect(clear).toHaveBeenCalled();
            for (const sub of subs) {
                expect(sub.listenerCount(SpaceEvent.SpaceError)).toBe(0);
            }
        });
    });

    describe("space extendMatrixClient()", () => {
        it("把 getSpaceManager 挂到 MatrixClient.prototype", () => {
            extendSpace();
            expect(typeof (MatrixClient.prototype as any).getSpaceManager).toBe("function");
        });

        it("getSpaceManager 是单例且返回 SpaceManager", () => {
            extendSpace();
            const a = (MatrixClient.prototype as any).getSpaceManager.call(fakeClient);
            const b = (MatrixClient.prototype as any).getSpaceManager.call(fakeClient);
            expect(a).toBe(b);
            expect(a).toBeInstanceOf(SpaceManager);
        });
    });
});
