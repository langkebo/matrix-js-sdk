import * as utils from "./utils";
import { Method, type Body, type IRequestOpts } from "./http-api/index";
import { ClientPrefix } from "./http-api/prefix";
import type { QueryDict } from "./utils";
import type { SearchPath } from "./search/__generated__/route-table";
import type { PathAssert, StripV3 } from "./http-api/strip-prefix";

type AuthedRequestFn = <T>(
    method: Method,
    path: string,
    queryParams?: QueryDict,
    body?: Body,
    requestOpts?: IRequestOpts,
) => Promise<T>;

function srp<const P extends string>(path: P & PathAssert<P, StripV3<SearchPath>>): P {
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
