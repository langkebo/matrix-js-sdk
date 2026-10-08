/**
 * 台账 / 基线的统一落盘方式：**先过 prettier 再写**。
 *
 * ## 为什么需要它
 *
 * 本仓有 7 个门禁会把自己的台账/基线写回磁盘（`--refresh` / `--update-baseline` /
 * `--write-ledger`）。原先它们一律用 `JSON.stringify(payload, null, 4) + "\n"`，
 * 而 prettier 对 JSON 的规则不同 —— 最典型的是**能把放得下的数组折叠回一行**。
 *
 * 后果不是"格式不好看"，而是**门禁自己印出来的修复指令每跑一次就把 `pnpm lint:js` 弄红**：
 * 用户照做 → `prettier --check .` 失败 → 只能再手工跑一次 `prettier --write`。
 *
 *   · 2026-10-07 在 `msc-reference-baseline.json` 上实测确认，单独修过一次；
 *   · 2026-10-08 同样的坑又踩在 `admin-response-contract-ledger.json` 上
 *     （跑完 `--refresh` 后 `prettier --check .` 直接报它）。
 *
 * 所以把这条约定抽成共享实现 —— 后来者不必再各修一遍。
 *
 * ## 为什么是**同步**实现（走 prettier CLI 而不是它的 API）
 *
 * prettier v3 的 `format()` 是异步的，而本仓这些写盘函数（`writeBaseline` / `writeLedger`）
 * 全是同步的、被同步的 `main()` 调用。为了用异步 API 而把 4 个门禁的调用链改成 async，
 * 是为"工具的形状"反过来改产品代码（本仓 §7.15-12 记过同源的教训）。
 * 走 CLI + `--stdin-filepath` 既用真 prettier（规则零漂移），调用方又保持一行替换。
 * 代价是写盘时多一次子进程（~150ms），而写盘本来就是低频动作。
 *
 * ## 约定
 *
 * 写盘前必须经过本函数；**不要**在任何门禁里直接 `fs.writeFileSync(path, JSON.stringify(...))`。
 *
 * @param {string} filePath 目标文件（绝对路径）；`--stdin-filepath` 用它解析 prettier 配置，
 *   保证与 `pnpm lint` 同规则（例如 `tabWidth: 4`）
 * @param {unknown} payload 要落盘的对象
 * @returns {void}
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const requireFromHere = createRequire(import.meta.url);
/** prettier 的 CLI 入口（`node_modules/prettier/bin/prettier.cjs`）。 */
const PRETTIER_BIN = requireFromHere.resolve("prettier/bin/prettier.cjs");

export function writeJsonFormatted(filePath, payload) {
    const raw = `${JSON.stringify(payload, null, 4)}\n`;
    const formatted = execFileSync(process.execPath, [PRETTIER_BIN, "--stdin-filepath", filePath], {
        input: raw,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });
    writeFileSync(filePath, formatted, "utf8");
}
