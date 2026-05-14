import * as utils from "./utils";
import { ClientPrefix, Method } from "./http-api/index";
import type { Body, IRequestOpts } from "./http-api/index";
import type { QueryDict } from "./utils";
import type { IEvent, IContent } from "./models/event";
import type { IRoomDirectoryOptions, ISearchOpts } from "./@types/requests";
import type {
    IJoinedMembersResponse,
    IJoinedRoomsResponse,
    IRoomInitialSyncResponse,
    IPublicRoomsResponse,
    IOpenIDToken,
} from "./client";
import type { IStateEventWithRoomId, ISearchRequestBody, ISearchResponse } from "./@types/search";
import type { EmptyObject } from "./@types/common";
import type { Visibility } from "./@types/partials";
import { ReceiptType } from "./@types/read_receipts";
import type { SyncPathPattern } from "./sync/__generated__/route-table";
import type { AccountDataPathPattern } from "./account-data/__generated__/route-table";

type AuthedRequestFn = <T>(
    method: Method,
    path: string,
    queryParams?: QueryDict,
    body?: Body,
    requestOpts?: IRequestOpts,
) => Promise<T>;

type StripV3<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;

function sp<P extends StripV3<SyncPathPattern>>(path: P): P {
    return path;
}

function adp<P extends StripV3<AccountDataPathPattern>>(path: P): P {
    return path;
}

export function buildRoomStatePath(roomId: string): string {
    return utils.encodeUri("/rooms/$roomId/state", { $roomId: roomId });
}

export function buildStateEventPath(roomId: string, eventType: string, stateKey?: string): string {
    const pathParams: Record<string, string | undefined> = {
        $roomId: roomId,
        $eventType: eventType,
        $stateKey: stateKey,
    };
    let path = utils.encodeUri("/rooms/$roomId/state/$eventType", pathParams);
    if (stateKey !== undefined) {
        path = utils.encodeUri(path + "/$stateKey", pathParams);
    }
    return path;
}

export function roomStateRequest(roomId: string, authedRequest: AuthedRequestFn): Promise<IStateEventWithRoomId[]> {
    const path = utils.encodeUri("/rooms/$roomId/state", { $roomId: roomId });
    return authedRequest<IStateEventWithRoomId[]>(Method.Get, path);
}

export function fetchRoomEventRequest(
    roomId: string,
    eventId: string,
    authedRequest: AuthedRequestFn,
): Promise<Partial<IEvent>> {
    const path = utils.encodeUri("/rooms/$roomId/event/$eventId", { $roomId: roomId, $eventId: eventId });
    return authedRequest<Partial<IEvent>>(Method.Get, path);
}

export function membersRequest(
    roomId: string,
    includeMembership: string | undefined,
    excludeMembership: string | undefined,
    atEventId: string | undefined,
    authedRequest: AuthedRequestFn,
): Promise<{ [userId: string]: IStateEventWithRoomId[] }> {
    const queryParams: Record<string, string> = {};
    if (includeMembership) queryParams.membership = includeMembership;
    if (excludeMembership) queryParams.not_membership = excludeMembership;
    if (atEventId) queryParams.at = atEventId;
    const path = utils.encodeUri("/rooms/$roomId/members?" + utils.encodeParams(queryParams), { $roomId: roomId });
    return authedRequest<{ [userId: string]: IStateEventWithRoomId[] }>(Method.Get, path);
}

export function getJoinedRoomMembersRequest(
    roomId: string,
    authedRequest: AuthedRequestFn,
): Promise<IJoinedMembersResponse> {
    const path = utils.encodeUri("/rooms/$roomId/joined_members", { $roomId: roomId });
    return authedRequest<IJoinedMembersResponse>(Method.Get, path);
}

export async function setRoomReadMarkersRequest(
    roomId: string,
    rmEventId: string,
    rrEventId: string | undefined,
    rpEventId: string | undefined,
    supportsPrivateReadReceipt: () => Promise<boolean>,
    authedRequest: AuthedRequestFn,
): Promise<EmptyObject> {
    const path = utils.encodeUri("/rooms/$roomId/read_markers", { $roomId: roomId });
    const content: IContent = {
        [ReceiptType.FullyRead]: rmEventId,
        [ReceiptType.Read]: rrEventId,
    };
    if (await supportsPrivateReadReceipt()) {
        content[ReceiptType.ReadPrivate] = rpEventId;
    }
    return authedRequest<EmptyObject>(Method.Post, path, undefined, content);
}

export function roomInitialSyncRequest(
    roomId: string,
    limit: number,
    authedRequest: AuthedRequestFn,
): Promise<IRoomInitialSyncResponse> {
    const path = utils.encodeUri("/rooms/$roomId/initialSync", { $roomId: roomId });
    return authedRequest<IRoomInitialSyncResponse>(Method.Get, path, { limit: limit?.toString() ?? "30" });
}

export function getJoinedRoomsRequest(authedRequest: AuthedRequestFn): Promise<IJoinedRoomsResponse> {
    return authedRequest<IJoinedRoomsResponse>(Method.Get, sp("/joined_rooms"), undefined, undefined, {
        prefix: ClientPrefix.V3,
    });
}

export function publicRoomsRequest(
    roomDirectoryOptions: IRoomDirectoryOptions,
    authedRequest: AuthedRequestFn,
): Promise<IPublicRoomsResponse> {
    const { server, limit, since, ...options } = roomDirectoryOptions;
    if (Object.keys(options).length === 0) {
        const queryParams: QueryDict = { server, limit, since };
        return authedRequest<IPublicRoomsResponse>(Method.Get, "/publicRooms", queryParams);
    }
    const queryParams: QueryDict = { server };
    const body = { limit, since, ...options };
    return authedRequest<IPublicRoomsResponse>(Method.Post, "/publicRooms", queryParams, body);
}

export function createAliasRequest(
    alias: string,
    roomId: string,
    authedRequest: AuthedRequestFn,
): Promise<EmptyObject> {
    const path = utils.encodeUri("/directory/room/$alias", { $alias: alias });
    return authedRequest<EmptyObject>(Method.Put, path, undefined, { room_id: roomId });
}

export function deleteAliasRequest(alias: string, authedRequest: AuthedRequestFn): Promise<EmptyObject> {
    const path = utils.encodeUri("/directory/room/$alias", { $alias: alias });
    return authedRequest<EmptyObject>(Method.Delete, path);
}

export function getLocalAliasesRequest(roomId: string, authedRequest: AuthedRequestFn): Promise<{ aliases: string[] }> {
    const path = utils.encodeUri("/rooms/$roomId/aliases", { $roomId: roomId });
    return authedRequest<{ aliases: string[] }>(Method.Get, path, undefined, undefined, { prefix: ClientPrefix.V3 });
}

export function getRoomIdForAliasRequest(
    alias: string,
    authedRequest: AuthedRequestFn,
): Promise<{ room_id: string; servers: string[] }> {
    const path = utils.encodeUri("/directory/room/$alias", { $alias: alias });
    return authedRequest<{ room_id: string; servers: string[] }>(Method.Get, path);
}

export function getRoomDirectoryVisibilityRequest(
    roomId: string,
    authedRequest: AuthedRequestFn,
): Promise<{ visibility: Visibility }> {
    const path = utils.encodeUri("/directory/list/room/$roomId", { $roomId: roomId });
    return authedRequest<{ visibility: Visibility }>(Method.Get, path);
}

export function setRoomDirectoryVisibilityRequest(
    roomId: string,
    visibility: Visibility,
    authedRequest: AuthedRequestFn,
): Promise<EmptyObject> {
    const path = utils.encodeUri("/directory/list/room/$roomId", { $roomId: roomId });
    return authedRequest<EmptyObject>(Method.Put, path, undefined, { visibility });
}

export function buildSearchMessageRequestBody(opts: ISearchOpts): ISearchRequestBody {
    const roomEvents: ISearchRequestBody["search_categories"]["room_events"] = {
        search_term: opts.query,
    };
    if ("keys" in opts) roomEvents.keys = opts.keys;
    return { search_categories: { room_events: roomEvents } };
}

export function searchMessageTextRequest(
    opts: ISearchOpts,
    search: (opts: { body: ISearchRequestBody }) => Promise<ISearchResponse>,
): Promise<ISearchResponse> {
    return search({ body: buildSearchMessageRequestBody(opts) });
}

export function getOpenIdTokenRequest(userId: string, authedRequest: AuthedRequestFn): Promise<IOpenIDToken> {
    const path = adp(
        utils.encodeUri("/user/$userId/openid/request_token", {
            $userId: userId,
        }) as StripV3<AccountDataPathPattern>,
    );
    return authedRequest<IOpenIDToken>(Method.Post, path, undefined, {});
}
