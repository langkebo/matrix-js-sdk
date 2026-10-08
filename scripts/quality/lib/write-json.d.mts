/**
 * `write-json.mjs` 的类型声明。
 *
 * 本仓惯例：vitest 走真实 .mjs、tsc 走本声明文件，两者必须同步。
 */

/**
 * 先过 prettier 再落盘（用目标文件自身的 prettier 配置，保证与 `pnpm lint` 同规则）。
 *
 * 与 `JSON.stringify(payload, null, 4) + "\n"` 的区别：后者会把放得下的数组展开成多行，
 * 而 prettier 会折叠回一行 —— 直接写就会让 `prettier --check .` 变红。
 *
 * **同步**：内部走 prettier CLI + `--stdin-filepath`，调用方（同步的
 * `writeBaseline` / `writeLedger`）无需改造成 async。
 */
export function writeJsonFormatted(filePath: string, payload: unknown): void;
