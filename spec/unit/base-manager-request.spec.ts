import { describe, expect, it, vi, beforeEach } from "vitest";

import { BaseManager, Transport, RequestSpec, ManagerOpts } from "../../src/managers/base-manager";
import { Method } from "../../src/http-api/method";
import { ClientPrefix } from "../../src/http-api/prefix";
import { MatrixClient } from "../../src/client";
import { HTTPError } from "../../src/http-api/errors";
import { RetryableError } from "../../src/errors";

class DummyRequestManager extends BaseManager {
    constructor(opts?: ManagerOpts) {
        super({} as unknown as MatrixClient, opts);
    }

    public doRequest<T>(spec: RequestSpec): Promise<T> {
        return this.request<T>(spec);
    }

    protected sleep(_ms: number): Promise<void> {
        return Promise.resolve();
    }
}

describe("BaseManager.request", () => {
    let transport: Transport;
    let requestSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        requestSpy = vi.fn();
        transport = { request: requestSpy } as Transport;
    });

    // ── Basic transport dispatch ──────────────────────────────

    it("dispatches GET with correct method, path, and default prefix", async () => {
        const mgr = new DummyRequestManager({ transport });
        requestSpy.mockResolvedValue({ ok: true });

        await mgr.doRequest({ method: Method.Get, path: "/test" });

        expect(requestSpy).toHaveBeenCalledTimes(1);
        const call = requestSpy.mock.calls[0];
        expect(call[0]).toBe(Method.Get);
        expect(call[1]).toBe("/test");
        expect(call[4]).toEqual({ prefix: ClientPrefix.V3 });
    });

    it("dispatches POST with body", async () => {
        const mgr = new DummyRequestManager({ transport });
        const body = { name: "alice" };
        requestSpy.mockResolvedValue({});

        await mgr.doRequest({ method: Method.Post, path: "/users", body });

        expect(requestSpy).toHaveBeenCalledTimes(1);
        const call = requestSpy.mock.calls[0];
        expect(call[0]).toBe(Method.Post);
        expect(call[3]).toEqual(body);
    });

    it("passes queryParams to transport", async () => {
        const mgr = new DummyRequestManager({ transport });
        requestSpy.mockResolvedValue({});
        const query = { user_id: "@alice:example.com", limit: "10" };

        await mgr.doRequest({ method: Method.Get, path: "/search", queryParams: query });

        expect(requestSpy).toHaveBeenCalledTimes(1);
        expect(requestSpy.mock.calls[0][2]).toEqual(query);
    });

    it("uses custom prefix when specified", async () => {
        const mgr = new DummyRequestManager({ transport });
        requestSpy.mockResolvedValue({});

        await mgr.doRequest({ method: Method.Get, path: "/data", prefix: "/_synapse/admin" });

        expect(requestSpy).toHaveBeenCalledTimes(1);
        expect(requestSpy.mock.calls[0][4]).toEqual({ prefix: "/_synapse/admin" });
    });

    it("uses manager defaultPrefix when no per-request prefix", async () => {
        const mgr = new DummyRequestManager({ transport, defaultPrefix: ClientPrefix.V1 });
        requestSpy.mockResolvedValue({});

        await mgr.doRequest({ method: Method.Get, path: "/v1" });

        expect(requestSpy.mock.calls[0][4]).toEqual({ prefix: ClientPrefix.V1 });
    });

    // ── Retry behaviour ───────────────────────────────────────

    it("retries idempotent GET on 500 error and eventually succeeds", async () => {
        const mgr = new DummyRequestManager({ transport });
        requestSpy.mockRejectedValueOnce(new HTTPError("server error", 500)).mockResolvedValue({ recovered: true });

        const result = await mgr.doRequest({ method: Method.Get, path: "/unstable" });

        expect(result).toEqual({ recovered: true });
        expect(requestSpy).toHaveBeenCalledTimes(2);
        expect(mgr.getRequestStats().retried).toBe(1);
    });

    it("does NOT retry non-idempotent POST by default", async () => {
        const mgr = new DummyRequestManager({ transport });
        requestSpy.mockRejectedValue(new HTTPError("server error", 500));

        await expect(mgr.doRequest({ method: Method.Post, path: "/unsafe" })).rejects.toBeInstanceOf(RetryableError);

        expect(requestSpy).toHaveBeenCalledTimes(1);
    });

    it("retries POST when retryNonIdempotent is set", async () => {
        const mgr = new DummyRequestManager({ transport });
        requestSpy.mockRejectedValueOnce(new HTTPError("transient", 503)).mockResolvedValue({ ok: true });

        const result = await mgr.doRequest({
            method: Method.Post,
            path: "/safe-write",
            retry: { retryNonIdempotent: true },
        });

        expect(result).toEqual({ ok: true });
        expect(requestSpy).toHaveBeenCalledTimes(2);
    });

    it("stops retrying after maxRetries", async () => {
        const mgr = new DummyRequestManager({ transport });
        requestSpy.mockRejectedValue(new HTTPError("persistent", 500));

        await expect(
            mgr.doRequest({
                method: Method.Get,
                path: "/fragile",
                retry: { maxRetries: 2 },
            }),
        ).rejects.toBeInstanceOf(RetryableError);

        expect(requestSpy).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    // ── Stats tracking ────────────────────────────────────────

    it("tracks successful request in stats", async () => {
        const mgr = new DummyRequestManager({ transport });
        requestSpy.mockResolvedValue({});

        await mgr.doRequest({ method: Method.Get, path: "/a" });
        await mgr.doRequest({ method: Method.Get, path: "/b" });

        expect(mgr.getRequestStats()).toEqual({
            total: 2,
            successful: 2,
            failed: 0,
            retried: 0,
        });
    });

    it("tracks failed request in stats", async () => {
        const mgr = new DummyRequestManager({ transport });
        requestSpy.mockRejectedValue(new HTTPError("not found", 404));

        await expect(mgr.doRequest({ method: Method.Get, path: "/missing" })).rejects.toBeTruthy();

        expect(mgr.getRequestStats().failed).toBe(1);
    });

    // ── Error normalization ───────────────────────────────────

    it("normalizes 401 to RetryableError... actually no, 401 is AuthError in normalizeError", async () => {
        const mgr = new DummyRequestManager({ transport });
        requestSpy.mockRejectedValue(new HTTPError("unauthorized", 401));

        // GET is idempotent, but 401 is not retryable — the retry check requires
        // (1) canRetry=true AND (2) normalized instanceof RetryableError OR httpStatus >= 500.
        // 401 normalizes to AuthError (not RetryableError), and 401 < 500, so it won't retry.
        await expect(mgr.doRequest({ method: Method.Get, path: "/auth" })).rejects.toThrow();
        expect(requestSpy).toHaveBeenCalledTimes(1);
    });

    it("passes through on successful request without error wrapping", async () => {
        const mgr = new DummyRequestManager({ transport });
        const data = { items: [1, 2, 3] };
        requestSpy.mockResolvedValue(data);

        const result = await mgr.doRequest({ method: Method.Get, path: "/items" });

        expect(result).toBe(data);
    });

    // ── Transport injection ───────────────────────────────────

    it("uses injected transport instead of real HTTP", async () => {
        const requestMock = vi.fn().mockResolvedValue({ fromFake: true });
        const fakeTransport: Transport = {
            request: requestMock as unknown as Transport["request"],
        };

        const mgr = new DummyRequestManager({ transport: fakeTransport });
        const result = await mgr.doRequest({ method: Method.Get, path: "/fake" });

        expect(result).toEqual({ fromFake: true });
        expect(fakeTransport.request).toHaveBeenCalledTimes(1);
    });
});
