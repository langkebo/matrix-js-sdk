import * as utils from "./utils";
import { Method, type Body, type IRequestOpts } from "./http-api/index";
import { ClientPrefix } from "./http-api/prefix";
import type { QueryDict } from "./utils";
import type { SearchPathPattern } from "./search/__generated__/route-table";

type AuthedRequestFn = <T>(
    method: Method,
    path: string,
    queryParams?: QueryDict,
    body?: Body,
    requestOpts?: IRequestOpts,
) => Promise<T>;

type StripV3<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;

function srp<P extends StripV3<SearchPathPattern>>(path: P): P {
    return path;
}

export function performSearchRequest<T>(
    body: Body,
    nextBatch: string | undefined,
    abortSignal: AbortSignal | undefined,
    authedRequest: AuthedRequestFn,
): Promise<T> {
    const queryParams: QueryDict = {};
    if (nextBatch) {
        queryParams.next_batch = nextBatch;
    }
    return authedRequest<T>(Method.Post, srp("/search"), queryParams, body, { abortSignal });
}

export function uploadKeysHttpRequest<T>(content: Body, authedRequest: AuthedRequestFn): Promise<T> {
    return authedRequest<T>(Method.Post, "/keys/upload", undefined, content);
}

export function uploadKeySignaturesHttpRequest<T>(content: Body, authedRequest: AuthedRequestFn): Promise<T> {
    return authedRequest<T>(Method.Post, "/keys/signatures/upload", undefined, content);
}

export function queryKeysForUsersRequest<T>(
    userIds: string[],
    token: string | undefined,
    authedRequest: AuthedRequestFn,
): Promise<T> {
    const content: Record<string, unknown> = {
        device_keys: {},
    };
    if (token !== undefined) {
        content.token = token;
    }
    const deviceKeys = content.device_keys as Record<string, string[]>;
    userIds.forEach((u) => {
        deviceKeys[u] = [];
    });

    return authedRequest<T>(Method.Post, "/keys/query", undefined, content);
}

export function claimOneTimeKeysHttpRequest<T>(
    devices: [string, string][],
    keyAlgorithm = "signed_curve25519",
    timeout: number | undefined,
    authedRequest: AuthedRequestFn,
): Promise<T> {
    const queries: Record<string, Record<string, string>> = {};

    if (keyAlgorithm === undefined) {
        keyAlgorithm = "signed_curve25519";
    }

    for (const [userId, deviceId] of devices) {
        const query = queries[userId] || {};
        utils.safeSet(queries, userId, query);
        utils.safeSet(query, deviceId, keyAlgorithm);
    }
    const content: Record<string, unknown> = { one_time_keys: queries };
    if (timeout) {
        content.timeout = timeout;
    }
    return authedRequest<T>(Method.Post, "/keys/claim", undefined, content);
}

export function getKeyChangesRequest<T>(
    oldToken: string,
    newToken: string,
    authedRequest: AuthedRequestFn,
): Promise<T> {
    const qps = {
        from: oldToken,
        to: newToken,
    };
    return authedRequest<T>(Method.Get, "/keys/changes", qps);
}

export function uploadDeviceSigningKeysHttpRequest<T>(
    auth: Body | undefined,
    keys: Body | undefined,
    authedRequest: AuthedRequestFn,
): Promise<T> {
    const data = Object.assign({}, keys);
    if (auth) Object.assign(data, { auth });
    return authedRequest<T>(Method.Post, "/keys/device_signing/upload", undefined, data, {
        prefix: ClientPrefix.V3,
    });
}

export function requestRoomKeyHttpRequest<T>(request: Body, authedRequest: AuthedRequestFn): Promise<T> {
    return authedRequest<T>(Method.Post, "/room_keys/request", undefined, request, {
        prefix: ClientPrefix.V3,
    });
}

export function getRoomKeyRequestsHttpRequest<T>(query: QueryDict, authedRequest: AuthedRequestFn): Promise<T> {
    return authedRequest<T>(Method.Get, "/room_keys/request", query, undefined, {
        prefix: ClientPrefix.V3,
    });
}

export function deleteRoomKeyRequestHttpRequest<T>(requestId: string, authedRequest: AuthedRequestFn): Promise<T> {
    const path = utils.encodeUri("/room_keys/request/$requestId", {
        $requestId: requestId,
    });
    return authedRequest<T>(Method.Delete, path, undefined, undefined, {
        prefix: ClientPrefix.V3,
    });
}

export function startDeviceSigningVerificationRequest<T>(
    request: Body,
    prefix: string,
    authedRequest: AuthedRequestFn,
): Promise<T> {
    return authedRequest<T>(Method.Post, "/keys/device_signing/verify_start", undefined, request, { prefix });
}

export function acceptDeviceSigningVerificationRequest<T>(
    request: Body,
    prefix: string,
    authedRequest: AuthedRequestFn,
): Promise<T> {
    return authedRequest<T>(Method.Put, "/keys/device_signing/verify_accept", undefined, request, { prefix });
}

export function sendDeviceSigningVerificationKeyAgreementRequest<T>(
    request: Body,
    prefix: string,
    authedRequest: AuthedRequestFn,
): Promise<T> {
    return authedRequest<T>(Method.Post, "/keys/device_signing/verify_key_agreement", undefined, request, { prefix });
}

export function confirmDeviceSigningVerificationMacRequest<T>(
    request: Body,
    prefix: string,
    authedRequest: AuthedRequestFn,
): Promise<T> {
    return authedRequest<T>(Method.Post, "/keys/device_signing/verify_mac", undefined, request, { prefix });
}

export function completeDeviceSigningVerificationRequest<T>(
    request: Body,
    prefix: string,
    authedRequest: AuthedRequestFn,
): Promise<T> {
    return authedRequest<T>(Method.Post, "/keys/device_signing/verify_done", undefined, request, { prefix });
}

export function cancelDeviceSigningVerificationRequest<T>(
    request: Body,
    prefix: string,
    authedRequest: AuthedRequestFn,
): Promise<T> {
    return authedRequest<T>(Method.Post, "/keys/device_signing/verify_cancel", undefined, request, { prefix });
}

export function getVerificationRequestsHttpRequest<T>(prefix: string, authedRequest: AuthedRequestFn): Promise<T> {
    return authedRequest<T>(Method.Get, "/keys/device_signing/requests", undefined, undefined, { prefix });
}

export function showQrCodeHttpRequest<T>(prefix: string, authedRequest: AuthedRequestFn): Promise<T> {
    return authedRequest<T>(Method.Get, "/keys/qr_code/show", undefined, undefined, { prefix });
}

export function scanQrCodeHttpRequest<T>(request: Body, prefix: string, authedRequest: AuthedRequestFn): Promise<T> {
    return authedRequest<T>(Method.Post, "/keys/qr_code/scan", undefined, request, { prefix });
}
