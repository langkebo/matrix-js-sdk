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
    // 只匹配代码中的实际使用（兜底/赋值/属性值），不匹配注释与错误提示文本
    const usagePattern = /(?:\?\?|=|:)\s*"DEFAULT_KEY"/;
    for (const file of walk(SRC_DIR)) {
        const content = fs.readFileSync(file, "utf8");
        const lines = content.split(/\r?\n/);
        lines.forEach((line, index) => {
            const trimmed = line.trim();
            if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
                return;
            }
            if (usagePattern.test(line)) {
                violations.push(`${path.relative(projectRoot, file)}:${index + 1}: ${trimmed}`);
            }
        });
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

main();
