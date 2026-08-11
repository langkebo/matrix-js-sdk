import { describe, it, expect, vi } from "vitest";

import { SyncApi, type SyncApiOptions } from "../../../src/sync";
import { logger } from "../../../src/logger";
import { Method } from "../../../src/http-api/method";
import type { ISyncTransport } from "../../../src/http-api/sync-transport";

/**
 * Regression protection for ISSUE-12: SyncApi HTTP access converges to a
 * Transport interface.
 *
 * SyncApi in src/sync.ts must not reach directly into `client.http` at its
 * call sites. Instead it routes every HTTP call through the private
 * `syncTransport` getter, which returns `client.http` typed as `ISyncTransport`.
 * This makes the network dependency explicit and replaceable for testing.
 *
 * These tests pin that contract in place by:
 *   - Verifying the `syncTransport` getter returns `client.http`.
 *   - Mocking the transport and asserting each known call site routes
 *     through `authedRequest`/`request` with the expected path.
 */
describe("SyncApi transport interface (ISSUE-12)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function createMinimalClient(): any {
        const http = {
            authedRequest: vi.fn(),
            request: vi.fn(),
        };
        return {
            getNotifTimelineSet: () => null,
            isGuest: () => false,
            // ISSUE-12: fallback path is taken only when getPushManager is absent.
            getPushManager: undefined,
            // getProfileManager absent so resolveInvites fallback hits the transport.
            getProfileManager: undefined,
            http,
        };
    }

    function createSyncApiOptions(): SyncApiOptions {
        return { logger };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function getSyncTransport(syncApi: SyncApi): ISyncTransport {
        // The getter is private; read it via the instance for the test.
        return (syncApi as any).syncTransport;
    }

    describe("syncTransport getter", () => {
        it("returns client.http as the ISyncTransport", () => {
            const client = createMinimalClient();
            const syncApi = new SyncApi(client, undefined, createSyncApiOptions());

            expect(getSyncTransport(syncApi)).toBe(client.http);
        });
    });

    describe("doSyncRequest routes /sync through the transport", () => {
        it("calls authedRequest on the transport with GET /sync", async () => {
            const client = createMinimalClient();
            client.http.authedRequest.mockResolvedValue({});

            const syncApi = new SyncApi(client, undefined, createSyncApiOptions());
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await (syncApi as any).doSyncRequest({ filter: undefined }, null);

            expect(client.http.authedRequest).toHaveBeenCalledTimes(1);
            const [method, path] = client.http.authedRequest.mock.calls[0];
            expect(method).toBe(Method.Get);
            expect(path).toBe("/sync");
            expect(result).toEqual({});
        });
    });

    describe("getPushRules fallback routes /pushrules/ through the transport", () => {
        it("calls authedRequest on the transport with GET /pushrules/ when getPushManager is absent", async () => {
            const client = createMinimalClient();
            const pushRules = { global: {} };
            client.http.authedRequest.mockResolvedValue(pushRules);

            const syncApi = new SyncApi(client, undefined, createSyncApiOptions());
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (syncApi as any).getPushRules();

            expect(client.http.authedRequest).toHaveBeenCalledTimes(1);
            const [method, path] = client.http.authedRequest.mock.calls[0];
            expect(method).toBe(Method.Get);
            expect(path).toBe("/pushrules/");
            // Fallback result is assigned back onto the client.
            expect(client.pushRules).toBe(pushRules);
        });
    });

    describe("peekPoll routes /events through the transport", () => {
        it("calls authedRequest on the transport with GET /events", async () => {
            const client = createMinimalClient();
            // Return a never-resolving promise so the .then() callback (which
            // needs a fully-mocked client to process events) never fires.
            // We only need to assert that the transport was invoked.
            client.http.authedRequest.mockReturnValue(new Promise(() => {}));

            const syncApi = new SyncApi(client, undefined, createSyncApiOptions());
            // peekPoll returns early unless _peekRoom === peekRoom; align them.
            const peekRoom = { roomId: "!test:example.org" };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (syncApi as any)._peekRoom = peekRoom;
            // abortController is optional but used for the request opts signal.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (syncApi as any).abortController = undefined;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (syncApi as any).peekPoll(peekRoom as any, undefined);

            // The authedRequest call is made synchronously before any await.
            expect(client.http.authedRequest).toHaveBeenCalledTimes(1);
            const [method, path, queryParams] = client.http.authedRequest.mock.calls[0];
            expect(method).toBe(Method.Get);
            expect(path).toBe("/events");
            expect(queryParams).toMatchObject({ room_id: "!test:example.org" });
        });
    });

    describe("keepAlive routes /_matrix/client/versions through the transport", () => {
        it("calls request (unauthed) on the transport with GET /_matrix/client/versions", async () => {
            const client = createMinimalClient();
            client.http.request.mockResolvedValue({ versions: ["v1.11"] });

            const syncApi = new SyncApi(client, undefined, createSyncApiOptions());
            // pokeKeepAlive returns early unless this.running is true.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (syncApi as any).running = true;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (syncApi as any).abortController = undefined;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const startKeepAlives = (syncApi as any).startKeepAlives.bind(syncApi);
            // startKeepAlives(0) calls pokeKeepAlive() immediately (no delay),
            // which issues the /versions request through the transport.
            startKeepAlives(0);

            await vi.waitFor(() => {
                expect(client.http.request).toHaveBeenCalledTimes(1);
            });
            const [method, path] = client.http.request.mock.calls[0];
            expect(method).toBe(Method.Get);
            expect(path).toBe("/_matrix/client/versions");
        });
    });
});
