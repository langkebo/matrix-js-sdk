import { beforeEach, describe, expect, it, vi } from "vitest";

import { Filter, type IFilterDefinition } from "../../src/filter";
import { FilterManager as CanonicalFilterManager } from "../../src/filter/index";
import {
    FilterManager as ExportedFilterManager,
} from "../../src/matrix";

describe("FilterManager compatibility", () => {
    let mockClient: any;
    let manager: CanonicalFilterManager;

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

        manager = new CanonicalFilterManager(mockClient);
    });

    it("creates a filter and returns the filter ID", async () => {
        const definition: IFilterDefinition = {
            room: {
                timeline: {
                    limit: 20,
                },
            },
        };

        mockClient.http.authedRequest.mockResolvedValueOnce({ filter_id: "test-filter" });

        await expect(manager.createFilter(definition)).resolves.toEqual({ filterId: "test-filter" });
    });

    it("returns a cached filter when available", async () => {
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

        await expect(manager.getFilter("@test:example.com", "cached-filter")).resolves.toBeDefined();
        expect(mockClient.http.authedRequest).not.toHaveBeenCalled();
    });

    it("re-exports the canonical manager through the main entrypoint", () => {
        expect(ExportedFilterManager).toBe(CanonicalFilterManager);
    });
});
