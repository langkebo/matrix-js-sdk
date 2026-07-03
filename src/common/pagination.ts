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
