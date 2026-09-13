export interface LedgerModuleMap {
    /** SDK 目录名 → ledger 模块名 */
    [sdkDir: string]: string;
}

/** 以 **SDK 目录名**为键的别名表。 */
export const LEDGER_MODULE_ALIASES: LedgerModuleMap;

/** Ledger 模块名 → SDK 目录覆盖（用于"ledger 名 ≠ 目录名"的情形）。 */
export const LEDGER_MODULE_TO_SDK_DIR: Record<string, string>;

/** Ledger 模块名 → SDK 目录。 */
export function findSdkDirForModule(moduleName: string): string;

/**
 * SDK 目录 → 该目录承载的 ledger 模块名（多对一，可能多于一个）。
 *
 * `moduleNames` 传 `docs/api-contract/generated/index.json` 的模块清单。
 */
export function findLedgerModulesForSdkDir(sdkDir: string, moduleNames: string[]): string[];
