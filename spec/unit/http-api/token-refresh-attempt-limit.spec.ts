/*
S-14: `doAuthedRequest` must not recurse without bound when the homeserver keeps answering
`M_UNKNOWN_TOKEN` even after a successful token refresh.

Regression background: the recursion is driven by `TokenRefreshOutcome.Success`. When the
refresh endpoint does not report an `expiry`, `TokenRefresher` never hits its "token should
still be valid, do not refresh" short-circuit, so a server that rejects freshly-minted tokens
produced refresh → retry → refresh → retry forever, with a backoff sleep of up to 32s per
iteration. The request neither resolved nor rejected.
*/

import { describe, it, expect, vi } from "vitest";

import { FetchHttpApi, MAX_TOKEN_REFRESH_ATTEMPTS } from "../../../src/http-api/fetch";
import { TypedEventEmitter } from "../../../src/models/typed-event-emitter";
import { ClientPrefix, HttpApiEvent, type HttpApiEventHandlerMap, MatrixError, Method } from "../../../src";

const baseUrl = "http://baseUrl";
const prefix = ClientPrefix.V3;
const tokenInactiveError = new MatrixError({ errcode: "M_UNKNOWN_TOKEN", error: "Token is not active" }, 401);

/** Always answers `M_UNKNOWN_TOKEN`. */
function makeAlwaysUnknownTokenFetchFn() {
    return vi.fn().mockResolvedValue({
        ok: false,
        status: tokenInactiveError.httpStatus,
        async text() {
            return JSON.stringify(tokenInactiveError.data);
        },
        async json() {
            return tokenInactiveError.data;
        },
        headers: {
            get: vi.fn().mockReturnValue("application/json"),
        },
    });
}

function makeOkFetchFn(payload: object) {
    return vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        async text() {
            return JSON.stringify(payload);
        },
        async json() {
            return payload;
        },
        headers: {
            get: vi.fn().mockReturnValue("application/json"),
        },
    });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeApi(opts: Record<string, any> = {}): FetchHttpApi<any> {
    const { emitter, ...httpOpts } = opts;
    return new FetchHttpApi(
        (emitter ?? new TypedEventEmitter<HttpApiEvent, HttpApiEventHandlerMap>()) as TypedEventEmitter<
            HttpApiEvent,
            HttpApiEventHandlerMap
        >,
        {
            baseUrl,
            prefix,
            onlyData: true,
            allowInsecureHttp: true,
            ...httpOpts,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
    );
}

describe("FetchHttpApi: M_UNKNOWN_TOKEN retry bound (S-14)", () => {
    it("gives up instead of recursing forever, and reports session logout", async () => {
        vi.useFakeTimers();
        try {
            const fetchFn = makeAlwaysUnknownTokenFetchFn();
            // A refresh that "succeeds" but yields a token the server still rejects, and reports
            // no expiry — exactly the combination that previously caused unbounded recursion.
            let refreshCount = 0;
            const tokenRefreshFunction = vi.fn().mockImplementation(async () => {
                refreshCount++;
                return {
                    accessToken: `ACCESS_TOKEN_${refreshCount}`,
                    refreshToken: `REFRESH_TOKEN_${refreshCount}`,
                    // no `expiry`: the refresher cannot short-circuit on "token should still be valid"
                };
            });

            const emitter = new TypedEventEmitter<HttpApiEvent, HttpApiEventHandlerMap>();
            vi.spyOn(emitter, "emit");
            const api = makeApi({
                fetchFn,
                tokenRefreshFunction,
                accessToken: "ACCESS_TOKEN_0",
                refreshToken: "REFRESH_TOKEN_0",
                emitter,
            });

            const request = api.authedRequest(Method.Get, "/foo");
            // Track settlement so we can drive the backoff sleeps without a fixed 30s wait.
            let settled = false;
            void request
                .catch(() => {})
                .then(() => {
                    settled = true;
                });
            for (let i = 0; i < 40 && !settled; i++) {
                await vi.advanceTimersByTimeAsync(5000);
            }

            // Surfaces the original M_UNKNOWN_TOKEN: a persistently-refused token is a dead
            // session, not a transient failure (TokenRefreshError would be misleading).
            await expect(request).rejects.toThrow(MatrixError);
            await expect(request).rejects.toMatchObject({ errcode: "M_UNKNOWN_TOKEN" });

            // Bounded: exactly one request per attempt, and no more attempts than the cap.
            expect(fetchFn).toHaveBeenCalledTimes(MAX_TOKEN_REFRESH_ATTEMPTS);
            // One refresh per retry, i.e. cap - 1 refreshes.
            expect(tokenRefreshFunction).toHaveBeenCalledTimes(MAX_TOKEN_REFRESH_ATTEMPTS - 1);

            expect(emitter.emit).toHaveBeenCalledWith(HttpApiEvent.SessionLoggedOut, expect.anything());
        } finally {
            vi.useRealTimers();
        }
    }, 60000);

    it("does not penalise a single successful refresh", async () => {
        const fetchFn = makeAlwaysUnknownTokenFetchFn();
        // First call rejects with M_UNKNOWN_TOKEN, subsequent calls succeed.
        fetchFn.mockResolvedValueOnce({
            ok: false,
            status: tokenInactiveError.httpStatus,
            async text() {
                return JSON.stringify(tokenInactiveError.data);
            },
            async json() {
                return tokenInactiveError.data;
            },
            headers: {
                get: vi.fn().mockReturnValue("application/json"),
            },
        });
        fetchFn.mockResolvedValue(makeOkFetchFn({ result: "ok" })());

        const tokenRefreshFunction = vi.fn().mockResolvedValue({
            accessToken: "ACCESS_TOKEN_NEW",
            refreshToken: "REFRESH_TOKEN_NEW",
        });

        const api = makeApi({
            fetchFn,
            tokenRefreshFunction,
            accessToken: "ACCESS_TOKEN_OLD",
            refreshToken: "REFRESH_TOKEN_OLD",
        });

        await expect(api.authedRequest(Method.Get, "/foo")).resolves.toEqual({ result: "ok" });

        expect(fetchFn).toHaveBeenCalledTimes(2);
        expect(tokenRefreshFunction).toHaveBeenCalledTimes(1);
    });

    it("sends the refreshed token on the retry", async () => {
        const fetchFn = makeAlwaysUnknownTokenFetchFn();
        let call = 0;
        fetchFn.mockImplementation(async () => {
            call++;
            if (call === 1) {
                return {
                    ok: false,
                    status: tokenInactiveError.httpStatus,
                    async text() {
                        return JSON.stringify(tokenInactiveError.data);
                    },
                    async json() {
                        return tokenInactiveError.data;
                    },
                    headers: { get: vi.fn().mockReturnValue("application/json") },
                };
            }
            return {
                ok: true,
                status: 200,
                async text() {
                    return JSON.stringify({});
                },
                async json() {
                    return {};
                },
                headers: { get: vi.fn().mockReturnValue("application/json") },
            };
        });

        const tokenRefreshFunction = vi.fn().mockResolvedValue({
            accessToken: "ACCESS_TOKEN_NEW",
            refreshToken: "REFRESH_TOKEN_NEW",
        });

        const api = makeApi({
            fetchFn,
            tokenRefreshFunction,
            accessToken: "ACCESS_TOKEN_OLD",
            refreshToken: "REFRESH_TOKEN_OLD",
        });

        await api.authedRequest(Method.Get, "/foo");

        const secondRequestHeaders = fetchFn.mock.calls[1][1]?.headers as Record<string, string>;
        expect(secondRequestHeaders?.Authorization).toBe("Bearer ACCESS_TOKEN_NEW");
    });
});
