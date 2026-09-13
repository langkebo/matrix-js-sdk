/*
 * 契约差集门禁的负向测试（阶段 3 · SDK-2）。
 *
 * 这个门禁是"让 24/49 模块的漂移变成逐条有结论"的唯一依据，判定写松了它就会变成
 * 一份永绿的清单：未登记不报、reason 空着不管、过期不红、差集修好后登记不清理。
 * 下面每条都钉住。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
    diffModule,
    driftKey,
    evaluateDrift,
    readLedgerManifest,
    readRegistry,
    readRouteTable,
} from "../../scripts/quality/check-contract-drift.mjs";
import { findLedgerModulesForSdkDir, findSdkDirForModule } from "../../scripts/contract-module-map.mjs";

function makeTree(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-js-sdk-contract-drift-"));
    for (const [relativePath, content] of Object.entries(files)) {
        const fullPath = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, `${content}\n`, "utf8");
    }
    return root;
}

const TODAY = new Date("2026-09-13T00:00:00Z");

describe("契约差集门禁: 读取与差集", () => {
    it("从 route-table 抽出 (method, path)，没有表时返回 null", () => {
        const root = makeTree({
            "src/demo/__generated__/route-table.ts": [
                "export const DEMO_ROUTES = [",
                '    { method: "GET", path: "/a" },',
                '    { method: "POST", path: "/b" },',
                "] as const;",
            ].join("\n"),
        });

        expect([...(readRouteTable("demo", root) ?? [])]).toEqual(["GET /a", "POST /b"]);
        expect(readRouteTable("absent", root)).toBeNull();
    });

    it("从 ledger 镜像抽出 (method, path)，大小写归一", () => {
        const root = makeTree({
            "docs/api-contract/generated/modules/demo.json": JSON.stringify({
                module: "demo",
                entries: [
                    { method: "GET", path: "/a" },
                    { method: "post", path: "/b" },
                ],
            }),
        });

        expect([...(readLedgerManifest("demo", root) ?? [])]).toEqual(["GET /a", "POST /b"]);
        expect(readLedgerManifest("absent", root)).toBeNull();
    });

    it("双向算差集（两个方向都要报，只报一边会让漂移从另一边漏掉）", () => {
        const diff = diffModule("demo", new Set(["GET /ledger", "POST /both"]), new Set(["GET /table", "POST /both"]));

        expect(diff.sdkOnly).toEqual(["GET /table"]);
        expect(diff.ledgerOnly).toEqual(["GET /ledger"]);
    });
});

describe("契约差集门禁: 判定", () => {
    const key = driftKey("room", "sdk-only", "GET /a");

    it("未登记 → 红", () => {
        expect(evaluateDrift(key, { entries: [] }, TODAY)).toMatchObject({ ok: false, detail: "未登记" });
    });

    it("登记缺 reason → 红", () => {
        expect(evaluateDrift(key, { entries: [{ key, reason: "" }] }, TODAY).ok).toBe(false);
    });

    it("登记已过期 → 红；未过期 → 通过", () => {
        expect(evaluateDrift(key, { entries: [{ key, reason: "历史条目", expires: "2026-01-01" }] }, TODAY).ok).toBe(
            false,
        );
        expect(
            evaluateDrift(key, { entries: [{ key, reason: "历史条目", expires: "2026-12-31" }] }, TODAY),
        ).toMatchObject({ ok: true, detail: "历史条目" });
    });

    it("key 形状固定为 module:kind:METHOD path（kind 只允许两个值）", () => {
        expect(key).toBe("room:sdk-only:GET /a");
        expect(driftKey("push", "ledger-only", "POST /b")).toBe("push:ledger-only:POST /b");
    });
});

describe("契约差集门禁: 仓库现状", () => {
    it("每条登记都有 reason/expires，且 key 与 module/kind/entry 自洽", () => {
        const registry = readRegistry();

        expect(registry.entries.length).toBeGreaterThan(0);
        for (const entry of registry.entries) {
            expect(entry.key).toBe(driftKey(entry.dir, entry.kind, entry.entry));
            expect(typeof entry.reason).toBe("string");
            expect(entry.reason.length).toBeGreaterThan(8);
            expect(typeof entry.expires).toBe("string");
        }
    });

    it("登记表与当前差集一一对应（没有未登记，也没有已修好却没删的 stale）", () => {
        // 与门禁本身同源地算一遍仓库现状：这是"登记表没有腐化"的唯一机械保证
        const registry = readRegistry();
        const index = JSON.parse(fs.readFileSync(path.resolve("docs/api-contract/generated/index.json"), "utf8"));
        const observed = new Set<string>();

        const moduleNames = Object.keys(index.modules).filter((name) => name !== "assembly");
        const sdkDirs = [...new Set(moduleNames.map((name) => findSdkDirForModule(name)))].sort();
        for (const sdkDir of sdkDirs) {
            const table = readRouteTable(sdkDir);
            if (table === null) continue;
            // 同一目录的兄弟 ledger 模块取并集（映射多对一）
            const ledger = new Set<string>();
            for (const moduleName of findLedgerModulesForSdkDir(sdkDir, moduleNames)) {
                for (const entry of readLedgerManifest(moduleName) ?? []) ledger.add(entry);
            }
            const diff = diffModule(sdkDir, ledger, table);
            for (const entry of diff.sdkOnly) observed.add(driftKey(sdkDir, "sdk-only", entry));
            for (const entry of diff.ledgerOnly) observed.add(driftKey(sdkDir, "ledger-only", entry));
        }

        const registered = new Set(registry.entries.map((entry) => entry.key));
        const missing = [...observed].filter((key) => !registered.has(key)).sort();
        const stale = [...registered].filter((key) => !observed.has(key)).sort();

        expect(missing, "有差集但没登记").toEqual([]);
        expect(stale, "登记了但差集已消失（应删登记）").toEqual([]);
    });
});
