/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { encodeUri } from "./utils";

export interface SendEventPathParams {
    roomId: string;
    eventType: string;
    stateKey?: string | null;
    txnId: string;
    isState: boolean;
    isRedaction: boolean;
    redactsEventId?: string;
}

export function buildSendEventPath(params: SendEventPathParams): string {
    const pathParams = {
        $roomId: params.roomId,
        $eventType: params.eventType,
        $stateKey: params.stateKey ?? "",
        $txnId: params.txnId,
    };

    if (params.isState) {
        let pathTemplate = "/rooms/$roomId/state/$eventType";
        if (params.stateKey && params.stateKey.length > 0) {
            pathTemplate = "/rooms/$roomId/state/$eventType/$stateKey";
        }
        return encodeUri(pathTemplate, pathParams);
    }

    if (params.isRedaction && params.redactsEventId) {
        return encodeUri("/rooms/$roomId/redact/$redactsEventId/$txnId", {
            ...pathParams,
            $redactsEventId: params.redactsEventId,
        });
    }

    return encodeUri("/rooms/$roomId/send/$eventType/$txnId", pathParams);
}
