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

/**
 * Shared pagination utilities
 *
 * Used by Admin API and Module API to build query parameters for paginated endpoints.
 */

/**
 * Build pagination query parameters
 *
 * @param limit - Number of items to return
 * @param from - Pagination start token
 * @param to - Pagination end token
 * @param dir - Pagination direction ("f" for forward, "b" for backward)
 * @returns Query parameters object
 *
 * @example
 * ```typescript
 * const params = buildPaginationParams(50, "token123");
 * // { limit: "50", from: "token123" }
 * ```
 */
export function buildPaginationParams(
    limit?: number,
    from?: string,
    to?: string,
    dir?: string,
): Record<string, string> {
    const params: Record<string, string> = {};
    if (limit !== undefined) params.limit = String(limit);
    if (from !== undefined) params.from = from;
    if (to !== undefined) params.to = to;
    if (dir !== undefined) params.dir = dir;
    return params;
}

/**
 * Map a backend page into the canonical {@link PaginatedResult} shape.
 *
 * Backends return page envelopes with different item field names
 * (`users`, `rooms`, `events`, `spaces`, `notifications`, `flags`, `threads`…)
 * and different cursor spellings (`next_token`, `next_batch`, `has_more`).
 * Instead of each module hand-rolling its own mapping, this helper centralizes
 * the conversion so every paginated endpoint returns one consistent shape.
 *
 * @param raw - Backend envelope, any shape.
 * @param itemKey - Name of the array field holding the page items.
 * @returns Normalized paginated result.
 *
 * @example
 * ```typescript
 * const page = toPaginatedResult(
 *   { users: [...], next_token: "tok" },
 *   "users",
 * );
 * // { items: [...], next: "tok" }
 * ```
 */
export function toPaginatedResult<T>(
    raw: Record<string, unknown>,
    itemKey: string,
): PaginatedResult<T> {
    const items = (Array.isArray(raw[itemKey]) ? raw[itemKey] : []) as T[];
    const cursor =
        raw.next_token ?? raw.next_batch ?? raw.nextToken ?? raw.next;
    const result: PaginatedResult<T> = { items };
    if (typeof cursor === "string" && cursor.length > 0) {
        // `next` is the canonical cursor field; `nextToken` is written as a
        // transitional mirror so early admin consumers keep working while the
        // SDK converges on one spelling.
        result.next = cursor;
        result.nextToken = cursor;
    }
    if (typeof raw.total === "number") result.total = raw.total;
    if (typeof raw.has_more === "boolean") result.hasMore = raw.has_more;
    return result;
}

/**
 * Shared paginated response cursor configuration.
 */
export interface PaginationCursor {
    /** Raw server cursor to fetch the next page (source-specific naming). */
    next?: string;
    /** Optional total item count when the backend provides it. */
    total?: number;
    /** Whether more pages are available (when the backend exposes it explicitly). */
    hasMore?: boolean;
}

/**
 * Unified paginated response shape.
 *
 * Many modules return pages in slightly different wire shapes
 * (`next_token` / `next_batch` / `has_more` / `total`). This type provides a
 * canonical `items` + optional cursor fields that existing endpoints can map
 * into, or that new endpoints can declare directly without inventing another
 * ad-hoc shape.
 *
 * Backward compatible: existing concrete response interfaces keep their own
 * fields; this generic exists for shared producers/consumers.
 *
 * @example
 * ```typescript
 * import type { PaginatedResult } from "../common/pagination";
 *
 * // Declare a paginated endpoint response directly
 * export interface ListFilesResult extends PaginatedResult<FileEntry> {
 *     // domain-specific fields may be added alongside
 *     account_id: string;
 * }
 * ```
 */
export interface PaginatedResult<T> {
    /** The page items. */
    items: T[];
    /**
     * Cursor for the next page, if available (canonical name).
     *
     * Prefer this over `nextToken`; the two are the same cursor, and
     * `nextToken` is kept only for backward compatibility with early admin
     * endpoints that shipped before the shared pagination module existed.
     */
    next?: string;
    /** @deprecated Use `next` instead — same cursor, one canonical name. */
    nextToken?: string;
    /** Total item count, when provided by the backend. */
    total?: number;
    /** Explicit "more pages" flag, when provided by the backend. */
    hasMore?: boolean;
}

/** Convenience alias for the response of a cursor-only paginated endpoint. */
export type PaginatedPage<T> = PaginatedResult<T>;
