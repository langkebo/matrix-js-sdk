import { encodeUnpaddedBase64Url } from "./base64.ts";
import { sha256 } from "./digest.ts";
import { IdentityPrefix, Method } from "./http-api/index.ts";
import type { EmptyObject } from "./@types/common.ts";

export interface IdentityHashDetails {
    algorithms: string[];
    lookup_pepper: string;
}

export interface IdentityLookupResult {
    address: string;
    mxid: string;
}

export interface IdServerRequestFn {
    <T extends object = Record<string, unknown>>(
        method: Method,
        path: string,
        params: Record<string, string | string[]> | undefined,
        prefix: string,
        accessToken?: string,
    ): Promise<T>;
}

export async function getIdentityHashDetailsRequest(
    idServerRequest: IdServerRequestFn,
    identityAccessToken: string,
): Promise<IdentityHashDetails> {
    return idServerRequest<IdentityHashDetails>(
        Method.Get,
        "/hash_details",
        undefined,
        IdentityPrefix.V2,
        identityAccessToken,
    );
}

export async function identityHashedLookupRequest(
    addressPairs: [string, string][],
    identityAccessToken: string,
    idServerRequest: IdServerRequestFn,
): Promise<IdentityLookupResult[]> {
    const params: Record<string, string | string[]> = {};

    const hashes = await getIdentityHashDetailsRequest(idServerRequest, identityAccessToken);
    if (!hashes || !hashes["lookup_pepper"] || !hashes["algorithms"]) {
        throw new Error("Unsupported identity server: bad response");
    }

    params["pepper"] = hashes["lookup_pepper"];

    const localMapping: Record<string, string> = {};

    if (hashes["algorithms"].includes("sha256")) {
        params["addresses"] = await Promise.all(
            addressPairs.map(async (p) => {
                const addr = p[0].toLowerCase();
                const med = p[1].toLowerCase();
                const hashBuffer = await sha256(`${addr} ${med} ${params["pepper"]}`);
                const hashed = encodeUnpaddedBase64Url(hashBuffer);
                localMapping[hashed] = p[0];
                return hashed;
            }),
        );
        params["algorithm"] = "sha256";
    } else if (hashes["algorithms"].includes("none")) {
        params["addresses"] = addressPairs.map((p) => {
            const addr = p[0].toLowerCase();
            const med = p[1].toLowerCase();
            const unhashed = `${addr} ${med}`;
            localMapping[unhashed] = p[0];
            return unhashed;
        });
        params["algorithm"] = "none";
    } else {
        throw new Error("Unsupported identity server: unknown hash algorithm");
    }

    const response = await idServerRequest<{ mappings: { [address: string]: string } }>(
        Method.Post,
        "/lookup",
        params,
        IdentityPrefix.V2,
        identityAccessToken,
    );

    if (!response?.["mappings"]) return [];

    const foundAddresses: IdentityLookupResult[] = [];
    for (const hashed of Object.keys(response["mappings"])) {
        const mxid = response["mappings"][hashed];
        const plainAddress = localMapping[hashed];
        if (!plainAddress) {
            throw new Error("Identity server returned more results than expected");
        }
        foundAddresses.push({ address: plainAddress, mxid });
    }
    return foundAddresses;
}

export async function lookupThreePidRequest(
    medium: string,
    address: string,
    identityAccessToken: string,
    idServerRequest: IdServerRequestFn,
): Promise<{ address: string; medium: string; mxid: string } | EmptyObject> {
    const response = await identityHashedLookupRequest([[address, medium]], identityAccessToken, idServerRequest);
    const result = response.find((p) => p.address === address);
    if (!result) {
        return {};
    }

    return {
        address,
        medium,
        mxid: result.mxid,
    };
}

export async function bulkLookupThreePidsRequest(
    query: [string, string][],
    identityAccessToken: string,
    idServerRequest: IdServerRequestFn,
): Promise<{ threepids: [medium: string, address: string, mxid: string][] }> {
    const response = await identityHashedLookupRequest(
        query.map((p) => [p[1], p[0]]),
        identityAccessToken,
        idServerRequest,
    );

    const v1results: [medium: string, address: string, mxid: string][] = [];
    for (const mapping of response) {
        const originalQuery = query.find((p) => p[1] === mapping.address);
        if (!originalQuery) {
            throw new Error("Identity sever returned unexpected results");
        }
        v1results.push([originalQuery[0], mapping.address, mapping.mxid]);
    }

    return { threepids: v1results };
}
