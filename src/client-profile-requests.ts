import * as utils from "./utils";
import { ClientPrefix, Method } from "./http-api/index";
import type { Body, IRequestOpts } from "./http-api/index";
import type { QueryDict } from "./utils";
import type { EmptyObject } from "./@types/common";
import type { IThreepid } from "./@types/three-pids";
import type { IAddThreePidOnlyBody, IBindThreePidBody } from "./@types/requests";
import type { IdServerUnbindResult } from "./@types/partials";
import type { IContent } from "./models/event";

export type ProfileField = "displayname" | "avatar_url";

export function selectExtendedProfileRequestPrefix(
    isVersionSupportedV116: boolean,
    hasStableMsc4133Feature: boolean,
): string {
    if (isVersionSupportedV116 || hasStableMsc4133Feature) {
        return ClientPrefix.V3;
    }
    return "/_matrix/client/unstable/uk.tcpip.msc4133";
}

export function buildProfilePath(userId: string | null): string {
    return utils.encodeUri("/profile/$userId", { $userId: userId });
}

export function buildProfileFieldPath(userId: string | null, field: ProfileField): string {
    return utils.encodeUri("/profile/$userId/$field", { $userId: userId, $field: field });
}

export function buildExtendedProfilePropertyPath(userId: string | null, key: string): string {
    return utils.encodeUri("/profile/$userId/$key", { $userId: userId, $key: key });
}

export function buildDisplayNameBody(displayname: string): { displayname: string } {
    return { displayname };
}

export function buildAvatarUrlBody(avatarUrl: string): { avatar_url: string } {
    return { avatar_url: avatarUrl };
}

export function buildExtendedProfilePropertyBody(key: string, value: unknown): IContent {
    return { [key]: value };
}

type AuthedRequestFn = <T>(
    method: Method,
    path: string,
    queryParams?: QueryDict,
    body?: Body,
    requestOpts?: IRequestOpts,
) => Promise<T>;

export function getExtendedProfileRequest(
    userId: string,
    requestPrefix: string,
    authedRequest: AuthedRequestFn,
): Promise<Record<string, unknown>> {
    return authedRequest<Record<string, unknown>>(Method.Get, buildProfilePath(userId), undefined, undefined, {
        prefix: requestPrefix,
    });
}

export async function getExtendedProfilePropertyRequest(
    userId: string,
    key: string,
    requestPrefix: string,
    authedRequest: AuthedRequestFn,
): Promise<unknown> {
    const profile = await authedRequest<Record<string, unknown>>(
        Method.Get,
        buildExtendedProfilePropertyPath(userId, key),
        undefined,
        undefined,
        {
            prefix: requestPrefix,
        },
    );
    return profile[key];
}

export function setExtendedProfilePropertyRequest(
    userId: string | null,
    key: string,
    value: unknown,
    requestPrefix: string,
    authedRequest: AuthedRequestFn,
): Promise<void> {
    return authedRequest<void>(
        Method.Put,
        buildExtendedProfilePropertyPath(userId, key),
        undefined,
        buildExtendedProfilePropertyBody(key, value),
        {
            prefix: requestPrefix,
        },
    );
}

export function deleteExtendedProfilePropertyRequest(
    userId: string | null,
    key: string,
    requestPrefix: string,
    authedRequest: AuthedRequestFn,
): Promise<void> {
    return authedRequest<void>(Method.Delete, buildExtendedProfilePropertyPath(userId, key), undefined, undefined, {
        prefix: requestPrefix,
    });
}

export function patchExtendedProfileRequest(
    userId: string | null,
    profile: Record<string, unknown>,
    requestPrefix: string,
    authedRequest: AuthedRequestFn,
): Promise<Record<string, unknown>> {
    return authedRequest<Record<string, unknown>>(Method.Patch, buildProfilePath(userId), {}, profile, {
        prefix: requestPrefix,
    });
}

export function setExtendedProfileRequest(
    userId: string | null,
    profile: Record<string, unknown>,
    requestPrefix: string,
    authedRequest: AuthedRequestFn,
): Promise<void> {
    return authedRequest<void>(Method.Put, buildProfilePath(userId), {}, profile, {
        prefix: requestPrefix,
    });
}

export function getThreePidsRequest(authedRequest: AuthedRequestFn): Promise<{ threepids: IThreepid[] }> {
    return authedRequest<{ threepids: IThreepid[] }>(Method.Get, "/account/3pid");
}

export function addThreePidOnlyRequest(
    data: IAddThreePidOnlyBody,
    authedRequest: AuthedRequestFn,
): Promise<EmptyObject> {
    return authedRequest<EmptyObject>(Method.Post, "/account/3pid/add", undefined, data);
}

export function bindThreePidRequest(data: IBindThreePidBody, authedRequest: AuthedRequestFn): Promise<EmptyObject> {
    return authedRequest<EmptyObject>(Method.Post, "/account/3pid/bind", undefined, data);
}

export function unbindThreePidRequest(
    medium: string,
    address: string,
    idServer: string | undefined,
    authedRequest: AuthedRequestFn,
): Promise<{ id_server_unbind_result: IdServerUnbindResult }> {
    return authedRequest<{ id_server_unbind_result: IdServerUnbindResult }>(
        Method.Post,
        "/account/3pid/unbind",
        undefined,
        {
            medium,
            address,
            id_server: idServer,
        },
    );
}

export function deleteThreePidRequest(
    medium: string,
    address: string,
    authedRequest: AuthedRequestFn,
): Promise<{ id_server_unbind_result: IdServerUnbindResult }> {
    return authedRequest<{ id_server_unbind_result: IdServerUnbindResult }>(
        Method.Post,
        "/account/3pid/delete",
        undefined,
        { medium, address },
    );
}
