/**
 * spec-import-graph.mjs —— 「源文件是否被测试触及」的单一真相源
 *
 * 为什么需要这个模块:
 *   本仓 spec 命名与源文件**不同名**（`src/client.ts` ← `spec/unit/matrix-client.spec.ts`、
 *   `src/room/RoomManager.ts` ← `spec/unit/room-manager.spec.ts`、
 *   `src/three-pids/` ← `spec/unit/threepids.spec.ts`）。
 *   因此任何"按 basename 猜有没有测试"的实现都必然产出大量假阳性。
 *
 * 历史上这里踩过两个坑，二者叠加导致 COVERAGE_WEAK_FILES.md 出现
 * 「Found 471 source files and 0 test files」级别的误报:
 *   1. `path.extname("foo.spec.ts")` 返回 `".ts"`，所以
 *      `exts.includes(path.extname(name))` 用 `[".spec.ts"]` 永远为 false ⇒ 扫到 0 个 spec。
 *   2. 即使扫到了，按 basename 匹配也认不出上面那些不同名的对应关系。
 *
 * 本模块提供两个可验证信号:
 *   A. 直接 spec：spec/unit/<镜像路径>/<basename>.spec.ts 或扁平 <basename>.spec.ts
 *   B. import 图：任意 spec 文件 import 了该源文件（真实可达性证据）
 */

import fs from "node:fs";
import path from "node:path";

/** 某个文件是否是测试文件（Vitest 可识别后缀）。 */
export const isSpecFile = (f) => f.endsWith(".spec.ts") || f.endsWith(".spec.test.ts") || f.endsWith(".test.ts");

/** 递归遍历目录，按**后缀**收集文件（不要传 path.extname 的产物如 ".spec.ts"）。 */
export function walk(dir, suffixes = [".ts"]) {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...walk(full, suffixes));
        } else if (entry.isFile() && suffixes.some((s) => entry.name.endsWith(s))) {
            out.push(full);
        }
    }
    return out;
}

/**
 * 收集 src/ 下需要被测试覆盖的源文件。
 *
 * 注意：`src/**\/__generated__/acceptance.spec.ts` 这类生成出来的测试文件也在 src 下，
 * 必须排除，否则它们会被当成"未被测试的源文件"制造假阳性。
 */
export function collectSourceFiles(srcDir) {
    return walk(srcDir, [".ts"]).filter((f) => !f.endsWith(".d.ts") && !isSpecFile(f));
}

/** 收集 spec 文件。 */
export function collectSpecFiles(specDir) {
    return walk(specDir, [".ts"]).filter(isSpecFile);
}

/**
 * 收集**全部** spec 文件：既包括 `spec/`，也包括放在源文件旁边的 `src/**\/*.spec.ts`。
 *
 * ⚠️ 只扫 `spec/` 会造成假阳性：本仓确实有 in-src 测试
 * （如 `src/client/worker/worker.spec.ts` 与 `src/client/worker/worker.ts` 同级，
 * `src/managers/cache-manager.spec.ts`、`src/http-api/__tests__/fetch.test.ts`）。
 * 漏掉它们会让这些源文件被误判为"无任何 spec 触及"，进而被塞进覆盖台账。
 * Vitest 默认 include 是 `**\/*.{test,spec}.*`，未在 vitest.config.ts 里收窄，
 * 所以这些 in-src spec 确实在 `pnpm test` 里执行。
 */
export function collectAllSpecFiles(specRoot, srcDir) {
    return [...collectSpecFiles(specRoot), ...collectSpecFiles(srcDir)].sort();
}

/**
 * 解析全部 spec 的相对 import，映射回 src/ 下的**相对路径集合**。
 *
 * 只解析相对说明符（`./` / `../`），因为只有它们能确定地映射到仓内文件。
 */
export function buildSpecImportSet(srcDir, specFiles) {
    const imported = new Set();
    const importRe = /from\s+["']([^"']+)["']/g;
    for (const spec of specFiles) {
        const specDirPath = path.dirname(spec);
        const content = fs.readFileSync(spec, "utf8");
        let m;
        while ((m = importRe.exec(content)) !== null) {
            const specifier = m[1];
            if (!specifier.startsWith(".")) continue;
            const resolvedBase = path.resolve(specDirPath, specifier);
            const variants = [
                `${resolvedBase}.ts`,
                path.join(resolvedBase, "index.ts"),
                resolvedBase.replace(/\.js$/, ".ts"),
            ];
            for (const v of variants) {
                const rel = path.relative(srcDir, v);
                if (!rel.startsWith("..") && fs.existsSync(v)) {
                    imported.add(rel);
                }
            }
        }
    }
    return imported;
}

/**
 * 源文件是否有"直接 spec"（镜像路径或扁平同名）。
 * @param {string} sourceFile 绝对路径
 */
export function hasDirectSpec(sourceFile, srcDir, specDir) {
    const rel = path.relative(srcDir, sourceFile);
    const dir = path.dirname(rel);
    const base = path.basename(sourceFile, ".ts");
    const unitDir = path.join(specDir, "unit");
    const candidates = [
        path.join(unitDir, dir, `${base}.spec.ts`),
        path.join(unitDir, dir, `${base}.test.ts`),
        path.join(unitDir, `${base}.spec.ts`),
        path.join(unitDir, `${base}.test.ts`),
    ];
    if (base === "index") {
        const parent = path.basename(dir);
        candidates.push(path.join(unitDir, `${parent}.spec.ts`));
    }
    return candidates.some((c) => fs.existsSync(c));
}

/**
 * 建立「源文件相对路径 -> 是否被任何 spec 触及」的判定函数。
 * 同时缓存 import 图，避免每个文件重复解析。
 */
export function createCoverageSignals(srcDir, specDir) {
    const sourceFiles = collectSourceFiles(srcDir);
    const specFiles = collectAllSpecFiles(specDir, srcDir);
    const importedBySpec = buildSpecImportSet(srcDir, specFiles);

    const isTouched = (sourceFile) => {
        const rel = path.relative(srcDir, sourceFile);
        return hasDirectSpec(sourceFile, srcDir, specDir) || importedBySpec.has(rel);
    };

    return { sourceFiles, specFiles, importedBySpec, isTouched };
}

/**
 * 模块级信号：`src/<module>/` 是否被任何 spec 触及（任一文件被 import，或存在直接 spec）。
 * 这比"模块名 == spec 文件名"可靠得多（后者认不出 `three-pids` ← `threepids.spec.ts`）。
 */
export function moduleIsTouched(moduleName, srcDir, specDir, signals) {
    const modulePath = path.join(srcDir, moduleName);
    if (!fs.existsSync(modulePath)) return false;
    if (signals.sourceFiles.some((f) => f.startsWith(modulePath + path.sep) && signals.isTouched(f))) return true;
    return signals.specFiles.some((f) => f.startsWith(path.join(specDir, moduleName) + path.sep));
}
