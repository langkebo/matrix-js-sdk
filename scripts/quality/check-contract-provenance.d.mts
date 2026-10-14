/**
 * `check-contract-provenance.mjs` 的类型声明（只声明导出给 spec 用的纯函数）。
 *
 * 本仓惯例：vitest 走真实 .mjs、tsc 走本声明文件，两者必须同步。
 */

/**
 * 返回载体文本（PR body / push 提交 message）里**缺失**的 provenance 字段名
 *（contract-prompt / ledger-commit / ledger-profile / change-type / module）。
 *
 * 五条正则都带 `^...$` + `m` flag（整行锚定）：改成子串匹配会让"提到字段名"
 * 的散文也能通过，门禁形同虚设。`contract-prompt` 的值只接受
 * `docs/api-contract/drafts/...` 或 `artifact://contract-drafts-...`。
 *
 * ⚠️ 本函数只判**存在与形态**；"声明是否与实际生成物相符"由 `auditProvenance()` 判。
 *
 * body 为 null / undefined 时按空串处理（返回全部字段）。
 */
export function missingProvenanceFields(body: string | null | undefined): string[];

export interface ParsedProvenance {
    contractPrompt: string | null;
    /** 去掉 `synapse-rust@` 前缀后的 commit（缺失时为 null）。 */
    ledgerCommit: string | null;
    /** 原始 `ledger-commit:` 行值（供报错展示）。 */
    ledgerCommitRaw: string | null;
    profiles: string[];
    changeTypes: string[];
    modules: string[];
}

/** 把载体文本里的 provenance 块解析成结构化字段。 */
export function parseProvenanceBlock(carrierText: string | null | undefined): ParsedProvenance;

export interface ChangedFileExpectations {
    /** 被改的 `route-manifest.<profile>.json` 对应的 profile 集合（排序）。 */
    profiles: string[];
    /** 被改的 `modules/<module>.json` 对应的模块集合（排序）。 */
    modules: string[];
    /** 被改的 manifest 文件路径（排序）。 */
    manifestFiles: string[];
}

/** 从改动清单推导"这次实际动了哪些内容载体"。 */
export function expectationsFromChangedFiles(changedFiles: string[]): ChangedFileExpectations;

export interface MirrorCommitEntry {
    file: string;
    /** 生成物自记录的后端 commit（缺失/不可解析时为 null）。 */
    commit: string | null;
    profile: string | null;
    parseError?: boolean;
}

/**
 * 读取镜像文件里自记录的后端 commit（`synapse_rust_commit`）。
 *
 * 这就是「声明 vs 内容」的锚点：声明"从 synapse-rust@X 生成"必须与生成物里的 X 相等。
 */
export function readMirrorCommits(rootDir: string, files?: string[]): MirrorCommitEntry[];

export interface ProvenanceMismatch {
    field: string;
    declared: string;
    actual: string;
    why: string;
}

/**
 * 内容级审计：把声明与生成物对齐。
 *
 * 判定：① 声明 ledger-commit == 镜像自记录的 synapse_rust_commit（逐文件全等）；
 * ② 声明 ledger-profile ⊇ 被改 manifest 的 profile；③ 声明 module ⊇ 被改模块页；
 * ④ 枚举合法（profile ∈ all/default/worker，change-type ∈ added/modified/removed/renamed）；
 * ⑤ 镜像文件缺 `synapse_rust_commit` ⇒ 判 mismatch（不静默放过）。
 */
export function auditProvenance(input: {
    carrierText: string | null | undefined;
    changedFiles: string[];
    mirrorCommits: MirrorCommitEntry[];
}): { declared: ParsedProvenance; expected: ChangedFileExpectations; mismatches: ProvenanceMismatch[] };
