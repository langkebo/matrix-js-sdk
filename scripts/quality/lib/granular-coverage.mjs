#!/usr/bin/env node
/**
 * granular-coverage.mjs —— 18 个 `check-*-granular-coverage.mjs` 的共享引擎
 *
 * 背景
 * ----
 * 这 18 个门禁曾是**同一模板的 18 份副本**：`readRelative` / `escapeRegex` / `hasMethod` /
 * `collectMissing` 四个 helper 与整个 main 循环逐字重复，各文件只有 `CHECKS` 数据不同
 * （审计 §7.13-5）。副本的代价是修一处 bug 要改 18 个文件——事实上已经分叉过一次：
 * `check-room-space-search-granular-coverage.mjs` 的 `hasMethod` 用的是宽松
 * `includes` 判据，其余 17 份用的是带词边界的正则判据（已实测两者在本仓数据上判定一致，
 * 故本库统一为严格判据）。
 *
 * 现在 18 个门禁文件只保留 `CHECKS` 数据与一行 `runGranularCoverage({ title, checks })`，
 * 判定逻辑全部收敛到这里，由 `spec/unit/granular-coverage-gate.spec.ts` 统一守护。
 *
 * 判据语义（与原 17 份副本逐字一致，勿改）
 * ------------------------------------
 * - `hasMethod`：owner 文件里"方法存在"= 满足以下任一形态——
 *   调用 `foo(` / 泛型调用 `foo<T>(` / 属性简写 `foo:` / 委托调用 `.foo(`，
 *   均带词边界（`resetFoo(` 不会误命中 `foo`）。
 * - 测试命中：测试文件文本里出现 `` `foo(` `` 即算（沿用原语义，宽松是有意的——
 *   测试里常见 `expect(vm.foo).toHaveBeenCalled()` 这类非调用形态）。
 *
 * 等价性证明方式
 * --------------
 * 判定类重构必须先存金标准再对拍（审计 §7.12）：
 *
 *   node scripts/audit/gate-golden.mjs capture gran-cas --script quality:cas
 *   # …重构…
 *   node scripts/audit/gate-golden.mjs verify gran-cas   # 逐字节对拍
 *
 * 本轮 18/18 全部通过（stdout 逐字节一致）。
 */

import fs from "node:fs";
import path from "node:path";

/**
 * 读取 `rootDir` 相对路径的文件内容。缺文件时抛错（沿用原实现：让门禁直接红）。
 */
export function readRelative(rootDir, file) {
    return fs.readFileSync(path.join(rootDir, file), "utf8");
}

/** 转义正则元字符（方法名进入 RegExp 前必须过这一步）。 */
export function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * owner 文件里是否"存在"该方法（严格判据，带词边界）。
 */
export function hasMethod(content, method) {
    const escapedMethod = escapeRegex(method);
    const methodCall = new RegExp(`\\b${escapedMethod}(?:<[^>]+>)?\\s*\\(`);
    const propertyShape = new RegExp(`\\b${escapedMethod}\\s*:`);
    const delegatedCall = new RegExp(`\\.${escapedMethod}(?:<[^>]+>)?\\s*\\(`);
    return methodCall.test(content) || propertyShape.test(content) || delegatedCall.test(content);
}

/**
 * 测试文件里是否有该方法的测试命中（宽松判据，沿用原语义）。
 */
export function hasTestHit(content, method) {
    return content.includes(`${method}(`);
}

/** 返回不满足谓词的元素（保持原顺序与重复性）。 */
export function collectMissing(items, predicate) {
    return items.filter((item) => !predicate(item));
}

/**
 * 纯求值：跑完整个 CHECKS 结构，返回 `{ failures, totalGroups, passedGroups }`。
 * 不打印、不碰退出码——供 spec 与自定义报告复用。
 *
 * @param checks 与原 18 份门禁相同的 CHECKS 数据结构
 * @param opts.rootDir owner/test 文件的解析根（默认 `process.cwd()`）
 * @param opts.readFile 可注入的读取函数（(file) => string），测试用
 */
export function evaluateGranularCoverage(checks, opts = {}) {
    const rootDir = opts.rootDir ?? process.cwd();
    const read = opts.readFile ?? ((file) => readRelative(rootDir, file));

    const failures = [];
    let totalGroups = 0;
    let passedGroups = 0;

    for (const moduleCheck of checks) {
        for (const group of moduleCheck.groups) {
            totalGroups += 1;
            const ownerContent = read(group.ownerFile);
            const testContents = group.testFiles.map((file) => ({ file, content: read(file) }));

            const missingMethods = collectMissing(group.methods, (method) => hasMethod(ownerContent, method));
            const methodsWithoutTests = collectMissing(group.methods, (method) =>
                testContents.some(({ content }) => hasTestHit(content, method)),
            );

            if (missingMethods.length === 0 && methodsWithoutTests.length === 0) {
                passedGroups += 1;
                continue;
            }

            failures.push({
                module: moduleCheck.module,
                group: group.name,
                ownerFile: group.ownerFile,
                missingMethods,
                methodsWithoutTests,
            });
        }
    }

    return { failures, totalGroups, passedGroups };
}

/**
 * 完整门禁入口：求值 + 打印 + 置退出码。
 *
 * stdout 与重构前 18 份副本**逐字节一致**（金标准已证）——改动本函数的任何输出
 * 都会让 `gate-golden verify` 报差异，请先存金标准再改。
 *
 * @param cfg.title 汇总头部标题（如 `"CAS Granular Coverage"`）
 * @param cfg.checks CHECKS 数据
 * @param cfg.rootDir 解析根（默认 `process.cwd()`，保持原实现行为）
 * @returns 求值结果（便于调用方进一步处理）
 */
export function runGranularCoverage({ title, checks, rootDir } = {}) {
    const failures = [];
    let totalGroups = 0;
    let passedGroups = 0;

    console.log(`=== ${title} ===`);

    const read =
        rootDir === undefined ? (file) => readRelative(process.cwd(), file) : (file) => readRelative(rootDir, file);

    for (const moduleCheck of checks) {
        console.log(`\n[${moduleCheck.module}]`);

        for (const group of moduleCheck.groups) {
            totalGroups += 1;
            const ownerContent = read(group.ownerFile);
            const testContents = group.testFiles.map((file) => ({ file, content: read(file) }));

            const missingMethods = collectMissing(group.methods, (method) => hasMethod(ownerContent, method));
            const methodsWithoutTests = collectMissing(group.methods, (method) =>
                testContents.some(({ content }) => hasTestHit(content, method)),
            );

            if (missingMethods.length === 0 && methodsWithoutTests.length === 0) {
                passedGroups += 1;
                console.log(`  PASS: ${group.name}`);
                continue;
            }

            console.log(`  FAIL: ${group.name}`);
            if (missingMethods.length > 0) {
                console.log(`    missing methods in ${group.ownerFile}: ${missingMethods.join(", ")}`);
            }
            if (methodsWithoutTests.length > 0) {
                console.log(`    methods without test hits: ${methodsWithoutTests.join(", ")}`);
            }

            failures.push({
                module: moduleCheck.module,
                group: group.name,
                ownerFile: group.ownerFile,
                missingMethods,
                methodsWithoutTests,
            });
        }
    }

    console.log(`\nGroups passed: ${passedGroups}/${totalGroups}`);

    if (failures.length > 0) {
        console.log("\nGranular coverage gaps detected.");
        process.exitCode = 1;
        return { failures, totalGroups, passedGroups };
    }

    console.log("\nGranular coverage check passed.");
    return { failures, totalGroups, passedGroups };
}
