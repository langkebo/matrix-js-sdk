import { describe, expect, it, vi } from "vitest";

import { performSearchRequest } from "../../src/client-crypto-requests.ts";
import { searchRecipientsRequest, searchRoomsRequest } from "../../src/client-secure-backup-requests.ts";
import { Method } from "../../src/http-api/method.ts";
import { SearchManager } from "../../src/search/index.ts";

describe("search contract helpers", () => {
    it("binds POST /search through the generated-compatible v3 path", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ search_categories: {} });

        await performSearchRequest({ search_categories: {} }, "cursor-1", undefined, authedRequest);

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/search",
            { next_batch: "cursor-1" },
            { search_categories: {} },
            { abortSignal: undefined },
        );
    });

    it("binds POST /search_rooms through the generated-compatible v3 path", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ results: [], count: 0, next_batch: null });

        await searchRoomsRequest(authedRequest, "matrix", 20);

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/search_rooms",
            undefined,
            { search_term: "matrix", limit: 20 },
            { prefix: "/_matrix/client/v3" },
        );
    });

    it("binds POST /search_recipients through the generated-compatible v3 path", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ results: [], count: 0, next_batch: null });

        await searchRecipientsRequest(authedRequest, "alice", 10);

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/search_recipients",
            undefined,
            { search_term: "alice", limit: 10 },
            { prefix: "/_matrix/client/v3" },
        );
    });
});

describe("SearchManager", () => {
    it("delegates search to MatrixClient", async () => {
        const client = {
            search: vi.fn().mockResolvedValue({ search_categories: { room_events: { count: 1, results: [] } } }),
        };
        const manager = new SearchManager(client as any);
        manager.setRetryOptions({ maxRetries: 0 });

        await expect(manager.search({ room_events: { term: "matrix", limit: 10 } })).resolves.toEqual({
            search_categories: { room_events: { count: 1, results: [] } },
        });

        expect(client.search).toHaveBeenCalledWith({ room_events: { term: "matrix", limit: 10 } });
    });

    it("validates and delegates searchRecipients to MatrixClient", async () => {
        const client = {
            searchRecipients: vi.fn().mockResolvedValue({ results: [{ user_id: "@alice:example.com" }], count: 1, next_batch: null }),
        };
        const manager = new SearchManager(client as any);
        manager.setRetryOptions({ maxRetries: 0 });

        await expect(manager.searchRecipients({ term: "alice", limit: 10 })).resolves.toEqual({
            results: [{ user_id: "@alice:example.com" }],
            count: 1,
            next_batch: null,
        });

        expect(client.searchRecipients).toHaveBeenCalledWith("alice", 10);
    });

    it("rejects empty searchRecipients term", async () => {
        const manager = new SearchManager({ searchRecipients: vi.fn() } as any);
        await expect(manager.searchRecipients({ term: "   " })).rejects.toThrow("Search term is required");
    });
});
