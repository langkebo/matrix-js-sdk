/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { ClientPrefix } from "./http-api/index.ts";
import type { SendDelayedEventRequestOpts } from "./@types/requests.ts";
import type { QueryDict } from "./utils.ts";

export function getLegacyClientPrefix(version: "v1" | "r0" = "v1"): string {
    return version === "r0" ? "/_matrix/client/r0" : ClientPrefix.V1;
}

export function buildUnstableDelayQueryOpts(
    delayOpts: SendDelayedEventRequestOpts,
    unstableFeatureName: string,
): QueryDict {
    return Object.fromEntries(Object.entries(delayOpts).map(([k, v]) => [`${unstableFeatureName}.${k}`, v]));
}
