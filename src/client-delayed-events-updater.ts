/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { MatrixError, Method, type IRequestOpts } from "./http-api/index.ts";
import type { EmptyObject } from "./@types/common.ts";
import type { UpdateDelayedEventAction } from "./@types/requests.ts";
import {
    buildDelayedEventsActionPath,
    buildDelayedEventsPath,
    buildUnstableFeaturePrefix,
} from "./client-delayed-events.ts";

export interface DelayedEventsHttpClient {
    request<T>(
        method: Method,
        path: string,
        queryParams?: Record<string, unknown>,
        body?: Record<string, unknown>,
        opts?: IRequestOpts,
    ): Promise<T>;
    authedRequest<T>(
        method: Method,
        path: string,
        queryParams?: Record<string, unknown>,
        body?: Record<string, unknown>,
        opts?: IRequestOpts,
    ): Promise<T>;
}

export async function updateScheduledDelayedEventWithActionInBody(
    http: DelayedEventsHttpClient,
    delayId: string,
    action: UpdateDelayedEventAction,
    unstableFeatureName: string,
    requestOptions: IRequestOpts = {},
): Promise<EmptyObject> {
    const path = buildDelayedEventsPath(delayId);
    const data = { action };
    try {
        return await http.request(Method.Post, path, undefined, data, {
            ...requestOptions,
            prefix: buildUnstableFeaturePrefix(unstableFeatureName),
        });
    } catch (e) {
        if (e instanceof MatrixError && e.errcode === "M_MISSING_TOKEN") {
            return await http.authedRequest(Method.Post, path, undefined, data, {
                ...requestOptions,
                prefix: buildUnstableFeaturePrefix(unstableFeatureName),
            });
        }
        throw e;
    }
}

export async function updateScheduledDelayedEventWithFallback(
    http: DelayedEventsHttpClient,
    delayId: string,
    action: UpdateDelayedEventAction,
    unstableFeatureName: string,
    requestOptions: IRequestOpts = {},
): Promise<EmptyObject> {
    try {
        const path = buildDelayedEventsActionPath(delayId, action);
        return await http.request(Method.Post, path, undefined, undefined, {
            ...requestOptions,
            prefix: buildUnstableFeaturePrefix(unstableFeatureName),
        });
    } catch (e) {
        if (e instanceof MatrixError && e.errcode === "M_UNRECOGNIZED") {
            return await updateScheduledDelayedEventWithActionInBody(
                http,
                delayId,
                action,
                unstableFeatureName,
                requestOptions,
            );
        }
        throw e;
    }
}
