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

/**
 * ISSUE-05: synapse-rust 的 /login、/refresh、/register 响应携带
 * `expires_in`（秒，OAuth2 习惯），而 SDK 类型契约是 `expires_in_ms`
 * （毫秒）。此前类型注释声称"SDK自动转换"，但全库没有任何转换点——
 * 应用层按契约读 `expires_in_ms` 只能得到 undefined，若误读
 * `expires_in` 则单位错 1000 倍（token 过期后才发现）。
 *
 * 在响应边界做一次显式归一化：缺失 `expires_in_ms` 且存在数值型
 * `expires_in` 时，按秒→毫秒换算补齐。两个字段都在时以 `expires_in_ms`
 * 为准（防止后端未来双写时的不一致）。
 */
export function normalizeExpiresInMs<T extends { expires_in_ms?: number; expires_in?: number }>(response: T): T {
    if (response.expires_in_ms === undefined && typeof response.expires_in === "number") {
        response.expires_in_ms = response.expires_in * 1000;
    }
    return response;
}
