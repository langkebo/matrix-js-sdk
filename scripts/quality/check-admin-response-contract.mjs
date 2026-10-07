#!/usr/bin/env node
/*
 * check-admin-response-contract.mjs — admin 面「响应/请求形状」契约门禁。
 *
 * ## 这个门禁关的洞
 *
 * 2026-10-07 的六轮人工核对（`artifacts/quality-gate-fingerprint-audit-2026-10-06.md`
 * §7.15-21 ~ §7.15-27）在 admin 面找出并修掉几十处「SDK 声明的响应/请求形状与后端不一致」。
 * 它们能长期存活，是因为**没有任何门禁把两侧对起来看**：
 *
 *   - `quality:path-contract`              → 只核对**路径**（HTTP 方法只是顺带）；
 *   - `contract:codegen`                   → 只核对**契约文档 ↔ 生成的 dto.ts**（同侧自我一致）；
 *   - `quality:generated-dto-strictness`   → 只核对生成物自身的严格性。
 *
 * 于是「字段名错 / 少字段 / 多伪造字段 / 请求体该不该有」整类缺陷在门禁全绿下长期存活。
 *
 * ## 两个半场（本门禁的核心设计）
 *
 * 后端只存在于同级 checkout（`../synapse-rust`），**CI 拿不到**；而已提交的后端产物
 * （`docs/api-contract/generated/route-manifest.*.json`）只有路径、没有响应体
 * （实测 admin 的 295 条路由里只有 30 条带 `query_params`，且 `HashMap` 型 Query 提取器
 * 一律为空 ⇒ 连"参数走 query 还是 body"都判不出来）。所以拆成两个半场：
 *
 *   1. **CI 半场**（无后端也能跑）：台账 `entries` 记录「路由 ↔ SDK 类型 ↔ 核对当时的字段集」。
 *      重抽 SDK 字段集与台账比对 ⇒ **改了 admin 响应类型而没重新核后端，CI 直接红**。
 *      这是唯一能在 CI 生效的机制。
 *   2. **工作区半场**（后端在场时）：重抽后端响应键/请求结构再比一次 ⇒ 后端漂移与 SDK 漂移都能发现。
 *      后端不在场时 **skip**（与 `check-cross-repo-pin.mjs` 同约定；`--strict` 把 skip 变失败）。
 *
 * ## 台账只降不升
 *
 * `deviations` = 已知偏差，每条必须带 `reason` 与 `expires`，过期即红。
 * `unresolved` = 抽取器覆盖不到的桶（返回类型无法解析 / 后端形状不可知 / 路由未解析 / 数组返回），
 * 计数**只准降不准升** —— 否则"沉默"会变成"通过"（本仓在可达性门禁上踩过同一个坑）。
 *
 * ## 用法
 *
 * ```bash
 * node scripts/quality/check-admin-response-contract.mjs             # CI 半场 +（后端在场时）工作区半场
 * node scripts/quality/check-admin-response-contract.mjs --strict    # 后端不在场也算失败（发布流程用）
 * node scripts/quality/check-admin-response-contract.mjs --refresh   # 需要后端：重新冻结 entries/unresolved
 * node scripts/quality/check-admin-response-contract.mjs --json      # 机器可读输出
 * ```
 *
 * 环境变量：`SYNAPSE_RUST_REPO`（后端仓根，默认 `../synapse-rust`）
 *
 * 退出码：0 通过 / 1 违规 / 2 门禁自身无法运行
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
    collectRustAdminContract,
    collectSdkAdminContract,
    normalizeReturnType,
    diffResponse,
} from "./lib/admin-contract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SDK_ROOT = path.resolve(__dirname, "..", "..");
const LEDGER_PATH = path.join(__dirname, "admin-response-contract-ledger.json");
const BACKEND_ROOT = process.env.SYNAPSE_RUST_REPO ?? path.resolve(SDK_ROOT, "..", "synapse-rust");
const RUST_ROUTES_ROOT = path.join(BACKEND_ROOT, "synapse-web", "src");

const STRICT = process.argv.includes("--strict");
const REFRESH = process.argv.includes("--refresh");
const EMIT_JSON = process.argv.includes("--json");

const MUTATIONS = new Set(["POST", "PUT", "PATCH"]);

/**
 * 请求体「该不该有」的判定。
 *
 * - `body-required-missing`：后端用 `Json<T>` 而 SDK 不传 body ⇒ 415（axum 要求 Content-Type）；
 * - `body-sent-ignored`：SDK 传了 body 而后端没有 `Json` 提取器 ⇒ 请求体被静默忽略。
 *
 * @returns {"body-required-missing" | "body-sent-ignored" | null}
 */
function bodyPresence(cs, be) {
    if (!MUTATIONS.has(cs.httpMethod)) return null;
    if (be.io.hasJson && !cs.hasBodyArg) return "body-required-missing";
    if (!be.io.hasJson && cs.hasBodyArg) return "body-sent-ignored";
    return null;
}

/**
 * 把调用点分成「可比对」「请求体问题」与「覆盖不到的桶」。
 *
 * ⚠️ **请求体检查必须独立于响应形状的可比对性**：第一版把两项检查写在同一个循环里，
 * 于是响应形状不透明的处理器（如 `cleanup_all` 走 `Ok(Json(Value::Object(...)))`）
 * 整行被归入覆盖桶，**连它的请求体检查也一起被跳过** —— 而"后端要 Json 而 SDK 不传"
 * 恰恰最容易发生在这些手工组装响应的处理器上。变异测试（去掉 `cleanupAll` 的 body）
 * 没有让门禁变红，才暴露出这个结构缺陷。
 *
 * @param {{ sdk: object, rust: object }} input
 */
function classify({ sdk, rust }) {
    const comparable = [];
    const bodyIssues = [];
    const unresolved = [];
    for (const cs of sdk.callSites) {
        const base = { managerMethod: cs.managerMethod, route: cs.route, declaredReturn: cs.declaredReturn };
        const be = rust.byRoute.get(cs.route);
        if (!be) {
            unresolved.push({ ...base, kind: "route-not-resolved" });
            continue;
        }
        // 请求体「该不该有」：只依赖路由是否解析出来，与响应形状无关
        const bodyIssue = bodyPresence(cs, be);
        if (bodyIssue && !bodyIssues.some((b) => b.route === cs.route && b.managerMethod === cs.managerMethod)) {
            bodyIssues.push({ ...base, handler: be.handler, bodyIssue });
        }

        const norm = normalizeReturnType(cs.declaredReturn);
        if (norm.primitive) continue; // `Promise<void>` 之类没有响应形状可核对，不进覆盖桶
        if (!norm.base) {
            unresolved.push({ ...base, kind: "return-type-not-named" });
            continue;
        }
        const sdkFields = sdk.fields.get(norm.base);
        if (!sdkFields) {
            unresolved.push({ ...base, kind: "interface-not-found", sdkType: norm.base });
            continue;
        }
        if (norm.isArray) {
            unresolved.push({ ...base, kind: "array-return", sdkType: norm.base });
            continue;
        }
        const diff = diffResponse({ sdkFields, variants: be.responseVariants });
        if (diff.unknown) {
            unresolved.push({ ...base, kind: "backend-shape-unknown", sdkType: norm.base, handler: be.handler });
            continue;
        }
        comparable.push({
            ...base,
            sdkType: norm.base,
            sdkFile: sdk.fieldFiles.get(norm.base),
            sdkFields,
            handler: be.handler,
            diff,
        });
    }
    return { comparable, bodyIssues, unresolved };
}

function countByKind(unresolved) {
    const out = {};
    for (const u of unresolved) out[u.kind] = (out[u.kind] ?? 0) + 1;
    return out;
}

function deviationKey(route, sdkType, kind) {
    return `${route}::${sdkType}::${kind}`;
}

function backendCommit() {
    try {
        return execFileSync("git", ["rev-parse", "HEAD"], { cwd: BACKEND_ROOT, encoding: "utf8" }).trim();
    } catch {
        return null;
    }
}

/** 只记录「已核对一致」的行；这是 CI 半场比对的对象。 */
function buildEntries({ comparable } = {}) {
    return comparable
        .filter((r) => r.diff.ok && !r.bodyIssue)
        .map((r) => ({
            route: r.route,
            sdkType: r.sdkType,
            sdkFile: r.sdkFile,
            fields: r.sdkFields,
        }))
        .sort((a, b) => (a.route + a.sdkType).localeCompare(b.route + b.sdkType));
}

async function main() {
    const sdk = await collectSdkAdminContract({ srcDir: path.join(SDK_ROOT, "src", "admin") });
    const backendPresent = fs.existsSync(RUST_ROUTES_ROOT);

    if (REFRESH) {
        if (!backendPresent) {
            console.error(`❌ --refresh 需要后端仓，未找到 ${RUST_ROUTES_ROOT}`);
            process.exit(2);
        }
        const rust = await collectRustAdminContract({ routesDir: RUST_ROUTES_ROOT });
        const { comparable, unresolved } = classify({ sdk, rust });
        const previous = readLedger();
        const entries = buildEntries({ comparable });
        const ledger = {
            schema_version: 1,
            generated_at: new Date().toISOString(),
            synapseRustCommit: backendCommit(),
            note:
                "由 `node scripts/quality/check-admin-response-contract.mjs --refresh` 生成。" +
                "`entries` 只收录**已验证一致**的行（CI 半场据此发现 SDK 单方面改动）；" +
                "`deviations` 为人工登记的已知偏差（必须带 reason 与 expires）；" +
                "`unresolved` 为抽取器覆盖不到的桶，计数只准降不准升。",
            entries,
            deviations: previous?.deviations ?? [],
            unresolved: Object.fromEntries(Object.entries(countByKind(unresolved)).map(([k, v]) => [k, { count: v }])),
        };
        fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 4) + "\n");
        console.log(`✅ 已写入台账 ${path.relative(SDK_ROOT, LEDGER_PATH)}`);
        console.log(`   entries=${entries.length} deviations=${ledger.deviations.length}`);
        console.log(`   unresolved=${JSON.stringify(ledger.unresolved)}`);
        return;
    }

    const ledger = readLedger();
    if (!ledger) {
        console.error(`❌ 台账缺失：${LEDGER_PATH}（首次请在有后端的环境跑 --refresh 生成）`);
        process.exit(2);
    }

    const violations = [];
    const now = new Date().toISOString().slice(0, 10);

    // ─── 半场 1：SDK 自漂移（CI 可跑，无需后端）───
    for (const entry of ledger.entries ?? []) {
        const live = sdk.fields.get(entry.sdkType);
        if (!live) {
            violations.push({
                kind: "sdk-type-gone",
                route: entry.route,
                detail: `类型 ${entry.sdkType} 已不在 src/admin 中；改名或删除后需重新核对后端并 --refresh`,
            });
            continue;
        }
        const recorded = [...(entry.fields ?? [])].sort().join(",");
        const actual = [...live].sort().join(",");
        if (recorded !== actual) {
            violations.push({
                kind: "sdk-drift",
                route: entry.route,
                sdkType: entry.sdkType,
                detail: `字段集与台账不一致：台账 [${recorded}] vs 现状 [${actual}]`,
            });
        }
    }

    // ─── 半场 2：与后端实际形状比对（后端不在场则 skip）───
    let evaluated = null;
    if (backendPresent) {
        const rust = await collectRustAdminContract({ routesDir: RUST_ROUTES_ROOT });
        evaluated = classify({ sdk, rust });
        const devs = new Set((ledger.deviations ?? []).map((d) => deviationKey(d.route, d.sdkType, d.kind)));
        // 请求体偏差按**路由**匹配（同一路由的 sdkType 可能随方法签名变化，用类型名做键太脆）
        const devBodyRoutes = new Set(
            (ledger.deviations ?? []).filter((d) => d.kind === "body-sent-ignored").map((d) => d.route),
        );

        for (const row of evaluated.comparable) {
            if (!row.diff.ok && !devs.has(deviationKey(row.route, row.sdkType, "response-shape"))) {
                violations.push({
                    kind: "response-shape",
                    route: row.route,
                    sdkType: row.sdkType,
                    handler: row.handler,
                    detail: `SDK 缺 [${row.diff.missing.join(", ") || "—"}]；SDK 多 [${row.diff.extra.join(", ") || "—"}]`,
                });
            }
        }

        // 请求体问题与响应形状无关：即使响应形状不透明（`Ok(Json(struct))`）也要查
        for (const row of evaluated.bodyIssues) {
            const kind = row.bodyIssue;
            if (kind === "body-required-missing") {
                violations.push({
                    kind,
                    route: row.route,
                    handler: row.handler,
                    detail: "后端用 Json<T> 提取器但 SDK 未传请求体 ⇒ 415（缺 Content-Type）",
                });
                continue;
            }
            if (!devBodyRoutes.has(row.route)) {
                violations.push({
                    kind,
                    route: row.route,
                    handler: row.handler,
                    detail: "SDK 传了请求体但后端处理器没有 Json 提取器 ⇒ 请求体被静默忽略",
                });
            }
        }

        const live = countByKind(evaluated.unresolved);
        for (const [kind, n] of Object.entries(live)) {
            const recorded = ledger.unresolved?.[kind]?.count ?? 0;
            if (n > recorded) {
                violations.push({
                    kind: "unresolved-grown",
                    route: "—",
                    detail: `${kind}: ${recorded} → ${n}（覆盖桶只准降不准升；新增端点请先核对后端再 --refresh）`,
                });
            }
        }
    }

    // ─── 偏差合法性 ───
    for (const d of ledger.deviations ?? []) {
        if (!d.reason || !d.expires) {
            violations.push({
                kind: "deviation-malformed",
                route: d.route,
                detail: "deviations 每条必须带 reason 与 expires",
            });
            continue;
        }
        if (d.expires < now) {
            violations.push({
                kind: "deviation-expired",
                route: d.route,
                sdkType: d.sdkType,
                detail: `已于 ${d.expires} 过期，须修复或重新评估`,
            });
        }
    }

    const payload = {
        backendPresent,
        ledgerEntries: (ledger.entries ?? []).length,
        deviations: (ledger.deviations ?? []).length,
        comparable: evaluated?.comparable.length ?? null,
        unresolved: evaluated ? countByKind(evaluated.unresolved) : null,
        violations,
    };

    if (EMIT_JSON) {
        console.log(JSON.stringify(payload, null, 2));
    } else {
        if (!backendPresent) {
            console.log(`[admin-response-contract] 后端仓不在场（${RUST_ROUTES_ROOT}）⇒ 只跑 CI 半场（SDK 自漂移）。`);
        }
        console.log(
            `[admin-response-contract] entries=${payload.ledgerEntries} deviations=${payload.deviations}` +
                (evaluated ? ` | 可比对=${payload.comparable} 覆盖桶=${JSON.stringify(payload.unresolved)}` : ""),
        );
        if (violations.length === 0) {
            console.log("[admin-response-contract] ✅ 无违规");
        } else {
            console.error(`[admin-response-contract] ❌ ${violations.length} 项违规：`);
            for (const v of violations) {
                console.error(`  [${v.kind}] ${v.route}${v.sdkType ? ` :: ${v.sdkType}` : ""} — ${v.detail}`);
            }
        }
    }

    if (violations.length > 0) process.exit(1);
    if (!backendPresent && STRICT) {
        console.error("[admin-response-contract] ❌ --strict 要求工作区半场实际运行，但后端仓不在场");
        process.exit(1);
    }
}

function readLedger() {
    if (!fs.existsSync(LEDGER_PATH)) return null;
    try {
        return JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));
    } catch (e) {
        console.error(`❌ 台账无法解析：${LEDGER_PATH}\n   ${e.message}`);
        process.exit(2);
    }
}

await main();
