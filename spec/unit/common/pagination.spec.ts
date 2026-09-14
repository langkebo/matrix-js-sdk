/*
Copyright 2025 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { describe, expect, it } from "vitest";

import { buildPaginationParams, toPaginatedResult, type PaginatedResult } from "../../../src/common/pagination";

describe("common/pagination", () => {
    describe("buildPaginationParams", () => {
        it("omits undefined fields", () => {
            expect(buildPaginationParams()).toEqual({});
        });

        it("stringifies limit and passes through tokens", () => {
            expect(buildPaginationParams(50, "from1", "to1", "b")).toEqual({
                limit: "50",
                from: "from1",
                to: "to1",
                dir: "b",
            });
        });
    });

    describe("toPaginatedResult", () => {
        it("maps the item array and normalizes next_token into `next` (with transitional `nextToken` mirror)", () => {
            const result = toPaginatedResult<{ id: number }>({ users: [{ id: 1 }], next_token: "tok" }, "users");
            expect(result).toEqual({ items: [{ id: 1 }], next: "tok", nextToken: "tok" });
        });

        it("prefers next_token over other cursor spellings", () => {
            const result = toPaginatedResult<string>({ items: ["a"], next_batch: "batch" }, "items");
            expect(result).toEqual({ items: ["a"], next: "batch", nextToken: "batch" });
        });

        it("carries total and has_more when present", () => {
            const result = toPaginatedResult<string>(
                { rooms: ["r1"], next_token: "n", total: 7, has_more: true },
                "rooms",
            );
            expect(result).toEqual({ items: ["r1"], next: "n", nextToken: "n", total: 7, hasMore: true });
        });

        it("returns empty items when the key is missing or not an array", () => {
            expect(toPaginatedResult<unknown>({}, "nope")).toEqual({ items: [] });
            expect(toPaginatedResult<unknown>({ nope: "not-array" }, "nope")).toEqual({ items: [] });
        });

        it("drops empty-string and null cursors", () => {
            expect(toPaginatedResult<string>({ items: ["a"], next_token: "" }, "items")).toEqual({ items: ["a"] });
            expect(toPaginatedResult<string>({ items: ["a"], next_batch: null }, "items")).toEqual({ items: ["a"] });
        });
    });

    describe("PaginatedResult shape", () => {
        it("is assignable across cursor field spellings", () => {
            // The canonical shape accepts `next` and keeps `nextToken` for
            // backward compatibility with early admin endpoints.
            const a: PaginatedResult<number> = { items: [1, 2], next: "n" };
            const b: PaginatedResult<number> = { items: [1, 2], nextToken: "n" };
            expect(a.items).toHaveLength(2);
            expect(b.nextToken).toBe("n");
        });
    });
});
