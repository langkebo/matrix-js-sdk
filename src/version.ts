/*
Copyright 2026 HuLa/Tjg IM Project

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
 * Runtime identity of this SDK build.
 *
 * This fork is published as `@langkebo/matrix-js-sdk`; without a runtime
 * identity, a bug report or a server access log cannot tell whether the caller
 * was running upstream `matrix-js-sdk` or this fork. The constants here let the
 * SDK identify itself in logs, and give host applications a token to splice into
 * the native User-Agent (see {@link getUserAgentToken} for why the SDK cannot
 * set that header itself).
 */

/**
 * The npm package name, including scope. Kept in sync with `package.json`.
 */
export const SDK_NAME = "@langkebo/matrix-js-sdk";

/**
 * Build-time placeholder for the package version.
 *
 * `babel.config.cjs` runs `babel-plugin-search-and-replace` over this file and
 * rewrites the literal `"__SDK_VERSION__"` to the `version` field of
 * `package.json`. That only happens on the Babel path (`pnpm build`).
 *
 * Tooling that consumes `src/` directly — Vitest (esbuild), `tsx`, `ts-node`,
 * or a bundler configured to compile TS sources — never runs Babel, so the
 * literal survives untouched. Use {@link getSdkVersion} rather than reading this
 * value, so the un-injected case degrades cleanly instead of leaking the
 * placeholder into a User-Agent or a log line.
 */
const RAW_VERSION = "__SDK_VERSION__";

/**
 * Version reported when the build-time injection did not run.
 *
 * Distinguishing this from a real version matters: a `0.0.0` with a build
 * metadata suffix is unambiguously a non-release build, and `+uninjected`
 * says exactly which step was skipped.
 */
const UNINJECTED_VERSION = "0.0.0-dev+uninjected";

/**
 * True when Babel replaced the placeholder with a real version string.
 *
 * The placeholder is delimited by double underscores on both ends; a real
 * semver string never is. The `"__"` literals below are deliberately *not*
 * matches for the `__SDK_VERSION__` replace rule, so they survive injection.
 */
function isVersionInjected(raw: string): boolean {
    return !(raw.startsWith("__") && raw.endsWith("__"));
}

/**
 * The version of this SDK build.
 *
 * @returns The version from `package.json` for built artifacts, or
 * `0.0.0-dev+uninjected` when the source is consumed without the Babel
 * injection step.
 *
 * @example
 * ```ts
 * logger.info(`${SDK_NAME} ${getSdkVersion()}`);
 * // "@langkebo/matrix-js-sdk 40.2.0-langkebo.1"
 * ```
 */
export function getSdkVersion(): string {
    return isVersionInjected(RAW_VERSION) ? RAW_VERSION : UNINJECTED_VERSION;
}

/**
 * Whether the reported version comes from a real build.
 *
 * Useful for tests and diagnostics that must not silently pass on the
 * fallback value.
 */
export function isReleaseBuild(): boolean {
    return isVersionInjected(RAW_VERSION);
}

/**
 * A `name/version` token suitable for a User-Agent string.
 *
 * **The SDK cannot set the `User-Agent` request header for you.** The Fetch
 * spec lists `User-Agent` as a
 * [forbidden header name](https://fetch.spec.whatwg.org/#forbidden-header-name),
 * so browsers and webviews — including the WKWebView / WebView2 that Tauri
 * renders with — silently discard any attempt to set it from JavaScript.
 *
 * The host application must therefore write this token into the *native*
 * User-Agent instead. On Tauri v2 that is the `userAgent` field of the window
 * config, which maps to `WKWebView.customUserAgent` on macOS and
 * `ICoreWebView2Settings2::put_UserAgent` on Windows.
 *
 * @example
 * ```ts
 * // src-tauri/tauri.conf.json
 * { "app": { "windows": [{ "userAgent": "Tjg/1.0 @langkebo/matrix-js-sdk/40.2.0-langkebo.1" }] } }
 * ```
 *
 * @returns A token of the form `@langkebo/matrix-js-sdk/<version>`.
 */
export function getUserAgentToken(): string {
    return `${SDK_NAME}/${getSdkVersion()}`;
}

/**
 * Append the SDK's User-Agent token to an existing User-Agent string.
 *
 * Pass the User-Agent your host application already uses so the result keeps
 * the platform/browser tokens that servers and proxies expect, with the SDK
 * identity appended as a trailing product token.
 *
 * @param base - Existing User-Agent, or omitted to get the token alone.
 * @returns `base` followed by the SDK token, space-separated; or just the token
 * when `base` is empty or omitted.
 *
 * @example
 * ```ts
 * buildUserAgent("Tjg/1.0 (Macintosh; Intel Mac OS X 10_15_7)");
 * // "Tjg/1.0 (Macintosh; Intel Mac OS X 10_15_7) @langkebo/matrix-js-sdk/40.2.0-langkebo.1"
 *
 * buildUserAgent();
 * // "@langkebo/matrix-js-sdk/40.2.0-langkebo.1"
 * ```
 */
export function buildUserAgent(base?: string): string {
    const token = getUserAgentToken();
    const trimmed = base?.trim();
    if (!trimmed) {
        return token;
    }
    return `${trimmed} ${token}`;
}
