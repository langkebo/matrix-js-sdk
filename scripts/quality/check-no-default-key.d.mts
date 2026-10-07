/**
 * `check-no-default-key.mjs` 的类型声明（只声明导出给 spec 用的纯函数）。
 *
 * 本仓惯例：门禁脚本导出函数供 spec 使用时，**vitest 走运行时（真实 .mjs）、
 * tsc 走本声明文件**；两者必须同步。
 */

/** 匹配"代码里真的用了 DEFAULT_KEY 兜底"的位置（`??` / `=` / `:` 之后）。 */
export const USAGE_PATTERN: RegExp;

/** 该行是否是注释（注释里的 DEFAULT_KEY 不算违规：错误提示文本允许出现）。 */
export function isCommentLine(line: string): boolean;

/** 找出源码文本里的 DEFAULT_KEY 兜底行，返回 `rel:line: 内容` 描述。 */
export function findDefaultKeyViolations(content: string, relPath: string): string[];
