/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { isSendDelayedEventRequestOpts, type SendDelayedEventRequestOpts } from "./@types/requests";
import type { QueryDict } from "./utils";

export interface ResolvedSendEventRequestArgs {
    delayOpts?: SendDelayedEventRequestOpts;
    queryOpts?: QueryDict;
}

export function resolveSendEventRequestArgs(
    queryOrDelayOpts?: SendDelayedEventRequestOpts | QueryDict,
    queryDict?: QueryDict,
): ResolvedSendEventRequestArgs {
    const delayOpts =
        queryOrDelayOpts && isSendDelayedEventRequestOpts(queryOrDelayOpts) ? queryOrDelayOpts : undefined;
    const queryOpts = !delayOpts ? (queryOrDelayOpts as QueryDict | undefined) : queryDict;
    return { delayOpts, queryOpts };
}
