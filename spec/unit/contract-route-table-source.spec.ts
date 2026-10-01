/*
 * SDK-1 的回归防线：**ledger 里的每一条路由都必须出现在对应 SDK 目录的 route-table 里**。
 *
 * 改造前 route-table 只从后端 `ROUTE_CONTRACT.md`（人工文档）+ 既有条目渲染，于是 ledger 里
 * 声明、文档漏掉的路由会静默缺失 —— `friend` 表就少了 5 条写方法（`POST /friends` 等），
 * 而模块正在调它们（见 CONTRACT_ROUTE_TABLE_MAPPING_REVIEW_2026-09-13.md §2）。
 * 现在 ledger 是权威源，这条不变量必须由测试守住：**往 ledger 加路由就必须重新 codegen**。
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { readLedgerManifest, readRouteTable } from "../../scripts/quality/check-contract-drift.mjs";
import { findLedgerModulesForSdkDir, findSdkDirForModule } from "../../scripts/contract-module-map.mjs";

const index = JSON.parse(fs.readFileSync(path.resolve("docs/api-contract/generated/index.json"), "utf8"));
const moduleNames: string[] = Object.keys(index.modules).filter((name) => name !== "assembly");

describe("route-table 以 ledger 为权威源（SDK-1）", () => {
    it("每个 SDK 目录的表都覆盖该目录承载的全部 ledger 路由（ledger-only 差集为 0）", () => {
        const missing: string[] = [];

        for (const sdkDir of [...new Set(moduleNames.map((name) => findSdkDirForModule(name)))].sort()) {
            const table = readRouteTable(sdkDir);
            if (table === null) continue; // 没有表的模块由覆盖门禁的白名单负责
            for (const moduleName of findLedgerModulesForSdkDir(sdkDir, moduleNames)) {
                for (const entry of readLedgerManifest(moduleName) ?? []) {
                    if (!table.has(entry)) missing.push(`src/${sdkDir}: ${entry}（来自 ledger 模块 ${moduleName}）`);
                }
            }
        }

        expect(missing, "ledger 有、表里没有 —— 说明改了 ledger 但没重新 codegen").toEqual([]);
    });

    it("friend 表包含 ledger 声明的 5 条写方法（复核报告 §2 的具体缺口）", () => {
        const table = readRouteTable("friend");
        const expected = [
            "POST /_matrix/vendor/v1/friends",
            "POST /_matrix/vendor/v1/friends/dm/{user_id}",
            "POST /_matrix/vendor/v1/friends/groups",
            "POST /_matrix/vendor/v1/friends/search",
            "PUT /_matrix/vendor/v1/friends/{user_id}/status",
        ];

        for (const entry of expected) {
            expect(table?.has(entry), entry).toBe(true);
        }
    });

    it("生成头注释写明三源合并（避免又回到「只从 ROUTE_CONTRACT.md 渲染」）", () => {
        const header = fs
            .readFileSync(path.resolve("src/friend/__generated__/route-table.ts"), "utf8")
            .split("\n")
            .slice(0, 10)
            .join("\n");

        expect(header).toContain("既有条目 ∪ ledger 清单 ∪ ROUTE_CONTRACT.md");
    });

    it("friend 模块的路径经 friendPath() 约束（编译期断言，由 lint:types 把关）", () => {
        // 这里只做静态检查：三个子管理器都用了 friendPath 且导入了它
        for (const file of [
            "src/friend/sub-managers/friend-block-manager.ts",
            "src/friend/sub-managers/friend-list-manager.ts",
            "src/friend/sub-managers/friend-request-manager.ts",
        ]) {
            const content = fs.readFileSync(path.resolve(file), "utf8");
            expect(content, file).toMatch(/import \{ friendPath \} from "\.\.\/paths";/);
            expect(content.match(/friendPath\(/g)?.length ?? 0, file).toBeGreaterThan(0);
        }
    });
});
