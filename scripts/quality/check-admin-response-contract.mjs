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
    resolveSdkRequestShape,
    diffRequestShape,
    diffResponse,
    diffFields,
} from "./lib/admin-contract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SDK_ROOT = path.resolve(__dirname, "..", "..");
const LEDGER_PATH = path.join(__dirname, "admin-response-contract-ledger.json");
const BACKEND_ROOT = process.env.SYNAPSE_RUST_REPO ?? path.resolve(SDK_ROOT, "..", "synapse-rust");
const RUST_ROUTES_ROOT = path.join(BACKEND_ROOT, "synapse-web", "src");
/**
 * 响应形状的下沉目录：响应 struct 与辅助函数不都在 `synapse-web` 里。
 *
 * `synapse-storage` / `synapse-common` 定义了 `AuditEvent` / `ServerNotification` /
 * `RateLimitConfig` 这类被直接 `Ok(Json(struct))` 返回的类型；不索引它们，
 * 这些端点只能落进"未知"桶（沉默不等于通过）。
 */
const RUST_SINK_DIRS = ["synapse-storage/src", "synapse-common/src", "synapse-services/src"].map((d) =>
    path.join(BACKEND_ROOT, d),
);

const STRICT = process.argv.includes("--strict");
const REFRESH = process.argv.includes("--refresh");
const EMIT_JSON = process.argv.includes("--json");

/**
 * 请求体「该不该有」的判定。
 *
 * - `body-required-missing`：后端用 `Json<T>` 而 SDK 不传 body ⇒ 415（axum 要求 Content-Type）；
 * - `body-sent-ignored`：SDK 传了 body 而后端没有 `Json` 提取器 ⇒ 请求体被静默忽略。
 *
 * ⚠️ **不能只看 `POST` / `PUT` / `PATCH`**：第一版把判据限制在"写方法"上，于是
 * `DELETE /_synapse/admin/v1/rooms/{room_id}` 这种**带了 body 但后端处理器根本没有
 * `Json` 提取器**的调用点整类隐身 —— 而 `deleteRoom(id, {purge: true})` 恰恰是
 * "以为会 purge、实际整段 body 被丢掉"的真实缺陷（后端 `delete_room` 只 `delete(delete_room)`，
 * 连 `Json` 参数都没有）。HTTP 方法不是判据，"有没有 `Json` 提取器"才是。
 *
 * @returns {"body-required-missing" | "body-sent-ignored" | null}
 */
function bodyPresence(cs, be) {
    if (be.io.hasJson && !cs.hasBodyArg) return "body-required-missing";
    if (!be.io.hasJson && cs.hasBodyArg) return "body-sent-ignored";
    return null;
}

/**
 * 求一个调用点的「**线格式声明**」—— 也就是"这个端点实际发出的 JSON 形状，SDK 是怎么声明的"。
 *
 * ⚠️ 不能直接拿方法的声明返回类型：两者只在**原样返回**时一致。本仓里存在一批
 * 加工后再返回的方法（`const r = await this.adminRequest(..); return r.destinations;`），
 * 它们的声明返回类型是"加工后的值"，拿去比后端响应会得到"后端返回对象、SDK 声明数组"
 * 这种假阳性（`getFederationDestinations` 实测如此）。判据是：
 *
 *   1. 显式传了泛型实参 `adminRequest<T>(..)` ⇒ **T 才是线格式**；
 *      但 T 是内联对象字面量类型（`{ destinations: ... }`）时，它是"这个方法消费的字段"
 *      的窄视图，不是响应模型 ⇒ 判不了，落回未知桶。
 *   2. 没传泛型实参、且调用点原样 `return`（`directReturn`）⇒ 声明返回类型即线格式。
 *   3. 其余（加工后返回又没有显式线格式）⇒ 未知。**不要**退化成用声明返回类型兜底。
 *
 * @param {object} cs
 * @returns {{ base: string | null, isArray: boolean, primitive: boolean, unknown?: string }}
 */
function wireClaim(cs) {
    if (cs.typeArg) {
        const n = normalizeReturnType(cs.typeArg);
        if (n.base || n.primitive) return n;
        // `{ destinations: FederationDestination[] }` 这类内联对象字面量类型：
        // 它是"方法消费的字段"的窄视图，不是响应模型 ⇒ 判不了，不拿声明返回类型兜底
        return { base: null, isArray: false, primitive: false, unknown: "inline-type-arg" };
    }
    const declared = normalizeReturnType(cs.declaredReturn);
    // `Promise<void>` 的写入型方法本来就"不返回 `await` 的值"，没有响应形状可核对 ——
    // 它们不该落进任何覆盖桶（否则桶里全是噪声，真缺口被淹没）。
    if (declared.primitive) return declared;
    if (cs.directReturn) return declared;
    return { base: null, isArray: false, primitive: false, unknown: "no-wire-claim" };
}

/**
 * 把调用点分成「可比对」「形状类型不符」「请求体问题」与「覆盖不到的桶」。
 *
 * ⚠️ **请求体检查必须独立于响应形状的可比对性**：第一版把两项检查写在同一个循环里，
 * 于是响应形状不透明的处理器（如 `cleanup_all` 走 `Ok(Json(Value::Object(...)))`）
 * 整行被归入覆盖桶，**连它的请求体检查也一起被跳过** —— 而"后端要 Json 而 SDK 不传"
 * 恰恰最容易发生在这些手工组装响应的处理器上。变异测试（去掉 `cleanupAll` 的 body）
 * 没有让门禁变红，才暴露出这个结构缺陷。
 *
 * ⚠️ **数组/对象的种类也必须比**：`get_modules_by_type` 后端返回的是**裸数组**
 * （`let responses: Vec<ModuleResponse> = ..; Ok(Json(responses))`），而 SDK 声明
 * `AdminModulePage`（对象）。第一版因为"后端形状不可知"把这一类整体跳过了 ——
 * 于是"声明成对象、实际收到数组"的调用方会在 `.modules.map()` 上直接抛 TypeError。
 *
 * @param {{ sdk: object, rust: object }} input
 */
function classify({ sdk, rust }) {
    const comparable = [];
    const bodyIssues = [];
    const kindIssues = [];
    const requestComparable = [];
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

        // 请求体**字段名**：同样与响应形状无关，必须排在任何 `continue` 之前。
        if (cs.hasBodyArg && be.io.hasJson) {
            const bs = be.bodyStruct;
            const shape = bs
                ? resolveSdkRequestShape({
                      params: cs.params,
                      bodyArg: cs.bodyArg,
                      methodBody: cs.methodBody,
                      shapes: sdk.typeShapes,
                      ownShapes: cs.ownShapes,
                  })
                : null;
            if (!bs) {
                unresolved.push({ ...base, kind: "request-shape-unknown", reason: "backend", handler: be.handler });
            } else if (bs.opaque) {
                unresolved.push({
                    ...base,
                    kind: "request-shape-unknown",
                    reason: "backend-opaque",
                    sdkType: bs.name,
                    handler: be.handler,
                });
            } else if (!shape) {
                unresolved.push({ ...base, kind: "request-shape-unknown", reason: "sdk", handler: be.handler });
            } else {
                requestComparable.push({
                    ...base,
                    handler: be.handler,
                    backendType: bs.name,
                    backendFields: bs.fields,
                    backendOptional: bs.optional,
                    fields: shape.fields,
                    optionalFields: shape.optionalFields,
                    denyUnknownFields: bs.denyUnknownFields,
                });
            }
        }

        const norm = wireClaim(cs);
        if (norm.unknown) {
            unresolved.push({ ...base, kind: norm.unknown });
            continue;
        }
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
        const shapes = be.responseShapes;
        if (!shapes) {
            unresolved.push({
                ...base,
                kind: norm.isArray ? "array-return" : "backend-shape-unknown",
                sdkType: norm.base,
                handler: be.handler,
            });
            continue;
        }
        const kinds = new Set(shapes.map((s) => s.kind));
        if (kinds.size > 1) {
            unresolved.push({ ...base, kind: "backend-shape-mixed", sdkType: norm.base, handler: be.handler });
            continue;
        }
        const isBackendArray = shapes[0].kind === "array";
        if (isBackendArray !== norm.isArray) {
            kindIssues.push({
                ...base,
                handler: be.handler,
                sdkType: `${norm.base}${norm.isArray ? "[]" : ""}`,
                backendKind: isBackendArray ? `array<${shapes[0].item ?? "?"}>` : "object",
            });
            continue;
        }
        if (isBackendArray) {
            const itemKeys = shapes[0].itemKeys;
            if (!itemKeys) {
                unresolved.push({
                    ...base,
                    kind: "backend-array-item-unknown",
                    sdkType: norm.base,
                    handler: be.handler,
                });
                continue;
            }
            comparable.push({
                ...base,
                sdkType: norm.base,
                sdkFile: sdk.fieldFiles.get(norm.base),
                sdkFields,
                handler: be.handler,
                arrayItem: true,
                backendItemType: shapes[0].item,
                diff: diffFields({ sdkFields, backendKeys: itemKeys }),
            });
            continue;
        }
        const diff = diffResponse({ sdkFields, variants: shapes.map((s) => s.keys) });
        comparable.push({
            ...base,
            sdkType: norm.base,
            sdkFile: sdk.fieldFiles.get(norm.base),
            sdkFields,
            handler: be.handler,
            diff,
        });
    }
    return { comparable, bodyIssues, kindIssues, requestComparable, unresolved };
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

/**
 * 只记录「已核对一致」的行；这是 CI 半场比对的对象。
 *
 * `arrayItem: true` 表示这一行核对的是**数组元素**类型（后端裸数组 + SDK 声明 `X[]`），
 * `sdkType` 仍是元素类型名，CI 半场据此查字段集，不需要额外分支。
 */
function buildEntries({ comparable } = {}) {
    return comparable
        .filter((r) => r.diff.ok)
        .map((r) => ({
            route: r.route,
            sdkType: r.sdkType,
            sdkFile: r.sdkFile,
            fields: r.sdkFields,
            ...(r.arrayItem ? { arrayItem: true, backendItemType: r.backendItemType } : {}),
        }))
        .sort((a, b) => (a.route + a.sdkType).localeCompare(b.route + b.sdkType));
}

/**
 * 记录「已核对一致」的**请求体**行。
 *
 * 与 `buildEntries` 的区别：请求体形状的判定**完全在 SDK 侧**（解析签名/内联字面量/
 * 局部变量），所以 CI 半场不需要后端也能重算 —— 于是"改了请求体类型而没重新核后端"
 * 同样能在 CI 抓到（CI 半场的 `sdk-request-drift`）。
 *
 * 同一路由可能有多个调用点（`makeRoomAdmin` 同时试 PUT 与 POST），按
 * `route + managerMethod` 去重，保留字段集最大的那行（信息量最大）。
 */
function buildRequestEntries({ requestComparable } = {}) {
    const byKey = new Map();
    for (const r of requestComparable) {
        if (!r.fields) continue;
        const key = `${r.route}::${r.managerMethod}`;
        const row = {
            route: r.route,
            managerMethod: r.managerMethod,
            backendType: r.backendType,
            fields: r.fields,
            optionalFields: r.optionalFields,
        };
        const prev = byKey.get(key);
        if (!prev || row.fields.length > prev.fields.length) byKey.set(key, row);
    }
    return [...byKey.values()].sort((a, b) => (a.route + a.managerMethod).localeCompare(b.route + b.managerMethod));
}

async function main() {
    const sdk = await collectSdkAdminContract({ srcDir: path.join(SDK_ROOT, "src", "admin") });
    const backendPresent = fs.existsSync(RUST_ROUTES_ROOT);

    if (REFRESH) {
        if (!backendPresent) {
            console.error(`❌ --refresh 需要后端仓，未找到 ${RUST_ROUTES_ROOT}`);
            process.exit(2);
        }
        const rust = await collectRustAdminContract({ routesDir: RUST_ROUTES_ROOT, sinkDirs: RUST_SINK_DIRS });
        const { comparable, requestComparable, unresolved } = classify({ sdk, rust });
        const previous = readLedger();
        const entries = buildEntries({ comparable });
        const requestEntries = buildRequestEntries({ requestComparable });
        const ledger = {
            schema_version: 1,
            generated_at: new Date().toISOString(),
            synapseRustCommit: backendCommit(),
            note:
                "由 `node scripts/quality/check-admin-response-contract.mjs --refresh` 生成。" +
                "`entries` / `requestEntries` 只收录**已验证一致**的行（CI 半场据此发现 SDK 单方面改动）；" +
                "`deviations` 为人工登记的已知偏差（必须带 reason 与 expires）；" +
                "`unresolved` 为抽取器覆盖不到的桶，计数只准降不准升。",
            entries,
            requestEntries,
            deviations: previous?.deviations ?? [],
            unresolved: Object.fromEntries(Object.entries(countByKind(unresolved)).map(([k, v]) => [k, { count: v }])),
        };
        fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 4) + "\n");
        console.log(`✅ 已写入台账 ${path.relative(SDK_ROOT, LEDGER_PATH)}`);
        console.log(
            `   entries=${entries.length} requestEntries=${requestEntries.length} deviations=${ledger.deviations.length}`,
        );
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

    // 请求体形状同样在 CI 半场重算：这一步**不需要后端**（形状完全由 SDK 侧声明决定），
    // 所以"改了请求体类型而没重新核后端"能在 CI 直接红。
    for (const entry of ledger.requestEntries ?? []) {
        const sites = sdk.callSites.filter(
            (c) => c.route === entry.route && c.managerMethod === entry.managerMethod && c.hasBodyArg,
        );
        if (sites.length === 0) {
            violations.push({
                kind: "sdk-request-gone",
                route: entry.route,
                sdkType: entry.backendType,
                detail: `${entry.managerMethod} 的请求体调用点已不在（改名/换管理器？）⇒ 需重新核对后端并 --refresh`,
            });
            continue;
        }
        const shapes = sites
            .map((c) =>
                resolveSdkRequestShape({
                    params: c.params,
                    bodyArg: c.bodyArg,
                    methodBody: c.methodBody,
                    shapes: sdk.typeShapes,
                    ownShapes: c.ownShapes,
                }),
            )
            .filter(Boolean);
        if (shapes.length === 0) {
            violations.push({
                kind: "sdk-request-unresolvable",
                route: entry.route,
                sdkType: entry.backendType,
                detail: "请求体形状现在判不出来了（签名被改成索引签名/联合类型？）⇒ 覆盖桶会涨，需重新核对",
            });
            continue;
        }
        const recorded = [...(entry.fields ?? [])].sort().join(",");
        const actual = [...shapes[0].fields].sort().join(",");
        if (recorded !== actual) {
            violations.push({
                kind: "sdk-request-drift",
                route: entry.route,
                sdkType: entry.backendType,
                detail: `请求体字段集与台账不一致：台账 [${recorded}] vs 现状 [${actual}]`,
            });
        }
    }

    // ─── 半场 2：与后端实际形状比对（后端不在场则 skip）───
    let evaluated = null;
    if (backendPresent) {
        const rust = await collectRustAdminContract({ routesDir: RUST_ROUTES_ROOT, sinkDirs: RUST_SINK_DIRS });
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
                    sdkType: row.arrayItem ? `${row.sdkType}[]（元素）` : row.sdkType,
                    handler: row.handler,
                    detail: `SDK 缺 [${row.diff.missing.join(", ") || "—"}]；SDK 多 [${row.diff.extra.join(", ") || "—"}]`,
                });
            }
        }

        // 数组 / 对象种类不符：SDK 声明对象而收到裸数组（或反之）—— 调用方会在
        // `.x.map()` / `.length` 上直接抛，比字段名错更致命，必须单列一类。
        for (const row of evaluated.kindIssues) {
            if (devs.has(deviationKey(row.route, row.sdkType, "response-kind"))) continue;
            violations.push({
                kind: "response-kind",
                route: row.route,
                sdkType: row.sdkType,
                handler: row.handler,
                detail: `后端返回 ${row.backendKind}，SDK 声明 ${row.sdkType.includes("[]") ? "数组" : "对象"}`,
            });
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

        // 请求体**字段名**：与响应形状无关，单独一轮（`request-unknown-field-ignored`
        // 按**路由**豁免 —— 同一路由的 SDK 类型名会随签名变化，用类型名做键太脆）。
        for (const row of evaluated.requestComparable) {
            const issue = diffRequestShape({
                sdkFields: row.fields,
                sdkOptional: row.optionalFields,
                backendFields: row.backendFields,
                backendOptional: row.backendOptional,
                denyUnknownFields: row.denyUnknownFields,
                backendType: row.backendType,
            });
            if (!issue) continue;
            const devKind = issue.kind === "request-unknown-field-rejected" ? "request-shape" : "request-body";
            if (devs.has(deviationKey(row.route, row.backendType, devKind))) continue;
            if (devBodyRoutes.has(row.route) && issue.kind === "request-unknown-field-ignored") continue;
            violations.push({
                kind: issue.kind,
                route: row.route,
                sdkType: row.backendType,
                handler: row.handler,
                detail: issue.detail,
            });
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
        ledgerRequestEntries: (ledger.requestEntries ?? []).length,
        deviations: (ledger.deviations ?? []).length,
        comparable: evaluated?.comparable.length ?? null,
        comparableRequests: evaluated?.requestComparable.length ?? null,
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
            `[admin-response-contract] entries=${payload.ledgerEntries} requestEntries=${payload.ledgerRequestEntries} deviations=${payload.deviations}` +
                (evaluated
                    ? ` | 可比对=${payload.comparable} 可比对请求体=${payload.comparableRequests} 覆盖桶=${JSON.stringify(payload.unresolved)}`
                    : ""),
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
