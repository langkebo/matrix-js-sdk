/*
Copyright 2026 The Matrix.org Foundation C.I.C.

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

const INSECURE_DEV_HOSTS = ["localhost", "127.0.0.1", "10.0.2.2", "[::1]"];

export function assertSecureBaseUrl(baseUrl: string, opts: { allowInsecureDev?: boolean } = {}): void {
    let url: URL;
    try {
        url = new URL(baseUrl);
    } catch {
        throw new Error(`Invalid base url: ${baseUrl}`);
    }
    if (url.protocol === "https:") return;
    if (url.protocol !== "http:") {
        throw new Error(`Unsupported base url protocol: ${url.protocol}`);
    }
    // http: 仅在 dev 模式 + 本地地址放行
    if (opts.allowInsecureDev && INSECURE_DEV_HOSTS.includes(url.hostname)) return;
    throw new Error(
        `Refusing to use non-https base url in production: ${baseUrl}. ` +
            "Pass allowInsecureDev for local development only.",
    );
}
