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
    classifyModuleCoverage,
    collectCodegenConsumers,
    countRouteTableEntries,
} from "../../scripts/quality/check-manager-codegen-coverage.mjs";

const TODAY = new Date("2026-09-13T00:00:00Z");
const NO_CONSUMERS = { strong: [], weak: [] };
const STRONG = { strong: ["room/RoomManager.ts"], weak: [] };
const WEAK = { strong: [], weak: ["sync.ts"] };

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
        // push_notification 就是这种：表生成了（10 条），src 下无人 import
        // （friend_room 曾在同类名单里，SDK-1b 接线后已升级为强证据）
        const verdict = classifyModuleCoverage("push_notification", { hasCodegen: 9, consumers: WEAK, today: TODAY });

        expect(verdict.status).toBe("waived");
        expect(verdict.evidence).toBe("table-without-consumer");
        expect(verdict.waiver?.reason).toMatch(/子集|push/);
    });

    it("本来就没有表的白名单模块标为 no-table（与'有表没人读'区分开）", () => {
        const verdict = classifyModuleCoverage("admin", { hasCodegen: 0, consumers: NO_CONSUMERS, today: TODAY });

        expect(verdict.evidence).toBe("no-table");
    });

    it("waives a documented non-consumer while its waiver is live", () => {
        const verdict = classifyModuleCoverage("admin", { hasCodegen: 0, consumers: NO_CONSUMERS, today: TODAY });

        expect(verdict.status).toBe("waived");
        expect(verdict.waiver?.expires).toBe("2026-12-31");
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
        const afterExpiry = new Date("2027-01-01T00:00:00Z");

        expect(
            classifyModuleCoverage("admin", { hasCodegen: 0, consumers: NO_CONSUMERS, today: afterExpiry }),
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
