import { ServerSupport } from "./feature.ts";

export interface AccountDataEventLike {
    getContent(): unknown;
}

export function getAccountDataFromStoreWhenReady<T>(
    isInitialSyncComplete: boolean,
    event: AccountDataEventLike | undefined,
): T | null | undefined {
    if (!isInitialSyncComplete) {
        return undefined;
    }
    if (!event) {
        return null;
    }
    return event.getContent() as T;
}

export function isAccountDataNotFoundError(error: unknown): boolean {
    return (error as { data?: { errcode?: string } })?.data?.errcode === "M_NOT_FOUND";
}

export function shouldFallbackDeleteAccountDataToEmptyContent(serverSupport: ServerSupport | undefined): boolean {
    return serverSupport === ServerSupport.Unsupported;
}
