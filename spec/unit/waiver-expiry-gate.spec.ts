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

import { describe, expect, it } from "vitest";

import {
    EXPIRING_SOON_DAYS,
    EXPIRY,
    classifyExpiry,
    daysLeftUntil,
    formatLocalDate,
} from "../../scripts/quality/check-waiver-expiry.mjs";

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
