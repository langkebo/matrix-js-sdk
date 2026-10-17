/**
 * `check-generated-dto-placeholders.mjs` 的类型声明（只声明导出给 spec 用的纯函数）。
 *
 * 本仓惯例：vitest 走真实 .mjs、tsc 走本声明文件，两者必须同步。
 */

export interface DtoPlaceholderEntry {
    /** `src/<module>/__generated__/dto.ts` 里的 `<module>`（支持多级目录）。 */
    module: string | null;
    filePath: string;
    typeName: string;
    line: number;
}

/**
 * 模块名 = `src/<module>/__generated__/dto.ts` 里的 `<module>`；路径形态不符时返回 null。
 */
export function moduleFromDtoPath(relativePath: string): string | null;

/**
 * 扫描所有生成 DTO 里的 `= never` 空占位（按 filePath/typeName 稳定排序），
 * 并给出总 DTO 文件数（用于报告"15/46"这类占比）。
 */
export function scanDtoPlaceholders(scanRoot?: string): { entries: DtoPlaceholderEntry[]; dtoFileCount: number };

/** 条目在台账里的稳定标识：`<filePath>::<typeName>`。 */
export function placeholderId(entry: DtoPlaceholderEntry): string;

/**
 * 读取台账；文件缺失返回 `{ count: 0, entries: [] }`，内容损坏返回 `parseError: true`
 * 而不是抛异常（门禁要能报"台账坏了"，而不是自己崩）。
 */
export function readPlaceholderBaseline(filePath?: string): {
    count: number;
    entries: DtoPlaceholderEntry[];
    parseError?: boolean;
};
