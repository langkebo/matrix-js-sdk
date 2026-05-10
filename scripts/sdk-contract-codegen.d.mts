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
    manifest: RenderManifest,
    contractDocText: string,
): string;
