import * as utils from "./utils";
import { ClientPrefix, Method, VendorPrefix } from "./http-api/index";
import type { Body, IRequestOpts } from "./http-api/index";
import type { QueryDict } from "./utils";
import type { EmptyObject } from "./@types/common";
import type { SyncPath } from "./sync/__generated__/route-table";
import type { SearchPath } from "./search/__generated__/route-table";
import type { RoomPath } from "./room/__generated__/route-table";
import type { PathAssert, StripClientV3OrVendorV1, StripVendor } from "./http-api/strip-prefix";

type AuthedRequestFn = <T>(
    method: Method,
    path: string,
    queryParams?: QueryDict,
    body?: Body,
    requestOpts?: IRequestOpts,
) => Promise<T>;

// `my_rooms` 属 room 模块表（`/_matrix/vendor/v1/my_rooms`），故断言空间是 SyncPath ∪ RoomPath(vendor)。
function sp<const P extends string>(
    path: P & PathAssert<P, StripClientV3OrVendorV1<SyncPath> | StripVendor<RoomPath>>,
): P {
    return path;
}

function srp<const P extends string>(path: P & PathAssert<P, StripClientV3OrVendorV1<SearchPath>>): P {
    return path;
}

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

/** GET /_matrix/vendor/v1/my_rooms */
export function getMyRoomsRequest<T>(authedRequest: AuthedRequestFn): Promise<T> {
    return authedRequest<T>(Method.Get, sp("/my_rooms"), undefined, undefined, {
        prefix: VendorPrefix,
    });
}

/** POST /_matrix/vendor/v1/search_rooms */
export function searchRoomsRequest<T>(authedRequest: AuthedRequestFn, searchTerm: string, limit?: number): Promise<T> {
    return authedRequest<T>(
        Method.Post,
        srp("/search_rooms"),
        undefined,
        { search_term: searchTerm, limit },
        { prefix: VendorPrefix },
    );
}

/** POST /_matrix/vendor/v1/search_recipients */
export function searchRecipientsRequest<T>(
    authedRequest: AuthedRequestFn,
    searchTerm: string,
    limit?: number,
): Promise<T> {
    return authedRequest<T>(
        Method.Post,
        srp("/search_recipients"),
        undefined,
        { search_term: searchTerm, limit },
        { prefix: VendorPrefix },
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
