/*
 * 定时器配对门禁的负向测试（阶段 3 · P3-3）。
 *
 * 这个门禁的价值全在"会不会红"上：它读登记表、grep 清理语句，如果判定逻辑写松了
 * （漏掉 `globalThis.clearTimeout` 的写法、把方法声明当调用点、waived 不需要理由），
 * 它就会变成一份永绿的清单。下面把每一条都钉住。
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
    collectTimerSites,
    countDiscardedTimeouts,
    evaluateSite,
    fileClearsCollection,
    fileClearsHandle,
    readRegistry,
    siteKey,
    type TimerSite,
} from "../../scripts/quality/check-timer-pairing.mjs";

const site = (overrides: Partial<TimerSite> = {}): TimerSite => ({
    file: "src/demo.ts",
    kind: "interval",
    handle: "this.timer",
    line: 10,
    snippet: "this.timer = setInterval(() => {}, 1000);",
    ordinal: 1,
    ...overrides,
});

describe("timer pairing gate: 站点枚举", () => {
    it("识别 setInterval 与存句柄的 setTimeout", () => {
        const sites = collectTimerSites(
            [
                "this.timer = setInterval(() => {}, 1000);",
                "const later = setTimeout(() => {}, 50);",
                "setTimeout(() => {}, 10);",
            ].join("\n"),
            "src/demo.ts",
        );

        expect(sites.map((entry) => [entry.kind, entry.handle])).toEqual([
            ["interval", "this.timer"],
            ["stored-timeout", "later"],
        ]);
    });

    it("不把方法声明或对象上的同名方法当成全局调用", () => {
        const sites = collectTimerSites(
            [
                "public setInterval(interval: number): void {",
                "private setTimeout(ms: number): void {",
                "this.stats.setInterval(interval);",
            ].join("\n"),
            "src/demo.ts",
        );

        expect(sites).toEqual([]);
    });

    it("同一文件内同句柄的多处赋值带序号，键不冲突", () => {
        const sites = collectTimerSites(
            ["this.keepAliveTimer = setTimeout(a, 1);", "this.keepAliveTimer = setTimeout(b, 2);"].join("\n"),
            "src/demo.ts",
        );

        expect(sites.map((entry) => siteKey(entry))).toEqual([
            "src/demo.ts#stored-timeout#this.keepAliveTimer#1",
            "src/demo.ts#stored-timeout#this.keepAliveTimer#2",
        ]);
    });

    it("丢弃句柄的 setTimeout 只统计、不要求登记", () => {
        expect(countDiscardedTimeouts(["setTimeout(a, 1);", "const t = setTimeout(b, 2);"].join("\n"))).toBe(1);
    });
});

describe("timer pairing gate: 清理语句识别", () => {
    it("认得 globalThis.clearTimeout、断言写法与普通写法", () => {
        expect(fileClearsHandle("globalThis.clearTimeout(this.t);", "stored-timeout", "this.t")).toBe(true);
        expect(fileClearsHandle("clearTimeout(x as NodeJS.Timeout);", "stored-timeout", "x")).toBe(true);
        expect(
            fileClearsHandle(
                "clearInterval(client.checkTurnServersIntervalID);",
                "interval",
                "client.checkTurnServersIntervalID",
            ),
        ).toBe(true);
    });

    it("句柄前缀相同但不同的变量不算清理（timer vs timer2）", () => {
        expect(fileClearsHandle("clearTimeout(timer2);", "stored-timeout", "timer")).toBe(false);
    });

    it("集合统一清理要求集合名与 clear* 同时出现", () => {
        const content = "for (const t of this.setNewKeyTimeouts) { clearTimeout(t); }";

        expect(fileClearsCollection(content, "stored-timeout", "setNewKeyTimeouts")).toBe(true);
        expect(fileClearsCollection(content, "stored-timeout", "其他集合")).toBe(false);
    });
});

describe("timer pairing gate: 判定", () => {
    const today = new Date("2026-09-13T00:00:00Z");

    it("未登记 → 红", () => {
        expect(evaluateSite(site(), { sites: [] }, today)).toMatchObject({ ok: false });
    });

    it("paired 但同文件没有清理 → 红（登记表不能说谎）", () => {
        const entry = { key: siteKey(site()), disposition: "paired" as const };
        // 用一个真实存在的文件：该文件里没有 `clearInterval(this.definitelyNotThere)`
        const verdict = evaluateSite(
            site({ file: "src/web-rtc/callFeed.ts", handle: "this.definitelyNotThere" }),
            {
                sites: [
                    {
                        ...entry,
                        key: siteKey(site({ file: "src/web-rtc/callFeed.ts", handle: "this.definitelyNotThere" })),
                    },
                ],
            },
            today,
        );

        expect(verdict.ok).toBe(false);
        expect(verdict.detail).toContain("找不到清理");
    });

    it("owned + clearedHandle 指向真实清理点 → 通过", () => {
        const target = site({
            file: "src/embedded.ts",
            handle: "this.clientWellKnownIntervalID",
        });
        const verdict = evaluateSite(
            target,
            {
                sites: [
                    {
                        key: siteKey(target),
                        disposition: "owned",
                        clearedIn: "src/client-lifecycle-stop.ts",
                        clearedHandle: "client.clientWellKnownIntervalID",
                    },
                ],
            },
            today,
        );

        expect(verdict).toMatchObject({ ok: true });
    });

    it("waived 缺 reason 或已过期 → 红", () => {
        const target = site();
        const key = siteKey(target);

        expect(evaluateSite(target, { sites: [{ key, disposition: "waived" }] }, today).ok).toBe(false);
        expect(
            evaluateSite(
                target,
                { sites: [{ key, disposition: "waived", reason: "嵌入式常驻", expires: "2026-01-01" }] },
                today,
            ).ok,
        ).toBe(false);
        expect(
            evaluateSite(
                target,
                { sites: [{ key, disposition: "waived", reason: "嵌入式常驻", expires: "2026-12-31" }] },
                today,
            ).ok,
        ).toBe(true);
    });

    it("未知处置 → 红（防止拼错 disposition 被当成通过）", () => {
        expect(
            evaluateSite(site(), { sites: [{ key: siteKey(site()), disposition: "ignored" as never }] }, today).ok,
        ).toBe(false);
    });
});

describe("timer pairing gate: 仓库登记表", () => {
    it("当前登记表条目都能在源码里核到清理点或有理由", () => {
        const registry = readRegistry();
        const repoRoot = process.cwd();

        expect(registry.sites.length).toBeGreaterThan(0);
        for (const entry of registry.sites) {
            expect(entry.key).toMatch(/^src\/.+#(interval|stored-timeout)#.+#\d+$/);
            if (entry.disposition === "owned") {
                expect(typeof (entry.clearedHandle ?? entry.clearCollection)).toBe("string");
                expect(fs.existsSync(path.join(repoRoot, entry.clearedIn ?? ""))).toBe(true);
            }
            if (entry.disposition === "waived") {
                expect(typeof entry.reason).toBe("string");
                expect(typeof entry.expires).toBe("string");
            }
        }
    });
});
