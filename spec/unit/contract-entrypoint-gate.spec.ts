/*
 * `scripts/quality/check-contract-entrypoint.mjs` 的单元测试。
 *
 * 这个门禁守的是「手写聚合出口」与「codegen 产物」之间的一致性。
 * `src/contract/index.ts` 不在 `__generated__/` 下、也不由 codegen 生成，
 * 所以它必然有漂移风险：新增一个模块的 route-table 后忘记登记，消费者就看不到。
 *
 * 真实事故背景：消费者此前只能写
 * `../../../../../matrix-js-sdk/src/room/__generated__/route-table` 这种相对路径，
 * 既绕过了 `package.json#exports`，又在同一构建里混入了另一个 SDK 检出
 * （运行时来自 tarball，契约常量来自 sibling 仓库）。聚合出口就是为消除它而设。
 *
 * 值得钉的口径：
 *
 *   · **双向严格一致**：磁盘多一张表、或多登记一个幽灵模块，都必须单独可见。
 *   · **键必须指向正确的常量**：`SDK_CONTRACT_ROUTE_TABLES.room` 绑到
 *     `FRIEND_ROUTES` 是静默错误 —— 类型相同，运行时不报，只是数据全错。
 *   · **注释里的举例不能算登记**：本文件的文档注释里写了
 *     `SDK_CONTRACT_ROUTE_TABLES.room;` 作为用法示例，解析必须只认对象字面量里的键。
 *   · **跨模块重复路由**：重复说明后端契约或 codegen 有问题，必须在门禁暴露，
 *     而不是靠运行时去重掩盖。
 *   · **exports 配置**：子路径存在但指向错的 lib 产物，等于公开入口没生效。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
    collectRoutesFromTable,
    discoverRouteTableModules,
    evaluateContractEntrypoint,
    findDuplicateRoutes,
    hasContractEntrypointFailure,
    parseEntrypointImports,
    parseEntrypointModuleKeys,
    renderContractEntrypointFailure,
} from "../../scripts/quality/check-contract-entrypoint.mjs";

/** 造一段最小的聚合出口源码。 */
function makeEntrypointSource(entries: Array<{ module: string; constant: string }>): string {
    const imports = entries
        .map((e) => `import { ${e.constant} } from "../${e.module}/__generated__/route-table";`)
        .join("\n");
    const table = entries.map((e) => `    "${e.module}": ${e.constant},`).join("\n");
    return [
        "/*",
        " * 文档注释里会出现 SDK_CONTRACT_ROUTE_TABLES.room; 这样的用法举例。",
        " */",
        imports,
        "",
        "export const SDK_CONTRACT_ROUTE_TABLES = {",
        table,
        "} as const satisfies Record<string, readonly SdkContractRoute[]>;",
        "",
    ].join("\n");
}

const OK_EXPORTS = {
    "./contract": {
        import: "./lib/contract/index.js",
        types: "./lib/contract/index.d.ts",
    },
};

function evaluateWith(overrides: Partial<Parameters<typeof evaluateContractEntrypoint>[0]> = {}) {
    const entries = [
        { module: "friend", constant: "FRIEND_ROUTES" },
        { module: "room", constant: "ROOM_ROUTES" },
    ];
    return evaluateContractEntrypoint({
        entrypointSource: makeEntrypointSource(entries),
        diskModules: entries.map((e) => ({ module: e.module, tablePath: `/fake/${e.module}.ts` })),
        moduleRoutes: entries.map((e) => ({
            module: e.module,
            routes: [{ method: "GET", path: `/_matrix/client/v3/${e.module}` }],
        })),
        pkgExports: OK_EXPORTS,
        ...overrides,
    });
}

describe("check-contract-entrypoint / parseEntrypointModuleKeys", () => {
    it("只认对象字面量里的键，不把文档注释里的用法举例当登记", () => {
        const source = makeEntrypointSource([{ module: "room", constant: "ROOM_ROUTES" }]);
        expect(parseEntrypointModuleKeys(source)).toEqual([{ module: "room", constant: "ROOM_ROUTES" }]);
    });

    it("注释里的 SDK_CONTRACT_ROUTE_TABLES.room 不会被解析成键", () => {
        const source = [
            "// 用法: SDK_CONTRACT_ROUTE_TABLES.friend;",
            "export const SDK_CONTRACT_ROUTE_TABLES = {",
            '    "room": ROOM_ROUTES,',
            "} as const;",
        ].join("\n");
        expect(parseEntrypointModuleKeys(source).map((k) => k.module)).toEqual(["room"]);
    });

    it("接受 Prettier 去引号后的键（合法标识符不带引号）", () => {
        // Prettier 把 `"auth"` 写成 `auth`，只对含 `-` 的键保留引号。
        // 只认带引号的解析器会在一次 prettier --write 后静默丢掉大半模块 ——
        // 本项目 39 个模块里 28 个的键是合法标识符。
        const source = [
            "export const SDK_CONTRACT_ROUTE_TABLES = {",
            '    "account-data": ACCOUNT_DATA_ROUTES,',
            "    auth: AUTH_ROUTES,",
            '    "burn-after-read": BURN_AFTER_READ_ROUTES,',
            "    room: ROOM_ROUTES,",
            "} as const;",
        ].join("\n");
        expect(parseEntrypointModuleKeys(source)).toEqual([
            { module: "account-data", constant: "ACCOUNT_DATA_ROUTES" },
            { module: "auth", constant: "AUTH_ROUTES" },
            { module: "burn-after-read", constant: "BURN_AFTER_READ_ROUTES" },
            { module: "room", constant: "ROOM_ROUTES" },
        ]);
    });

    it("带引号与不带引号的两种写法解析结果一致", () => {
        const quoted = ["export const SDK_CONTRACT_ROUTE_TABLES = {", '    "room": ROOM_ROUTES,', "} as const;"].join(
            "\n",
        );
        const bare = ["export const SDK_CONTRACT_ROUTE_TABLES = {", "    room: ROOM_ROUTES,", "} as const;"].join("\n");
        expect(parseEntrypointModuleKeys(quoted)).toEqual(parseEntrypointModuleKeys(bare));
    });

    it("没有 SDK_CONTRACT_ROUTE_TABLES 块时返回空数组", () => {
        expect(parseEntrypointModuleKeys("export const X = 1;")).toEqual([]);
    });
});

describe("check-contract-entrypoint / parseEntrypointImports", () => {
    it("只收 __generated__/route-table 的命名导入，忽略其它导入", () => {
        const source = [
            'import { OTHER } from "../room/index";',
            'import { ROOM_ROUTES } from "../room/__generated__/route-table";',
            'import type { Foo } from "../friend/types";',
        ].join("\n");
        expect(parseEntrypointImports(source)).toEqual([
            { constant: "ROOM_ROUTES", specifier: "../room/__generated__/route-table", module: "room" },
        ]);
    });
});

describe("check-contract-entrypoint / discoverRouteTableModules", () => {
    it("只收有 __generated__/route-table.ts 的目录，忽略同层其它模块", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "contract-entrypoint-"));
        try {
            const withTable = path.join(root, "room", "__generated__");
            fs.mkdirSync(withTable, { recursive: true });
            fs.writeFileSync(path.join(withTable, "route-table.ts"), "export const ROOM_ROUTES = [];");

            // 只有 dto、没有 route-table 的模块（真实存在 7 个）不应被收进来
            const dtoOnly = path.join(root, "admin", "__generated__");
            fs.mkdirSync(dtoOnly, { recursive: true });
            fs.writeFileSync(path.join(dtoOnly, "dto.ts"), "export interface X {}");

            // 没有 __generated__ 的普通模块
            fs.mkdirSync(path.join(root, "models"), { recursive: true });

            expect(discoverRouteTableModules(root).map((m) => m.module)).toEqual(["room"]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe("check-contract-entrypoint / collectRoutesFromTable", () => {
    it("抽取 method/path 对", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "contract-table-"));
        try {
            const file = path.join(root, "route-table.ts");
            fs.writeFileSync(
                file,
                [
                    "export const ROOM_ROUTES = [",
                    '    { method: "GET", path: "/rooms" },',
                    '    { method: "POST", path: "/rooms/{roomId}/join" },',
                    "] as const;",
                ].join("\n"),
            );
            expect(collectRoutesFromTable(file)).toEqual([
                { method: "GET", path: "/rooms" },
                { method: "POST", path: "/rooms/{roomId}/join" },
            ]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe("check-contract-entrypoint / findDuplicateRoutes", () => {
    it("报出跨模块重复并标注两侧归属", () => {
        const duplicates = findDuplicateRoutes([
            { module: "a", routes: [{ method: "GET", path: "/x" }] },
            { module: "b", routes: [{ method: "GET", path: "/x" }] },
        ]);
        expect(duplicates).toEqual([{ key: "GET /x", count: 2, owners: ["a", "b"] }]);
    });

    it("同一模块内重复也报：codegen 承诺按 (method, path) 去重", () => {
        const duplicates = findDuplicateRoutes([
            {
                module: "a",
                routes: [
                    { method: "GET", path: "/x" },
                    { method: "GET", path: "/x" },
                ],
            },
        ]);
        expect(duplicates).toEqual([{ key: "GET /x", count: 2, owners: ["a"] }]);
    });

    it("同一模块出现三次只产出一条记录，count 反映真实次数", () => {
        const duplicates = findDuplicateRoutes([
            {
                module: "a",
                routes: [
                    { method: "GET", path: "/x" },
                    { method: "GET", path: "/x" },
                    { method: "GET", path: "/x" },
                ],
            },
        ]);
        expect(duplicates).toEqual([{ key: "GET /x", count: 3, owners: ["a"] }]);
    });

    it("method 不同不算重复", () => {
        const duplicates = findDuplicateRoutes([
            { module: "a", routes: [{ method: "GET", path: "/x" }] },
            { module: "b", routes: [{ method: "POST", path: "/x" }] },
        ]);
        expect(duplicates).toEqual([]);
    });
});

describe("check-contract-entrypoint / evaluateContractEntrypoint", () => {
    it("一致时无失败", () => {
        const result = evaluateWith();
        expect(hasContractEntrypointFailure(result)).toBe(false);
        expect(result.diskModuleCount).toBe(2);
        expect(result.declaredModuleCount).toBe(2);
        expect(result.importModuleCount).toBe(2);
        expect(result.routeCount).toBe(2);
    });

    it("磁盘多一张表 -> missingInEntrypoint", () => {
        const result = evaluateWith({
            diskModules: [
                { module: "friend", tablePath: "/f" },
                { module: "room", tablePath: "/r" },
                { module: "space", tablePath: "/s" },
            ],
            moduleRoutes: [
                { module: "friend", routes: [] },
                { module: "room", routes: [] },
                { module: "space", routes: [] },
            ],
        });
        expect(result.missingInEntrypoint).toEqual(["space"]);
        expect(hasContractEntrypointFailure(result)).toBe(true);
    });

    it("登记了幽灵模块 -> extraInEntrypoint", () => {
        const source = makeEntrypointSource([
            { module: "friend", constant: "FRIEND_ROUTES" },
            { module: "room", constant: "ROOM_ROUTES" },
            { module: "ghost", constant: "GHOST_ROUTES" },
        ]);
        const result = evaluateWith({ entrypointSource: source });
        expect(result.extraInEntrypoint).toEqual(["ghost"]);
        expect(hasContractEntrypointFailure(result)).toBe(true);
    });

    it("键绑到错误的常量 -> constantMismatches（类型相同、运行时不报）", () => {
        const source = [
            'import { FRIEND_ROUTES } from "../friend/__generated__/route-table";',
            'import { ROOM_ROUTES } from "../room/__generated__/route-table";',
            "export const SDK_CONTRACT_ROUTE_TABLES = {",
            '    "friend": FRIEND_ROUTES,',
            '    "room": FRIEND_ROUTES,',
            "} as const;",
        ].join("\n");
        const result = evaluateWith({ entrypointSource: source });
        expect(result.constantMismatches).toEqual([
            { module: "room", reason: "key maps to FRIEND_ROUTES but import binds ROOM_ROUTES" },
        ]);
        expect(hasContractEntrypointFailure(result)).toBe(true);
    });

    it("有键但缺 import -> constantMismatches", () => {
        const source = [
            'import { FRIEND_ROUTES } from "../friend/__generated__/route-table";',
            "export const SDK_CONTRACT_ROUTE_TABLES = {",
            '    "friend": FRIEND_ROUTES,',
            '    "room": ROOM_ROUTES,',
            "} as const;",
        ].join("\n");
        const result = evaluateWith({ entrypointSource: source });
        expect(result.constantMismatches).toContainEqual({
            module: "room",
            reason: "key present in SDK_CONTRACT_ROUTE_TABLES but not imported",
        });
    });

    it("重复路由 -> duplicateRoutes", () => {
        const result = evaluateWith({
            moduleRoutes: [
                { module: "friend", routes: [{ method: "GET", path: "/same" }] },
                { module: "room", routes: [{ method: "GET", path: "/same" }] },
            ],
        });
        expect(result.duplicateRoutes).toEqual([{ key: "GET /same", count: 2, owners: ["friend", "room"] }]);
        expect(hasContractEntrypointFailure(result)).toBe(true);
    });

    it("缺少 ./contract 子路径 -> exportIssues", () => {
        const result = evaluateWith({ pkgExports: {} });
        expect(result.exportIssues).toEqual(['package.json#exports["./contract"] is missing']);
        expect(hasContractEntrypointFailure(result)).toBe(true);
    });

    it("import 指向错误的 lib 产物 -> exportIssues", () => {
        const result = evaluateWith({
            pkgExports: { "./contract": { import: "./lib/wrong.js", types: "./lib/contract/index.d.ts" } },
        });
        expect(result.exportIssues).toHaveLength(1);
        expect(result.exportIssues[0]).toContain("./lib/wrong.js");
    });

    it("types 指向错误 -> exportIssues", () => {
        const result = evaluateWith({
            pkgExports: { "./contract": { import: "./lib/contract/index.js", types: "./lib/contract/index.d.tsx" } },
        });
        expect(result.exportIssues).toHaveLength(1);
        expect(result.exportIssues[0]).toContain(".d.tsx");
    });

    it("五类问题互不遮蔽：同时命中时全部可见", () => {
        const source = makeEntrypointSource([{ module: "ghost", constant: "GHOST_ROUTES" }]);
        const result = evaluateContractEntrypoint({
            entrypointSource: source,
            diskModules: [{ module: "room", tablePath: "/r" }],
            moduleRoutes: [
                { module: "room", routes: [{ method: "GET", path: "/x" }] },
                { module: "friend", routes: [{ method: "GET", path: "/x" }] },
            ],
            pkgExports: {},
        });
        expect(result.missingInEntrypoint).toEqual(["room"]);
        expect(result.extraInEntrypoint).toEqual(["ghost"]);
        expect(result.duplicateRoutes).toHaveLength(1);
        expect(result.exportIssues).toHaveLength(1);
    });
});

describe("check-contract-entrypoint / renderContractEntrypointFailure", () => {
    it("把各类问题都渲染出来，便于 CI 直接定位", () => {
        const result = evaluateContractEntrypoint({
            entrypointSource: makeEntrypointSource([{ module: "ghost", constant: "GHOST_ROUTES" }]),
            diskModules: [{ module: "room", tablePath: "/r" }],
            moduleRoutes: [{ module: "room", routes: [] }],
            pkgExports: {},
        });
        const text = renderContractEntrypointFailure(result);
        expect(text).toContain("room");
        expect(text).toContain("ghost");
        expect(text).toContain("./contract");
    });
});
