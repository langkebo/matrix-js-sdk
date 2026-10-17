/**
 * `check-api-contract-doc-paths.mjs` 的类型声明（只声明导出给 spec 用的纯函数与数据）。
 *
 * 本仓惯例：vitest 走真实 .mjs、tsc 走本声明文件，两者必须同步。
 */

/**
 * 扫描选项。全部可省；默认走仓内真实路径（`docs/api-contract/**` + ledger 镜像 +
 * waivers）。单元测试注入夹具目录以获得确定性输入。
 */
export interface DocPathsScanOptions {
    /** 待扫描的模块页目录，默认仓内 `docs/api-contract`。 */
    docsDir?: string;
    /** ledger 镜像（`route-manifest.all.json`）路径，默认仓内生成物。 */
    manifest?: string;
    /** `path-contract-waivers.json` 路径，默认仓内台账。 */
    waivers?: string;
    /** 跳过扫描的页名集合，默认为 README / CHANGELOG / 索引页。 */
    skipPages?: Set<string>;
}

/** 一条「引用了 ledger 中不存在路径」的陈旧行。 */
export interface DocPathsStaleRef {
    /** 该行在页面文件里的行号（从 1 起）。 */
    line: number;
    /** 逐字写在反引号里的路径原文（含 query / 尾斜杠，未规范化）。 */
    path: string;
}

/** 扫描结果：按页名分组的陈旧行 + 总行数。 */
export interface DocPathsScanResult {
    byPage: Record<string, DocPathsStaleRef[]>;
    total: number;
}

/**
 * 扫描 `docs/api-contract/*.md` 里逐行列出的路由路径，返回引用了 ledger 中不存在路径
 * 的行。CLI 的棘轮对照 `api-contract-doc-paths-baseline.json`（只降不升）。
 */
export function scan(options?: DocPathsScanOptions): DocPathsScanResult;
