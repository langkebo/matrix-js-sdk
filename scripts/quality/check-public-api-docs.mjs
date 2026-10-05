#!/usr/bin/env node
/**
 * check-public-api-docs.mjs —— 公开 API 文档「棘轮」门禁（源码面）
 *
 * 「公开 API」的口径（与 knip 对齐，勿再放宽）
 * -----------------------------------------
 * 本门禁只统计**从 `package.json` `exports` 可达**的文件中声明的类。
 *
 * 为什么必须这么定：本仓曾同时存在两个方向相反的门禁 —— 本脚本扫整个 `src/`
 * （于是每个 `export` 都算「公开 API」，都要 `@example`），而 `knip` 按 entry
 * 可达性判死代码。两者叠加会催生**反向劳动**：给一批没有任何调用方、本就该删掉的
 * 死代码补 JSDoc，既浪费工时，又把死代码「洗白」成有文档的正式 API。
 *
 * 现在的分工是单一的：**可达性由 knip 判，文档由本门禁判**。不可达的受跟踪类
 * 不再计入统计，而是打印成「未计入清单」提示清理（见 main() 的 unreachable 输出）。
 * 另有 R0 兜底：`package.json` 的每个 export 必须能映射到真实存在的 `src` 文件。
 * 这条规则真的抓到过缺陷 —— `./notification` 指向并不存在的 `lib/notification/`，
 * 即该子路径根本无法解析。
 *
 * 与 check-public-jsdoc-examples.mjs 的分工（两者互补，不是重复）
 * ------------------------------------------------------------
 * | 门禁                            | 覆盖范围                                   | 模式            |
 * | ------------------------------- | ------------------------------------------ | --------------- |
 * | check-public-jsdoc-examples.mjs | docs/api-contract 中「SDK 对齐状态」标记 ✅ 的方法 | 硬性：必须有 @example |
 * | check-public-api-docs.mjs（本文件）| 包入口可达的 Manager / MatrixClient 公开方法 | 棘轮：缺口数不得增长 |
 *
 * 前者回答「我文档里承诺的 API 有没有示例」；后者回答
 * 「我整体暴露出去的 API 面有没有在持续变差」。
 *
 * 为什么用棘轮而不是硬性要求
 * --------------------------
 * 全量公开方法规模在 2200 量级，其中约 6 成缺 JSDoc。一次性要求全部补齐
 * 既不现实，也会逼出「用空 @example 占位凑数」的注水行为。棘轮的作用是
 * **单调收敛**：每个类的缺口数只能下降不能上升，新增方法必须自带文档。
 *
 * 五条规则（缺一不可）
 * ------------------
 * - R0 `package.json` 的某个 export 无法映射到已存在的 src 文件 -> 失败（导出面撒谎）
 * - R1 出现台账未登记的新公开类      -> 失败（新 Manager 必须显式登记，迫使被看见）
 * - R2 某类缺口数高于台账值          -> 失败（新增/改动的方法必须补文档）
 * - R3 某类缺口数低于台账值          -> 失败（**必须下调台账**，防止台账退化成永不收敛的地板）
 * - R4 台账登记了已不存在的类        -> 失败（清理）
 *
 * R3 是这套机制的关键：它逼着台账跟着现实走，而不是变成一个只会「够宽松」的许可名单。
 *
 * 用法
 * ----
 *   node scripts/quality/check-public-api-docs.mjs                 # 检查
 *   node scripts/quality/check-public-api-docs.mjs --json          # JSON 摘要
 *   node scripts/quality/check-public-api-docs.mjs --emit-plan p.md # 输出待补清单
 *   node scripts/quality/check-public-api-docs.mjs --write-ledger   # 只在无恶化时下调台账
 *
 * 退出码：0 通过；1 命中任一规则。
 */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const PROJECT_ROOT = process.cwd();
const SRC_ROOT = path.join(PROJECT_ROOT, "src");
const LEDGER_PATH = path.join(PROJECT_ROOT, "scripts/quality/public-api-docs-ledger.json");

/**
 * 台账 schema 版本。改动字段含义时必须递增，避免旧台账被误读。
 *
 * v2 (2026-10-05)：指标口径从「按声明计数」改为「按重载组计数」。
 *   TS 重载是多个 MethodDeclaration 共享同一名字，按声明计数会让
 *   sendTextMessage 这类方法被算 3 次、指标虚高。口径变更后数字必然变化，
 *   因此必须升版，让旧台账显式失效而不是被静默沿用。
 *   同一版本内另加了「`_` 前缀方法不计入」的约定：`_setParent` 这类跨子管理器
 *   回引方法虽然语法上是 public，但按命名约定属内部实现，不属对外 API 面。
 *
 * v3 (2026-10-05)：统计范围从「整个 src/」收窄为「从 package.json exports 可达」。
 *   旧口径把不可达的死代码也算作公开 API，与 knip 的死代码判定直接冲突，
 *   会逼出「给死代码补 JSDoc」的反向劳动。收窄后**类数必然减少**，
 *   因此同样必须升版（旧台账里的类会大面积触发 R4，不是真的被删了）。
 */
const LEDGER_SCHEMA_VERSION = 3;

/**
 * 以下划线开头的方法视为内部实现。
 *
 * 判据来自命名约定而非访问修饰符：本仓库的 sub-manager 之间存在 `_setParent`
 * 这类回引方法，TS 上必须是 public（跨实例调用），但对使用方并非 API。
 * 注意这只是**排除统计**，不代表这类方法应当保持 public —— 更彻底的修法是
 * 加 `@internal` 或改 `protected` + 工厂注入，属于单独的清理项。
 */
function isConventionInternal(methodName) {
    return methodName.startsWith("_");
}

/** 纳入统计的类：以 Manager 结尾，或核心客户端类。 */
function isTrackedClassName(name) {
    return /Manager$/.test(name) || name === "MatrixClient";
}

const SKIP_DIR_SEGMENTS = ["__generated__", "node_modules"];

function walk(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIR_SEGMENTS.includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full, out);
        } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") && !entry.name.includes(".spec.")) {
            out.push(full);
        }
    }
    return out;
}

/**
 * `package.json` 声明的包入口 -> 真实存在的 src 文件。
 *
 * 来源是 `exports`（全部子路径）∪ 顶层入口字段（`main` / `browser` / `module` / `types`）。
 * `./lib/xxx.js` 映射为 `src/xxx.ts`（含 `./lib/xxx/index.js` -> `src/xxx/index.ts`）。
 *
 * 映射不到真实文件的条目计入 `broken` —— 这正是 R0 要拦的情况：导出面声明了一个
 * 根本无法解析的子路径（本仓真实发生过：`./notification` -> `lib/notification/`，
 * 而实际目录是 `notifications`）。只跟踪 `./lib/` 前缀；构建期生成的原生产物
 * （`.node`、纯数据文件等）不参与可达性推导。
 *
 * 口径政策：**只有这里登记过的入口才算「对外」**。某个类若确实是对外 API，
 * 正确做法是把它加进 `package.json`（exports 或对应模块的 index），而不是让
 * 本门禁去猜 —— 否则又会退回「整个 src 都算公开 API」的旧口径。
 */
export function resolvePackageExports() {
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8"));

    const declared = [];
    for (const [key, value] of Object.entries(pkg.exports ?? {})) {
        const target = typeof value === "string" ? value : (value?.import ?? value?.default ?? value?.require);
        if (typeof target === "string") declared.push({ key, target });
    }
    for (const field of ["main", "browser", "module", "types", "typings"]) {
        const value = pkg[field];
        if (typeof value === "string") {
            declared.push({ key: `<${field}>`, target: value });
        } else if (value && typeof value === "object") {
            for (const [sub, subTarget] of Object.entries(value)) {
                if (typeof subTarget === "string") declared.push({ key: `<${field}>.${sub}`, target: subTarget });
            }
        }
    }

    const entries = [];
    const broken = [];
    const seen = new Set();
    for (const { key, target } of declared) {
        if (!target.startsWith("./lib/")) continue;
        // 顶层 `types` 字段指向 `./lib/index.d.ts`，同样要落到 `src/index.ts`
        const rel = target
            .slice("./lib/".length)
            .replace(/\.d\.ts$/, ".ts")
            .replace(/\.js$/, ".ts");
        const srcFile = path.join(PROJECT_ROOT, "src", rel);
        if (seen.has(srcFile)) continue;
        seen.add(srcFile);
        if (fs.existsSync(srcFile)) {
            entries.push({ key, target, srcFile });
        } else {
            broken.push({ key, target, expected: path.relative(PROJECT_ROOT, srcFile) });
        }
    }
    return { entries, broken };
}

/** 收集相对说明符：`from "./x"`、`export ... from "../y"`、`import("../z/index.js")`。 */
export function relativeSpecifiers(text) {
    const out = new Set();
    const re = /\b(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g;
    let match;
    while ((match = re.exec(text)) !== null) out.add(match[1]);
    return out;
}

/** 把相对说明符解析成磁盘上的 .ts/.tsx 文件；解析不到返回 null。 */
export function resolveSpecifier(fromFile, spec) {
    const base = path.resolve(path.dirname(fromFile), spec.replace(/\.js$/, ""));
    const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return null;
}

/**
 * 从若干根文件出发，沿**相对**导入做传递闭包，得到「包入口可达」的源文件集合。
 *
 * 只跟踪相对说明符：裸包名（`rxjs` 之类）不属于本仓，与本口径无关。
 */
export function computeReachableFiles(rootFiles) {
    const reachable = new Set();
    const queue = [...rootFiles];
    while (queue.length > 0) {
        const file = queue.pop();
        if (!file || reachable.has(file)) continue;
        reachable.add(file);
        let text;
        try {
            text = fs.readFileSync(file, "utf8");
        } catch {
            continue;
        }
        for (const spec of relativeSpecifiers(text)) {
            const resolved = resolveSpecifier(file, spec);
            if (resolved && !reachable.has(resolved)) queue.push(resolved);
        }
    }
    return reachable;
}

/**
 * 模块根：`src/manager-extensions/index.ts` 以**字符串参数**形式动态 import 各模块
 * （`import("../<module>/index.js")`），静态分析追不到，因此显式从生成物里读出
 * `module` 名并映射为 `src/<module>/index.ts`。
 *
 * 这样模块清单的唯一真相源仍是生成器 `scripts/generate-manager-extensions.mjs`，
 * 本脚本不必再维护一份会漂移的手工镜像。
 */
export function managerModuleRoots() {
    const hub = path.join(SRC_ROOT, "manager-extensions/index.ts");
    if (!fs.existsSync(hub)) return [hub];
    const text = fs.readFileSync(hub, "utf8");
    const roots = [hub];
    for (const match of text.matchAll(/module:\s*"([^"]+)"/g)) {
        const candidate = path.join(SRC_ROOT, match[1], "index.ts");
        if (fs.existsSync(candidate)) roots.push(candidate);
    }
    return roots;
}

function getJsDocTags(node) {
    return ts.getJSDocTags(node).map((tag) => tag.tagName.text);
}

function hasJsDoc(node) {
    return ts.getJSDocCommentsAndTags(node).length > 0;
}

/** 方法体内是否有 throw（不深入嵌套 class，避免把内部类的 throw 记到外层方法头上）。 */
function bodyThrows(node) {
    let found = false;
    function visit(child) {
        if (found) return;
        if (ts.isThrowStatement(child)) {
            found = true;
            return;
        }
        if (ts.isClassDeclaration(child) || ts.isFunctionDeclaration(child)) return;
        ts.forEachChild(child, visit);
    }
    if (node.body) visit(node.body);
    return found;
}

/**
 * 取声明起始处的 1-based 行号。
 *
 * 注意：`node.getStart(sourceFile)` 返回的是**字符偏移**，不是行号。
 * 直接当行号输出会让「file:line」指到完全无关的位置，务必经
 * getLineAndCharacterOfPosition 转换。
 */
function declarationLine(node, sourceFile) {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function isNonPublic(member) {
    return member.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword,
    );
}

/**
 * 扫描单个源文件，返回 per-class 缺口统计。
 * 形态：Map<classOwner, { missingJsDoc, missingExample, throwsWithoutTag, details: [...] }>
 *
 * 重载处理：TS 的重载是多个独立的 MethodDeclaration 共享同一名字。
 * 若按声明逐个计数，sendTextMessage 这类 3 个重载的方法会被算 3 次，指标虚高
 * （且实际补文档时只需在重载签名上写一次）。因此这里**按方法名分组**：
 * 只要组内任一声明带 JSDoc，就认为该方法已文档化。
 */
export function analyzeSourceFile(sourceText, filePath = "<memory>") {
    const result = new Map();
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    function ensure(owner) {
        if (!result.has(owner)) {
            result.set(owner, { missingJsDoc: 0, missingExample: 0, throwsWithoutTag: 0, details: [] });
        }
        return result.get(owner);
    }

    function visit(node) {
        if (ts.isClassDeclaration(node) && node.name?.text && isTrackedClassName(node.name.text)) {
            const owner = node.name.text;

            // 先按方法名分组
            const groups = new Map();
            for (const member of node.members) {
                if (!ts.isMethodDeclaration(member)) continue;
                if (!member.name || !ts.isIdentifier(member.name)) continue;
                if (isNonPublic(member)) continue;

                const name = member.name.text;
                if (isConventionInternal(name)) continue;
                if (!groups.has(name)) groups.set(name, []);
                groups.get(name).push(member);
            }

            for (const [method, declarations] of groups) {
                const allTags = declarations.flatMap((d) => getJsDocTags(d));
                // 已废弃的转发壳不要求示例：它们的存在意义就是指向新 API。
                if (allTags.includes("deprecated")) continue;

                const documented = declarations.some((d) => hasJsDoc(d));
                const hasExample = allTags.includes("example");
                const hasThrowsTag = allTags.includes("throws");
                const throwsInBody = declarations.some((d) => bodyThrows(d));
                // 定位用：优先取带 JSDoc 的那条声明，否则取第一条
                const anchor = declarations.find((d) => hasJsDoc(d)) ?? declarations[0];

                const bucket = ensure(owner);
                if (!documented) {
                    bucket.missingJsDoc += 1;
                    bucket.details.push({
                        method,
                        kind: "missingJsDoc",
                        file: filePath,
                        line: declarationLine(anchor, sourceFile),
                    });
                    continue;
                }
                if (!hasExample) {
                    bucket.missingExample += 1;
                    bucket.details.push({
                        method,
                        kind: "missingExample",
                        file: filePath,
                        line: declarationLine(anchor, sourceFile),
                    });
                }
                if (throwsInBody && !hasThrowsTag) {
                    bucket.throwsWithoutTag += 1;
                    bucket.details.push({
                        method,
                        kind: "throwsWithoutTag",
                        file: filePath,
                        line: declarationLine(anchor, sourceFile),
                    });
                }
            }
        }
        ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return result;
}

/**
 * 扫描工作区，返回 `{ tracked, skipped }`。
 *
 * - `tracked`：**包入口可达**文件里的 per-class 缺口统计（进棘轮台账）。
 * - `skipped`：不可达文件里出现的受跟踪类名（如 `FooManager`）。它们**不计入**统计，
 *   只作为「疑似死代码」提示清理 —— 可达性归 knip 判，文档门禁不该替它兜底，
 *   否则又会退化成「给死代码补 JSDoc」的反向劳动。
 *
 * 仍是每个文件只解析一次：不可达文件也要过 TS 才能知道它声明了哪些类。
 */
function analyzeWorkspace(reachableFiles) {
    const tracked = new Map();
    const skipped = new Set();
    for (const file of walk(SRC_ROOT)) {
        const inScope = !reachableFiles || reachableFiles.has(file);
        const rel = path.relative(PROJECT_ROOT, file);
        for (const [owner, stats] of analyzeSourceFile(fs.readFileSync(file, "utf8"), rel)) {
            if (!inScope) {
                skipped.add(owner);
                continue;
            }
            if (!tracked.has(owner)) {
                tracked.set(owner, { missingJsDoc: 0, missingExample: 0, throwsWithoutTag: 0, details: [] });
            }
            const target = tracked.get(owner);
            target.missingJsDoc += stats.missingJsDoc;
            target.missingExample += stats.missingExample;
            target.throwsWithoutTag += stats.throwsWithoutTag;
            target.details.push(...stats.details);
        }
    }
    return { tracked, skipped };
}

function loadLedger() {
    if (!fs.existsSync(LEDGER_PATH)) return { ledger: null, mismatch: false, foundVersion: null };
    const ledger = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));
    if (ledger.schemaVersion !== LEDGER_SCHEMA_VERSION) {
        // 口径变了，旧数字不可比。检查模式必须失败（不能拿两套口径的数字互相比较），
        // 但重建台账的路径需要放行，否则升版时无法自举。
        return { ledger: null, mismatch: true, foundVersion: ledger.schemaVersion };
    }
    return { ledger, mismatch: false, foundVersion: ledger.schemaVersion };
}

const METRICS = ["missingJsDoc", "missingExample", "throwsWithoutTag"];

function evaluate(actual, ledger) {
    const violations = [];
    const baseline = ledger.ratchet;

    // R2：不得超过台账
    for (const [owner, values] of actual) {
        const expected = baseline[owner];
        if (!expected) {
            // 新类必须显式登记，否则换个名字就能绕过棘轮
            violations.push({
                rule: "R1",
                owner,
                detail:
                    `台账未登记该类（实际 ${METRICS.map((m) => `${m}=${values[m]}`).join(" ")}）。` +
                    `请运行 --write-ledger 登记，或在加入前先把公开方法补齐。`,
            });
            continue;
        }
        for (const metric of METRICS) {
            if (values[metric] > expected[metric]) {
                violations.push({
                    rule: "R2",
                    owner,
                    detail:
                        `${metric} 由 ${expected[metric]} 增至 ${values[metric]}（+${values[metric] - expected[metric]}）——` +
                        `新增/改动的公开方法必须补 JSDoc。`,
                });
            }
        }
    }

    // R3：低于台账必须下调（棘轮收紧）
    for (const [owner, expected] of Object.entries(baseline)) {
        const values = actual.get(owner);
        if (!values) {
            violations.push({
                rule: "R4",
                owner,
                detail: "台账登记的类在 src 中已不存在，请运行 --write-ledger 清理。",
            });
            continue;
        }
        for (const metric of METRICS) {
            if (values[metric] < expected[metric]) {
                violations.push({
                    rule: "R3",
                    owner,
                    detail:
                        `${metric} 由 ${expected[metric]} 降至 ${values[metric]} —— 缺口已收窄，` +
                        `请运行 --write-ledger 下调台账（或手工更新），否则棘轮会失去意义。`,
                });
            }
        }
    }

    return violations;
}

function buildLedger(actual, previous) {
    const ratchet = {};
    for (const [owner, values] of [...actual.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        ratchet[owner] = {};
        for (const metric of METRICS) ratchet[owner][metric] = values[metric];
    }
    return {
        schemaVersion: LEDGER_SCHEMA_VERSION,
        capturedAt: new Date().toISOString().slice(0, 10),
        previousCapturedAt: previous?.capturedAt ?? null,
        note:
            "公开 API 文档棘轮台账。本文件是「允许存在的缺口上限」，只能下降不能上升。" +
            "用 node scripts/quality/check-public-api-docs.mjs --write-ledger 更新，" +
            "该命令在检测到任何指标恶化时会拒绝写入。",
        ratchet,
    };
}

/** --write-ledger 只允许「不恶化」的更新，避免这条路径变成放水口。 */
function writeLedger(actual, previous) {
    if (previous) {
        const regressions = [];
        for (const [owner, values] of actual) {
            const expected = previous.ratchet[owner];
            if (!expected) continue;
            for (const metric of METRICS) {
                if (values[metric] > expected[metric]) {
                    regressions.push(`${owner}.${metric}: ${expected[metric]} -> ${values[metric]}`);
                }
            }
        }
        if (regressions.length > 0) {
            console.error("[public-api-docs] 拒绝写入台账：以下指标恶化。请先补齐文档，而不是放宽台账。");
            for (const r of regressions) console.error(`  - ${r}`);
            process.exit(1);
        }
    }
    fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
    fs.writeFileSync(LEDGER_PATH, `${JSON.stringify(buildLedger(actual, previous), null, 4)}\n`);
    console.log(`[public-api-docs] 台账已写入 ${path.relative(PROJECT_ROOT, LEDGER_PATH)}`);
}

function emitPlan(actual, outPath) {
    const lines = [
        "# 公开 API 文档缺口清单",
        "",
        "由 `node scripts/quality/check-public-api-docs.mjs --emit-plan <path>` 生成。",
        "按缺口总数降序排列；`missingJsDoc` 优先于 `missingExample`（前者连摘要都没有）。",
        "",
        "| 类 | 缺 JSDoc | 缺 @example | 有 throw 缺 @throws | 合计 |",
        "| :--- | ---: | ---: | ---: | ---: |",
    ];
    const rows = [...actual.entries()]
        .map(([owner, v]) => ({ owner, ...v, total: v.missingJsDoc + v.missingExample + v.throwsWithoutTag }))
        .sort((a, b) => b.total - a.total);
    for (const row of rows) {
        lines.push(
            `| ${row.owner} | ${row.missingJsDoc} | ${row.missingExample} | ${row.throwsWithoutTag} | ${row.total} |`,
        );
    }
    lines.push("", "## 明细（前 200 条）", "");
    let count = 0;
    for (const row of rows) {
        if (count >= 200) break;
        for (const d of row.details) {
            if (count >= 200) break;
            lines.push(`- [ ] \`${d.file}:${d.line}\` ${row.owner}.${d.method} — ${d.kind}`);
            count += 1;
        }
    }
    fs.writeFileSync(outPath, `${lines.join("\n")}\n`);
    console.log(`[public-api-docs] 清单已写入 ${outPath}（${count} 条明细）`);
}

function main() {
    const args = process.argv.slice(2);
    const jsonMode = args.includes("--json");
    const emitPlanIdx = args.indexOf("--emit-plan");
    const writeLedgerFlag = args.includes("--write-ledger");

    // R0：导出面必须先能映射到真实存在的 src 文件，再谈文档。
    // 一个指向不存在产物的子路径（本仓真实发生过）比缺 JSDoc 严重得多。
    const { entries: exportEntries, broken: brokenExports } = resolvePackageExports();
    if (brokenExports.length > 0) {
        console.error("[public-api-docs] R0 违规：package.json exports 指向不存在的 src 文件。");
        for (const b of brokenExports) {
            console.error(`  - exports["${b.key}"] = "${b.target}" -> 期望 ${b.expected}（不存在）`);
        }
        process.exit(1);
    }

    // 口径：可从包入口到达的源文件 = package.json exports 入口 ∪ manager-extensions hub
    // ∪ 其 MODULE_DEFS 模块根（动态 import 静态追不到，故显式取模块列表）。
    const roots = [...new Set([...exportEntries.map((e) => e.srcFile), ...managerModuleRoots()])].filter((f) =>
        fs.existsSync(f),
    );
    const reachable = computeReachableFiles(roots);
    const { tracked: actual, skipped } = analyzeWorkspace(reachable);
    const { ledger: previous, mismatch, foundVersion } = loadLedger();

    if (emitPlanIdx >= 0) {
        const outPath = args[emitPlanIdx + 1];
        if (!outPath) {
            console.error("[public-api-docs] --emit-plan 需要一个输出路径");
            process.exit(1);
        }
        emitPlan(actual, outPath);
        return;
    }

    if (writeLedgerFlag) {
        if (mismatch) {
            console.warn(
                `[public-api-docs] 台账 schemaVersion=${foundVersion} 已过时（当前为 v${LEDGER_SCHEMA_VERSION}），` +
                    `将整体重建并跳过棘轮比对。请 review 生成的 diff：口径变更会导致数字整体变动。`,
            );
        }
        writeLedger(actual, previous);
        return;
    }

    if (mismatch) {
        console.error(
            `[public-api-docs] 台账 schemaVersion=${foundVersion} 与本脚本期望的 ${LEDGER_SCHEMA_VERSION} 不一致。` +
                `\n  统计口径已变更（v3 起只统计包入口可达的文件），旧台账不可比。请运行：` +
                `\n    node scripts/quality/check-public-api-docs.mjs --write-ledger` +
                `\n  并在 PR 中 review 台账 diff（口径变更会整体改变数字，属预期）。`,
        );
        process.exit(1);
    }

    if (!previous) {
        console.error(
            "[public-api-docs] 台账不存在。首次接入请运行：\n" +
                "  node scripts/quality/check-public-api-docs.mjs --write-ledger",
        );
        process.exit(1);
    }

    const violations = evaluate(actual, previous);
    const totals = [...actual.values()].reduce(
        (acc, v) => ({
            missingJsDoc: acc.missingJsDoc + v.missingJsDoc,
            missingExample: acc.missingExample + v.missingExample,
            throwsWithoutTag: acc.throwsWithoutTag + v.throwsWithoutTag,
        }),
        { missingJsDoc: 0, missingExample: 0, throwsWithoutTag: 0 },
    );

    const unreachable = [...skipped].filter((owner) => !actual.has(owner)).sort();

    if (jsonMode) {
        console.log(
            JSON.stringify(
                {
                    scope: {
                        exportEntries: exportEntries.length,
                        reachableFiles: reachable.size,
                        unreachableTrackedClasses: unreachable,
                    },
                    totals,
                    classes: Object.fromEntries(actual),
                    violations,
                },
                null,
                4,
            ),
        );
    } else {
        console.log(
            `[public-api-docs] 口径=包入口可达（${exportEntries.length} 个 export 入口 / ${reachable.size} 个可达文件）；` +
                `已纳入 ${actual.size} 个类；缺口 ${totals.missingJsDoc} 无 JSDoc / ` +
                `${totals.missingExample} 无 @example / ${totals.throwsWithoutTag} throw 缺 @throws`,
        );
        if (unreachable.length > 0) {
            // 只是提示，不算违规：可达性归 knip 判（`pnpm lint:knip`）。这里故意不要求补文档，
            // 否则就等于催着给死代码写 JSDoc 把它洗白。
            console.log(
                `[public-api-docs] ℹ️ 未计入 ${unreachable.length} 个不可达的受跟踪类` +
                    `（不要求补文档；请交给 knip / 清理）：${unreachable.join(", ")}`,
            );
        }
        if (violations.length > 0) {
            console.error(`[public-api-docs] ${violations.length} 项违规：`);
            for (const v of violations) {
                console.error(`  [${v.rule}] ${v.owner}: ${v.detail}`);
            }
        } else {
            console.log("[public-api-docs] ✅ 无违规（缺口未增长，且台账与现实一致）");
        }
    }

    process.exit(violations.length > 0 ? 1 : 0);
}

// 仅在被直接执行时跑 main，便于单测导入 analyzeSourceFile
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
    main();
}
