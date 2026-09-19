export interface SupportedModule {
    ledgerModule: string;
    sdkDir: string;
    docBasename: string;
    docPath: string;
    constName: string;
    typePrefix: string;
    humanName: string;
}

export interface RenderManifest {
    entry_count: number;
}

export function discoverSupportedModules(contractIndexText?: string): SupportedModule[];

export function renderDtoFile(
    module: Pick<SupportedModule, "ledgerModule" | "docBasename" | "typePrefix">,
    contractDocText: string,
): string;

export function renderContractAssertions(
    module: Pick<SupportedModule, "ledgerModule" | "constName" | "typePrefix">,
    entries: { method: string; path: string }[],
    entryCount: number,
    contractDocText: string,
): string;

/**
 * 归一化路径查找表（键 = `"<METHOD> <normalizedPath>"`）。
 *
 * - `backend`：后端 `artifacts/route_contract.json` 的索引（缺失时为空表）；
 * - `sdk`：盘上各模块 `__generated__` 目录下 route-table 的索引。
 *
 * 两者都是**版本纠偏**来源：文档写 v3、后端实际服务 v1 时以查找表为准。
 */
export interface ResolveFullPathLookups {
    backend: Map<string, string>;
    sdk: Map<string, string>;
}

/**
 * 把后端文档里的资源路径解析成完整路径。
 *
 * `rawPath` 是文档原文；当查找表全部落空时，若 `rawPath` 已是绝对路径
 * （`/_matrix/...` / `/_synapse/...`）则**原样返回**，而不是按 `sdkDir` 猜前缀
 * （猜前缀曾把 client 面的 `/_matrix/client/v3/upload/provider` 渲染成不存在的
 * `/_matrix/media/v3/upload/provider`）。
 */
export function resolveFullPath(
    method: string,
    resourcePath: string,
    sdkDir: string,
    lookups: ResolveFullPathLookups,
    rawPath?: string,
): string;
