import * as utils from "./utils";
import { ClientPrefix, MatrixError, Method } from "./http-api/index";
import type { Body, IRequestOpts } from "./http-api/index";
import type { QueryDict } from "./utils";
import { type Direction } from "./models/event-timeline";

type AuthedRequestFn = <T>(
    method: Method,
    path: string,
    queryParams?: QueryDict,
    body?: Body,
    requestOpts?: IRequestOpts,
) => Promise<T>;

export function buildRoomHierarchyPath(roomId: string): string {
    return utils.encodeUri("/rooms/$roomId/hierarchy", {
        $roomId: roomId,
    });
}

export function buildTimestampToEventPath(roomId: string): string {
    return utils.encodeUri("/rooms/$roomId/timestamp_to_event", {
        $roomId: roomId,
    });
}

export function buildRoomHierarchyQuery(
    limit?: number,
    maxDepth?: number,
    suggestedOnly = false,
    fromToken?: string,
): QueryDict {
    return {
        suggested_only: String(suggestedOnly),
        max_depth: maxDepth?.toString(),
        from: fromToken,
        limit: limit?.toString(),
    };
}

export async function getRoomHierarchyRequest<T>(
    roomId: string,
    limit: number | undefined,
    maxDepth: number | undefined,
    suggestedOnly: boolean,
    fromToken: string | undefined,
    authedRequest: AuthedRequestFn,
): Promise<T> {
    const path = buildRoomHierarchyPath(roomId);
    const queryParams = buildRoomHierarchyQuery(limit, maxDepth, suggestedOnly, fromToken);
    try {
        return await authedRequest<T>(Method.Get, path, queryParams, undefined, {
            prefix: ClientPrefix.V1,
        });
    } catch (e) {
        if ((e as MatrixError).errcode === "M_UNRECOGNIZED") {
            return authedRequest<T>(Method.Get, path, queryParams, undefined, {
                prefix: "/_matrix/client/unstable/org.matrix.msc2946",
            });
        }
        throw e;
    }
}

export async function timestampToEventRequest<T>(
    roomId: string,
    timestamp: number,
    dir: Direction,
    authedRequest: AuthedRequestFn,
): Promise<T> {
    const path = buildTimestampToEventPath(roomId);
    const queryParams: QueryDict = {
        ts: timestamp.toString(),
        dir,
    };

    try {
        return await authedRequest<T>(Method.Get, path, queryParams, undefined, {
            prefix: ClientPrefix.V1,
        });
    } catch (err) {
        const matrixErr = err as MatrixError;
        if (
            matrixErr.errcode === "M_UNRECOGNIZED" &&
            (matrixErr.httpStatus === 400 || matrixErr.httpStatus === 404 || matrixErr.httpStatus === 405)
        ) {
            return await authedRequest<T>(Method.Get, path, queryParams, undefined, {
                prefix: "/_matrix/client/unstable/org.matrix.msc3030",
            });
        }

        throw err;
    }
}
