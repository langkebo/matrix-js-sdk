import { type Body, ClientPrefix, type IRequestOpts, MatrixError, Method } from "./http-api/index";
import { type QueryDict } from "./utils";
import {
    discoverAndValidateOIDCIssuerWellKnown,
    type OidcClientConfig,
    validateAuthMetadataAndKeys,
} from "./oidc/index";

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
        if (e instanceof MatrixError && e.errcode === "M_UNRECOGNIZED") {
            // Fall back to older variant of MSC2965
            const { issuer } = await request<{ issuer: string }>(Method.Get, "/auth_issuer", undefined, undefined, {
                prefix: ClientPrefix.Unstable + "/org.matrix.msc2965",
            });
            return discoverAndValidateOIDCIssuerWellKnown(issuer);
        }
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
