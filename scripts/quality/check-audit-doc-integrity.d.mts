/** 抽取 markdown 的章节标题（`##` ~ `####`），返回 `"## 标题"`；**跳过围栏代码块**。 */
export function extractHeadings(markdown: string): string[];

/**
 * 比较台账与当前文档的标题集合（两侧先过 `normalizeHeading`）。
 * `ok === false` 表示台账里有标题在当前文档中找不到（疑似回写丢内容 / 误删）。
 */
export function diffHeadingSets(input: { baseline: string[]; current: string[] }): {
    missing: string[];
    added: string[];
    ok: boolean;
};

/**
 * 抹掉标题里的易变字段：完整日期 → `{DATE}`；**最后一个 `—`/`–` 之后**的整数 → `{N}`。
 * 段号与标题正文不动（否则真删章节会被掩盖）。
 */
export function normalizeHeading(heading: string): string;

/** `artifacts/` 下的 markdown 列表（仓库相对路径，已排序）。 */
export function listAuditDocs(dir?: string): string[];

/** 台账文件的绝对路径。 */
export const BASELINE_PATH: string;

/** 台账 `note` 字段的固定文案。 */
export const NOTE: string;

/** 受管辖目录（`artifacts/`）的绝对路径。 */
export const SCAN_DIR: string;
