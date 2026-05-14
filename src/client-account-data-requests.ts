import * as utils from "./utils";
import { Method } from "./http-api/index";
import type { Body, IRequestOpts } from "./http-api/index";
import { ServerSupport } from "./feature";
import type { QueryDict } from "./utils";
import type { EmptyObject } from "./@types/common";
import type { AccountDataPathPattern } from "./account-data/__generated__/route-table";

type StripV3<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;

function adp<P extends StripV3<AccountDataPathPattern>>(path: P): P {
    return path;
}

export function buildUserAccountDataPath(userId: string | null, eventType: string): string {
    return adp(
        utils.encodeUri("/user/$userId/account_data/$type", {
            $userId: userId,
            $type: eventType,
        }) as StripV3<AccountDataPathPattern>,
    );
}

export function buildUserAccountDataListPath(userId: string | null): string {
    return adp(
        utils.encodeUri("/user/$userId/account_data/", {
            $userId: userId,
        }) as StripV3<AccountDataPathPattern>,
    );
}

export function buildRoomAccountDataPath(userId: string | null, roomId: string, eventType: string): string {
    return adp(
        utils.encodeUri("/user/$userId/rooms/$roomId/account_data/$type", {
            $userId: userId,
            $roomId: roomId,
            $type: eventType,
        }) as StripV3<AccountDataPathPattern>,
    );
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
    return adp(utils.encodeUri("/user/$userId/filter", { $userId: userId }) as StripV3<AccountDataPathPattern>);
}

export function buildFilterPath(userId: string | null, filterId: string): string {
    return adp(
        utils.encodeUri("/user/$userId/filter/$filterId", {
            $userId: userId,
            $filterId: filterId,
        }) as StripV3<AccountDataPathPattern>,
    );
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
