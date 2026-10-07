/**
 * `check-type-coverage.mjs` 的类型声明（只声明导出给 spec 用的纯函数）。
 *
 * 本仓惯例：vitest 走真实 .mjs、tsc 走本声明文件，两者必须同步。
 */

/**
 * 收集参与统计的 .ts 文件（绝对路径，已排序）。
 *
 * `recursive=false` 只收根目录一层（"src/root" 那一档必须用非递归，
 * 否则会与 8 个模块档大面积重叠）。`.test-d.ts` 一律排除 —— 它是类型测试的
 * 声明文件，算进分母会稀释百分比。
 *
 * 注意：本函数**不做** existsSync，传入不存在的目录会抛 ENOENT ——
 * 判存在的责任在调用方（main() 的模块档先 filter 过 existsSync）。
 */
export function collectTypeScriptFiles(rootDir: string, recursive?: boolean): string[];
