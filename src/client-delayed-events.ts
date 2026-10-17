/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { ClientPrefix } from "./http-api/index";
import type { DelayedEventsPath } from "./delayed-events/__generated__/route-table";
import type { PathAssert, StripMsc4140 } from "./http-api/strip-prefix";

export function buildUnstableFeaturePrefix(unstableFeatureName: string): string {
    return `${ClientPrefix.Unstable}/${unstableFeatureName}`;
}

/**
 * 契约路径断言助手：把本文件手写的相对路径绑到生成的 `DelayedEventsPath` 上。
 *
 * 契约表里的路径带 `/_matrix/client/unstable/org.matrix.msc4140` 前缀，实现侧写的是相对
 * 路径（前缀由调用方的 `DELAYED_EVENTS_PREFIX` 提供），故先 `StripMsc4140` 剥离再逐段比较
 * （segment 级：尾段拼错 / 凭空多段都会在**编译期**报 TS2345，见 `http-api/strip-prefix.ts`）。
 *
 * 为什么断言放在这两个构造器里（而不是 manager）：它们**是**路径字面量的家，也是唯一
 * 的生产消费点（`DelayedEventsManager` 三处 `path:` 全部经此）。后端改路由而本模块没跟上时，
 * `tsc --noEmit` 先于运行时炸 —— 这正是 delayed-events 从 WAIVED（无 route-table 约束）
 * 转为受管辖模块的意义。分开测这两个构造器的 `spec/unit/client-delayed-events.spec.ts`
 * 因此同时充当契约回归。
 */
function dp<const P extends string>(path: P & PathAssert<P, StripMsc4140<DelayedEventsPath>>): P {
    return path;
}

export function buildDelayedEventsPath(delayId: string | number): string {
    // FT-084/FT-101: 后端 delay_id 为 i64 (JSON number)，接受 number 类型
    return dp(`/delayed_events/${encodeURIComponent(String(delayId))}`);
}

/**
 * 专用调度端点路径（2026-10-14 后端新增，上游 19354 推荐形态）：
 * `PUT /rooms/{room_id}/delayed_event/{event_type}/{txn_id}`。
 * 与 `/send` 的 delay query（已标记弃用）相对；body 携带
 * `{ delay_ms, content, state_key? }` 而非把整个 body 当作事件内容。
 */
export function buildDedicatedDelayedEventPath(roomId: string, eventType: string, txnId: string): string {
    return dp(
        `/rooms/${encodeURIComponent(roomId)}/delayed_event/${encodeURIComponent(eventType)}/${encodeURIComponent(txnId)}`,
    );
}
