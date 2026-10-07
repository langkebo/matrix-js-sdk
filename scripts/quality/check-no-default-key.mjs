#!/usr/bin/env node

/**
 * ISSUE-08 静态门禁：断言 src/ 中不存在 `"DEFAULT_KEY"` 明文兜底。
 *
 * 历史背景：`client.ts` 曾有 `legacyPickleKey ?? "DEFAULT_KEY"`——
 * 那是一个**公开的常量密钥**，任何进程都能用它解密本地 crypto store，
 * E2EE 在终端侧形同虚设。兜底已删除，本脚本防止其以任何形式回归。
 *
 * 用法：node scripts/quality/check-no-default-key.mjs
 * 退出码：0 = 通过；1 = 发现违规。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC_DIR = path.join(projectRoot, "src");

const SOURCE_EXTENSIONS = new Set([".ts", ".js", ".mts", ".cts"]);

/** 只匹配"代码中的实际使用"（兜底/赋值/属性值），不匹配注释与错误提示文本。 */
const USAGE_PATTERN = /(?:\?\?|=|:)\s*"DEFAULT_KEY"/;

/** 注释行不参与判定：错误提示文本里出现 DEFAULT_KEY 是允许的。 */
function isCommentLine(line) {
    const trimmed = line.trim();
    return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

/**
 * 找出 `content` 里的 DEFAULT_KEY 兜底行。
 *
 * 抽成纯函数是为了让它可被 spec 钉住 —— 这条门禁防的是**公开常量密钥回归**
 * （`legacyPickleKey ?? "DEFAULT_KEY"`），判据写错一次就等于把漏洞放回去。
 *
 * @param content 源码文本
 * @param relPath 用于报错的仓库相对路径
 * @returns `rel:line: 内容` 形式的违规描述
 */
function findDefaultKeyViolations(content, relPath) {
    const violations = [];
    content.split(/\r?\n/).forEach((line, index) => {
        if (isCommentLine(line)) return;
        if (USAGE_PATTERN.test(line)) violations.push(`${relPath}:${index + 1}: ${line.trim()}`);
    });
    return violations;
}

function* walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            yield* walk(full);
        } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
            yield full;
        }
    }
}

function main() {
    const violations = [];
    for (const file of walk(SRC_DIR)) {
        const content = fs.readFileSync(file, "utf8");
        violations.push(...findDefaultKeyViolations(content, path.relative(projectRoot, file)));
    }

    if (violations.length > 0) {
        process.stderr.write(
            "check-no-default-key: found insecure DEFAULT_KEY fallback(s) in src/ (ISSUE-08):\n" +
                violations.map((v) => `  ${v}`).join("\n") +
                "\n",
        );
        process.exit(1);
    }

    process.stdout.write("check-no-default-key: OK, no DEFAULT_KEY fallback in src/.\n");
}

// 纯函数导出给 spec 用；副作用式入口用 invokedDirectly 兜住（被 import 时不得执行）。
export { USAGE_PATTERN, findDefaultKeyViolations, isCommentLine };

const invokedDirectly =
    typeof process.argv[1] === "string" && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
