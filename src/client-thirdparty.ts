import { Method, type Body, type IRequestOpts } from "./http-api/index.ts";
import type { IThirdPartyLocation, IThirdPartyUser } from "./client-internal-types.ts";
import type { IProtocol } from "./client-api-types.ts";
import type { QueryDict } from "./utils.ts";
import * as utils from "./utils.ts";

export interface AuthedRequestFn {
    <T>(method: Method, path: string, queryParams?: QueryDict, body?: Body, paramOpts?: IRequestOpts): Promise<T>;
}

export function getThirdpartyLocationRequest(
    protocol: string,
    params: { searchFields?: string[] },
    authedRequest: AuthedRequestFn,
): Promise<IThirdPartyLocation[]> {
    const path = utils.encodeUri("/thirdparty/location/$protocol", { $protocol: protocol });
    return authedRequest<IThirdPartyLocation[]>(Method.Get, path, params as QueryDict);
}

export function getThirdpartyUserRequest(
    protocol: string,
    params: QueryDict | undefined,
    authedRequest: AuthedRequestFn,
): Promise<IThirdPartyUser[]> {
    const path = utils.encodeUri("/thirdparty/user/$protocol", { $protocol: protocol });
    return authedRequest<IThirdPartyUser[]>(Method.Get, path, params);
}

export async function getThirdpartyProtocolsRequest(
    authedRequest: AuthedRequestFn,
): Promise<{ [protocol: string]: IProtocol }> {
    const response = await authedRequest<Record<string, IProtocol>>(Method.Get, "/thirdparty/protocols", undefined);
    if (!response || typeof response !== "object") {
        throw new Error(`/thirdparty/protocols did not return an object: ${response}`);
    }
    return response;
}
