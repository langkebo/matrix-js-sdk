/*
 * friends 路由的路径约束（SDK-1b）。
 *
 * `src/friend/**` 全部通过 `prefix: VendorPrefix`（`/_matrix/vendor/v1`）发请求，路径是手写的
 * 模板串。这层薄封装把每条路径约束到 ledger 声明的形态（`FriendPathPattern` 来自生成的
 * route-table，而 route-table 现在以 ledger 清单为权威源）：**路径拼错就是编译错误**，
 * 而不是运行期 404 —— 这个模块有 93 条路由的手写面，靠人眼 review 是不现实的。
 *
 * 为什么用 `StripVendor` 而不是直接用 `FriendPathPattern`：pattern 里是带
 * `/_matrix/vendor/v1` 前缀的绝对路径，而 `this.request({ prefix })` 已负责拼前缀，
 * 这里比较的是相对路径。
 */

import type { FriendPathPattern } from "./__generated__/route-table";
import type { StripVendor } from "../http-api/strip-prefix";

/** 相对 `/_matrix/vendor/v1` 的 friends 路径（必须是 ledger 声明过的形态）。 */
export type FriendRelativePath = StripVendor<FriendPathPattern>;

/**
 * 校验并返回 friends 路径。
 *
 * @example
 * await this.request({ method: Method.Put, path: friendPath(`/friends/${id}/status`), prefix: VendorPrefix });
 */
export function friendPath<P extends FriendRelativePath>(path: P): P {
    return path;
}
