/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import type { Body, IRequestOpts } from "./http-api/index.ts";
import { Method } from "./http-api/method.ts";
import { buildUnstableDelayQueryOpts } from "./client-internals.ts";
import type { QueryDict } from "./utils.ts";
import type { SendDelayedEventRequestOpts, SendDelayedEventResponse } from "./@types/requests.ts";
import { buildStateEventPath } from "./client-batch-requests.ts";

export { buildStateEventPath } from "./client-batch-requests.ts";

interface HttpLike {
    authedRequest<T>(
        method: Method,
        path: string,
        queryParams?: QueryDict,
        body?: unknown,
        opts?: IRequestOpts,
    ): Promise<T>;
}

export interface DispatchDelayedStateEventRequestArgs {
    roomId: string;
    eventType: string;
    content: Body;
    stateKey?: string;
    delayOpts: SendDelayedEventRequestOpts;
    http: HttpLike;
    requestOpts?: IRequestOpts;
    unstableDelayFeatureName: string;
}

export interface DispatchStateEventRequestArgs {
    roomId: string;
    eventType: string;
    content: Body;
    stateKey?: string;
    http: HttpLike;
    requestOpts?: IRequestOpts;
}

export function dispatchStateEventRequest({
    roomId,
    eventType,
    content,
    stateKey = "",
    http,
    requestOpts = {},
}: DispatchStateEventRequestArgs): Promise<unknown> {
    return http.authedRequest(
        Method.Put,
        buildStateEventPath(roomId, eventType, stateKey),
        undefined,
        content,
        requestOpts,
    );
}

export function dispatchDelayedStateEventRequest({
    roomId,
    eventType,
    content,
    stateKey = "",
    delayOpts,
    http,
    requestOpts = {},
    unstableDelayFeatureName,
}: DispatchDelayedStateEventRequestArgs): Promise<SendDelayedEventResponse> {
    return http.authedRequest(
        Method.Put,
        buildStateEventPath(roomId, eventType, stateKey),
        buildUnstableDelayQueryOpts(delayOpts, unstableDelayFeatureName),
        content,
        requestOpts,
    );
}
