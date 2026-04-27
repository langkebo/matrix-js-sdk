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
 * Utilities for handling deprecated APIs
 */

/**
 * Emit a deprecation warning for a method or API
 *
 * @param oldMethod - The deprecated method name
 * @param newMethod - The replacement method name
 * @param removeVersion - The version in which the old method will be removed
 * @param migrationUrl - Optional URL to migration guide
 *
 * @example
 * ```typescript
 * function oldMethod() {
 *     deprecationWarning(
 *         "oldMethod()",
 *         "newMethod()",
 *         "v41.0.0",
 *         "https://example.com/migration"
 *     );
 *     // ... implementation
 * }
 * ```
 */
export function deprecationWarning(
    oldMethod: string,
    newMethod: string,
    removeVersion: string,
    migrationUrl?: string,
): void {
    // Only show warnings in development
    if (process.env.NODE_ENV === "production") {
        return;
    }

    const message = [
        `[DEPRECATED] ${oldMethod} is deprecated and will be removed in ${removeVersion}.`,
        `Use ${newMethod} instead.`,
        migrationUrl ? `Migration guide: ${migrationUrl}` : "",
    ]
        .filter(Boolean)
        .join("\n");

    console.warn(message);
}

/**
 * Track which deprecation warnings have been shown to avoid spam
 */
const shownWarnings = new Set<string>();

/**
 * Emit a deprecation warning once per session
 *
 * @param key - Unique key for this warning
 * @param oldMethod - The deprecated method name
 * @param newMethod - The replacement method name
 * @param removeVersion - The version in which the old method will be removed
 * @param migrationUrl - Optional URL to migration guide
 */
export function deprecationWarningOnce(
    key: string,
    oldMethod: string,
    newMethod: string,
    removeVersion: string,
    migrationUrl?: string,
): void {
    if (shownWarnings.has(key)) {
        return;
    }

    shownWarnings.add(key);
    deprecationWarning(oldMethod, newMethod, removeVersion, migrationUrl);
}

/**
 * Clear all shown warnings (useful for testing)
 */
export function clearDeprecationWarnings(): void {
    shownWarnings.clear();
}
