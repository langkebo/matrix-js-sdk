#!/usr/bin/env node
/**
 * verify-path-contract.mjs — SDK ↔ 后端路径契约交叉校验门禁
 *
 * 背景（2026-09-30 联调发现）:
 *   `ApplicationServiceManager` 的 14 个方法全部使用 `/application_services`（下划线），
 *   而后端实际注册 `/_synapse/admin/v1/appservices`（无下划线）。
 *   该缺陷在 35/35 单测全绿的情况下完全不可见 —— 因为 mock 层不校验真实路径。
 *   本门禁把这类缺陷左移到 CI。
 *
 * 原理:
 *   1. 从后端 ledger 读出所有已注册路由（method + path），建立索引。
 *   2. 从 SDK 源码里提取每个请求调用的 (prefix, path, method) 三元组。
 *      SDK 的 `path` 是相对路径，前缀由 `prefix:` 字段单独给出（如 AdminPrefix.V1），
 *      所以要把两者拼接后再比对。关键难点：`prefix` 与 `path` 在源码里可能相隔
 *      十几行（中间夹着 body 对象），所以不能假设它们相邻。
 *   3. 参数化路径归一化：`{roomId}` / `$roomId` / `:roomId` → `{X}`。
 *   4. 拼接后的完整路径在 ledger 中找不到 → 报错并给出最接近的候选。
 *
 * 增强（2026-10-01）:
 *   - 通配符匹配：支持字面量 vs 通配符等价匹配（如 send/m.room.message/{txn} vs send/{event_type}/{txn_id}）
 *   - HTTP 方法校验：避免 PUT 误匹配到 GET 路由（假阳性）
 *   - MSC 编号格式校验：检测 SDK 中未注册的 MSC 编号引用
 *
 * 增强（2026-10-06）—— 补抽取器盲区（详见 docs/sdk-encapsulation-audit.md §13.15.7）:
 *   上一版只认两种写法：
 *     A) 对象字面量 { method: Method.X, path: "...", prefix: ... }
 *     B) `authedRequest<T>(Method.X, "...", ...)`
 *   于是**所有位置参数形态的包装器**都没进入校验 —— 其中 `adminRequest` 就有 234 处调用点。
 *   后果：admin 面 6 处「打后端未注册路径」的缺陷在门禁全绿的情况下长期存活
 *   （例：`getAdminInfo()` 打 `/_synapse/admin/v1/info`，而后端注册的是无 v1 段的
 *   `/_synapse/admin/info`）。
 *   本版把位置参数包装器改为**表驱动**（POSITIONAL_WRAPPERS），并对**故意不覆盖**的
 *   包装器显式登记（EXCLUDED_WRAPPERS）并打印在报告里 —— 覆盖率必须是可审计的，
 *   不能靠"没写就是没覆盖"这种沉默。
 *
 * 增强（2026-10-08）—— 把「表面覆盖」补成「真实覆盖」:
 *   上一版虽然把 `adminRequest` 登记进了表，但 `extractWrapperCalls` 里有一条
 *     `if (!/^(`…`|"…"|'…')$/.test(args[1])) continue;   // 路径必须是字面量`
 *   —— **非字面量路径的调用点被整个丢掉、连 skip 计数都不进**。实测：
 *     已校验 317 处 / 被静默丢弃 246 处（占 31 处包装器调用点的 44%）。
 *   于是报告里"提取请求调用 432、不匹配 0"读起来像"全覆盖"，而 `admin-config-manager.ts`
 *   整族 `apu("/x")` 调用**一个都没参与校验** —— 本轮就抓着它找出了
 *   `deleteFeatureFlag` 打 `DELETE /_synapse/admin/v1/feature_flags/{key}`（下划线 +
 *   后端根本没有 DELETE 路由）这个必然 404 的缺陷。
 *
 *   本轮做两件事：
 *     ① `apu` 是**恒等函数**（`return path;`），把它当作「恒等路径包装器」解开即可精确
 *        得到字面量。这类包装器登记在 PATH_IDENTITY_HELPERS，并且**启动时读源码校验
 *        它确实是恒等**（不是恒等就 exit 2）—— 否则一旦有人给它加上前缀，路径前缀会算错，
 *        "假匹配"与"假不匹配"会同时出现，而报告依然全绿。
 *     ② 仍然解不出来的调用点落进 `uncheckedPathArg` 桶并在报告里计数，外加棘轮
 *        `path-contract-coverage.json`（总数与**逐文件**计数只降不升）——
 *        覆盖率是一次声明，不是一个口号。
 *
 * 用法:
 *   node scripts/quality/verify-path-contract.mjs [--json] [--verbose] [--refresh-coverage]
 *
 * 退出码:
 *   0 = 全部匹配
 *   1 = 存在不匹配（CI 应红），或未校验调用点超出覆盖率基线
 *   2 = 门禁自身无法运行（ledger 缺失 / 源码无法解析 / 恒等包装器与源码不符）——
 *       刻意与 1 区分，避免把"环境问题"误报成"代码缺陷"。
 *
 * 环境变量:
 *   LEDGER_PATH  覆盖 ledger 路径
 *   SCAN_ROOTS   覆盖要扫描的目录（逗号分隔，默认 src）
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..");

const EMIT_JSON = process.argv.includes("--json");
const VERBOSE = process.argv.includes("--verbose");

// ---------------------------------------------------------------------------
// 1. 加载后端 ledger
// ---------------------------------------------------------------------------

/** 兄弟仓的**实时**导出（首选）。 */
const SIBLING_LEDGER_PATH = "../synapse-rust/tests/unit/fixtures/ledger_export_sdk/all.json";
/**
 * 仓内镜像（回退）。`synapse-ledger-sync.yaml` 把后端 ledger 导出同步进来的**纯后端副本**，
 * `docs/api-contract/contract-artifacts.md` 明确它就是「后端 ledger 声明的全部路由」。
 *
 * 为什么需要回退：本门禁原来**只认兄弟仓**，读不到就 `process.exit(2)`；而
 * `.github/workflows/systemic_refactor_quality_gate.yml` 只 checkout 本仓 ⇒
 * CI 上 `quality:contracts` 必然卡在这一步（实测 `LEDGER_PATH=/nonexistent` ⇒ exit 2）。
 * 实测两者在 2026-10-08 的判定逐项一致（539 / 519 / 20 / 0 / 139 全同）⇒ 回退是**保判定**的。
 */
const MIRROR_LEDGER_PATH = "docs/api-contract/generated/route-manifest.all.json";

/**
 * 解析 ledger 来源（纯函数，spec 直接测）。
 *
 * 优先级：显式 `LEDGER_PATH` > 兄弟仓实时导出 > 仓内镜像。
 * 三者都没有时仍返回兄弟仓路径 —— 让 `loadBackendRoutes` 打出原本那句「请先拉取」。
 *
 * @param {{ explicitPath: string | null; siblingExists: boolean; mirrorExists: boolean }} input
 * @returns {{ path: string; source: "env" | "sibling" | "mirror" | "none" }}
 */
export function resolveLedgerPath({ explicitPath, siblingExists, mirrorExists }) {
    if (explicitPath) return { path: explicitPath, source: "env" };
    if (siblingExists) return { path: SIBLING_LEDGER_PATH, source: "sibling" };
    if (mirrorExists) return { path: MIRROR_LEDGER_PATH, source: "mirror" };
    return { path: SIBLING_LEDGER_PATH, source: "none" };
}

const ledgerResolution = resolveLedgerPath({
    explicitPath: process.env.LEDGER_PATH ?? null,
    siblingExists: existsSync(resolve(PROJECT_ROOT, SIBLING_LEDGER_PATH)),
    mirrorExists: existsSync(resolve(PROJECT_ROOT, MIRROR_LEDGER_PATH)),
});
const LEDGER_PATH = ledgerResolution.path;
const ledgerFile = resolve(PROJECT_ROOT, LEDGER_PATH);

/**
 * 覆盖率基线文件（棘轮）：未参与校验的调用点计数，只准降不准升。
 * 由 `--refresh-coverage` 写入 —— 见 `main()` 里「6b. 覆盖率棘轮」。
 */
const COVERAGE_FILE = join(__dirname, "path-contract-coverage.json");
/** 剥离别名（`StripAdminV1` → `/_synapse/admin/v1` 等）的定义文件。 */
const STRIP_PREFIX_FILE = "src/http-api/strip-prefix.ts";
const COVERAGE_NOTE =
    "未参与路径校验的调用点计数（路径实参不是字面量，也不是已校验的恒等包装器调用）。" +
    "这是覆盖率声明：`uncheckedPathArg` 与 `byFile` 里的每一项都**只准降不准升**——" +
    "涨了说明有调用点从「已校验」滑到「未校验」，要么把它改回字面量，要么跑 " +
    "`node scripts/quality/verify-path-contract.mjs --refresh-coverage` 显式接受。" +
    "`byFile` 用**仓库相对路径**做键：一个文件被删/改名会让键消失（这是好事，不需要处理），" +
    "新增文件默认基线 0 ⇒ 它只要出现未校验调用点就会失败。";

/**
 * 覆盖率棘轮的核心判据（纯函数，spec 直接测）：观测值相对基线有没有「变多」。
 *
 * 两个维度都只准降：
 *   - `uncheckedPathArg` 总量；
 *   - `byFile` 里**每个文件**的计数（缺键视作 0 ⇒ 新文件只要出现未校验调用点就失败）。
 *
 * 只看总量是不够的：把一个字面量改成 `this.xxxPath(id)`、同时在别处把动态路径改回字面量，
 * 总量不变而覆盖面其实已经漂了。逐文件计数把这种"换位"卡住。
 *
 * @param {{ uncheckedPathArg: number, byFile?: Record<string, number> }} baseline
 * @param {{ uncheckedPathArg: number, byFile: Record<string, number> }} observed
 * @returns {Array<{ kind: string, detail: string }>}
 */
export function diffCoverage(baseline, observed) {
    const issues = [];
    if (observed.uncheckedPathArg > baseline.uncheckedPathArg) {
        issues.push({
            kind: "coverage-total-grown",
            detail: `未校验调用点 ${baseline.uncheckedPathArg} → ${observed.uncheckedPathArg}（+${observed.uncheckedPathArg - baseline.uncheckedPathArg}）`,
        });
    }
    for (const [file, n] of Object.entries(observed.byFile)) {
        const base = baseline.byFile?.[file] ?? 0;
        if (n > base) {
            issues.push({ kind: "coverage-file-grown", detail: `${file}: ${base} → ${n}（+${n - base}）` });
        }
    }
    return issues;
}

/**
 * 给「未校验的路径实参」**分形态**（纯函数，spec 直接测）。
 *
 * 为什么要有它：这份报告长期只有一句「未校验调用点 : 139（路径实参非字面量）」——
 * 139 是个巨大的数字，但**看不出下一步该做什么**。实测（2026-10-08）把它拆开后形态高度集中：
 *
 *   · `this-method`：`this.roomPath("/rooms/$roomId/sync", roomId)` —— 仓内最主流的写法，
 *     路径模板就在第一个实参里（`roomPath` 的定义体是
 *     `return this.buildRoomScopedPath(pathTemplate, roomId)` → `encodeUri(pathTemplate, …)`，
 *     即**对第一个参数恒等**），属于"再扩一层解析器就能收"的部分；
 *   · `identifier`：`path` / `endpoint` —— 指函数形参或局部 `const`，要**跨函数/跨作用域**追；
 *   · `cast`：`` `/v1/workers/${x}` as `/v1/workers/${string}` `` —— TS 断言，剥掉 `as` 就是模板。
 *
 * ⚠️ 这只是**报表口径**，不参与任何判定（判定仍是"能不能解成可比对的路径"）。
 * 分类器写错只会让报表分组难看，不会让门禁放行/拦住任何东西 —— 这是它与 `diffCoverage`
 * 那类判据的根本区别，也是它可以先落地、不必等解析器改造的原因。
 *
 * @param {string} expr 路径实参的源码文本
 * @returns {"this-method"|"member-call"|"bare-call"|"cast"|"template"|"concat"|"ternary"|"paren"|"identifier"|"empty"|"other"}
 */
export function classifyPathArgShape(expr) {
    const e = String(expr ?? "").trim();
    if (e === "") return "empty";
    if (/^[A-Za-z_$][\w$]*$/.test(e)) return "identifier";
    if (/^this\.[\w$]+\s*\(/.test(e)) return "this-method";
    if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+\s*\(/.test(e)) return "member-call";
    if (/^[A-Za-z_$][\w$]*\s*\(/.test(e)) return "bare-call";
    // `as` 断言优先于模板判定：断言的操作数才是真值（`` `...` as `/x/${string}` ``）
    if (/\sas\s/.test(e)) return "cast";
    if (e.startsWith("`")) return "template";
    if (e.startsWith("(")) return "paren";
    if (/\?.*:/.test(e)) return "ternary";
    if (/\+/.test(e)) return "concat";
    if (/^["']/.test(e)) return "literal"; // 理论上不该出现（字面量已进 calls），出现即抽取器有漏
    return "other";
}

/**
 * 把若干「未校验调用点」按形态汇总（纯函数）。
 *
 * @param {Array<{ expr: string }>} unchecked
 * @returns {Record<string, number>} 形态 → 计数（按计数降序，便于直接读）
 */
export function summarizeUncheckedShapes(unchecked) {
    const counts = {};
    for (const u of unchecked) {
        const k = classifyPathArgShape(u.expr);
        counts[k] = (counts[k] ?? 0) + 1;
    }
    return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

/**
 * 读后端 ledger 并建成「`METHOD /归一化路径` → 原始路径」索引。
 *
 * 这一段原先写在顶层：`ledger` 不存在时直接 `process.exit(2)`，于是**只要 import
 * 这个模块就会去读兄弟仓的文件、读不到就退出进程**——spec 连加载都做不到，只能
 * 退而求其次抄一份常量自己测自己（见 `spec/unit/scripts/quality/` 下那份老 spec）。
 * 现在改成函数，由 `main()` 调用；`--json` 之外的入口行为一字未变。
 */
export function loadBackendRoutes(file = ledgerFile) {
    if (!existsSync(file)) {
        console.error(`❌ ledger 不存在: ${file}`);
        console.error(`   请先拉取/更新 synapse-rust，或设置 LEDGER_PATH 环境变量。`);
        process.exit(2);
    }

    const routes = new Map();
    try {
        const ledger = JSON.parse(readFileSync(file, "utf8"));
        for (const entry of ledger.entries) {
            routes.set(`${entry.method.toUpperCase()} ${normalizePath(entry.path)}`, entry.path);
        }
    } catch (e) {
        console.error(`❌ ledger 解析失败: ${e.message}`);
        process.exit(2);
    }
    return routes;
}

let backendRoutes;

// ---------------------------------------------------------------------------
// 2. 前缀常量表 —— 手工镜像 src/http-api/prefix.ts
//    （不解析 TS enum：那是另一层依赖，而这张表本身就是可审计的契约声明。
//      改动 prefix.ts 时必须同步改这里 —— 单元测试会校验两者一致。）
// ---------------------------------------------------------------------------

export const PREFIX_CONSTANTS = {
    AdminPrefix: { V1: "/_synapse/admin/v1" },
    ClientPrefix: {
        R0: "/_matrix/client/r0",
        V1: "/_matrix/client/v1",
        V3: "/_matrix/client/v3",
        Unstable: "/_matrix/client/unstable",
    },
    IdentityPrefix: { V2: "/_matrix/identity/v2" },
    MediaPrefix: { V1: "/_matrix/media/v1", V3: "/_matrix/media/v3" },
    ServerPrefix: { V1: "/_matrix/server/v1" },
    FederationPrefix: { V1: "/_matrix/federation/v1" },
    VendorPrefix: { "": "/_matrix/vendor/v1" },
};

/**
 * SDK 在**没有显式 `prefix:` 字段**时使用的默认前缀。
 * 依据 `src/managers/base-manager.ts` 的 request 实现（client 默认走 ClientPrefix.V3）。
 * 若上游改成别的默认值，这里也要跟着改——`spec/unit/base-manager-request.spec.ts` 会先红。
 */
export const DEFAULT_PREFIX = "/_matrix/client/v3";

// ---------------------------------------------------------------------------
// 2b. 位置参数请求包装器表（2026-10-06 新增）
//
// 每个条目描述一个形如 `helper(Method.X, "<relative-path>", ...)` 的包装器，
// 以及它会把该 relative-path 拼到哪个前缀上。字段三选一：
//   fixed: [...]      前缀是固定字面量列表；任一命中即算匹配
//   byDir: [...]      **同名 helper 在不同模块注入不同前缀**时按目录区分（见下方 doRequest）：
//                     `[["src/widgets/", ["/_matrix/client/v1"]], ...]` + fallback。
//                     不按目录区分就会造出假阳性 —— widgets 的 `doRequest` 走 V1，
//                     若统一按 V3 校验，14 个本来正确的调用点会被一起报成错误。
//   opts:  n          前缀取自第 n 个参数（0-based）的 `prefix:` 字段；缺省 → DEFAULT_PREFIX
//   arg:   n          前缀就是第 n 个参数（0-based）本身
//
// ⚠️ 新增请求包装器时必须同步登记此表 —— 否则其调用点不会被校验。
//    回归守卫：spec/unit/path-contract-extractor.spec.ts
// ---------------------------------------------------------------------------
const POSITIONAL_WRAPPERS = {
    // ── admin 面（本表存在的直接原因：这 234 处调用点此前完全未被校验）──
    adminRequest: { fixed: ["/_synapse/admin/v1"] }, // base-manager.ts:adminRequest，前缀恒为 AdminPrefix.V1
    v2Request: { fixed: ["/_synapse/admin"] }, // admin-base-manager.ts:v2Request，注意**无版本段**
    // ── room-summary 内部面 ──
    requestInternal: { fixed: ["/_synapse/room_summary/v1"] }, // room-summary-base-manager.ts
    requestV3: { fixed: ["/_matrix/client/v3"] },
    // ── 其他固定前缀包装器 ──
    doRequestV3: { fixed: ["/_matrix/client/v3"] }, // widgets/index.ts（仅 capabilities / send / create）
    doRequest: {
        byDir: [
            ["src/widgets/", ["/_matrix/client/v1"]], // widgets/index.ts:doRequest → ClientPrefix.V1
            ["src/space/", ["/_matrix/client/v3"]], // space/sub-managers/*.ts → ClientPrefix.V3
            ["src/client/worker/", ["/_synapse/worker"]], // client/worker/worker.ts → WORKER_PREFIX
        ],
        fallback: ["/_matrix/client/v3"],
    },
    // ── 完整字面量路径（prefix 为 ""，path 自带 /_matrix/... 前缀）──
    requestWithRetry: { fixed: [""] }, // rust-crypto/OutgoingRequestProcessor.ts
    makeRequestWithUIA: { fixed: [""] },
    // ── 前缀由调用方给出 ──
    idServerRequest: { arg: 3 }, // http-api/fetch.ts — 第 4 个参数就是 prefix
    authedRequest: { opts: 4 }, // http-api/fetch.ts — opts.prefix，缺省 v3
    request: { opts: 4 }, // http-api/fetch.ts — 同上（此前完全未被提取）
};

/**
 * 故意**不**纳入校验的包装器 —— 显式登记而非默默略过。
 * 报告里会打印这张表，使「覆盖面」本身可被审阅：想偷偷漏掉一类写法，
 * 就必须在这里写下一行理由。
 */
const EXCLUDED_WRAPPERS = {
    requestOtherUrl:
        "第 2 个参数是**完整 URL**（含 host），用于联邦/身份服务器的跨 host 请求；" +
        "不属于「SDK relative path ↔ 后端 ledger」的校验范畴。",
    rawJsonRequest:
        '同 requestOtherUrl（prefix 为 "" + 完整字面量），且其调用点全部经由 ' +
        "requestWithRetry / makeRequestWithUIA 这两个已登记的入口。",
    sendToDeviceRequest:
        "rust-crypto 的 to-device 特化入口，内部把 path 拼成完整字面量后交给 requestWithRetry；" +
        "其字面量由 msg 运行时决定，静态不可求值。",
};

/**
 * 解析 `src/http-api/strip-prefix.ts` 里**单前缀**形态的剥离别名 → 真实前缀。
 *
 * 只认最简单的形态（本仓 8 个）：
 * ```ts
 * export type StripAdminV1<P extends string> = StripPrefix<P, "/_synapse/admin/v1">;
 * ```
 * 多前缀形态（`StripAuthPrefix` = v3→r0→v1 逐级、`StripMediaPrefix`、`StripClientV3OrVendorV1`…）
 * 是有条件的嵌套条件类型，**不解析**（解析它们就要写一个类型求值器）—— 那类模块退回
 * `POSITIONAL_WRAPPERS` 的声明。
 *
 * 为什么要这张表：`bu` / `wa` / `wb` 这些类型化路径包装器的参数类型里**已经写明了前缀**
 * （`PathAssert<P, StripAdminV1<BackgroundUpdatePath>>` 的语义就是"剥掉这个前缀后必须命中
 * 模块契约里的某条路由"）⇒ 前缀不需要门禁去猜、也不需要 `byDir` 手工登记。
 * 之前 `doRequest` 只有 widgets/space/worker 三条 `byDir`，于是 `background-update` 与
 * `worker-admin|worker-body` 整片被当成 `/_matrix/client/v3` 前缀 —— 45 条假不匹配。
 */
export function parseStripPrefixAliases(source) {
    const out = new Map();
    const re =
        /export\s+type\s+([A-Za-z_$][\w$]*)\s*<\s*P\s+extends\s+string\s*>\s*=\s*StripPrefix\s*<\s*P\s*,\s*"([^"]+)"\s*>\s*;/g;
    for (const m of source.matchAll(re)) out.set(m[1], m[2]);
    return out;
}

/**
 * 从参数类型文本里取出「唯一」的剥离别名（多于一个就判不了 —— 不猜）。
 *
 * @param {string | null} typeText
 * @param {Map<string, string>} stripAliases
 * @returns {string | null}
 */
export function resolveStripPrefixFromType(typeText, stripAliases) {
    if (!typeText || !stripAliases) return null;
    const names = new Set();
    for (const m of typeText.matchAll(/\b([A-Za-z_$][\w$]*)\s*</g)) names.add(m[1]);
    const hits = [...names].filter((n) => stripAliases.has(n));
    if (hits.length !== 1) return null;
    return stripAliases.get(hits[0]);
}

/**
 * 路径位置上的「恒等包装器」是**自动**识别并校验的，不需要手工登记表。
 *
 * 这类包装器长这样（本仓有 50 个带类型断言的，外加 `apu` 这种裸恒等）：
 * ```ts
 * function bu<const P extends string>(path: P & PathAssert<P, StripAdminV1<BackgroundUpdatePath>>): P {
 *     return path;
 * }
 * ```
 * 它的唯一效果是让路径实参不再是字面量 —— 于是调用点被踢出静态校验。
 * 要把它拉回校验，只要确认两件事：
 *   1. **函数体确实是 `return <参数>;`**（`verifyIdentityHelperShape`）——
 *      一旦有人给它加上前缀（哪怕"顺手"改成 `${Prefix}${path}`），解开就会算错路径，
 *      假匹配与假不匹配同时出现而报告全绿。这类判据错一次比门禁拒绝启动严重得多，
 *      所以认不出的形态一律判"不符"。
 *   2. **同名函数在**全仓范围内**要么只有恒等定义、要么干脆不用**（见下方 `indexIdentityPathHelpers`
 *      的"任一非恒等即整名作废"规则）—— 否则同名不同义会让解包变成猜。
 *
 * 识别出的恒等包装器还要按**参数类型**分两类，因为它们的覆盖来源不同：
 *   - `guarded`：参数类型带 `PathAssert<…>` ⇒ 路径已由 **tsc** 按模块契约逐段断言
 *     （`src/http-api/strip-prefix.ts`，segment 级比较），门禁只是**第二道**防线；
 *   - `plain`：参数类型就是 `string`（本仓只有 `apu`）⇒ **没有任何类型校验**，
 *     门禁是唯一防线。`admin-config-manager.ts` 里 `feature_flags`（下划线）这类
 *     拼写错误能在 tsc 全绿的情况下长期存活，靠的就是这一类。
 *
 * 分桶不是装饰：`guarded` 的调用点算「已被类型系统覆盖」，`plain` 的必须由本门禁核对。
 */

/** 在一个函数的 `(` 之后扫完参数表并跨过返回类型注解，返回函数体 `{` 的下标；失败返回 -1。 */
function findFunctionBodyStart(source, openParen) {
    const closeParen = matchParen(source, openParen);
    if (closeParen < 0) return -1;
    let i = closeParen + 1;
    while (i < source.length && /\s/.test(source[i])) i++;
    // 返回类型注解：`): string {` —— 不能假设 `)` 之后紧跟 `{`
    if (source[i] === ":") {
        i++;
        let typeDepth = 0;
        while (i < source.length) {
            const c = source[i];
            if (c === "(" || c === "[" || c === "<") typeDepth++;
            else if (c === ")" || c === "]" || c === ">") typeDepth--;
            else if (c === "{" && typeDepth === 0) break;
            i++;
        }
    }
    return source[i] === "{" ? i : -1;
}

/**
 * 扫描**一个** `function <name>(…) { … }` 声明，判断它是不是恒等函数。
 *
 * 用词法配平而不是正则取函数体：函数体里可能有嵌套花括号 / 字符串里的 `}`。
 * 参数表要能跨过**泛型参数**（`function bu<const P extends string>(path: …)`）与
 * 返回类型注解（`): P {`）—— 第一版直接写 `function\s+name\s*\(`，于是本仓 50 个
 * 带泛型的类型化路径包装器**一个都没被识别**，报告里"已校验的恒等包装器: 1"，
 * 而真正的原因被"看起来只有 apu 是这种写法"掩盖掉了。
 *
 * 不解析重载取首处、不解析箭头函数、不解析多参数 —— 认不出的形态一律**判为不符**
 * （fail-closed）：这里判错的代价是"路径算错却全绿"，比"门禁拒绝启动"严重得多。
 *
 * @param {string} source 已剥注释的源码
 * @param {number} nameEnd 函数名之后的下标
 * @returns {{ ok: true, param: string, typeText: string | null } | { ok: false, reason: string }}
 */
export function analyzeIdentityFunction(source, nameEnd) {
    let i = nameEnd;
    while (i < source.length && /\s/.test(source[i])) i++;
    if (source[i] === "<") {
        const after = skipGenerics(source, i);
        if (after < 0) return { ok: false, reason: "泛型参数不配平" };
        i = after;
        while (i < source.length && /\s/.test(source[i])) i++;
    }
    if (source[i] !== "(") return { ok: false, reason: "名字后面不是参数表" };
    const openParen = i;
    const bodyStart = findFunctionBodyStart(source, openParen);
    if (bodyStart < 0) return { ok: false, reason: "找不到函数体" };

    const paramList = (splitTopLevelArgs(source, openParen) ?? []).map((p) => p.trim()).filter(Boolean);
    if (paramList.length !== 1) {
        return { ok: false, reason: `有 ${paramList.length} 个参数，恒等包装器必须恰好 1 个` };
    }
    // 参数形如 `path: string` / `path: P & PathAssert<P, …>` / `path?: string` → 名字 + 类型文本
    const pm = /^([A-Za-z_$][\w$]*)\s*\??\s*(?::([\s\S]*))?$/.exec(paramList[0]);
    if (!pm) return { ok: false, reason: `参数写法认不出：${paramList[0]}` };

    const closeBrace = matchBrace(source, bodyStart);
    if (closeBrace < 0) return { ok: false, reason: "函数体不配平" };
    const body = source
        .slice(bodyStart + 1, closeBrace)
        // 函数体里允许有注释：`return path; // 无类型断言`
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "")
        .trim()
        .replace(/;$/, "")
        .trim();

    if (body !== `return ${pm[1]}`) return { ok: false, reason: `函数体不是恒等：\`${body}\`` };
    return { ok: true, param: pm[1], typeText: pm[2]?.trim() ?? null };
}

/**
 * 扫出源码里**所有** `function <name>(…)` 声明并逐条判定。
 *
 * 逐条而不是"按名字取首处"：同名重载里只要有**一处**不是恒等，整个名字就必须作废
 * （否则解包就是在同名不同义之间猜）。
 *
 * @param {string} source 已剥注释的源码
 * @returns {Array<{ name: string, ok: boolean, param?: string, typeText?: string | null, reason?: string }>}
 */
export function analyzeFunctionDeclarations(source) {
    const out = [];
    const declRe = /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g;
    for (const m of source.matchAll(declRe)) {
        const name = m[1];
        const verdict = analyzeIdentityFunction(source, m.index + m[0].length);
        out.push(
            verdict.ok
                ? { name, ok: true, param: verdict.param, typeText: verdict.typeText }
                : { name, ok: false, reason: verdict.reason },
        );
    }
    return out;
}

/**
 * 校验 `name` 在 `source` 里的**全部**定义都是恒等函数（函数体只有 `return <第一个参数>;`）。
 *
 * @param {{ source: string, name: string }} input
 * @returns {{ ok: true, param: string, typeText: string | null } | { ok: false, reason: string }}
 */
export function verifyIdentityHelperShape({ source, name }) {
    const decls = analyzeFunctionDeclarations(source).filter((d) => d.name === name);
    if (decls.length === 0) return { ok: false, reason: `找不到 \`function ${name}(…)\` 的定义` };
    const bad = decls.find((d) => !d.ok);
    if (bad) return { ok: false, reason: `\`${name}\` ${bad.reason}` };
    return { ok: true, param: decls[0].param, typeText: decls[0].typeText ?? null };
}

/**
 * 全仓扫描 `function <name>(…)` 声明，建「名字 → 恒等包装器种类」索引。
 *
 * 规则（**宁可漏解也不猜**）：
 *   - 一个名字只要有**任意一处**定义不是恒等 ⇒ 整个名字作废（同名不同义时解包就是猜）；
 *   - 所有定义都是恒等时：全部带 `PathAssert<…>` ⇒ `guarded`；否则算 `plain`
 *     （保守：只要有一处裸恒等，就不能声称"已被类型系统覆盖"）。
 *
 * ⚠️ 已知局限：不做作用域分析，因此**参数遮蔽**同名恒等函数时会被误解
 * （如某方法签名里有形参 `bu`）。本仓不存在这种写法；若将来出现，门禁会把
 * 该文件的未校验计数打到基线之上并报红，届时再加形参遮蔽检查即可。
 *
 * @param {Map<string, string>} sourcesByFile 仓库相对路径 → 已剥注释的源码
 * @param {{ stripAliases?: Map<string, string> }} [options] 剥离别名表（见 `parseStripPrefixAliases`）
 * @returns {{ helpers: Map<string, { kind: "plain" | "guarded", files: string[], stripPrefix: string | null }> }}
 */
export function indexIdentityPathHelpers(sourcesByFile, options = {}) {
    const stripAliases = options.stripAliases ?? new Map();
    /** @type {Map<string, { identity: boolean, guarded: boolean, files: Set<string>, prefixes: Set<string> }>} */
    const raw = new Map();
    for (const [file, source] of sourcesByFile) {
        for (const decl of analyzeFunctionDeclarations(source)) {
            const entry = raw.get(decl.name) ?? {
                identity: true,
                guarded: true,
                files: new Set(),
                prefixes: new Set(),
            };
            entry.files.add(file);
            if (!decl.ok) {
                entry.identity = false;
            } else {
                const strip = resolveStripPrefixFromType(decl.typeText, stripAliases);
                if (!/PathAssert\s*</.test(decl.typeText ?? "")) entry.guarded = false;
                if (strip) entry.prefixes.add(strip);
                else entry.prefixes.add("\u0000unknown");
            }
            raw.set(decl.name, entry);
        }
    }
    const helpers = new Map();
    for (const [name, e] of raw) {
        if (!e.identity) continue; // 同名有非恒等定义 ⇒ 整名作废
        // 同名多处定义的前缀必须一致（否则"这个调用点该按哪个前缀算"取决于遍历顺序）
        const prefixes = [...e.prefixes];
        helpers.set(name, {
            kind: e.guarded ? "guarded" : "plain",
            files: [...e.files].sort(),
            stripPrefix: prefixes.length === 1 && prefixes[0] !== "\u0000unknown" ? prefixes[0] : null,
        });
    }
    return { helpers };
}

/**
 * 把 `helper(<字面量>)` 展开成 `<字面量>`；不是恒等包装器调用就返回 `null`。
 *
 * 只解「整段就是一个调用」的形态：`apu("x") + y`、`apu("x").slice(1)` 一律不解
 * （展开一半会让路径变成错的，比不解更糟）。
 * `helpers` 必须是 `indexIdentityPathHelpers()` 的产物（已校验）。
 *
 * @param {string} raw
 * @param {{ has(name: string): boolean }} helpers
 * @returns {string | null} 展开后的表达式（未判是否为字面量）
 */
export function unwrapIdentityPath(raw, helpers) {
    if (!helpers || typeof helpers.has !== "function") return null;
    let expr = String(raw ?? "").trim();
    for (let hop = 0; hop < 5; hop++) {
        const m = /^([A-Za-z_$][\w$]*)\s*\(/.exec(expr);
        // 不再是函数调用（`"x"` / `path` / `this.a.b()`）⇒ 展开到此结束。
        // ⚠️ 这里必须**返回已展开的表达式**而不是 null：第一版写成 `return null`，
        // 于是 `apu("x")` 展开成 `"x"` 之后又被第二圈判成"不是恒等调用"而整条作废
        // —— 解包看起来"实现了"，13 处调用点却仍全部落在未校验桶里，且不报错。
        if (!m) return hop === 0 ? null : expr;
        if (!helpers.has(m[1])) return hop === 0 ? null : expr;
        const openParen = m[0].length - 1;
        const closeParen = matchParen(expr, openParen);
        if (closeParen < 0) return null;
        const args = splitTopLevelArgs(expr, openParen);
        if (!args || args.length !== 1) return null;
        // 闭括号之后必须什么都没有（否则是 `apu("x") + y` / `.trim()` 之类）
        if (expr.slice(closeParen + 1).trim() !== "") return null;
        expr = args[0].trim();
    }
    return null;
}

/** 路径实参必须长这样（含 `${…}` 插值的模板字面量也算 —— 归一化会处理成 `{X}`）。 */
const PATH_LITERAL_RE = /^(`[^`]*`|"[^"]*"|'[^']*')$/;

/**
 * 不属于「homeserver ledger」校验范畴的路径命名空间 —— 单独成桶，**不计入 mismatch**。
 *
 * ledger 是 homeserver 的路由表。identity server（身份服务器）是独立部署的服务，
 * 它的路由永远不会出现在 ledger 里：这是**结构性的**，不是缺口。
 * 显式登记并单独计数，避免两件坏事：
 *   ① 把它们当成 mismatch（假阳性）；② 用一堆豁免把它们盖掉（豁免注水）。
 */
const OUT_OF_SCOPE_PREFIXES = {
    "/_matrix/identity/":
        "identity server（身份服务器）是独立部署的服务，本后端 ledger 只含 homeserver 路由；" +
        "SDK 打的是配置里指定的身份服务器地址。",
};

export function resolvePrefix(expr) {
    // 无 prefix 字段 → 用默认前缀（不是"无法判断"）
    if (!expr) return { prefix: DEFAULT_PREFIX, known: true };

    const literal = expr.trim().replace(/^["'`]|["'`]$/g, "");

    // VendorPrefix 是 const 字符串（不是 enum），源码里直接当值用
    if (literal === "VendorPrefix") return { prefix: PREFIX_CONSTANTS.VendorPrefix[""], known: true };

    // 模板字面量前缀：`${ClientPrefix.Unstable}/org.matrix.msc4143`
    // 注意：上面的 strip 已经去掉了两端的引号/反引号，所以这里的正则不能再要求反引号，
    // 否则永远匹配不上 → 正确的 unstable 前缀会被误判为「用默认 v3 前缀」。
    // 纯字符串不可能以 `${` 开头，所以这里只可能是（被剥了反引号的）模板字面量。
    if (literal.startsWith("${")) {
        const resolved = resolveTemplateLiteral(literal);
        return { prefix: resolved, known: true };
    }

    // 裸字符串前缀（少数地方直接写字面量）
    if (literal.startsWith("/")) return { prefix: literal, known: true };

    const m = /^(\w+)\.(\w+)$/.exec(literal);
    if (m) {
        const group = PREFIX_CONSTANTS[m[1]];
        if (group && group[m[2]] !== undefined) return { prefix: group[m[2]], known: true };
        return { prefix: null, known: false };
    }
    return { prefix: null, known: false };
}

// ---------------------------------------------------------------------------
// 模板字面量解析辅助函数
// ---------------------------------------------------------------------------

/**
 * 解析模板字面量字符串（已剥去反引号），返回最终拼接的完整前缀字符串。
 * 支持简单的插值表达式：`${ClientPrefix.Unstable}...`
 */
export function resolveTemplateLiteral(literal) {
    // 简单实现：只支持当前出现的插值表达式的类型
    // 例如 `${ClientPrefix.Unstable}/org.matrix.msc4143`
    // 支持组合：先解析插值，再拼接后缀

    // 匹配第一个 `${...}` 表达式的类型
    const interpMatch = /^\$\{(\w+)\.(\w+)\}(.*)$/.exec(literal);
    if (interpMatch) {
        const [_, group, key, rest] = interpMatch;
        const base = PREFIX_CONSTANTS[group]?.[key] || "";
        // 递归解析剩余部分（可能包含其他插值表达式）
        const restResult = rest.includes("$") ? resolveTemplateLiteral(rest) : rest;
        return base + restResult;
    }

    // 没有插值表达式，返回字符串本身
    return literal;
}

// ---------------------------------------------------------------------------
// 3. 路径归一化
// ---------------------------------------------------------------------------

export function normalizePath(p) {
    return (
        p
            // ${encodeURIComponent(x)} / ${this.encode(x)} / ${x || y} 等任意插值表达式 → {X}
            .replace(/\$\{[^}]*\}/g, "{X}")
            .replace(/\$(\w+)/g, "{X}") // $roomId（无花括号形态）
            .replace(/\{[^}]+\}/g, "{X}") // {roomId}
            .replace(/:(\w+)/g, "{X}") // :roomId
            .split("?")[0]
            .replace(/\/+$/, "") || "/"
    );
}

/**
 * 形态 A（对象字面量，主流写法）：
 *   this.request({ method: Method.Post, path: "/appservices", body: {...}, prefix: AdminPrefix.V1 })
 *
 * 难点：prefix 与 path 之间可能夹着整个 body 对象。所以不能靠正则的固定顺序，
 * 而是：先锚定 `method:`，再在该调用对象的括号配平范围内分别找 `path:` 和 `prefix:`。
 */
export function extractObjectCalls(source) {
    const calls = [];
    const methodRe = /\bmethod:\s*Method\.(\w+)/g;

    let m;
    while ((m = methodRe.exec(source)) !== null) {
        const start = m.index;

        // 从 method: 往后找到包裹它的对象字面量的闭合括号
        const openIdx = source.lastIndexOf("{", start);
        if (openIdx < 0) continue;
        const closeIdx = matchBrace(source, openIdx);
        if (closeIdx < 0) continue;

        const region = source.slice(start, closeIdx);

        const pathM = region.match(/\bpath:\s*(`[^`]*`|"[^"]*"|'[^']*')/);
        if (!pathM) continue;

        // prefix 允许在 path 之前或之后，null 表示"无显式前缀，用默认值"
        // 支持：标识符（ClientPrefix.V3）、普通字符串、模板字面量（`/_matrix/client/unstable/org.matrix.msc4143`）
        const prefixM =
            region.match(/\bprefix:\s*(`[^`]*`|[\w.]+|"[^"]*"|'[^']*')/) ??
            source.slice(openIdx, closeIdx).match(/\bprefix:\s*(`[^`]*`|[\w.]+|"[^"]*"|'[^']*')/);

        calls.push({
            method: m[1].toUpperCase(),
            pathRaw: pathM[1],
            // 有字面量就用它；null 会让 resolvePrefix 走默认前缀分支
            prefixExpr: prefixM?.[1] ?? null,
            line: source.slice(0, start).split("\n").length,
        });
    }
    return calls;
}

// ---------------------------------------------------------------------------
// 前缀表达式求值（支持多候选）—— 位置参数包装器用
// ---------------------------------------------------------------------------

/** 在顶层（不在括号/字符串内）扫描，返回第一个满足 pred 的字符下标 */
export function findTopLevel(src, pred) {
    let depth = 0;
    let inStr = null;
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (inStr) {
            if (c === "\\") i++;
            else if (c === inStr) inStr = null;
            continue;
        }
        if (c === '"' || c === "'" || c === "`") {
            inStr = c;
            continue;
        }
        if (c === "(" || c === "[" || c === "{") depth++;
        else if (c === ")" || c === "]" || c === "}") depth--;
        else if (depth === 0 && pred(c, i)) return i;
    }
    return -1;
}

/**
 * `cond ? A : B` → { whenTrue: "A", whenFalse: "B" }，否则 null。
 * 两条腿都要合法，因为**fallback 的两条路径都真会被发出去**——
 * 只校验其中一条等于没校验（`client-auth.ts` 的 MSC2965 稳定/unstable 回退就是这种）。
 */
export function splitTopLevelTernary(expr) {
    // 跳过 `?.`（可选链）与 `??`（空值合并）
    const q = findTopLevel(expr, (c, i) => c === "?" && expr[i + 1] !== "." && expr[i + 1] !== "?");
    if (q < 0) return null;
    const colon = findTopLevel(expr.slice(q + 1), (c) => c === ":");
    if (colon < 0) return null;
    return {
        whenTrue: expr.slice(q + 1, q + 1 + colon).trim(),
        whenFalse: expr.slice(q + 1 + colon + 1).trim(),
    };
}

/** 顶层 `+` 切分（不在字符串内的拼接） */
export function splitTopLevelPlus(expr) {
    const parts = [];
    let rest = expr;
    let offset = 0;
    for (;;) {
        const p = findTopLevel(rest, (c, i) => c === "+" && rest[i - 1] !== "+" && rest[i + 1] !== "+");
        if (p < 0) {
            parts.push(rest.trim());
            break;
        }
        parts.push(rest.slice(0, p).trim());
        offset += p + 1;
        rest = rest.slice(p + 1);
    }
    return parts.filter((p) => p !== "");
}

/**
 * 求值一个前缀表达式，返回**候选前缀集合**。
 * known=false 表示无法静态求值 —— 调用点会被计入「动态跳过」并显示在 --verbose 里，
 * 而不是被悄悄当成"匹配成功"。
 */
export function resolvePrefixExpression(expr) {
    const e = (expr ?? "").trim();
    if (!e) return { candidates: [DEFAULT_PREFIX], known: true };

    const tern = splitTopLevelTernary(e);
    if (tern) {
        const a = resolvePrefixExpression(tern.whenTrue);
        const b = resolvePrefixExpression(tern.whenFalse);
        if (a.known && b.known) {
            return { candidates: [...new Set([...a.candidates, ...b.candidates])], known: true };
        }
        return { candidates: [], known: false };
    }

    const plusParts = splitTopLevelPlus(e);
    if (plusParts.length > 1) {
        let acc = [""];
        for (const part of plusParts) {
            const r = resolvePrefixExpression(part);
            if (!r.known) return { candidates: [], known: false };
            const next = [];
            for (const a of acc) for (const c of r.candidates) next.push(a + c);
            acc = next;
        }
        return { candidates: [...new Set(acc)], known: true };
    }

    const { prefix, known } = resolvePrefix(e);
    return known ? { candidates: [prefix], known: true } : { candidates: [], known: false };
}

/** 根据包装器声明 + 实参 + 所在文件，得出该调用的前缀候选 */
function candidatesForWrapper(spec, args, relFile) {
    if (spec.byDir) {
        const hit = spec.byDir.find(([dirPrefix]) => relFile.startsWith(dirPrefix));
        return { candidates: hit ? hit[1] : spec.fallback, known: true };
    }

    if (spec.fixed) return { candidates: spec.fixed, known: true };

    if (spec.arg !== undefined) {
        const expr = args[spec.arg];
        if (expr === undefined) return { candidates: [], known: false };
        return resolvePrefixExpression(expr);
    }

    if (spec.opts !== undefined) {
        const optsArg = args[spec.opts];
        // 没传 opts → 走默认前缀；传了但没有 prefix: 字段 → 同样走默认前缀
        if (optsArg === undefined) return { candidates: [DEFAULT_PREFIX], known: true };
        const pm = /\bprefix:\s*([^,}]*)/.exec(optsArg);
        const expr = pm?.[1]?.trim();
        // 空值（如 `prefix: undefined`）也按默认前缀处理
        if (!expr || expr === "undefined") return { candidates: [DEFAULT_PREFIX], known: true };
        return resolvePrefixExpression(expr);
    }

    return { candidates: [], known: false };
}

// ---------------------------------------------------------------------------
// 形态 C（位置参数，表驱动）：helper(Method.X, "<relative-path>", ...)
// 覆盖范围完全由 POSITIONAL_WRAPPERS 决定 —— 见文件头「增强（2026-10-06）」。
// ---------------------------------------------------------------------------

/** 跳过 `<...>` 泛型参数（支持嵌套），返回 `>` 之后的下标；不是泛型则原样返回 */
function skipGenerics(src, i) {
    if (src[i] !== "<") return i;
    let depth = 0;
    for (; i < src.length; i++) {
        const c = src[i];
        if (c === "<") depth++;
        else if (c === ">") {
            depth--;
            if (depth === 0) return i + 1;
        }
    }
    return -1;
}

/**
 * 从 `(` 起按顶层逗号切分实参（自动忽略字符串/括号/**泛型实参**内部的逗号）。
 *
 * ⚠️ 泛型深度必须单独跟踪：本仓的类型化路径包装器写成
 * `bu<const P extends string>(path: P & PathAssert<P, StripAdminV1<BackgroundUpdatePath>>)`
 * —— 参数表里有 `PathAssert<P, …>` 这个**带逗号的泛型**。只按 `()[]{}` 计深度时
 * 那个逗号落在 depth 0 ⇒ 一个参数被切成两个 ⇒ "恒等包装器必须恰好 1 个参数"判据
 * 失败 ⇒ 50 个包装器一个都识别不出来（而报告只会说"已校验的恒等包装器: 1"）。
 *
 * `<` 的开合是**启发式**：紧跟标识符/`>` 的 `<` 才算泛型开口（`a < b` 有空格 ⇒ 不算），
 * 避免把比较运算符当成泛型。宁可少切（少一切一刀 ⇒ 实参变长 ⇒ 下游判据 fail-closed），
 * 也不要多切（多一刀 ⇒ 实参错位 ⇒ 静默取错参数）。
 */
function splitTopLevelArgs(src, openIdx) {
    const closeParen = matchParen(src, openIdx);
    if (closeParen < 0) return null;
    const inner = src.slice(openIdx + 1, closeParen);
    const args = [];
    let depth = 0;
    let generic = 0;
    let inStr = null;
    let start = 0;
    for (let i = 0; i < inner.length; i++) {
        const c = inner[i];
        if (inStr) {
            if (c === "\\") i++;
            else if (c === inStr) inStr = null;
            continue;
        }
        if (c === '"' || c === "'" || c === "`") {
            inStr = c;
            continue;
        }
        if (c === "<" && /[\w>$]/.test(inner[i - 1] ?? "")) generic++;
        else if (c === ">" && generic > 0) generic--;
        else if (c === "(" || c === "[" || c === "{") depth++;
        else if (c === ")" || c === "]" || c === "}") depth--;
        else if (c === "," && depth === 0 && generic === 0) {
            args.push(inner.slice(start, i));
            start = i + 1;
        }
    }
    args.push(inner.slice(start));
    return args.map((a) => a.trim());
}

/**
 * 抽取形态 C 的调用点。
 *
 * 返回 `{ calls, unchecked }` 两个桶 —— **不允许再出现第三种去向**：
 *   - `calls`     路径实参是字面量（可直接与 ledger 比对）；
 *   - `unchecked` 路径实参是表达式且解不开（`this.fooPath(id)` / `path` / `mp(...)` …）。
 *
 * ⚠️ 上一版这里写的是 `if (!LITERAL.test(args[1])) continue;` —— 静默 `continue`。
 * 后果不是"少校验几条"，而是**这 246 处调用点在报告里完全不存在**：分母只统计
 * `calls`，于是"提取请求调用 432 / 不匹配 0"读起来像全覆盖。任何"无法校验"的
 * 调用点都必须**显式计数**，这是本文件已经写在 EXCLUDED_WRAPPERS 上的同一条原则。
 *
 * @param {string} source 已剥注释的源码
 * @param {string} relFile 仓库相对路径（用于 byDir 前缀分流与报告）
 * @param {{ identityHelpers?: { has(name: string): boolean } }} [options]
 *        `identityHelpers` 是**已校验**的恒等包装器名字集合（见 PATH_IDENTITY_HELPERS）。
 *        不传 ⇒ 不解包（保守：宁可算不出来的进 unchecked 桶，也不拿未校验的表去展开）。
 */
export function extractWrapperCalls(source, relFile, options = {}) {
    const calls = [];
    const unchecked = [];
    const identityHelpers = options.identityHelpers ?? null;
    const names = Object.keys(POSITIONAL_WRAPPERS);
    // 名字前的 `this.` / `api.` / `this.client.http.` 等链式前缀由 \b 天然丢弃。
    // 方法**定义处**（`protected async adminRequest<T>(method: Method, ...)`）也会被本正则命中，
    // 但会在下面「第 1 个实参必须是 Method.X」这一步被过滤掉。
    const nameRe = new RegExp(`\\b(${names.join("|")})\\b`, "g");

    for (const m of source.matchAll(nameRe)) {
        let i = skipGenerics(source, m.index + m[1].length);
        if (i < 0) continue;
        while (i < source.length && /\s/.test(source[i])) i++;
        if (source[i] !== "(") continue;

        const args = splitTopLevelArgs(source, i);
        if (!args || args.length < 2) continue;

        const methodM = /^Method\.(\w+)$/.exec(args[0]);
        if (!methodM) continue;

        const line = source.slice(0, m.index).split("\n").length;
        const rawPathArg = args[1];
        // 恒等包装器（`apu("x")` / `bu("/…")`）先解开，再判是不是字面量
        const helperName = /^([A-Za-z_$][\w$]*)\s*\(/.exec(rawPathArg.trim())?.[1];
        const unwrapped = unwrapIdentityPath(rawPathArg, identityHelpers);
        const pathArg = unwrapped ?? rawPathArg;
        if (!PATH_LITERAL_RE.test(pathArg)) {
            unchecked.push({
                file: relFile,
                line,
                wrapper: m[1],
                // 表达式原文（截断）——报告里按「前导标识符」聚合，便于看出是哪一类写法
                expr: rawPathArg.replace(/\s+/g, " ").slice(0, 120),
            });
            continue;
        }

        const helperInfo = unwrapped ? identityHelpers.get(helperName) : null;
        // 类型化包装器的参数类型里**已经写明了前缀**（`PathAssert<P, StripAdminV1<…>>`）
        // ⇒ 优先用它，必要时才退回 POSITIONAL_WRAPPERS 的 byDir/fixed 声明。
        // 这消掉了整片"按目录猜前缀"的错配：`background-update` / `worker-admin` /
        // `worker-body` 都走 `doRequest`，但前缀分别是 admin v1 与 /_synapse/worker。
        const resolved = helperInfo?.stripPrefix
            ? { candidates: [helperInfo.stripPrefix], known: true }
            : candidatesForWrapper(POSITIONAL_WRAPPERS[m[1]], args, relFile);
        const { candidates, known } = resolved;
        calls.push({
            method: methodM[1].toUpperCase(),
            pathRaw: pathArg,
            prefixCandidates: candidates,
            prefixKnown: known,
            wrapper: m[1],
            // `guarded` = 路径原本裹在带 `PathAssert<…>` 的恒等包装器里（tsc 已逐段断言过）；
            // `plain` = 裹在裸恒等包装器里（只有本门禁能核对）；`null` = 本来就是字面量。
            guard: unwrapped ? (helperInfo?.kind ?? "plain") : null,
            prefixFromHelper: Boolean(helperInfo?.stripPrefix),
            line,
        });
    }
    return { calls, unchecked };
}

/** 从 openIdx 处的 `(` 开始做圆括号配平，返回闭合 `)` 的下标 */
function matchParen(src, openIdx) {
    if (openIdx < 0) return -1;
    let depth = 0;
    let inStr = null;
    for (let i = openIdx; i < src.length; i++) {
        const c = src[i];
        if (inStr) {
            if (c === "\\") i++;
            else if (c === inStr) inStr = null;
            continue;
        }
        if (c === '"' || c === "'" || c === "`") {
            inStr = c;
            continue;
        }
        if (c === "(") depth++;
        else if (c === ")") {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/**
 * 去掉注释，避免把 JSDoc `@example` 里的示例代码当成真实调用。
 * `base-manager.ts` 和 `errors.ts` 的文档块里都写了完整的 request 示例，
 * 不剔除就会产出「代码里根本不存在」的假缺口。
 */
function stripComments(source) {
    let out = "";
    let i = 0;
    const n = source.length;
    // 简单状态机：normal → lineComment / blockComment / string
    let state = "normal";
    let quote = "";

    while (i < n) {
        const c = source[i];
        const next = source[i + 1];

        if (state === "normal") {
            if (c === "/" && next === "/") {
                state = "lineComment";
                out += "  ";
                i += 2;
                continue;
            }
            if (c === "/" && next === "*") {
                state = "blockComment";
                out += "  ";
                i += 2;
                continue;
            }
            if (c === '"' || c === "'" || c === "`") {
                state = "string";
                quote = c;
                out += c;
                i++;
                continue;
            }
            out += c;
            i++;
            continue;
        }

        if (state === "lineComment") {
            if (c === "\n") {
                state = "normal";
                out += c;
            } else {
                out += " "; // 保留列宽，便于按行号定位
            }
            i++;
            continue;
        }

        if (state === "blockComment") {
            if (c === "*" && next === "/") {
                state = "normal";
                out += "  ";
                i += 2;
                continue;
            }
            out += c === "\n" ? "\n" : " ";
            i++;
            continue;
        }

        if (state === "string") {
            out += c;
            if (c === "\\") {
                out += next ?? "";
                i += 2;
                continue;
            }
            if (c === quote) {
                state = "normal";
            }
            i++;
            continue;
        }
    }
    return out;
}

/** 从 openIdx 处的 `{` 开始做括号配平，返回闭合 `}` 的下标 */
export function matchBrace(src, openIdx) {
    let depth = 0;
    let inStr = null;
    for (let i = openIdx; i < src.length; i++) {
        const c = src[i];
        if (inStr) {
            if (c === "\\") i++;
            else if (c === inStr) inStr = null;
            continue;
        }
        if (c === '"' || c === "'" || c === "`") {
            inStr = c;
            continue;
        }
        if (c === "{") depth++;
        else if (c === "}") {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

// ---------------------------------------------------------------------------
// 4b. 与后端注册面比对
// ---------------------------------------------------------------------------

/**
 * 判断 (method, 完整路径) 是否在后端注册面内，并返回**匹配方式**：
 *   "exact"    — 与 ledger 条目逐段完全一致
 *   "wildcard" — 仅靠「SDK 字面量段 ↔ 后端占位符段」等价规则命中。**语义存疑**，
 *                必须单独汇报让人复核：`DELETE /notifications/deactivate` 正是靠这条规则
 *                被误当成 `DELETE /notifications/{notification_id}` 而长期隐形的
 *                （真实情况是后端只有 `PUT /notifications/{id}/deactivate`）。
 *   null       — 未命中
 */
export function matchAgainstLedger(method, fullPath, routes = backendRoutes) {
    if (routes.has(`${method} ${fullPath}`)) return "exact";

    const sdkSegments = fullPath.split("/");
    for (const [backendKey, originalBackendPath] of routes.entries()) {
        const [backendMethod] = backendKey.split(" ");
        if (backendMethod !== method) continue;

        const backendSegments = normalizePath(originalBackendPath).split("/");
        if (sdkSegments.length !== backendSegments.length) continue;

        const compatible = sdkSegments.every((seg, i) => {
            const bSeg = backendSegments[i];
            if (seg === bSeg) return true;
            // 只允许一种放宽：SDK 写了**具体值**而后端声明为占位符，且该具体值形如
            // Matrix 的事件类型 / 域名（含 "."）。这是为
            // `send/m.room.message/{txn}` vs `send/{event_type}/{txn_id}` 这类等价而留的。
            //
            // 早期版本还允许「SDK 的任意字面量段顶掉任意 {占位符} 段」，结果把
            // `/notifications/deactivate` 当成 `/notifications/{notification_id}`、
            // `/federation/blacklist/add` 当成 `/federation/blacklist/{server_name}` ——
            // 两处真缺陷因此长期隐形。收紧后它们会被正常报出。
            if (bSeg.startsWith("{") && seg !== "{X}" && seg.includes(".")) return true;
            return false;
        });
        if (compatible) return "wildcard";
    }
    return null;
}

// ---------------------------------------------------------------------------
// 5. 遍历源码
// ---------------------------------------------------------------------------

function walkSrc(dir) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "__generated__" || entry.name === "__tests__") continue;
            out.push(...walkSrc(full));
        } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
            out.push(full);
        }
    }
    return out;
}

function main() {
    backendRoutes = loadBackendRoutes();

    const scanRoots = (process.env.SCAN_ROOTS ?? "src").split(",").map((r) => resolve(PROJECT_ROOT, r.trim()));
    const srcFiles = scanRoots.flatMap((r) => (existsSync(r) ? walkSrc(r) : []));

    // 先把全仓源码读一遍（剥注释）：
    //   ① 建「恒等包装器」索引需要**全仓**视野（`sp` 在 `src/space/utils.ts` 定义、
    //      在 `space/sub-managers/*` 使用；只看单文件会漏掉并把它算成"未校验"）；
    //   ② 索引必须**先于**抽取完成，否则解包与不解包的结果会依赖遍历顺序。
    const sourcesByFile = new Map();
    for (const file of srcFiles) {
        sourcesByFile.set(file.slice(PROJECT_ROOT.length + 1), stripComments(readFileSync(file, "utf8")));
    }
    const stripSource = sourcesByFile.get(STRIP_PREFIX_FILE);
    if (!stripSource) {
        console.error(`❌ 找不到 ${STRIP_PREFIX_FILE} —— 类型化路径包装器的前缀表读不出来。`);
        console.error("   若该文件被移动/改名，请同步更新 STRIP_PREFIX_FILE（否则前缀会退回 byDir 猜测，");
        console.error("   表现为一大片假不匹配）。");
        process.exit(2);
    }
    const stripAliases = parseStripPrefixAliases(stripSource);
    const { helpers: identityHelpers } = indexIdentityPathHelpers(sourcesByFile, { stripAliases });

    const findings = [];
    const skipped = [];
    const uncheckedCalls = [];
    const outOfScopeCalls = [];

    for (const [relFile, source] of sourcesByFile) {
        // 同一调用可能被两种提取器各命中一次，按 method+path+候选前缀 去重
        const seen = new Set();
        const wrapperResult = extractWrapperCalls(source, relFile, { identityHelpers });
        uncheckedCalls.push(...wrapperResult.unchecked);
        const calls = [...extractObjectCalls(source), ...wrapperResult.calls];

        for (const call of calls) {
            // 统一成「前缀候选集」：
            //   对象形态 → 单候选；位置参数形态 → 可能多候选（如 doRequest 的两种前缀、
            //   三元 fallback 的两条腿）。任一候选命中即视为匹配 —— 见 POSITIONAL_WRAPPERS 注释。
            let candidates;
            let known;
            if (call.prefixCandidates) {
                candidates = call.prefixCandidates;
                known = call.prefixKnown;
            } else {
                const r = resolvePrefix(call.prefixExpr);
                candidates = r.known ? [r.prefix] : [];
                known = r.known;
            }

            // 去重键含行号：既避免「同一调用被两种提取器各命中一次」，又不会把
            // 同一文件里两个**不同调用点**（如 getServerInfo / getAdminInfo 都打 /info）合并成一条。
            const dedupKey = `${call.method}|${call.pathRaw}|${candidates.join("\u0001")}|${call.line}`;
            if (seen.has(dedupKey)) continue;
            seen.add(dedupKey);

            // 模板字面量可通过归一化处理（${...} → {X}），不跳过
            const pathOnly = call.pathRaw.replace(/^["'`]|["'`]$/g, "");
            if (!pathOnly.includes("${") && !pathOnly.startsWith("/")) {
                skipped.push({ file: relFile, line: call.line, reason: "非字面量路径" });
                continue;
            }

            if (!known) {
                skipped.push({
                    file: relFile,
                    line: call.line,
                    reason: `无法静态求值的前缀（${call.prefixExpr ?? call.wrapper ?? "?"}）`,
                });
                continue;
            }

            // pathOnly 本身已是完整路径时忽略 prefix，避免双重前缀
            const isFullUrl = /^\/_matrix\/(client|admin|vendor|identity|media|federation|server)/.test(pathOnly);

            // 域外命名空间：结构性不属于本 ledger，单独计数后跳过
            const probePath = isFullUrl ? pathOnly : (candidates[0] ?? "") + pathOnly;
            const outOfScopePrefix = Object.keys(OUT_OF_SCOPE_PREFIXES).find((p) => probePath.startsWith(p));
            if (outOfScopePrefix) {
                outOfScopeCalls.push({
                    file: relFile,
                    line: call.line,
                    method: call.method,
                    fullPath: normalizePath(probePath),
                    prefix: outOfScopePrefix,
                });
                continue;
            }

            let matchKind = null;
            let fullPath = null; // 报告用：第一个候选算出的路径作为「主路径」
            for (const prefix of candidates) {
                const fp = normalizePath(isFullUrl ? pathOnly : (prefix ?? "") + pathOnly);
                if (fullPath === null) fullPath = fp;
                const kind = matchAgainstLedger(call.method, fp);
                if (kind) {
                    matchKind = kind;
                    fullPath = fp;
                    break;
                }
            }
            const matched = matchKind !== null;

            const finding = {
                file: relFile,
                line: call.line,
                method: call.method,
                sdkPath: pathOnly,
                fullPath,
                matched,
                matchKind,
            };

            if (!matched) {
                const bare = normalizePath(pathOnly);
                const candidatesList = [...backendRoutes.entries()]
                    .filter(([, original]) => {
                        const n = normalizePath(original);
                        return n.endsWith(bare) || bare.endsWith(n);
                    })
                    .map(([k]) => k);
                if (candidatesList.length > 0) finding.suggestion = candidatesList.slice(0, 3).join(" | ");
            }

            findings.push(finding);
        }
    }

    // ---------------------------------------------------------------------------
    // 6. Waiver 处理
    // ---------------------------------------------------------------------------

    /**
     * 豁免表的作用是「让已知缺口可见但不作红」，而不是「让门禁闭嘴」。
     * 三条约束：
     *   1. 每条豁免必须有 reason 和 expires —— 没有主人的豁免等于删除门禁；
     *   2. 过期即失败 —— 强制定期复核；
     *   3. 没被用到的豁免也要报 —— 后端补齐后忘记删豁免，会让门禁的失败面被旧条目遮住。
     */
    const WAIVER_FILE = join(__dirname, "path-contract-waivers.json");
    const waivers = new Map(); // "<METHOD> <path>" -> {reason, expires, file}
    const expiredWaivers = [];
    let unusedWaivers = [];

    if (existsSync(WAIVER_FILE)) {
        let waiverDoc;
        try {
            waiverDoc = JSON.parse(readFileSync(WAIVER_FILE, "utf8"));
        } catch (e) {
            console.error(`❌ 豁免表解析失败: ${WAIVER_FILE}\n   ${e.message}`);
            process.exit(2);
        }

        const today = new Date();
        for (const w of waiverDoc.waivers ?? []) {
            const key = `${w.sdkCall}`;
            if (!w.reason || !w.expires) {
                console.error(`❌ 豁免条目缺少 reason 或 expires: ${key}`);
                process.exit(2);
            }
            if (new Date(w.expires) < today) {
                expiredWaivers.push({ key, ...w });
                continue;
            }
            waivers.set(key, w);
        }
    } else {
        console.error(`❌ 豁免表不存在: ${WAIVER_FILE}`);
        process.exit(2);
    }

    // ---------------------------------------------------------------------------
    // 7. 报告
    // ---------------------------------------------------------------------------

    /**
     * MSC 编号格式校验：检测 SDK 中引用的 MSC 编号是否与后端实现一致
     * 常见错误：MSC3882（Allow an existing session to sign in a new session）vs MSC3720（Account status）张冠李戴
     */
    function validateMSCReferences(findings, backendRoutes) {
        const mscIssues = [];

        // 从所有调用中提取可能的 MSC 引用
        for (const finding of findings) {
            if (finding.sdkPath.includes("org.matrix.msc")) {
                const mscMatch = finding.sdkPath.match(/org\.matrix\.msc(\d+)/i);
                if (mscMatch) {
                    const mscNum = mscMatch[1];
                    const mscPath = finding.sdkPath;

                    // 检查该 MSC 路径是否在后端已注册
                    let mscMatched = false;
                    for (const [key, orig] of backendRoutes.entries()) {
                        if (orig.includes(`org.matrix.msc${mscNum}`) || orig.includes(`msc${mscNum}`)) {
                            mscMatched = true;
                            break;
                        }
                    }

                    if (!mscMatched) {
                        mscIssues.push({
                            msc: `MSC${mscNum}`,
                            path: mscPath,
                            file: finding.file,
                            line: finding.line,
                            note: "SDK 声称实现该 MSC 端点，但后端 ledger 中无对应路由。请核实 MSC 编号是否正确。",
                        });
                    }
                }
            }
        }

        return mscIssues;
    }

    const rawMismatches = findings.filter((f) => !f.matched);

    // 仅靠通配符规则命中的调用点 —— 单独汇报，避免「形似而已」被当成匹配成功。
    const wildcardMatches = findings.filter((f) => f.matchKind === "wildcard");

    const mismatches = rawMismatches.filter((f) => {
        const key = `${f.method} ${f.fullPath}`;
        if (waivers.has(key)) {
            waivers.delete(key); // 标记为「已使用」
            return false;
        }
        return true;
    });

    // 没被任何不匹配命中到的豁免 = 后端已补齐但豁免没删
    unusedWaivers = [...waivers.entries()].map(([key, w]) => ({ key, ...w }));

    // ---------------------------------------------------------------------------
    // 6b. 覆盖率棘轮（2026-10-08 新增）
    //
    // `unchecked` 桶把"静默丢检"变成了"显式计数"，但计数本身会漂：只要有人写一个
    // `this.xxxPath(id)`，调用点就从"已校验"变成"未校验"而总数看不出变化。
    // 所以把观测值冻结成基线：**总量与逐文件计数都只准降**。
    // 想让它涨就必须跑 `--refresh-coverage` —— 那是一次显式声明，不是一个副作用。
    // ---------------------------------------------------------------------------
    const REFRESH_COVERAGE = process.argv.includes("--refresh-coverage");
    const countBy = (items, keyOf) => {
        const out = {};
        for (const it of items) {
            const k = keyOf(it);
            out[k] = (out[k] ?? 0) + 1;
        }
        return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
    };
    const coverage = {
        uncheckedPathArg: uncheckedCalls.length,
        checkedPathArg: findings.length,
        byFile: countBy(uncheckedCalls, (u) => u.file),
        byWrapper: countBy(uncheckedCalls, (u) => u.wrapper),
        // 形态拆解也落进棘轮文件：它给出的是"下一步该扩哪一层解析器"的工作清单
        byShape: summarizeUncheckedShapes(uncheckedCalls),
    };
    const coverageIssues = [];

    if (REFRESH_COVERAGE) {
        writeFileSync(
            COVERAGE_FILE,
            JSON.stringify(
                { schema_version: 1, note: COVERAGE_NOTE, generatedAt: new Date().toISOString(), ...coverage },
                null,
                4,
            ) + "\n",
        );
    } else {
        if (!existsSync(COVERAGE_FILE)) {
            console.error(`❌ 覆盖率基线不存在: ${COVERAGE_FILE}`);
            console.error("   首次使用或基线被删时，跑 `--refresh-coverage` 生成（这等于声明「当前覆盖现状」）。");
            process.exit(2);
        }
        let baseline;
        try {
            baseline = JSON.parse(readFileSync(COVERAGE_FILE, "utf8"));
        } catch (e) {
            console.error(`❌ 覆盖率基线解析失败: ${COVERAGE_FILE}\n   ${e.message}`);
            process.exit(2);
        }
        if (typeof baseline.uncheckedPathArg !== "number") {
            console.error(`❌ 覆盖率基线格式不认识（缺 uncheckedPathArg）: ${COVERAGE_FILE}`);
            process.exit(2);
        }
        coverageIssues.push(...diffCoverage(baseline, coverage));
    }

    const payload = {
        generatedAt: new Date().toISOString(),
        ledger: LEDGER_PATH,
        // 兄弟仓 / 仓内镜像 / 显式 LEDGER_PATH —— 结论要能追溯到来源（CI 上必然是 mirror）。
        ledgerSource: ledgerResolution.source,
        scannedFiles: srcFiles.length,
        totalCalls: findings.length,
        matched: findings.length - rawMismatches.length,
        wildcardMatched: wildcardMatches.length,
        waived: rawMismatches.length - mismatches.length,
        mismatched: mismatches.length,
        expiredWaivers: expiredWaivers.length,
        unusedWaivers: unusedWaivers.length,
        skippedDynamic: skipped.length,
        // 「路径实参不是字面量」的调用点：上一版它们被 `continue` 静默丢掉，
        // 于是分母只含能校验的那些，报告读起来像全覆盖。现在必须显式出现。
        uncheckedPathArg: uncheckedCalls.length,
        // 139 是个看不出下一步的大数字 —— 按形态拆开，"该扩哪一层解析器"才是可读的。
        uncheckedByShape: summarizeUncheckedShapes(uncheckedCalls),
        coverage,
        coverageIssues,
        uncheckedSamples: uncheckedCalls.slice(0, 40).map((u) => ({
            file: u.file,
            line: u.line,
            wrapper: u.wrapper,
            expr: u.expr,
        })),
        coveredIdentityHelpers: [...identityHelpers.entries()]
            .map(([name, v]) => ({ name, kind: v.kind }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        outOfScope: outOfScopeCalls.length,
        outOfScopeCalls: outOfScopeCalls.map((c) => ({
            file: c.file,
            line: c.line,
            method: c.method,
            fullPath: c.fullPath,
        })),
        coveredWrappers: Object.keys(POSITIONAL_WRAPPERS),
        excludedWrappers: Object.keys(EXCLUDED_WRAPPERS),
        mismatches: mismatches.map((m) => ({
            file: m.file,
            line: m.line,
            method: m.method,
            fullPath: m.fullPath,
            suggestion: m.suggestion ?? null,
        })),
        wildcardMatches: wildcardMatches.map((m) => ({
            file: m.file,
            line: m.line,
            method: m.method,
            fullPath: m.fullPath,
        })),
    };

    if (EMIT_JSON) {
        console.log(JSON.stringify(payload, null, 2));
    } else {
        console.log("");
        console.log("╔══════════════════════════════════════════════════════════════════╗");
        console.log("║        SDK ↔ 后端路径契约交叉校验（P2-a 门禁）                   ║");
        console.log("╚══════════════════════════════════════════════════════════════════╝");
        console.log("");
        console.log(
            `  ledger       : ${LEDGER_PATH}${ledgerResolution.source === "mirror" ? "  ⚠️ 兄弟仓不在场，回退到仓内镜像" : ""}`,
        );
        console.log(`  扫描源文件   : ${srcFiles.length}`);
        console.log(`  提取请求调用 : ${findings.length}`);
        console.log(`  匹配成功     : ${payload.matched}（其中 ${payload.wildcardMatched} 处为通配符匹配，见下）`);
        console.log(`  已豁免       : ${payload.waived}（后端未实现，见 path-contract-waivers.json）`);
        console.log(`  不匹配       : ${payload.mismatched}`);
        console.log(`  豁免已过期   : ${payload.expiredWaivers}`);
        console.log(`  豁免未被引用 : ${payload.unusedWaivers}（后端已补齐？应删除条目）`);
        console.log(`  动态跳过     : ${skipped.length}`);
        console.log(
            `  未校验调用点 : ${payload.uncheckedPathArg}` +
                `（路径实参非字面量；基线 ${REFRESH_COVERAGE ? "已刷新" : "见 path-contract-coverage.json"}）`,
        );
        const shapes = Object.entries(payload.uncheckedByShape ?? {});
        if (shapes.length > 0) {
            console.log(`      形态拆解 : ${shapes.map(([k, v]) => `${k} ${v}`).join(" / ")}`);
        }
        console.log(`  域外命名空间 : ${payload.outOfScope}（不属于本 ledger 的服务，如 identity server）`);
        console.log(`  覆盖的包装器 : ${payload.coveredWrappers.length}（${payload.coveredWrappers.join(", ")}）`);
        console.log(
            `  已校验的恒等包装器: ${payload.coveredIdentityHelpers.length}` +
                `（guarded ${payload.coveredIdentityHelpers.filter((h) => h.kind === "guarded").length}` +
                ` / plain ${payload.coveredIdentityHelpers.filter((h) => h.kind === "plain").length}）`,
        );
        console.log(`  未覆盖的包装器: ${payload.excludedWrappers.length}（${payload.excludedWrappers.join(", ")}）`);
        console.log("");

        if (expiredWaivers.length > 0) {
            console.log("─".repeat(84));
            console.log("⏰ 已过期的豁免（必须复核并处理）：");
            console.log("─".repeat(84));
            for (const w of expiredWaivers) {
                console.log(`  ${w.key}  (expires ${w.expires})`);
                console.log(`    ${w.file} — ${w.reason}`);
            }
            console.log("");
        }

        if (unusedWaivers.length > 0) {
            console.log("─".repeat(84));
            console.log("🧹 未被引用的豁免（对应的缺口已不存在，请删除条目）：");
            console.log("─".repeat(84));
            for (const w of unusedWaivers) {
                console.log(`  ${w.key}  (expires ${w.expires})`);
            }
            console.log("");
        }

        if (mismatches.length > 0) {
            console.log("─".repeat(84));
            console.log("不匹配的路径（在真实后端上会 404）：");
            console.log("─".repeat(84));
            for (const m of mismatches) {
                console.log("");
                console.log(`  ${m.method} ${m.fullPath}`);
                console.log(`    at ${m.file}:${m.line}`);
                if (m.suggestion) {
                    console.log(`    ledger 相近条目: ${m.suggestion}`);
                } else {
                    console.log(`    ledger 中无相近条目`);
                    console.log(`    → 若后端确实未实现，请加进 path-contract-waivers.json 并写明原因与期限；`);
                    console.log(`      若后端已实现，说明 SDK 拼错了路径，请修正 SDK。`);
                }
            }
            console.log("");
            console.log("─".repeat(84));
            console.log(`❌ ${mismatches.length} 处路径契约不符 —— 门禁失败。`);
        } else {
            console.log(`✅ 全部静态请求路径均与后端 ledger 一致（豁免 ${payload.waived} 处已登记）。`);
        }

        // 覆盖率：把"未校验"摆到台面上，而不是让报告的分母替它掩盖
        if (coverageIssues.length > 0) {
            console.log("");
            console.log("─".repeat(84));
            console.log("📉 覆盖率基线被突破（未校验调用点变多了）：");
            console.log("─".repeat(84));
            for (const v of coverageIssues) console.log(`  [${v.kind}] ${v.detail}`);
            console.log("");
            console.log("  这说明有调用点从「已校验」滑到「未校验」（如把字面量换成 `this.xxxPath(id)`）。");
            console.log("  两条出路：① 把路径改回字面量（或登记成恒等包装器）；");
            console.log("            ② 跑 `--refresh-coverage` 显式接受 —— 那等于声明「这些调用点不再被路径校验」。");
        }
        if (VERBOSE && uncheckedCalls.length > 0) {
            console.log("");
            console.log(`未校验的调用点（路径实参非字面量，共 ${uncheckedCalls.length} 处；按包装器聚合）：`);
            for (const [w, n] of Object.entries(coverage.byWrapper)) console.log(`  ${w}: ${n} 处`);
            console.log(`  —— 按文件聚合见 path-contract-coverage.json 的 byFile`);
        }

        // MSC 编号格式校验报告
        const mscIssues = validateMSCReferences(findings, backendRoutes);
        if (mscIssues.length > 0) {
            console.log("");
            console.log("─".repeat(84));
            console.log("⚠️  MSC 编号引用疑似张冠李戴（SDK 声称的 MSC 端点后耑未注册）：");
            console.log("─".repeat(84));
            for (const issue of mscIssues) {
                console.log("");
                console.log(`  ${issue.msc}: ${issue.path}`);
                console.log(`    at ${issue.file}:${issue.line}`);
                console.log(`    ${issue.note}`);
                console.log(`    → 建议核对 matrix.org 官方 MSC 列表确认该 MSC 的实际编号。`);
            }
            console.log("");
        }

        if (VERBOSE && outOfScopeCalls.length > 0) {
            console.log("");
            console.log("─".repeat(84));
            console.log("🌐 域外命名空间调用点（不计入 mismatch —— 不属于本 homeserver ledger）：");
            console.log("─".repeat(84));
            for (const [prefix, reason] of Object.entries(OUT_OF_SCOPE_PREFIXES)) {
                const hits = outOfScopeCalls.filter((c) => c.prefix === prefix);
                if (hits.length === 0) continue;
                console.log(`  ${prefix}  —— ${hits.length} 处`);
                console.log(`    ${reason}`);
                for (const h of hits) console.log(`      ${h.method} ${h.fullPath}  @ ${h.file}:${h.line}`);
            }
            console.log("");
        }

        if (VERBOSE && wildcardMatches.length > 0) {
            console.log("");
            console.log("─".repeat(84));
            console.log("🔍 仅靠「字面量段 ↔ 占位符段」规则命中的调用点（语义存疑，请人工复核）：");
            console.log("─".repeat(84));
            console.log("   规则：SDK 的字面量段可以顶掉后端的任意 {占位符} 段。这条规则是为");
            console.log("   `send/m.room.message/{txn}` vs `send/{event_type}/{txn_id}` 这类等价而加的，");
            console.log("   但它同样会把 `/notifications/deactivate` 误认成 `/notifications/{id}`。");
            console.log("");
            for (const w of wildcardMatches) {
                console.log(`  ${w.method} ${w.fullPath}`);
                console.log(`    at ${w.file}:${w.line}`);
            }
            console.log("");
        }

        if (VERBOSE && skipped.length > 0) {
            console.log("");
            console.log("跳过的动态调用（无法静态求值，未参与校验）：");
            const byReason = new Map();
            for (const s of skipped) {
                byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
            }
            for (const [reason, count] of byReason) {
                console.log(`  ${reason}: ${count} 处`);
            }
        }

        if (VERBOSE) {
            console.log("");
            console.log("故意不覆盖的请求包装器（覆盖率声明 —— 想漏掉一类写法必须在此写理由）：");
            for (const [name, reason] of Object.entries(EXCLUDED_WRAPPERS)) {
                console.log(`  ${name}`);
                console.log(`    ${reason}`);
            }
        }
        console.log("");
    }

    // 门禁失败条件：有不匹配、有过期豁免、有未被引用的豁免、或覆盖率基线被突破
    const failed =
        mismatches.length > 0 || expiredWaivers.length > 0 || unusedWaivers.length > 0 || coverageIssues.length > 0;
    process.exit(failed ? 1 : 0);
}

// 顶层裸跑会让 `import` 这个模块直接扫全仓 + 读兄弟仓 ledger + process.exit，
// 所以只在被当作脚本直接执行时才跑（与 scripts/quality/ 下其它门禁同一形态）。
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
