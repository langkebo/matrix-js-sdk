/**
 * API consistency — synapse-rust wire contracts (Phase 0 hot fixes).
 *
 * These tests pin the *shape of the request* for three endpoints whose SDK
 * wrappers had drifted away from the backend and could not be caught by
 * type-checking, because the wrong shapes were declared locally and then
 * amplified by `as unknown as` casts at the call sites.
 *
 * Provenance for each assertion is a `file:line` in synapse-rust; do not
 * "fix" a failure here without re-reading that handler first.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { MatrixClient } from "../../../src/client";
import { Method } from "../../../src/http-api/method";
import { ClientPrefix } from "../../../src/http-api/prefix";
import { ServerCapabilities } from "../../../src/serverCapabilities";

/**
 * The exact key set synapse-rust emits in the top-level `unstable_features`
 * map — `synapse-services/src/capability_governance.rs:451-465`.
 */
const BACKEND_UNSTABLE_FEATURES: Record<string, boolean> = {
    "io.hula.friends": true,
    "org.matrix.msc3245.voice": true,
    "org.matrix.msc3983.thread": true,
    "org.matrix.msc3886.sliding_sync": true,
    "org.matrix.simplified_msc3575": true,
    "org.matrix.msc4186": true,
    "io.hula.burn_after_read": true,
    "org.matrix.msc4108": true,
    "uk.tcpip.msc4133": true,
};

describe("D-01: MatrixClient.getUserDevices uses POST /keys/query", () => {
    let http: { authedRequest: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        http = { authedRequest: vi.fn() };
    });

    /** Invoke the method against a minimal stand-in — only `http` is touched. */
    function callGetUserDevices(userId: string): Promise<Record<string, unknown>> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return MatrixClient.prototype.getUserDevices.call({ http } as any, userId);
    }

    it("must NOT call GET /devices (that endpoint is caller-scoped, no {user_id} segment)", async () => {
        http.authedRequest.mockResolvedValue({ device_keys: { "@bob:hs": {} } });

        await callGetUserDevices("@bob:hs");

        const [method, path] = http.authedRequest.mock.calls[0];
        expect(method).toBe(Method.Post);
        expect(path).toBe("/keys/query");
        expect(path).not.toBe("/devices");
    });

    it("asks for all of the target user's devices via `device_keys: { [userId]: [] }`", async () => {
        http.authedRequest.mockResolvedValue({ device_keys: { "@bob:hs": {} } });

        await callGetUserDevices("@bob:hs");

        expect(http.authedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/keys/query",
            undefined,
            { device_keys: { "@bob:hs": [] } },
            // 5th parameter is IRequestOpts — a bare prefix string would be
            // silently dropped by the http layer.
            { prefix: ClientPrefix.V3 },
        );
    });

    it("unwraps `device_keys[userId]` into a deviceId → content map", async () => {
        const deviceKeys = {
            D1: { user_id: "@bob:hs", device_id: "D1", algorithms: [] },
            D2: { user_id: "@bob:hs", device_id: "D2", algorithms: [] },
        };
        http.authedRequest.mockResolvedValue({ device_keys: { "@bob:hs": deviceKeys } });

        const result = await callGetUserDevices("@bob:hs");

        expect(result).toEqual(deviceKeys);
        expect(Object.keys(result)).toEqual(["D1", "D2"]);
    });

    it("returns an empty map when the server has no keys for that user", async () => {
        http.authedRequest.mockResolvedValue({ device_keys: { "@bob:hs": {} } });
        await expect(callGetUserDevices("@bob:hs")).resolves.toEqual({});

        http.authedRequest.mockResolvedValue({});
        await expect(callGetUserDevices("@bob:hs")).resolves.toEqual({});
    });

    it("rejects an empty userId instead of querying the caller's own devices", async () => {
        await expect(callGetUserDevices("")).rejects.toThrow(/userId/);
        expect(http.authedRequest).not.toHaveBeenCalled();
    });
});

describe("D-05: ServerCapabilities.hasUnstableFeature matches exactly", () => {
    let http: { authedRequest: ReturnType<typeof vi.fn> };
    let capabilities: ServerCapabilities;

    beforeEach(async () => {
        http = {
            authedRequest: vi.fn().mockResolvedValue({
                capabilities: {},
                unstable_features: BACKEND_UNSTABLE_FEATURES,
            }),
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        capabilities = new ServerCapabilities({ debug: vi.fn(), warn: vi.fn() } as any, http as any);
        await capabilities.fetchCapabilities();
    });

    it("enters the cache that the backend actually populated", () => {
        expect(capabilities.getUnstableFeatures()).toEqual(BACKEND_UNSTABLE_FEATURES);
    });

    it("matches every one of the nine real backend keys verbatim", () => {
        for (const key of Object.keys(BACKEND_UNSTABLE_FEATURES)) {
            // Regression guard: `io.hula.friends` used to be looked up as
            // `org.matrix.mscio.hula.friends`, `uk.tcpip.msc4133` as
            // `org.matrix.mscuk.tcpip.msc4133`, etc.
            expect(capabilities.hasUnstableFeature(key), `expected ${key} to match`).toBe(true);
        }
    });

    it("expands the bare `mscNNNN` / numeric forms to org.matrix.mscNNNN", () => {
        expect(capabilities.hasUnstableFeature("msc4108")).toBe(true);
        expect(capabilities.hasUnstableFeature("4108")).toBe(true);
    });

    it("does not invent keys for namespaces the backend never used", () => {
        // These would only "work" under the old prefix-guessing logic.
        expect(capabilities.hasUnstableFeature("org.matrix.mscio.hula.friends")).toBe(false);
        expect(capabilities.hasUnstableFeature("org.matrix.mscmsc4108")).toBe(false);
        expect(capabilities.hasUnstableFeature("msc9999")).toBe(false);
        expect(capabilities.hasUnstableFeature("")).toBe(false);
    });

    it("treats a false-valued feature as unsupported", async () => {
        http.authedRequest.mockResolvedValue({
            capabilities: {},
            unstable_features: { "io.hula.friends": false },
        });
        await capabilities.fetchCapabilities();

        expect(capabilities.hasUnstableFeature("io.hula.friends")).toBe(false);
    });

    it("returns false for every lookup when the server sends no unstable_features", async () => {
        http.authedRequest.mockResolvedValue({ capabilities: {} });
        await capabilities.fetchCapabilities();

        expect(capabilities.getUnstableFeatures()).toBeUndefined();
        expect(capabilities.hasUnstableFeature("org.matrix.msc4108")).toBe(false);
    });
});
