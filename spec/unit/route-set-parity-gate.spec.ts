/*
 * `scripts/quality/check-route-set-parity.mjs` 的单元测试。
 *
 * 这条门禁补的是一格真实存在的盲区：`route-table.ts` 由三个来源**取并集**生成
 * （既有条目 ∪ ledger ∪ 人工文档 `ROUTE_CONTRACT.md`），而 `PathAssert<P, …>` 的类型
 * 就来自它。于是"后端不服务的路径"也能被类型系统接受 —— 实测
 * `bu("/background_updates/coun")`（占位路由下少一个字母）**tsc 全绿**，
 * 而 `quality:path-contract` 只核对源码里真正出现的调用点，看不见契约类型本身漂没漂。
 *
 * 它出错的代价不对称：
 *   · 假阴性 → 契约里长出后端不存在的路由，调用方一路绿灯到运行时 404；
 *   · 假阳性 → 每个 PR 都红，逼人把 waiver 灌水，门禁形同不存在。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { diffRouteSet, parseRouteTableEntries, routeKey } from "../../scripts/quality/check-route-set-parity.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const TODAY = "2026-10-08";

describe("parseRouteTableEntries", () => {
    it("认得 codegen 生成的那种单行条目", () => {
        const src = [
            "export const ROOM_ROUTES = [",
            '    { method: "POST", path: "/_matrix/client/v3/createRoom" },',
            '    { method: "GET", path: "/_matrix/client/v3/rooms/{room_id}" },',
            "];",
        ].join("\n");
        expect(parseRouteTableEntries(src)).toEqual([
            { method: "POST", path: "/_matrix/client/v3/createRoom" },
            { method: "GET", path: "/_matrix/client/v3/rooms/{room_id}" },
        ]);
    });

    it("生成物写法一变就**抽到空数组**（调用方必须判空，否则门禁恒绿）", () => {
        // 键序调换
        expect(parseRouteTableEntries('{ path: "/x", method: "GET" }')).toEqual([]);
        // 引号换了
        expect(parseRouteTableEntries("{ method: 'GET', path: '/x' }")).toEqual([]);
        // 数组本来就空
        expect(parseRouteTableEntries("export const X = [];")).toEqual([]);
    });

    it("不把其它花括号当条目", () => {
        expect(parseRouteTableEntries("const o = { a: 1 }; type T = { method: string };")).toEqual([]);
    });
});

describe("routeKey", () => {
    it("method 统一大写；路径逐字保留（不做版本/命名空间归一）", () => {
        expect(routeKey("get", "/_matrix/client/v3/x")).toBe("GET /_matrix/client/v3/x");
        expect(routeKey("GET", "/x")).not.toBe(routeKey("GET", "/y"));
    });
});

describe("diffRouteSet", () => {
    const ledger = new Set(["GET /in-ledger"]);

    it("命中 ledger ⇒ 无违规", () => {
        const r = diffRouteSet({
            entries: [{ method: "GET", path: "/in-ledger", file: "a.ts", module: "a" }],
            ledgerKeys: ledger,
            waivers: [],
            today: TODAY,
        });
        expect(r).toEqual({ uncovered: [], expiredWaivers: [], unusedWaivers: [] });
    });

    it("回归守卫：契约有、ledger 没有、又没有豁免 ⇒ uncovered", () => {
        const r = diffRouteSet({
            entries: [{ method: "GET", path: "/background_updates/coun", file: "a.ts", module: "a" }],
            ledgerKeys: ledger,
            waivers: [],
            today: TODAY,
        });
        expect(r.uncovered).toHaveLength(1);
        expect(r.uncovered[0].key).toBe("GET /background_updates/coun");
    });

    it("带有效豁免 ⇒ 不算 uncovered", () => {
        const r = diffRouteSet({
            entries: [{ method: "GET", path: "/qr", file: "a.ts", module: "a" }],
            ledgerKeys: ledger,
            waivers: [{ method: "GET", path: "/qr", reason: "上游规范路由", expires: "2026-12-31" }],
            today: TODAY,
        });
        expect(r.uncovered).toEqual([]);
        expect(r.expiredWaivers).toEqual([]);
    });

    it("豁免已过期 ⇒ 单独成桶（与 path-contract-waivers 同一纪律）", () => {
        const r = diffRouteSet({
            entries: [{ method: "GET", path: "/qr", file: "a.ts", module: "a" }],
            ledgerKeys: ledger,
            waivers: [{ method: "GET", path: "/qr", reason: "x", expires: "2026-01-01" }],
            today: TODAY,
        });
        expect(r.expiredWaivers).toHaveLength(1);
        expect(r.expiredWaivers[0].detail).toContain("2026-01-01");
    });

    it("豁免缺 expires（或格式非法）也算失效 —— 不许开无限期口子", () => {
        for (const w of [
            { method: "GET", path: "/qr", reason: "x" },
            { method: "GET", path: "/qr", reason: "x", expires: "nextyear" },
        ]) {
            const r = diffRouteSet({
                entries: [{ method: "GET", path: "/qr", file: "a.ts", module: "a" }],
                ledgerKeys: ledger,
                waivers: [w],
                today: TODAY,
            });
            expect(r.expiredWaivers).toHaveLength(1);
        }
    });

    it("豁免指向的路径已不在任何 route-table 里 ⇒ unusedWaivers（台账腐烂）", () => {
        const r = diffRouteSet({
            entries: [],
            ledgerKeys: ledger,
            waivers: [{ method: "GET", path: "/gone", reason: "x", expires: "2026-12-31" }],
            today: TODAY,
        });
        expect(r.unusedWaivers).toHaveLength(1);
    });

    it("到期判定按「当天不算过期」（`expires < today`）", () => {
        const r = diffRouteSet({
            entries: [{ method: "GET", path: "/qr", file: "a.ts", module: "a" }],
            ledgerKeys: ledger,
            waivers: [{ method: "GET", path: "/qr", reason: "x", expires: TODAY }],
            today: TODAY,
        });
        expect(r.expiredWaivers).toEqual([]);
    });
});

describe("仓库事实", () => {
    it("豁免台账存在且每条都有 reason + expires（否则纪律形同虚设）", () => {
        const raw = JSON.parse(
            readFileSync(path.join(projectRoot, "scripts/quality/route-set-parity-waivers.json"), "utf8"),
        );
        expect(Array.isArray(raw.waivers)).toBe(true);
        for (const w of raw.waivers) {
            expect(typeof w.reason).toBe("string");
            expect(w.reason.length).toBeGreaterThan(0);
            expect(w.expires).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
    });
});
