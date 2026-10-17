/*
 * `scripts/quality/check-api-contract-doc-paths.mjs` 的守卫 spec（2026-10-10，批次 H3）。
 *
 * 这个门禁守的是：`docs/api-contract/*.md` 表格行里逐字写出的 `/_matrix` / `/_synapse`
 * 路径，是否仍存在于后端 ledger 镜像。它先前有一条**静默漏扫**：
 *
 *   · 旧判据 `PATH_RE` 要求反引号后**紧跟 `/`**，而模块页「后端端点」列的主写法是
 *     `` `GET /path` ``（方法 + 路径同反引号）⇒ 整列从未被扫过。实测这 4 个页面
 *     （federation / thread / voice / widget）恰好有 11 行陈旧路径一直在门禁眼皮底下。
 *
 * 批次 H 把判据扩成「两种写法都扫」，并补了三条容易再造假红的护栏：
 *
 *   ① 裸路径单反引号 `` `/path` ``；
 *   ② 方法 + 路径同反引号 `` `GET /path` ``（D-04 之前整列漏扫）；
 *   ③ 比对前**先剥 query**（`` `/register?kind=guest` `` 的真身是 `/register`，
 *      不剥就会把正确路径报成"陈旧"—— 本轮实测的假阳性来源之一）；
 *   ④ 已登记在 `path-contract-waivers.json` 的后端缺失路径**放过**（有主有期限的已知差距，
 *      不是文档漂移）；
 *   ⑤ 含 `{}` / `*` 的模板路径跳过（不可逐字比对）；只扫表格行、跳纯前缀命名空间。
 *
 * 每个 `it` 对应上面一条，并给出**必须被扫出**（或必须被放过）的样本 —— 门禁的价值
 * 不在于"它检查了什么"，而在于"它能否证明自己会红"。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { scan } from "../../scripts/quality/check-api-contract-doc-paths.mjs";

/**
 * 用一份 `probe.md` + 一份 ledger 夹具 + 一份 waivers 夹具跑一次 `scan`。
 * 全部写进独立临时目录，互不干扰。
 */
function runScan(md: string, opts: { ledger?: unknown[]; waivers?: unknown[] } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "doc-paths-fixture-"));
    const docsDir = path.join(dir, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, "probe.md"), md);

    const manifest = path.join(dir, "ledger.json");
    fs.writeFileSync(manifest, JSON.stringify({ entries: opts.ledger ?? [] }));

    const waivers = path.join(dir, "waivers.json");
    fs.writeFileSync(waivers, JSON.stringify({ waivers: opts.waivers ?? [] }));

    return { result: scan({ docsDir, manifest, waivers }), docsDir };
}

/** 三行最小表格：第 3 行放被测端点。 */
function tableRow(cell: string): string {
    return ["| 后端端点 | 现状 |", "| --- | --- |", `| ${cell} | 探针 |`, ""].join("\n");
}

const LEDGER_SYNC = [{ method: "GET", path: "/_matrix/client/v3/sync" }];

describe("check-api-contract-doc-paths：三条判据各一例", () => {
    it("判据①：反引号内裸路径 —— ledger 里没有即判陈旧（红）", () => {
        const { result } = runScan(tableRow("`/_matrix/client/v3/gone`"), { ledger: LEDGER_SYNC });
        expect(result.total).toBe(1);
        expect(result.byPage["probe.md"]).toEqual([{ line: 3, path: "/_matrix/client/v3/gone" }]);
    });

    it("判据②：方法 + 路径同反引号 —— D-04 之前整列漏扫，现在同样判陈旧（红）", () => {
        const { result } = runScan(tableRow("`GET /_matrix/client/v3/gone2`"), { ledger: LEDGER_SYNC });
        expect(result.total).toBe(1);
        expect(result.byPage["probe.md"]).toEqual([{ line: 3, path: "/_matrix/client/v3/gone2" }]);
    });

    it("判据②阴性对照：同一单元格裸路径写法不会被两种正则重复计数", () => {
        const { result } = runScan(tableRow("`/_matrix/client/v3/gone`"), { ledger: LEDGER_SYNC });
        expect(result.total).toBe(1);
    });

    it("判据③：已登记 waiver 的后端缺失路径被放过（不算陈旧）", () => {
        const { result } = runScan(tableRow("`POST /_matrix/vendor/v1/widgets/create`"), {
            ledger: [{ method: "POST", path: "/_matrix/vendor/v1/widgets" }],
            waivers: [{ sdkCall: "POST /_matrix/vendor/v1/widgets/create" }],
        });
        expect(result.total).toBe(0);
    });

    it("判据③阴性对照：把 waiver 抽掉，同一路径立刻变红（豁免是真在起作用的）", () => {
        const { result } = runScan(tableRow("`POST /_matrix/vendor/v1/widgets/create`"), {
            ledger: [{ method: "POST", path: "/_matrix/vendor/v1/widgets" }],
        });
        expect(result.total).toBe(1);
        expect(result.byPage["probe.md"][0].path).toBe("/_matrix/vendor/v1/widgets/create");
    });
});

describe("check-api-contract-doc-paths：本轮的两种探针形态", () => {
    it("探针一：query 必须先剥再比对 —— `/register?kind=guest` 的真身是 `/register`（不假红）", () => {
        const { result } = runScan(tableRow("`GET /_matrix/client/v3/register?kind=guest`"), {
            ledger: [{ method: "GET", path: "/_matrix/client/v3/register" }],
        });
        expect(result.total).toBe(0);
    });

    it("探针二：含 `{}` 的模板路径跳过（不可逐字比对，不参与判定）", () => {
        const { result } = runScan(tableRow("`POST /_matrix/client/v3/rooms/{room_id}/threads`"), { ledger: [] });
        expect(result.total).toBe(0);
    });

    it("探针二负例：含 `*` / `...` 的通配路径同样跳过", () => {
        expect(runScan(tableRow("`GET /_matrix/client/v3/rooms/*/x`"), { ledger: [] }).result.total).toBe(0);
        expect(runScan(tableRow("`GET /_matrix/client/v3/a/.../b`"), { ledger: [] }).result.total).toBe(0);
    });
});

describe("check-api-contract-doc-paths：既有口径不回归", () => {
    it("ledger 命中的路径不报；纯前缀命名空间（`/_matrix/client/v3`）不报", () => {
        const md = [
            "| 后端端点 | 现状 |",
            "| --- | --- |",
            "| `/_matrix/client/v3/sync` | 命中 |",
            "| `/_matrix/client/v3` | 裸前缀 |",
            "",
        ].join("\n");
        const { result } = runScan(md, { ledger: LEDGER_SYNC });
        expect(result.total).toBe(0);
    });

    it("尾斜杠差异按「去尾斜杠后存在」放过（ledger 自身有尾斜杠孪生）", () => {
        const { result } = runScan(tableRow("`/_matrix/client/v3/sync/`"), { ledger: LEDGER_SYNC });
        expect(result.total).toBe(0);
    });

    it("只扫表格行：正文/列表里的路径提及不算端点引用", () => {
        const md = [
            "| 后端端点 | 现状 |",
            "| --- | --- |",
            "| `/_matrix/client/v3/sync` | 命中 |",
            "",
            "正文里写 `/_matrix/client/v3/not-a-row` 不该被扫。",
            "",
        ].join("\n");
        const { result } = runScan(md, { ledger: LEDGER_SYNC });
        expect(result.total).toBe(0);
    });
});

describe("check-api-contract-doc-paths：与真实仓库接线", () => {
    it("扫描仓内真实 docs/api-contract：陈旧行数为 0（批次 H2 已归零，且与 baseline 一致）", () => {
        // 这条是"门禁确实接在真实文档上"的证明：若有人再往模块页写回陈旧路径，这里先红。
        const { total } = scan();
        expect(total).toBe(0);
    });
});
