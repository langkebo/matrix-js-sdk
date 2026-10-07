/**
 * `check-contract-provenance.mjs` 的类型声明（只声明导出给 spec 用的纯函数）。
 *
 * 本仓惯例：vitest 走真实 .mjs、tsc 走本声明文件，两者必须同步。
 */

/**
 * 返回 PR body 里**缺失**的 provenance 字段名
 *（contract-prompt / ledger-commit / ledger-profile / change-type / module）。
 *
 * 五条正则都带 `^...$` + `m` flag（整行锚定）：改成子串匹配会让"提到字段名"
 * 的散文也能通过，门禁形同虚设。`contract-prompt` 的值只接受
 * `docs/api-contract/drafts/...` 或 `artifact://contract-drafts-...`。
 *
 * body 为 null / undefined 时按空串处理（返回全部字段）。
 */
export function missingProvenanceFields(body: string | null | undefined): string[];
