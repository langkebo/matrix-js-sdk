#!/usr/bin/env node

/**
 * ISSUE-13 收口门禁：私有扩展模块的端点应走 /_matrix/vendor/v1 前缀，
 * 不得再冒用 /_matrix/client/{r0,v1,v3} 标准命名空间。
 *
 * 背景：friend/voice/key-rotation/burn-after-read/external-service 等私有
 * 模块此前把私有端点注册在 /_matrix/client/{r0,v1,v3} 下，污染标准 CS
 * 命名空间。现已全部迁移到 /_matrix/vendor/v1（client 前缀保留为后端向后
 * 兼容别名）。本脚本防止私有端点以 client 前缀回潮。
 *
 * 豁免：
 * - 标准 Matrix CS 路径（如 /rooms/{id}/send、/rooms/{id}/redact），这些
 *   本就是标准 API，可合法使用 client 前缀。
 * - 显式版本回退（如 `return ClientPrefix.V3`），这是向后兼容分支，非
 *   私有端点的默认前缀。
 *
 * 用法：node scripts/quality/check-vendor-prefix-migration.mjs
 * 退出码：0 = 通过；1 = 发现违规。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC_DIR = path.join(projectRoot, "src");

// 私有模块清单：这些目录下的端点属于私有扩展，应走 vendor 前缀。
// 注意：ai-connection / open-claw 是前端死代码（后端路由已删除），不在清单内。
const PRIVATE_MODULES = ["friend", "voice", "key-rotation", "burn-after-read", "external-service"];

// 标准路径白名单：这些是标准 Matrix CS API，可合法使用 client 前缀。
const STANDARD_PATH_PATTERNS = [
    /\/rooms\/[^`"']*\/(send|redact)\//, // 标准消息发送 / 撤回
];

function* walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            yield* walk(full);
        } else if (entry.name.endsWith(".ts")) {
            yield full;
        }
    }
}

function main() {
    const violations = [];
    const prefixPattern = /prefix:\s*ClientPrefix\.(V1|V3|R0)\b/;

    for (const mod of PRIVATE_MODULES) {
        const dir = path.join(SRC_DIR, mod);
        if (!fs.existsSync(dir)) continue;
        for (const file of walk(dir)) {
            const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
            lines.forEach((line, index) => {
                if (!prefixPattern.test(line)) return;
                // 检查前后 4 行内是否有标准路径（豁免标准 CS API）
                const start = Math.max(0, index - 4);
                const end = Math.min(lines.length - 1, index + 4);
                const isStandardPath = STANDARD_PATH_PATTERNS.some((pattern) => {
                    for (let i = start; i <= end; i++) {
                        if (pattern.test(lines[i])) return true;
                    }
                    return false;
                });
                if (!isStandardPath) {
                    violations.push(`${path.relative(projectRoot, file)}:${index + 1}: ${line.trim()}`);
                }
            });
        }
    }

    if (violations.length > 0) {
        process.stderr.write(
            "check-vendor-prefix-migration: 私有端点仍用 client 前缀（应迁 /_matrix/vendor/v1，见 ISSUE-13）:\n" +
                violations.map((v) => `  ${v}`).join("\n") +
                "\n",
        );
        process.exit(1);
    }

    process.stdout.write("check-vendor-prefix-migration: OK，私有端点已迁 vendor 前缀。\n");
}

main();
