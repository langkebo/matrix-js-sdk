/*
 * `scripts/quality/check-waiver-expiry.mjs` 的单元测试。
 *
 * 这条门禁管的是"豁免（waiver）到期强制"（审计 P3：本仓曾有两套豁免纪律，
 * 一套有 `expires` 硬阻断、另一套过期只 warn）。它出错的方式很隐蔽：
 *
 *   · **边界错一天**：把"到期当天"判成"已过期" → 每逢到期日就假红；
 *     把"已过期"判成"还有效" → 债务可以永不归还（等于没有到期强制）。
 *   · **时区错一天**：`new Date("2026-12-31")` 是 **UTC** 零点，在负时区会落到前一天，
 *     于是"明天到期"被算成"今天已过期"。所以实现里必须用 `T00:00:00`（本地自然日）。
 *
 * 下面把边界与解析异常逐条钉死。
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
    EXPIRING_SOON_DAYS,
    EXPIRY,
    LEDGER_SOURCES,
    classifyExpiry,
    collectExpirables,
    daysLeftUntil,
    formatLocalDate,
} from "../../scripts/quality/check-waiver-expiry.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 固定的"今天"：2026-06-01 本地零点（避免用例随真实日期漂移）。 */
const TODAY = new Date(2026, 5, 1);

describe("formatLocalDate（报告头日期：必须按**本地**日历，不能用 toISOString）", () => {
    it("按本地年月日输出，补零", () => {
        expect(formatLocalDate(new Date(2026, 0, 5))).toBe("2026-01-05");
        expect(formatLocalDate(new Date(2026, 11, 31))).toBe("2026-12-31");
    });

    it("**不**用 UTC —— 与 toISOString 在跨日时必须不同", () => {
        // 东八区 2026-10-07 本地零点 ⇒ UTC 是 2026-10-06T16:00Z。
        // 这就是曾经的 bug：本地 10-07 早上，报告头打印 10-06。
        const d = new Date(2026, 5, 1, 0, 0, 0); // 本地 06-01 00:00
        const utcDate = d.toISOString().slice(0, 10);

        // 无论机器在哪个时区，本地日历日都必须是 06-01（这是 formatLocalDate 的全部职责）
        expect(formatLocalDate(d)).toBe("2026-06-01");

        // getTimezoneOffset() 返回 (UTC − local) 分钟：东八区是 **−480**，不是 +480。
        const offsetMinutes = d.getTimezoneOffset();
        if (offsetMinutes < 0) {
            // 本地在 UTC 之前（如东八区）：本地零点在 UTC 里落到前一天 ⇒ 两者必须不同
            expect(utcDate).toBe("2026-05-31");
            expect(formatLocalDate(d)).not.toBe(utcDate);
        } else {
            expect(formatLocalDate(d)).toBe(utcDate);
        }
    });
});

describe("daysLeftUntil", () => {
    it("按自然日计算差值", () => {
        expect(daysLeftUntil("2026-06-01", TODAY)).toBe(0);
        expect(daysLeftUntil("2026-06-02", TODAY)).toBe(1);
        expect(daysLeftUntil("2026-05-31", TODAY)).toBe(-1);
        expect(daysLeftUntil("2026-07-01", TODAY)).toBe(30);
    });

    it("无法解析的日期返回 NaN（而不是悄悄当成 0 或 -1）", () => {
        expect(Number.isNaN(daysLeftUntil("not-a-date", TODAY))).toBe(true);
        expect(Number.isNaN(daysLeftUntil("2026-13-45", TODAY))).toBe(true);
    });
});

describe("classifyExpiry 边界", () => {
    it("昨天到期 ⇒ EXPIRED，剩余 -1 天", () => {
        expect(classifyExpiry("2026-05-31", TODAY)).toEqual({ status: EXPIRY.EXPIRED, daysLeft: -1 });
    });

    it("当天到期 ⇒ EXPIRING_SOON 而非 EXPIRED（到期日当天仍有效）", () => {
        expect(classifyExpiry("2026-06-01", TODAY)).toEqual({
            status: EXPIRY.EXPIRING_SOON,
            daysLeft: 0,
        });
    });

    it("恰好还剩 EXPIRING_SOON_DAYS 天 ⇒ 仍在提醒窗口内", () => {
        expect(classifyExpiry("2026-07-01", TODAY).status).toBe(EXPIRY.EXPIRING_SOON);
        expect(daysLeftUntil("2026-07-01", TODAY)).toBe(EXPIRING_SOON_DAYS);
    });

    it("提醒窗口多一天 ⇒ VALID", () => {
        expect(classifyExpiry("2026-07-02", TODAY)).toEqual({
            status: EXPIRY.VALID,
            daysLeft: EXPIRING_SOON_DAYS + 1,
        });
    });

    it("完全无效的日期 ⇒ status 为 null（调用方据此 exit 1）", () => {
        const r = classifyExpiry("nope", TODAY);
        expect(r.status).toBeNull();
        expect(Number.isNaN(r.daysLeft)).toBe(true);
    });

    it("三个状态互斥且覆盖：EXPIRED / EXPIRING_SOON / VALID", () => {
        const seen = new Set(["2026-05-31", "2026-06-15", "2026-12-31"].map((d) => classifyExpiry(d, TODAY).status));
        expect(seen).toEqual(new Set([EXPIRY.EXPIRED, EXPIRY.EXPIRING_SOON, EXPIRY.VALID]));
    });
});

describe("collectExpirables（多台账拍平）", () => {
    /*
     * 背景：本门禁原先只读 `path-contract-waivers.json`，而 `swallow-fallback-baseline.json`
     * 里的 `@swallow-error { owner, expires }` **也有 expires 却没人读** ——
     * `check-swallow-fallbacks.mjs` 对"已登记基线里过期"只打一行 warning。
     * 同一仓库两套到期纪律、其中一套无人执行，就是这里要修的。
     */
    it("path-contract 台账：逐条取出 sdkCall/owner/expires/reason", () => {
        const out = collectExpirables([
            {
                name: "path-contract",
                doc: {
                    waivers: [
                        {
                            sdkCall: "activateUser",
                            file: "src/admin/index.ts",
                            owner: "langkebo",
                            expires: "2026-12-31",
                            reason: "后端未实现",
                        },
                    ],
                },
            },
        ]);
        expect(out).toEqual([
            {
                ledger: "path-contract",
                id: "activateUser",
                file: "src/admin/index.ts",
                owner: "langkebo",
                expires: "2026-12-31",
                reason: "后端未实现",
            },
        ]);
    });

    it("route-set-parity 台账：id 用 `METHOD path`", () => {
        const out = collectExpirables([
            {
                name: "route-set-parity",
                doc: {
                    waivers: [
                        {
                            method: "GET",
                            path: "/_matrix/client/v1/login/get_qr_code",
                            owner: "langkebo",
                            expires: "2026-12-31",
                        },
                    ],
                },
            },
        ]);
        expect(out[0].id).toBe("GET /_matrix/client/v1/login/get_qr_code");
        expect(out[0].ledger).toBe("route-set-parity");
        expect(out[0].owner).toBe("langkebo");
    });

    it("缺 owner 时落成空串（schema 判据据此报「缺 owner」）", () => {
        const out = collectExpirables([
            { name: "path-contract", doc: { waivers: [{ sdkCall: "x", expires: "2026-12-31" }] } },
        ]);
        expect(out[0].owner).toBe("");
    });

    it("swallow 台账：从 whitelist 里取 owner/expires，id 用 file:line", () => {
        const out = collectExpirables([
            {
                name: "swallow-fallback",
                doc: {
                    findings: [{ file: "src/a.ts", line: 188, whitelist: { owner: "x", expires: "2026-12-31" } }],
                },
            },
        ]);
        expect(out).toHaveLength(1);
        expect(out[0].id).toBe("src/a.ts:188");
        expect(out[0].owner).toBe("x");
        expect(out[0].expires).toBe("2026-12-31");
        expect(out[0].reason).toContain("owner=x");
    });

    it("swallow 里没有 whitelist 的条目**不算豁免**（那是待修缺陷，归 swallow 门禁管）", () => {
        const out = collectExpirables([
            { name: "swallow-fallback", doc: { findings: [{ file: "src/a.ts", line: 1 }] } },
        ]);
        expect(out).toEqual([]);
    });

    it("两本台账合并后仍各自保留来源标签", () => {
        const out = collectExpirables([
            { name: "path-contract", doc: { waivers: [{ path: "/x", expires: "2026-12-31" }] } },
            {
                name: "swallow-fallback",
                doc: { findings: [{ file: "a.ts", line: 1, whitelist: { expires: "2026-12-31" } }] },
            },
        ]);
        expect(out.map((e) => e.ledger)).toEqual(["path-contract", "swallow-fallback"]);
    });

    it("未登记的台账名 ⇒ 抛错，不许静默跳过（否则新台账会悄悄脱离纪律）", () => {
        expect(() => collectExpirables([{ name: "brand-new-ledger", doc: {} }])).toThrow(/未登记的台账/);
    });
});

describe("LEDGER_SOURCES", () => {
    it("覆盖 path-contract / swallow-fallback / route-set-parity 三本", () => {
        expect(LEDGER_SOURCES.map((s) => s.name).sort()).toEqual([
            "path-contract",
            "route-set-parity",
            "swallow-fallback",
        ]);
    });

    it("每本台账文件都真实存在（缺文件 = 纪律断链）", () => {
        for (const s of LEDGER_SOURCES) {
            expect(existsSync(path.join(projectRoot, "scripts", "quality", s.file))).toBe(true);
        }
    });
});
