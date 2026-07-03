/*
Copyright 2024 The Matrix.org Foundation C.I.C.

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
 * Utility functions for Admin API
 */

/**
 * Build pagination query parameters
 *
 * Re-exported from common utilities. Accepts (limit, from, to, dir) order.
 *
 * @param limit - Number of items to return
 * @param from - Pagination start token
 * @returns Query parameters object
 *
 * @example
 * ```typescript
 * const params = buildPaginationParams(50, "token123");
 * // { limit: "50", from: "token123" }
 * ```
 */
import { buildPaginationParams } from "../common/pagination";
export { buildPaginationParams };

/**
 * Build search query parameters
 *
 * @param searchTerm - Search term
 * @param from - Pagination start token
 * @param limit - Number of items to return
 * @returns Query parameters object
 *
 * @example
 * ```typescript
 * const params = buildSearchParams("alice", "token123", 50);
 * // { search_term: "alice", from: "token123", limit: "50" }
 * ```
 */
export function buildSearchParams(searchTerm?: string, from?: string, limit?: number): Record<string, string> {
    const params = buildPaginationParams(limit, from);
    if (searchTerm) {
        params["search_term"] = searchTerm;
    }
    return params;
}

/**
 * Check if query parameters object is empty
 *
 * @param params - Query parameters object
 * @returns True if empty, false otherwise
 */
export function hasQueryParams(params: Record<string, string>): boolean {
    return Object.keys(params).length > 0;
}

/**
 * Build query parameters object, returning undefined if empty
 *
 * @param params - Query parameters object
 * @returns Query parameters or undefined if empty
 */
export function buildQueryParams(params: Record<string, string>): Record<string, string> | undefined {
    return hasQueryParams(params) ? params : undefined;
}
