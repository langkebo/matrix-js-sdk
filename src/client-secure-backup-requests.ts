import * as utils from "./utils.ts";
import { ClientPrefix, Method } from "./http-api/index.ts";
import type { Body, IRequestOpts } from "./http-api/index.ts";
import type { QueryDict } from "./utils.ts";
import type { EmptyObject } from "./@types/common.ts";

type AuthedRequestFn = <T>(
    method: Method,
    path: string,
    queryParams?: QueryDict,
    body?: Body,
    requestOpts?: IRequestOpts,
) => Promise<T>;

export function buildSecureBackupPath(backupId: string): string {
    return utils.encodeUri("/keys/backup/secure/$backupId", { $backupId: backupId });
}

export function buildSecureBackupVerifyPath(backupId: string): string {
    return utils.encodeUri("/keys/backup/secure/$backupId/verify", { $backupId: backupId });
}

export function buildSecureBackupKeysPath(backupId: string): string {
    return utils.encodeUri("/keys/backup/secure/$backupId/keys", { $backupId: backupId });
}

export function buildSecureBackupRestorePath(backupId: string): string {
    return utils.encodeUri("/keys/backup/secure/$backupId/restore", { $backupId: backupId });
}

export function getMyRoomsRequest<T>(authedRequest: AuthedRequestFn): Promise<T> {
    return authedRequest<T>(Method.Get, "/my_rooms", undefined, undefined, {
        prefix: ClientPrefix.V3,
    });
}

/** POST /_matrix/client/v3/search_rooms */
export function searchRoomsRequest<T>(authedRequest: AuthedRequestFn, searchTerm: string, limit?: number): Promise<T> {
    return authedRequest<T>(
        Method.Post,
        "/search_rooms",
        undefined,
        { search_term: searchTerm, limit },
        { prefix: ClientPrefix.V3 },
    );
}

/** GET /_matrix/client/v1/config/client */
export function getClientConfigRequest<T>(authedRequest: AuthedRequestFn): Promise<T> {
    return authedRequest<T>(Method.Get, "/config/client", undefined, undefined, {
        prefix: ClientPrefix.V1,
    });
}

/** GET /_matrix/client/v3/login/sso/userinfo */
export function getSSOUserInfoRequest<T>(authedRequest: AuthedRequestFn): Promise<T> {
    return authedRequest<T>(Method.Get, "/login/sso/userinfo", undefined, undefined, {
        prefix: ClientPrefix.V3,
    });
}

export function createSecureBackupRequest<T>(passphrase: string, authedRequest: AuthedRequestFn): Promise<T> {
    return authedRequest<T>(Method.Post, "/keys/backup/secure", undefined, { passphrase }, { prefix: ClientPrefix.V3 });
}

export function getSecureBackupRequest<T>(backupId: string, authedRequest: AuthedRequestFn): Promise<T> {
    return authedRequest<T>(Method.Get, buildSecureBackupPath(backupId), undefined, undefined, {
        prefix: ClientPrefix.V3,
    });
}

export function verifySecureBackupPassphraseRequest<T>(
    backupId: string,
    passphrase: string,
    authedRequest: AuthedRequestFn,
): Promise<T> {
    return authedRequest<T>(
        Method.Post,
        buildSecureBackupVerifyPath(backupId),
        undefined,
        { passphrase },
        {
            prefix: ClientPrefix.V3,
        },
    );
}

export function storeSecureBackupKeysRequest<T>(
    backupId: string,
    passphrase: string,
    sessionKeys: unknown[],
    authedRequest: AuthedRequestFn,
): Promise<T> {
    return authedRequest<T>(
        Method.Post,
        buildSecureBackupKeysPath(backupId),
        undefined,
        { passphrase, session_keys: sessionKeys },
        { prefix: ClientPrefix.V3 },
    );
}

export function restoreSecureBackupRequest<T>(
    backupId: string,
    passphrase: string,
    authedRequest: AuthedRequestFn,
): Promise<T> {
    return authedRequest<T>(
        Method.Post,
        buildSecureBackupRestorePath(backupId),
        undefined,
        { passphrase },
        {
            prefix: ClientPrefix.V3,
        },
    );
}

export function deleteSecureBackupRequest(backupId: string, authedRequest: AuthedRequestFn): Promise<EmptyObject> {
    return authedRequest<EmptyObject>(Method.Delete, buildSecureBackupPath(backupId), undefined, undefined, {
        prefix: ClientPrefix.V3,
    });
}
