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
 * 契约路径前缀剥离工具（内部共享，不对外导出）。
 *
 * SDK 的路径字面量断言依赖「把契约表里带 API 前缀的路径模板，剥成实现侧写的相对路径」。
 * 此前每个业务模块都各自手写等价的 `StripXxx` 条件类型（全仓 66 份、22 个名字、14 种形态），
 * 且存在**同名不同义**（`StripAuthPrefix` 在部分模块是 `client/v3`、在另一些是「v3→r0→v1 逐级」）
 * 的陷阱。本文件是该剥离逻辑的**唯一实现**，各模块一律从这里 import。
 *
 * 语义：`StripPrefix<P, Prefix, Fallback>` —— 若 `P` 形如 `` `${Prefix}${Rest}` ``
 * 则取 `Rest`，否则取 `Fallback`（默认 `never`，即「不匹配 = 类型错误」）。
 */

/** 核心泛型：剥离单个前缀，不匹配时返回 `Fallback`（默认 `never`）。 */
export type StripPrefix<P extends string, Prefix extends string, Fallback = never> = P extends `${Prefix}${infer Rest}`
    ? Rest
    : Fallback;

// ---------------------------------------------------------------------------
// 单前缀 API 的规范别名。
// 历史命名（`StripV3` / `StripV1` / `StripR0` / `StripAdminV1` …）保持不变，
// 以免下游使用点大范围重命名；新代码请优先直接用 `StripPrefix<P, Prefix>`。
// ---------------------------------------------------------------------------

/** 剥离 `/_matrix/client/v3`。 */
export type StripV3<P extends string> = StripPrefix<P, "/_matrix/client/v3">;

/** 剥离 `/_matrix/client/v1`。 */
export type StripV1<P extends string> = StripPrefix<P, "/_matrix/client/v1">;

/** 剥离 `/_matrix/client/r0`。 */
export type StripR0<P extends string> = StripPrefix<P, "/_matrix/client/r0">;

/** 剥离 `/_synapse/admin/v1`。 */
export type StripAdminV1<P extends string> = StripPrefix<P, "/_synapse/admin/v1">;

/** 剥离 `/_synapse/admin`（无版本号）。 */
export type StripAdminPath<P extends string> = StripPrefix<P, "/_synapse/admin">;

/** 剥离 `/_matrix/vendor/v1`。 */
export type StripVendor<P extends string> = StripPrefix<P, "/_matrix/vendor/v1">;

/** 剥离 `/_synapse/room_summary/v1`。 */
export type StripInternalSummary<P extends string> = StripPrefix<P, "/_synapse/room_summary/v1">;

/** 剥离 `/_synapse/worker`。 */
export type StripWorkerPrefix<P extends string> = StripPrefix<P, "/_synapse/worker">;

/** 剥离 `/_matrix/admin/v1`。 */
export type StripMatrixAdminV1<P extends string> = StripPrefix<P, "/_matrix/admin/v1">;

/** 剥离 `/_matrix/client/unstable/org.matrix.simplified_msc3575`。 */
export type StripSimplifiedSlidingSync<P extends string> = StripPrefix<
    P,
    "/_matrix/client/unstable/org.matrix.simplified_msc3575"
>;

// ---------------------------------------------------------------------------
// 多前缀形态：按列出的顺序依次匹配（TS 条件类型按书写顺序求值）。
// ---------------------------------------------------------------------------

/** client `v3 → r0 → v1`；**不匹配时返回 `P` 本身**（用于契约表含非 client 路径的模块）。 */
export type StripAuthPrefix<P extends string> = StripPrefix<
    P,
    "/_matrix/client/v3",
    StripPrefix<P, "/_matrix/client/r0", StripPrefix<P, "/_matrix/client/v1", P>>
>;

/** client `r0 → v1 → v3`；不匹配时返回 `never`。 */
export type StripClientPrefix<P extends string> = StripPrefix<
    P,
    "/_matrix/client/r0",
    StripPrefix<P, "/_matrix/client/v1", StripPrefix<P, "/_matrix/client/v3">>
>;

/** `/_matrix/client/v3` 或 `/_matrix/vendor/v1`；不匹配时返回 `never`。 */
export type StripClientV3OrVendorV1<P extends string> = StripPrefix<
    P,
    "/_matrix/client/v3",
    StripPrefix<P, "/_matrix/vendor/v1">
>;

/** media `v1 → v3 → r0 → r1`；不匹配时返回 `never`。 */
export type StripMediaPrefix<P extends string> = StripPrefix<
    P,
    "/_matrix/media/v1",
    StripPrefix<P, "/_matrix/media/v3", StripPrefix<P, "/_matrix/media/r0", StripPrefix<P, "/_matrix/media/r1">>>
>;
