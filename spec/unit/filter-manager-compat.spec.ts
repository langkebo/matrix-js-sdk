import { beforeEach, describe, expect, it, vi } from "vitest";

import { Filter, type IFilterDefinition } from "../../src/filter";
import { FilterManager as CanonicalFilterManager } from "../../src/filter/index";
import {
    FilterEvent,
    FilterManager as LegacyFilterManager,
    createFilterDefinition,
} from "../../src/filter-manager/index";
import {
    FilterManager as ExportedFilterManager,
    LegacyFilterManager as ExportedLegacyFilterManager,
} from "../../src/matrix";
import { RetryableError } from "../../src/errors";

describe("Legacy FilterManager compatibility", () => {
    let mockClient: any;
    let manager: LegacyFilterManager;

    beforeEach(() => {
        mockClient = {
            getUserId: vi.fn().mockReturnValue("@test:example.com"),
            http: {
                authedRequest: vi.fn(),
            },
            store: {
                storeFilter: vi.fn(),
                getFilter: vi.fn(),
                getFilterIdByName: vi.fn(),
                setFilterIdByName: vi.fn(),
            },
        };

        manager = new LegacyFilterManager(mockClient);
    });

    it("delegates createFilter to the canonical implementation and caches the definition", async () => {
        const definition = createFilterDefinition({
            room: {
                timeline: {
                    limit: 20,
                },
            },
        });
        const createdListener = vi.fn();
        manager.on(FilterEvent.FilterCreated, createdListener);

        mockClient.http.authedRequest.mockResolvedValueOnce({ filter_id: "legacy-filter" });

        await expect(manager.createFilter(definition)).resolves.toBe("legacy-filter");
        expect(manager.getCachedFilter("legacy-filter")).toEqual(definition);
        expect(manager.getFilterInfo("legacy-filter")).toEqual(
            expect.objectContaining({
                filterId: "legacy-filter",
                definition,
            }),
        );
        expect(createdListener).toHaveBeenCalledWith("legacy-filter", definition);
    });

    it("returns null for not found filters while keeping the legacy signature", async () => {
        mockClient.http.authedRequest.mockRejectedValueOnce({
            message: "missing filter",
            httpStatus: 404,
            errcode: "M_NOT_FOUND",
        });

        await expect(manager.getFilter("missing-filter", false)).resolves.toBeNull();
    });

    it("throws normalized errors instead of swallowing non-404 failures", async () => {
        const errorListener = vi.fn();
        manager.on(FilterEvent.FilterError, errorListener);
        mockClient.http.authedRequest.mockRejectedValueOnce({
            message: "server exploded",
            httpStatus: 500,
        });

        await expect(manager.getFilter("boom-filter", false)).rejects.toThrow(RetryableError);
        expect(errorListener).toHaveBeenCalledWith(expect.any(RetryableError));
    });

    it("re-exports the canonical and legacy managers through the main entrypoint", () => {
        expect(ExportedFilterManager).toBe(CanonicalFilterManager);
        expect(ExportedLegacyFilterManager).toBe(LegacyFilterManager);
    });

    it("hydrates definitions from the canonical cache-aware implementation", async () => {
        const definition: IFilterDefinition = {
            event_format: "client",
            room: {
                timeline: {
                    types: ["m.room.message"],
                },
            },
        };

        mockClient.store.getFilter.mockReturnValueOnce(
            Filter.fromJson("@test:example.com", "cached-filter", definition),
        );

        await expect(manager.getFilter("cached-filter")).resolves.toEqual(definition);
        expect(mockClient.http.authedRequest).not.toHaveBeenCalled();
        expect(manager.getCachedFilter("cached-filter")).toEqual(definition);
    });
});
