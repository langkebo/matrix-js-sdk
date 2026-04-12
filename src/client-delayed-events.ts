/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { ClientPrefix } from "./http-api/index.ts";
import type { UpdateDelayedEventAction } from "./@types/requests.ts";
import type { QueryDict } from "./utils.ts";

export function buildUnstableFeaturePrefix(unstableFeatureName: string): string {
    return `${ClientPrefix.Unstable}/${unstableFeatureName}`;
}

export function buildDelayedEventsQuery(
    status?: "scheduled" | "finalised",
    delayId?: string | string[],
    fromToken?: string,
): QueryDict {
    return {
        from: fromToken,
        status,
        delay_id: delayId,
    };
}

export function buildDelayedEventsActionPath(delayId: string, action: UpdateDelayedEventAction): string {
    return `/delayed_events/${encodeURIComponent(delayId)}/${encodeURIComponent(action)}`;
}

export function buildDelayedEventsPath(delayId: string): string {
    return `/delayed_events/${encodeURIComponent(delayId)}`;
}
