/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import {
    type ISendEventResponse,
    type SendDelayedEventRequestOpts,
    type SendDelayedEventResponse,
} from "./@types/requests";
import { Method } from "./http-api/method";
import { buildUnstableDelayQueryOpts } from "./client-internals";
import { buildSendEventPath } from "./client-send-paths";
import { resolveSendEventRequestArgs } from "./client-send-request";
import type { MatrixEvent } from "./models/event";
import type { QueryDict } from "./utils";

interface LoggerLike {
    debug(message: string): void;
}

interface HttpLike {
    authedRequest<T>(method: Method, path: string, queryParams?: QueryDict, body?: unknown): Promise<T>;
}

export interface DispatchSendEventHttpRequestArgs {
    event: MatrixEvent;
    queryOrDelayOpts?: SendDelayedEventRequestOpts | QueryDict;
    queryDict?: QueryDict;
    makeTxnId: () => string;
    http: HttpLike;
    logger: LoggerLike;
    unstableDelayFeatureName: string;
}

export function dispatchSendEventHttpRequest({
    event,
    queryOrDelayOpts,
    queryDict,
    makeTxnId,
    http,
    logger,
    unstableDelayFeatureName,
}: DispatchSendEventHttpRequestArgs): Promise<ISendEventResponse | SendDelayedEventResponse> {
    let txnId = event.getTxnId();
    if (!txnId) {
        txnId = makeTxnId();
        event.setTxnId(txnId);
    }

    const path = buildSendEventPath({
        roomId: event.getRoomId()!,
        eventType: event.getWireType(),
        stateKey: event.getStateKey(),
        txnId,
        isState: event.isState(),
        isRedaction: event.isRedaction(),
        redactsEventId: event.event.redacts,
    });

    const { delayOpts, queryOpts } = resolveSendEventRequestArgs(queryOrDelayOpts, queryDict);
    const content = event.getWireContent();

    if (delayOpts) {
        return http.authedRequest<SendDelayedEventResponse>(
            Method.Put,
            path,
            { ...buildUnstableDelayQueryOpts(delayOpts, unstableDelayFeatureName), ...queryOpts },
            content,
        );
    }

    return http.authedRequest<ISendEventResponse>(Method.Put, path, queryOpts, content).then((res) => {
        logger.debug(`Event sent to ${event.getRoomId()} with event id ${res.event_id}`);
        return res;
    });
}
