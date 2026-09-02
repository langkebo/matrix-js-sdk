/*
Copyright 2026 Tjg (HuLa)

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TypedEventEmitter } from "../../models/typed-event-emitter";
import { HttpApiEvent, HttpApiEventHandlerMap } from "../interface";
import type { IHttpOpts, IRequestOpts } from "../interface";
import { FetchHttpApi } from "../fetch";
import { Method } from "../method";
import { gunzipSync, strFromU8 } from "fflate";

/**
 * Tests for the optional GZIP compression of JSON request bodies
 * (see artifacts/三项目优化方案-精准版-2026-08-29.md — 优化点 1).
 *
 * The compression logic in `FetchHttpApi.requestOtherUrl` is gated by
 * `opts.gzipRequests` and `opts.gzipThresholdBytes`:
 *
 *   - opts.gzipRequests=false → never compress
 *   - JSON body smaller than gzipThresholdBytes → do not compress
 *   - JSON body larger than gzipThresholdBytes → gzip and set `Content-Encoding: gzip`
 *   - non-JSON body (FormData/Blob/string) → do not compress
 *
 * The tests use `opts.fetchFn` (the SDK's injectable fetch hook) to
 * capture the request body and headers without actually hitting the
 * network. The request is short-circuited with a fake `Response`.
 */

function makeApi(opts: Partial<IHttpOpts> = {}): { api: FetchHttpApi<IHttpOpts>; captured: { url: any; init: RequestInit | undefined } } {
    const captured: { url: any; init: RequestInit | undefined } = { url: undefined, init: undefined };
    const baseOpts: IHttpOpts = {
        baseUrl: "https://hs.example.com",
        prefix: "",
        onlyData: true,
        accessToken: "test-token",
        fetchFn: (url, init) => {
            captured.url = url;
            captured.init = init;
            return Promise.resolve(
                new Response(JSON.stringify({ ok: true }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }),
            );
        },
        ...opts,
    };
    const emitter = new TypedEventEmitter<HttpApiEvent, HttpApiEventHandlerMap>();
    const api = new FetchHttpApi<IHttpOpts>(emitter, baseOpts);
    return { api, captured };
}

function readBody(init: RequestInit | undefined): string {
    if (!init || init.body === undefined || init.body === null) return "";
    if (typeof init.body === "string") return init.body;
    if (init.body instanceof Uint8Array) {
        return strFromU8(init.body);
    }
    return String(init.body);
}

function readUint8Body(init: RequestInit | undefined): Uint8Array {
    if (!init || init.body === undefined || init.body === null) return new Uint8Array(0);
    if (init.body instanceof Uint8Array) return init.body;
    if (typeof init.body === "string") return new TextEncoder().encode(init.body);
    return new Uint8Array(0);
}

function readHeader(init: RequestInit | undefined, name: string): string | null {
    if (!init || !init.headers) return null;
    const headers = init.headers as Record<string, string>;
    if (name in headers) return headers[name];
    // Headers are normalised to lowercase in some implementations
    for (const k of Object.keys(headers)) {
        if (k.toLowerCase() === name.toLowerCase()) return headers[k]!;
    }
    return null;
}

describe("FetchHttpApi GZIP compression (W1 optimization)", () => {
    let requestOpts: IRequestOpts;

    beforeEach(() => {
        requestOpts = {};
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("body < gzipThresholdBytes → not compressed, no Content-Encoding header", async () => {
        const { api, captured } = makeApi({ gzipRequests: true, gzipThresholdBytes: 1024 });
        // Small body: 5 fields × ~5 chars each = well under 1KB
        const smallBody = { a: 1, b: 2, c: 3, d: 4, e: 5 };

        await api.requestOtherUrl(Method.Post, "https://hs.example.com/_matrix/test", smallBody, requestOpts);

        expect(readHeader(captured.init, "Content-Encoding")).toBeNull();
        expect(readBody(captured.init)).toBe(JSON.stringify(smallBody));
        expect(readHeader(captured.init, "Content-Type")).toBe("application/json");
    });

    it("body > gzipThresholdBytes + JSON → Content-Encoding: gzip, body is binary gzipped", async () => {
        const { api, captured } = makeApi({ gzipRequests: true, gzipThresholdBytes: 1024 });
        // Build a body whose JSON serialization comfortably exceeds 1KB.
        // 200 entries × ~10 bytes each ≈ 2KB
        const bigBody: Record<string, string> = {};
        for (let i = 0; i < 200; i++) {
            bigBody[`key_${i.toString().padStart(3, "0")}`] = `value_${i}`;
        }
        const jsonStr = JSON.stringify(bigBody);
        expect(jsonStr.length).toBeGreaterThan(1024);

        await api.requestOtherUrl(Method.Post, "https://hs.example.com/_matrix/test", bigBody, requestOpts);

        // The wire body should be gzipped, not the JSON string
        const wireBytes = readUint8Body(captured.init);
        expect(wireBytes.length).toBeGreaterThan(0);
        expect(wireBytes.length).toBeLessThan(jsonStr.length); // gzipped is smaller

        // The header announces gzipped encoding
        expect(readHeader(captured.init, "Content-Encoding")).toBe("gzip");

        // The wire body must be valid gzip — verify by decompressing and
        // comparing to the original JSON.
        const decompressed = gunzipSync(wireBytes);
        expect(strFromU8(decompressed)).toBe(jsonStr);
    });

    it("body > threshold but opts.json=false → not compressed (explicit JSON opt-out)", async () => {
        const { api, captured } = makeApi({ gzipRequests: true, gzipThresholdBytes: 64 });
        const bigBody: Record<string, string> = {};
        for (let i = 0; i < 50; i++) bigBody[`k_${i}`] = `v_${i}`;
        expect(JSON.stringify(bigBody).length).toBeGreaterThan(64);

        // opts.json=false: caller is sending a pre-serialised body, do not touch
        const preEncoded = JSON.stringify(bigBody);
        await api.requestOtherUrl(
            Method.Post,
            "https://hs.example.com/_matrix/test",
            preEncoded,
            { json: false },
        );

        expect(readHeader(captured.init, "Content-Encoding")).toBeNull();
        expect(readBody(captured.init)).toBe(preEncoded);
    });

    it("non-object body (string) → not compressed even when > threshold", async () => {
        const { api, captured } = makeApi({ gzipRequests: true, gzipThresholdBytes: 32 });
        // A raw string is treated as an already-encoded body — must not be
        // re-encoded and must not be gzipped.
        const longString = "x".repeat(200);

        await api.requestOtherUrl(Method.Post, "https://hs.example.com/_matrix/test", longString, requestOpts);

        expect(readHeader(captured.init, "Content-Encoding")).toBeNull();
        expect(readBody(captured.init)).toBe(longString);
    });

    it("opts.gzipRequests=false → compression disabled regardless of body size", async () => {
        const { api, captured } = makeApi({ gzipRequests: false, gzipThresholdBytes: 8 });
        const bigBody: Record<string, string> = {};
        for (let i = 0; i < 50; i++) bigBody[`k_${i}`] = `v_${i}`;
        expect(JSON.stringify(bigBody).length).toBeGreaterThan(8);

        await api.requestOtherUrl(Method.Post, "https://hs.example.com/_matrix/test", bigBody, requestOpts);

        expect(readHeader(captured.init, "Content-Encoding")).toBeNull();
        expect(readBody(captured.init)).toBe(JSON.stringify(bigBody));
    });

    it("body exactly at threshold → not compressed (strict greater-than)", async () => {
        // 32-byte JSON body with a 32-byte threshold. Per the implementation
        // (`> threshold`, not `>=`), this must not compress.
        const { api, captured } = makeApi({ gzipRequests: true, gzipThresholdBytes: 32 });
        // Build a body whose JSON serialization is exactly 32 bytes:
        //   {"a":"012345678901234567890123"}  → 32 bytes
        const body = { a: "012345678901234567890123" };
        const jsonStr = JSON.stringify(body);
        expect(jsonStr.length).toBe(32);

        await api.requestOtherUrl(Method.Post, "https://hs.example.com/_matrix/test", body, requestOpts);

        expect(readHeader(captured.init, "Content-Encoding")).toBeNull();
        expect(readBody(captured.init)).toBe(jsonStr);
    });

    it("body one byte over threshold → compressed", async () => {
        // Sanity check: strict-greater-than means threshold+1 should compress.
        const { api, captured } = makeApi({ gzipRequests: true, gzipThresholdBytes: 32 });
        const body = { a: "0123456789012345678901234" }; // 33 bytes
        const jsonStr = JSON.stringify(body);
        expect(jsonStr.length).toBe(33);

        await api.requestOtherUrl(Method.Post, "https://hs.example.com/_matrix/test", body, requestOpts);

        expect(readHeader(captured.init, "Content-Encoding")).toBe("gzip");
        const wireBytes = readUint8Body(captured.init);
        expect(wireBytes.length).toBeGreaterThan(0);
        const decompressed = gunzipSync(wireBytes);
        expect(strFromU8(decompressed)).toBe(jsonStr);
    });

    it("custom gzipThresholdBytes is honoured", async () => {
        // Set threshold high so this body does NOT compress
        const { api: apiHi, captured: capHi } = makeApi({ gzipRequests: true, gzipThresholdBytes: 100_000 });
        const mediumBody = { data: "x".repeat(200) };
        await apiHi.requestOtherUrl(Method.Post, "https://hs.example.com/_matrix/test", mediumBody, requestOpts);
        expect(readHeader(capHi.init, "Content-Encoding")).toBeNull();
        expect(readBody(capHi.init)).toBe(JSON.stringify(mediumBody));

        // Set threshold very low so even a tiny body DOES compress
        const { api: apiLo, captured: capLo } = makeApi({ gzipRequests: true, gzipThresholdBytes: 4 });
        const tinyBody = { data: "x".repeat(50) };
        await apiLo.requestOtherUrl(Method.Post, "https://hs.example.com/_matrix/test", tinyBody, requestOpts);
        expect(readHeader(capLo.init, "Content-Encoding")).toBe("gzip");
        const wireBytes = readUint8Body(capLo.init);
        const decompressed = gunzipSync(wireBytes);
        expect(strFromU8(decompressed)).toBe(JSON.stringify(tinyBody));
    });
});
