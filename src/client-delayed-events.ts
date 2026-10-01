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
