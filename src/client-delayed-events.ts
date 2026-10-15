/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { ClientPrefix } from "./http-api/index";

export function buildUnstableFeaturePrefix(unstableFeatureName: string): string {
    return `${ClientPrefix.Unstable}/${unstableFeatureName}`;
}

export function buildDelayedEventsPath(delayId: string | number): string {
    // FT-084/FT-101: 后端 delay_id 为 i64 (JSON number)，接受 number 类型
    return `/delayed_events/${encodeURIComponent(String(delayId))}`;
}

/**
 * 专用调度端点路径（2026-10-14 后端新增，上游 19354 推荐形态）：
 * `PUT /rooms/{room_id}/delayed_event/{event_type}/{txn_id}`。
 * 与 `/send` 的 delay query（已标记弃用）相对；body 携带
 * `{ delay_ms, content, state_key? }` 而非把整个 body 当作事件内容。
 */
export function buildDedicatedDelayedEventPath(roomId: string, eventType: string, txnId: string): string {
    return `/rooms/${encodeURIComponent(roomId)}/delayed_event/${encodeURIComponent(eventType)}/${encodeURIComponent(txnId)}`;
}
