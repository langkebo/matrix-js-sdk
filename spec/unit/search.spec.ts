import { describe, expect, it, vi } from "vitest";

import { performSearchRequest } from "../../src/client-crypto-requests.ts";
import { searchRecipientsRequest, searchRoomsRequest } from "../../src/client-secure-backup-requests.ts";
import { buildSearchMessageRequestBody } from "../../src/client-batch-requests.ts";
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
    it("performs search via http.authedRequest directly", async () => {
        const authedRequest = vi
            .fn()
            .mockResolvedValue({ search_categories: { room_events: { count: 1, results: [] } } });
        const client = {
            http: { authedRequest },
        };
        const manager = new SearchManager(client as any);
        manager.setRetryOptions({ maxRetries: 0 });

        const body = { search_categories: { room_events: { search_term: "matrix" } } };
        await expect(manager.search({ body })).resolves.toEqual({
            search_categories: { room_events: { count: 1, results: [] } },
        });

        expect(authedRequest).toHaveBeenCalledWith(Method.Post, "/search", {}, body, { abortSignal: undefined });
    });

    it("performs searchRecipients via http.authedRequest directly", async () => {
        const authedRequest = vi
            .fn()
            .mockResolvedValue({ results: [{ user_id: "@alice:example.com" }], count: 1, next_batch: null });
        const client = {
            http: { authedRequest },
        };
        const manager = new SearchManager(client as any);
        manager.setRetryOptions({ maxRetries: 0 });

        await expect(manager.searchRecipients({ term: "alice", limit: 10 })).resolves.toEqual({
            results: [{ user_id: "@alice:example.com" }],
            count: 1,
            next_batch: null,
        });

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/search_recipients",
            undefined,
            { search_term: "alice", limit: 10 },
            { prefix: "/_matrix/client/v3" },
        );
    });

    it("rejects empty searchRecipients term", async () => {
        const manager = new SearchManager({ http: { authedRequest: vi.fn() } } as any);
        await expect(manager.searchRecipients({ term: "   " })).rejects.toThrow("Search term is required");
    });

    it("performs searchMessageText via http.authedRequest directly", async () => {
        const authedRequest = vi
            .fn()
            .mockResolvedValue({ search_categories: { room_events: { count: 2, results: [] } } });
        const client = {
            http: { authedRequest },
        };
        const manager = new SearchManager(client as any);
        manager.setRetryOptions({ maxRetries: 0 });

        await expect(manager.searchMessageText({ term: "hello" })).resolves.toEqual({
            search_categories: { room_events: { count: 2, results: [] } },
        });

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/search",
            {},
            buildSearchMessageRequestBody({ query: "hello" }),
            { abortSignal: undefined },
        );
    });

    it("performs searchUserDirectory via http.authedRequest directly", async () => {
        const authedRequest = vi
            .fn()
            .mockResolvedValue({ results: [{ user_id: "@bob:example.com", display_name: "Bob" }], limited: false });
        const client = {
            http: { authedRequest },
        };
        const manager = new SearchManager(client as any);
        manager.setRetryOptions({ maxRetries: 0 });

        await expect(manager.searchUserDirectory({ term: "bob", limit: 5 })).resolves.toEqual({
            results: [{ user_id: "@bob:example.com", display_name: "Bob" }],
            limited: false,
        });

        expect(authedRequest).toHaveBeenCalledWith(Method.Post, "/user_directory/search", undefined, {
            search_term: "bob",
            limit: 5,
        });
    });
});
