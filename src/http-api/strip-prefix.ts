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

// ---------------------------------------------------------------------------
// 精确路径断言：segment 级结构比较。
//
// 为什么需要它：契约生成器把 `{name}` 占位替换成 `${string}`（各模块的
// `XxxPathPattern`），而 TypeScript 的 **`${string}` 可以包含 `/`**。于是契约里只要
// 存在一条「以参数结尾」的路由（例如 `GET /rooms/{room_id}` → 类型 `/rooms/${string}`），
// 整片 `/rooms/**` 命名空间的断言就会恒过 —— 任何以 `/rooms/` 开头的字符串都能通过。
// 实测：`/rooms/$roomId/invite_blocklist`、`/rooms/$roomId/a/b/c` 均被静默放行。
//
// 因此这里不再依赖 `${string}` 做匹配，而是把调用点路径与契约路由**按 `/` 切成
// segment 后逐段比较**：契约侧是占位（`{...}`）的段接受任意值，其余段要求字面量
// **精确相等**，且两侧段数必须一致。这样「尾段拼错」「凭空多出几段」都会报错。
//
// ⚠️ 实现陷阱（实测踩过，务必保留这段注释）：**失败态不能用 `never`**。
// `never` 作为非分布式条件类型的被检类型时，`never extends true` 恒为 `true`
// —— 会把「不匹配」静默反转成「匹配」。故此处一律返回 `true` / `false`，
// 且用 `true extends Results` 方向判定；分段比较必须先于「任意字符串」匹配。
// ---------------------------------------------------------------------------

/** 契约侧占位 segment（如 `{room_id}`）——接受调用点的任意单段。 */
type IsPlaceholder<S extends string> = S extends `{${string}}` ? true : false;

/** 双向 `extends` 的精确相等判断（`never` 一律视为不等）。 */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * 调用点路径与**单条**契约路由的 segment 级比较。
 *
 * 规则：契约侧占位段接受任意内容；其余段必须与调用点段字面量精确相等；
 * 两侧段数必须一致（因此 `` `/rooms/${string}` `` 不会再吞掉后续的 `/a/b`）。
 */
export type PathMatchesRoute<
    Call extends string,
    Route extends string,
> = Call extends `${infer CallHead}/${infer CallTail}`
    ? Route extends `${infer RouteHead}/${infer RouteTail}`
        ? IsPlaceholder<RouteHead> extends true
            ? PathMatchesRoute<CallTail, RouteTail>
            : Exact<CallHead, RouteHead> extends true
              ? PathMatchesRoute<CallTail, RouteTail>
              : false
        : false
    : Route extends `${string}/${string}`
      ? false
      : IsPlaceholder<Route> extends true
        ? true
        : Exact<Call, Route>;

/** 调用点路径对契约里**每一条**路由的比较结果（按路由联合分布）。 */
type RouteResults<Call extends string, Routes extends string> = Routes extends string
    ? PathMatchesRoute<Call, Routes>
    : false;

/** `true` 当且仅当调用点路径命中契约中的**至少一条**路由。 */
export type MatchesRoute<Call extends string, Routes extends string> =
    true extends RouteResults<Call, Routes> ? true : false;

/**
 * 断言助手：命中契约时求值为 `unknown`（于是 `P & PathAssert<P, …>` 即 `P`），
 * 未命中时求值为一个「品牌」对象类型，使实参不可赋值，从而在**调用点**报错，
 * 并在错误信息里带上提示。
 *
 * 两处实现要点（都由实测确定，改动前请先跑变异自证）：
 *
 * 1. 断言助手的类型参数**必须写成 `const P`**。模板字面量表达式在没有上下文
 *    模板类型时会被推断成宽 `string`，普通泛型参数会因此拿到 `string` 而误报；
 *    `const P` 才能拿到 `` `/user/${string}/tags` `` 这样的模板字面量类型。
 * 2. 失败态用「品牌对象」而不是 `never`：`never` 会让 `P & never` 退化成 `never`，
 *    错误信息毫无线索；品牌对象能把 `__hint` 带进错误信息。
 *
 * @example
 * ```ts
 * function tp<const P extends string>(path: P & PathAssert<P, StripV3<TagsPath>>): P {
 *     return path;
 * }
 * tp("/user/$userId/tags");        // ✓
 * tp("/user/$userId/tagz");        // ✗ TS2345，错误信息点名 __invalidPath
 * ```
 */
export type PathAssert<Call extends string, Routes extends string> =
    MatchesRoute<Call, Routes> extends true
        ? unknown
        : {
              readonly __invalidPath: Call;
              readonly __hint: "path does not match any route in this module's contract";
          };
