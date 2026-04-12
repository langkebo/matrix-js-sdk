import { describe, expect, it } from "vitest";

import { ServerSupport } from "../../src/feature.ts";
import {
    getAccountDataFromStoreWhenReady,
    isAccountDataNotFoundError,
    shouldFallbackDeleteAccountDataToEmptyContent,
} from "../../src/client-account-data-core.ts";

describe("client account data core helpers", () => {
    it("returns undefined before initial sync completion", () => {
        const result = getAccountDataFromStoreWhenReady(false, {
            getContent: () => ({ value: 1 }),
        });
        expect(result).toBeUndefined();
    });

    it("returns null when event is missing after initial sync", () => {
        const result = getAccountDataFromStoreWhenReady(true, undefined);
        expect(result).toBeNull();
    });

    it("returns event content when event exists after initial sync", () => {
        const result = getAccountDataFromStoreWhenReady<{ value: number }>(true, {
            getContent: () => ({ value: 1 }),
        });
        expect(result).toEqual({ value: 1 });
    });

    it("matches account data not found errors", () => {
        expect(isAccountDataNotFoundError({ data: { errcode: "M_NOT_FOUND" } })).toBe(true);
        expect(isAccountDataNotFoundError({ data: { errcode: "M_FORBIDDEN" } })).toBe(false);
        expect(isAccountDataNotFoundError({})).toBe(false);
    });

    it("falls back to empty content only when account data deletion is unsupported", () => {
        expect(shouldFallbackDeleteAccountDataToEmptyContent(ServerSupport.Unsupported)).toBe(true);
        expect(shouldFallbackDeleteAccountDataToEmptyContent(ServerSupport.Stable)).toBe(false);
        expect(shouldFallbackDeleteAccountDataToEmptyContent(undefined)).toBe(false);
    });
});
