/*
 * Negative tests for the manager-codegen coverage gate.
 *
 * The gate used to report a flat "71.4% covered / 14 missing" with no way to tell a real
 * gap from a module that simply does not consume a route table (three of those 14 were
 * actually gate bugs — see the 2026-09-13 review, P2 item 2.4). It then over-corrected the
 * other way: coverage was decided by matching manager CLASS NAMES, so `sliding_sync` was
 * "covered" by `SyncManager` (`"slidingsync".includes("sync")`) — a manager that lives in
 * `src/sync-management/` and knows nothing about sliding sync. These tests pin the
 * evidence-based rule so neither failure mode can return.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
    WAIVED_MODULES,
    classifyModuleCoverage,
    collectCodegenConsumers,
    countRouteTableEntries,
} from "../../scripts/quality/check-manager-codegen-coverage.mjs";

const TODAY = new Date("2026-09-13T00:00:00Z");
const NO_CONSUMERS = { strong: [], weak: [] };
const STRONG = { strong: ["room/RoomManager.ts"], weak: [] };
const WEAK = { strong: [], weak: ["sync.ts"] };

/**
 * 白名单里任取一个模块名。**不要在这里硬写模块名**：断言一旦绑死业务事实，业务一变就是假红。
 * 这个文件正是这么红的 —— `push_notification` 的 waiver 在 c1e304dc4 被移除后，
 * `classifyModuleCoverage("push_notification", …)` 期望 `waived` 的断言没人跟着改，
 * spec 从那之后一直失败（见审计文档 §7.11）。改为从真实表里取样本，表变了断言自动跟着走。
 */
const SAMPLE_WAIVED_MODULE = Object.keys(WAIVED_MODULES)[0] ?? "";

function makeSrcTree(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-js-sdk-codegen-coverage-"));
    for (const [relativePath, content] of Object.entries(files)) {
        const fullPath = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, `${content}\n`, "utf8");
    }
    return root;
}

describe("codegen coverage gate: module classification", () => {
    it("covers a module that has both a route table and a route-table consumer", () => {
        expect(classifyModuleCoverage("room", { hasCodegen: 40, consumers: STRONG, today: TODAY })).toEqual({
            status: "covered",
            evidence: "route-table-import",
        });
    });

    it("只发 HTTP、没人 import 表的模块不算 covered（旧版把它算进 100%）", () => {
        expect(classifyModuleCoverage("brand_new_module", { hasCodegen: 12, consumers: WEAK, today: TODAY })).toEqual({
            status: "missing",
            reason: "NO_CONSUMER",
        });
    });

    it("有表没人读、但已白名单说明原因的模块 → waived，并标出证据强度", () => {
        // push_notification 曾是这样，friend_room 也是（SDK-1b 接线后升级为强证据）。
        // 样本取自真实白名单表，不硬写名字。
        const verdict = classifyModuleCoverage(SAMPLE_WAIVED_MODULE, {
            hasCodegen: 9,
            consumers: WEAK,
            today: TODAY,
        });

        expect(verdict.status).toBe("waived");
        expect(verdict.evidence).toBe("table-without-consumer");
        expect(verdict.waiver?.reason).toBe(WAIVED_MODULES[SAMPLE_WAIVED_MODULE]?.reason);
    });

    it("本来就没有表的白名单模块标为 no-table（与'有表没人读'区分开）", () => {
        const verdict = classifyModuleCoverage(SAMPLE_WAIVED_MODULE, {
            hasCodegen: 0,
            consumers: NO_CONSUMERS,
            today: TODAY,
        });

        expect(verdict.evidence).toBe("no-table");
    });

    it("waives a documented non-consumer while its waiver is live", () => {
        const verdict = classifyModuleCoverage(SAMPLE_WAIVED_MODULE, {
            hasCodegen: 0,
            consumers: NO_CONSUMERS,
            today: TODAY,
        });

        expect(verdict.status).toBe("waived");
        // 到期日只校验"晚于 today"，不写死日期：续期是例行操作，写死就每次续期假红。
        expect(new Date(verdict.waiver?.expires ?? 0).getTime()).toBeGreaterThan(TODAY.getTime());
        expect(verdict.waiver?.reason).toBeTruthy();
    });

    it("fails an UNLISTED module that has no route table (new gaps must not hide)", () => {
        expect(
            classifyModuleCoverage("brand_new_module", { hasCodegen: 0, consumers: STRONG, today: TODAY }),
        ).toMatchObject({ status: "missing", reason: "NO_CODEGEN" });
    });

    it("fails an UNLISTED module whose route table nothing in the module consumes", () => {
        expect(
            classifyModuleCoverage("brand_new_module", { hasCodegen: 12, consumers: NO_CONSUMERS, today: TODAY }),
        ).toMatchObject({ status: "missing", reason: "NO_CONSUMER" });
    });

    it("turns a waived module back into a failure once the waiver expires", () => {
        // 过期点从条目自身推导，而不是写死 "2027-01-01"：写死的话每当白名单续期，这条就假红。
        const expires = new Date(WAIVED_MODULES[SAMPLE_WAIVED_MODULE]?.expires ?? 0);
        const afterExpiry = new Date(expires.getTime() + 24 * 60 * 60 * 1000);

        expect(
            classifyModuleCoverage(SAMPLE_WAIVED_MODULE, {
                hasCodegen: 0,
                consumers: NO_CONSUMERS,
                today: afterExpiry,
            }),
        ).toMatchObject({ status: "missing", reason: "EXPIRED_WAIVER" });
    });
});

describe("codegen coverage gate: consumer evidence", () => {
    it("ignores a same-named manager that lives in another module (the SyncManager bug)", () => {
        const root = makeSrcTree({
            "sliding-sync/__generated__/route-table.ts": 'export const routes = [{ method: "POST", path: "/x" }];',
            // `"slidingsync".includes("sync")` used to make this file authorise sliding_sync.
            "sync-management/index.ts": [
                "export class SyncManager {",
                "    async go() {",
                "        return this.client.http.authedRequest('GET', '/sync');",
                "    }",
                "}",
            ].join("\n"),
        });

        expect(collectCodegenConsumers("sliding-sync", root)).toEqual({ strong: [], weak: [] });
        expect(
            classifyModuleCoverage("sliding_sync", {
                hasCodegen: countRouteTableEntries("sliding-sync", root),
                consumers: collectCodegenConsumers("sliding-sync", root),
                today: TODAY,
            }),
        ).toMatchObject({ status: "missing", reason: "NO_CONSUMER" });
    });

    it("跨模块 import 也算强证据（sync/account_data/search/sliding_sync 的真实形态）", () => {
        const root = makeSrcTree({
            "sync/__generated__/route-table.ts": 'export const SYNC_ROUTES = [{ method: "GET", path: "/sync" }];',
            "client-batch-requests.ts":
                'import type { SyncPathPattern } from "./sync/__generated__/route-table";\nexport type P = SyncPathPattern;',
        });

        expect(collectCodegenConsumers("sync", root).strong).toEqual(["client-batch-requests.ts"]);
        expect(
            classifyModuleCoverage("sync", {
                hasCodegen: countRouteTableEntries("sync", root),
                consumers: collectCodegenConsumers("sync", root),
                today: TODAY,
            }),
        ).toMatchObject({ status: "covered", evidence: "route-table-import" });
    });

    it("导入了**别的模块**的表不算本模块的证据（push_notification 的真实形态）", () => {
        const root = makeSrcTree({
            "notifications/__generated__/route-table.ts": 'export const N = [{ method: "GET", path: "/n" }];',
            "push/__generated__/route-table.ts": 'export const P = [{ method: "GET", path: "/p" }];',
            // notifications 目录里的文件导入的是 push 的表 —— 旧规则只看"是否 import 了某张表"，
            // 于是把它算成 notifications 的强证据。
            "notifications/index.ts": [
                'import type { PushPathPattern } from "../push/__generated__/route-table";',
                "export type Q = PushPathPattern;",
                "export class NotificationsManager {",
                "    async list() {",
                "        return this.client.http.authedRequest('GET', '/notifications');",
                "    }",
                "}",
            ].join("\n"),
        });

        expect(collectCodegenConsumers("notifications", root)).toEqual({
            strong: [],
            weak: ["notifications/index.ts"],
        });
    });

    it("counts a route-table import in the module as strong evidence", () => {
        const root = makeSrcTree({
            "room/__generated__/route-table.ts": 'export const routes = [{ method: "GET", path: "/x" }];',
            "room/RoomManager.ts": 'import { routes } from "./__generated__/route-table";\nexport const x = routes;',
        });

        expect(collectCodegenConsumers("room", root)).toEqual({ strong: ["room/RoomManager.ts"], weak: [] });
    });

    it("counts a flat sibling file (src/sliding-sync.ts) as part of the module", () => {
        const root = makeSrcTree({
            "sliding-sync/__generated__/route-table.ts": 'export const routes = [{ method: "POST", path: "/x" }];',
            "sliding-sync.ts":
                "export class SlidingSync {\n    go() {\n        return this.client.http.authedRequest('GET', '/sync');\n    }\n}",
        });

        expect(collectCodegenConsumers("sliding-sync", root)).toEqual({ strong: [], weak: ["sliding-sync.ts"] });
    });

    it("does not treat generated files themselves as consumers", () => {
        const root = makeSrcTree({
            "room/__generated__/route-table.ts": 'export const routes = [{ method: "GET", path: "/x" }];',
            "room/__generated__/dto.ts": "export interface RoomDto {\n    x: string;\n}",
        });

        expect(collectCodegenConsumers("room", root)).toEqual({ strong: [], weak: [] });
    });

    it("聚合契约出口不算消费者（否则会洗白全部豁免）", () => {
        // 回归守卫：`src/contract/index.ts` 把 39 张表统一再导出，供 matrix-js-sdk/contract 使用。
        // 它对「某个模块是否被真正使用」**零证据** —— 若被算作强证据，
        // 每个有表的模块都会凭空变成 covered，把 `cas` 这类
        // 「有表没人读」的豁免静默洗白（正是 cas 豁免注释里明令禁止的做法）。
        const root = makeSrcTree({
            "cas/__generated__/route-table.ts": 'export const routes = [{ method: "GET", path: "/x" }];',
            "contract/index.ts":
                'import { routes } from "../cas/__generated__/route-table";\nexport const SDK_CONTRACT = { cas: routes };',
        });

        expect(collectCodegenConsumers("cas", root)).toEqual({ strong: [], weak: [] });
    });

    it("聚合出口被排除，但同目录下真实消费者仍被认出", () => {
        const root = makeSrcTree({
            "cas/__generated__/route-table.ts": 'export const routes = [{ method: "GET", path: "/x" }];',
            "contract/index.ts":
                'import { routes } from "../cas/__generated__/route-table";\nexport const SDK_CONTRACT = { cas: routes };',
            "cas/index.ts":
                'import type { routes } from "./__generated__/route-table";\nexport type R = typeof routes;',
        });

        expect(collectCodegenConsumers("cas", root).strong).toEqual(["cas/index.ts"]);
    });

    it("同一进程内不同 srcRoot 的索引互不串味（索引必须按 root 分键）", () => {
        // 回归守卫：findStrongConsumers 现在建「文件 → route-table 落点」索引并按 srcRoot 缓存。
        // 若有人把缓存键写错（例如只按模块名），下面第二个 root 会拿到第一个 root 的结果，
        // 于是"没接线的模块"被误判成 covered —— 这正是本门禁历史上栽过的那个坑。
        const withConsumer = makeSrcTree({
            "room/__generated__/route-table.ts": 'export const routes = [{ method: "GET", path: "/x" }];',
            "room/RoomManager.ts": 'import { routes } from "./__generated__/route-table";\nexport const x = routes;',
        });
        const withoutConsumer = makeSrcTree({
            "room/__generated__/route-table.ts": 'export const routes = [{ method: "GET", path: "/x" }];',
        });

        expect(collectCodegenConsumers("room", withConsumer).strong).toEqual(["room/RoomManager.ts"]);
        expect(collectCodegenConsumers("room", withoutConsumer).strong).toEqual([]);
        // 回头再查第一个 root：后建的索引不得污染它。
        expect(collectCodegenConsumers("room", withConsumer).strong).toEqual(["room/RoomManager.ts"]);
    });

    it("同一 srcRoot 重复查询不再读盘（索引复用，而非每模块重扫一次）", () => {
        // 这是 O(模块 × 文件) → O(文件) 那条性能修复的行为化断言：
        // 第一次查询建索引，此后同 root 的查询必须走索引。删掉源文件后结果不变即为证据
        // （若仍在每次重扫盘，结果会变成空）。
        const root = makeSrcTree({
            "room/__generated__/route-table.ts": 'export const routes = [{ method: "GET", path: "/x" }];',
            "room/RoomManager.ts": 'import { routes } from "./__generated__/route-table";\nexport const x = routes;',
        });

        expect(collectCodegenConsumers("room", root).strong).toEqual(["room/RoomManager.ts"]);

        fs.rmSync(path.join(root, "room", "RoomManager.ts"));

        expect(collectCodegenConsumers("room", root).strong).toEqual(["room/RoomManager.ts"]);
    });

    it("counts route-table entries and reports 0 when no table was generated", () => {
        const root = makeSrcTree({
            "room/__generated__/route-table.ts": [
                "export const routes = [",
                '    { method: "GET", path: "/a" },',
                '    { method: "POST", path: "/b" },',
                "];",
            ].join("\n"),
        });

        expect(countRouteTableEntries("room", root)).toBe(2);
        expect(countRouteTableEntries("absent", root)).toBe(0);
    });
});

describe("codegen coverage gate: 白名单表自身的完整性", () => {
    it("每一条 waiver 都带 reason 与可解析的 expires（不留纸面豁免）", () => {
        // 这条断言只依赖真实白名单表本身，因此不会随业务接线而腐朽；
        // 它替代了原先"把 admin / push_notification 写进断言"的那类硬编码。
        const entries = Object.entries(WAIVED_MODULES);

        expect(entries.length).toBeGreaterThan(0);

        for (const [moduleName, waiver] of entries) {
            expect(waiver.reason, `${moduleName} 缺 reason`).toBeTruthy();
            expect(Number.isNaN(new Date(waiver.expires).getTime()), `${moduleName} 的 expires 无法解析`).toBe(false);
        }
    });
});
