/*
 * `synapse-ledger-export` 交接的漂移防线。
 *
 * 这条链路有四个端点，任何一端的 profile 列表改了都会让交接静默失效：
 *   1. 后端导出器    synapse-rust/.github/workflows/ledger-export.yml（`for profile in ...`）
 *   2. 后端 fixture  synapse-rust/scripts/generate_sdk_ledger_fixtures.sh（SDK 默认摄取的车道）
 *   3. SDK 接收器    .github/workflows/synapse-ledger-sync.yaml（semantic-diff 里的 profiles）
 *   4. SDK 消费者    scripts/contract-sync.mjs（PROFILES）
 *
 * 2026-09 实况：`openclaw` 已在 1/2/4 退役，只有 3 还留着它 —— 于是每次交接都被判定为
 * “有语义变化”（`route-manifest.openclaw.json` 永远不存在），白跑一轮同步流程。
 * 这条不变量必须由测试守着：**改 PROFILES 就必须同时改接收器**。
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SYNC_WORKFLOW = ".github/workflows/synapse-ledger-sync.yaml";
const CONTRACT_SYNC = "scripts/contract-sync.mjs";
const BACKEND_EXPORT_WORKFLOW = "../synapse-rust/.github/workflows/ledger-export.yml";
const BACKEND_FIXTURE_GENERATOR = "../synapse-rust/scripts/generate_sdk_ledger_fixtures.sh";

const readFile = (relative: string): string => fs.readFileSync(path.resolve(relative), "utf8");
const readIfExists = (relative: string): string | null => {
    const abs = path.resolve(relative);
    return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
};

/** 从 `name = ["a", "b"]` 形态里取出字符串列表。 */
function extractQuotedList(source: string, pattern: RegExp, label: string): string[] {
    const match = pattern.exec(source);
    if (!match) throw new Error(`未能从 ${label} 解析出 profile 列表（模式 ${String(pattern)}）`);
    return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

/** 从 `for profile in default worker all; do` 里取出 profile 列表。 */
function extractShellProfileLoop(source: string, label: string): string[] {
    const match = /for profile in ([^;]+); do/.exec(source);
    if (!match) throw new Error(`未能从 ${label} 解析出 profile 循环`);
    return match[1].trim().split(/\s+/);
}

const syncWorkflow = readFile(SYNC_WORKFLOW);
const sdkProfiles = extractQuotedList(readFile(CONTRACT_SYNC), /const PROFILES = \[([^\]]*)\]/, CONTRACT_SYNC);
const hasBackendCheckout = readIfExists(BACKEND_EXPORT_WORKFLOW) !== null;

describe("synapse ledger 交接的 profile 契约", () => {
    it("contract-sync 的 PROFILES 是后端导出器实际导出的三个 profile", () => {
        expect(sdkProfiles).toEqual(["default", "worker", "all"]);
    });

    it("SDK 接收器的 profiles 与 contract-sync 的 PROFILES 完全一致", () => {
        expect(extractQuotedList(syncWorkflow, /^\s*profiles = \[([^\]]*)\]/m, SYNC_WORKFLOW)).toEqual(sdkProfiles);
    });

    it("接收器监听的是后端真正派发的事件类型", () => {
        expect(syncWorkflow).toMatch(/repository_dispatch:/);
        expect(syncWorkflow).toMatch(/types:\s*\[synapse-ledger-export\]/);
    });

    it("接收器按后端上传的名字（ledger-export-<sha>）解析 artifact", () => {
        expect(syncWorkflow).toContain('artifact_name="ledger-export-${source_sha}"');
    });

    it.skipIf(!hasBackendCheckout)("后端导出器与本仓库 PROFILES 一致，且用 all-extensions 编译", () => {
        const backend = readIfExists(BACKEND_EXPORT_WORKFLOW);
        expect(backend).not.toBeNull();

        expect(extractShellProfileLoop(backend!, BACKEND_EXPORT_WORKFLOW)).toEqual(sdkProfiles);
        expect(backend!).toContain("--features all-extensions");
        expect(backend!).toContain("LEDGER_ARTIFACT_NAME: ledger-export-${{ github.sha }}");
    });

    it.skipIf(!hasBackendCheckout)("后端 SDK fixture 车道用同一组 profile 与 all-extensions 生成", () => {
        const generator = readIfExists(BACKEND_FIXTURE_GENERATOR);
        expect(generator).not.toBeNull();

        expect(extractShellProfileLoop(generator!, BACKEND_FIXTURE_GENERATOR)).toEqual(sdkProfiles);
        expect(generator!).toContain("--features all-extensions");
        // SDK 的 contract:sync 默认就吃这条车道，生成脚本必须写进同一个目录。
        expect(generator!).toContain("tests/unit/fixtures/ledger_export_sdk");
    });
});
