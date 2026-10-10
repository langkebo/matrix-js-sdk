import { type Body, ClientPrefix, type IRequestOpts, Method } from "./http-api/index";
import { type QueryDict } from "./utils";
import { type OidcClientConfig, validateAuthMetadataAndKeys } from "./oidc/index";

export function buildEmailTokenRequestParams(
    email: string,
    clientSecret: string,
    sendAttempt: number,
    nextLink?: string,
): QueryDict {
    return {
        email,
        client_secret: clientSecret,
        send_attempt: sendAttempt,
        next_link: nextLink,
    };
}

export function buildMsisdnTokenRequestParams(
    phoneCountry: string,
    phoneNumber: string,
    clientSecret: string,
    sendAttempt: number,
    nextLink?: string,
): QueryDict {
    return {
        country: phoneCountry,
        phone_number: phoneNumber,
        client_secret: clientSecret,
        send_attempt: sendAttempt,
        next_link: nextLink,
    };
}

type RequestFn = <T>(
    method: Method,
    path: string,
    queryParams?: QueryDict,
    data?: Body,
    opts?: IRequestOpts,
) => Promise<T>;

export async function fetchAuthMetadataWithFallback(
    request: RequestFn,
    isVersionSupported: (version: string) => Promise<boolean>,
): Promise<OidcClientConfig> {
    let authMetadata: unknown | undefined;
    try {
        const useStable = await isVersionSupported("v1.15");
        authMetadata = await request<unknown>(Method.Get, "/auth_metadata", undefined, undefined, {
            prefix: useStable ? ClientPrefix.V1 : ClientPrefix.Unstable + "/org.matrix.msc2965",
        });
    } catch (e) {
        // ⚠️ 这里曾回退到 `GET /_matrix/client/unstable/org.matrix.msc2965/auth_issuer`，
        // 但后端从未注册该路由（`assembly.rs` 只有 `auth_metadata`）⇒ 一旦落入必然 404，
        // 属「回退即失败」的死路径，按铁律 1 删除。
        throw e;
    }

    return validateAuthMetadataAndKeys(authMetadata);
}

export async function requestTokenFromEndpoint<T extends { sid?: string }>(
    endpoint: string,
    params: QueryDict,
    request: RequestFn,
): Promise<T> {
    const postParams = Object.assign({}, params);
    return request<T>(Method.Post, endpoint, undefined, postParams);
}
