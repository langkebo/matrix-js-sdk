import { MediaPrefix, Method } from "./http-api/index.ts";
import type { Body, IRequestOpts } from "./http-api/index.ts";
import { InflightRequestCache } from "./utils/inflight-request-cache.ts";
import type { QueryDict } from "./utils.ts";

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
    cache: InflightRequestCache<T>,
    authedRequest: AuthedRequestFn,
): Promise<T> {
    const bucketedTs = Math.floor(ts / 60000) * 60000;

    const parsed = new URL(url);
    parsed.hash = "";
    const normalizedUrl = parsed.toString();
    const key = bucketedTs + "_" + normalizedUrl;

    return cache.getOrCreate(key, () =>
        authedRequest<T>(
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
        ),
    );
}
