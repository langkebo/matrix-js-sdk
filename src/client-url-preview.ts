import { MediaPrefix, Method } from "./http-api/index.ts";
import type { Body, IRequestOpts } from "./http-api/index.ts";
import type { QueryDict } from "./utils.ts";

interface PreviewCache<T> {
    has(key: string): boolean;
    get(key: string): Promise<T> | undefined;
    set(key: string, value: Promise<T>): void;
}

type AuthedRequestFn = <T>(
    method: Method,
    path: string,
    queryParams?: QueryDict,
    body?: Body,
    requestOpts?: IRequestOpts,
) => Promise<T>;

export function getUrlPreviewRequest<T>(
    url: string,
    ts: number,
    cache: PreviewCache<T>,
    authedRequest: AuthedRequestFn,
): Promise<T> {
    const bucketedTs = Math.floor(ts / 60000) * 60000;

    const parsed = new URL(url);
    parsed.hash = "";
    const normalizedUrl = parsed.toString();
    const key = bucketedTs + "_" + normalizedUrl;

    if (cache.has(key)) {
        return cache.get(key)!;
    }

    const response = authedRequest<T>(
        Method.Get,
        "/preview_url",
        {
            url: normalizedUrl,
            ts: bucketedTs.toString(),
        },
        undefined,
        {
            prefix: MediaPrefix.V3,
        },
    );
    cache.set(key, response);
    return response;
}
