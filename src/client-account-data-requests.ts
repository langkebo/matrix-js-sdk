import * as utils from "./utils.ts";
import { Method } from "./http-api/index.ts";
import type { Body, IRequestOpts } from "./http-api/index.ts";
import { ServerSupport } from "./feature.ts";
import type { QueryDict } from "./utils.ts";
import type { EmptyObject } from "./@types/common.ts";

export function buildUserAccountDataPath(userId: string | null, eventType: string): string {
    return utils.encodeUri("/user/$userId/account_data/$type", {
        $userId: userId,
        $type: eventType,
    });
}

export function buildUserAccountDataListPath(userId: string | null): string {
    return utils.encodeUri("/user/$userId/account_data/", {
        $userId: userId,
    });
}

export function buildRoomAccountDataPath(userId: string | null, roomId: string, eventType: string): string {
    return utils.encodeUri("/user/$userId/rooms/$roomId/account_data/$type", {
        $userId: userId,
        $roomId: roomId,
        $type: eventType,
    });
}

export function buildRoomTagsPath(userId: string | null, roomId: string): string {
    return utils.encodeUri("/user/$userId/rooms/$roomId/tags", {
        $userId: userId,
        $roomId: roomId,
    });
}

export function buildRoomTagPath(userId: string | null, roomId: string, tagName: string): string {
    return utils.encodeUri("/user/$userId/rooms/$roomId/tags/$tag", {
        $userId: userId,
        $roomId: roomId,
        $tag: tagName,
    });
}

export function buildCreateFilterPath(userId: string | null): string {
    return utils.encodeUri("/user/$userId/filter", {
        $userId: userId,
    });
}

export function buildFilterPath(userId: string | null, filterId: string): string {
    return utils.encodeUri("/user/$userId/filter/$filterId", {
        $userId: userId,
        $filterId: filterId,
    });
}

type AuthedRequestFn = <T>(
    method: Method,
    path: string,
    queryParams?: QueryDict,
    body?: Body,
    requestOpts?: IRequestOpts,
) => Promise<T>;

export function setUserAccountDataRequest(
    userId: string | null,
    eventType: string,
    content: Record<string, unknown>,
    authedRequest: AuthedRequestFn,
): Promise<EmptyObject> {
    return authedRequest(Method.Put, buildUserAccountDataPath(userId, eventType), undefined, content);
}

export function getUserAccountDataRequest<T>(
    userId: string | null,
    eventType: string,
    authedRequest: AuthedRequestFn,
): Promise<T> {
    return authedRequest<T>(Method.Get, buildUserAccountDataPath(userId, eventType));
}

export function deleteUserAccountDataRequest(
    userId: string | null,
    eventType: string,
    authedRequest: AuthedRequestFn,
    requestOpts?: IRequestOpts,
): Promise<void> {
    return authedRequest<void>(
        Method.Delete,
        buildUserAccountDataPath(userId, eventType),
        undefined,
        undefined,
        requestOpts,
    );
}

export function selectDeleteAccountDataRequestOptions(
    serverSupport: ServerSupport | undefined,
): IRequestOpts | undefined {
    if (serverSupport === ServerSupport.Unstable) {
        return { prefix: "/_matrix/client/unstable/org.matrix.msc3391" };
    }
    return undefined;
}
