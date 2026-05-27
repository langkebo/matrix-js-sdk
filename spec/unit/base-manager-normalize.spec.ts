import { describe, it, expect } from "vitest";

import { BaseManager } from "../../src/managers/base-manager";
import type { MatrixClient } from "../../src/client";
import { HTTPError, MatrixError } from "../../src/http-api/errors";
import { RetryableError, NotFoundError, AuthError, ApiError } from "../../src/errors";

class DummyManager extends BaseManager {
    constructor() {
        super({} as unknown as MatrixClient);
    }
    public n(err: unknown, method: string) {
        return this.normalizeError(err, method);
    }
}

describe("BaseManager.normalizeError", () => {
    it("classifies 5xx MatrixError as RetryableError", () => {
        const m = new DummyManager();
        const err = new MatrixError({ error: "server exploded" }, 503);
        const e = m.n(err, "t");
        expect(e).toBeInstanceOf(RetryableError);
    });

    it("classifies 429 MatrixError as RetryableError", () => {
        const m = new DummyManager();
        const err = new MatrixError({ errcode: "M_LIMIT_EXCEEDED", error: "rate limited" }, 429);
        const e = m.n(err, "t");
        expect(e).toBeInstanceOf(RetryableError);
    });

    it("classifies 429 HTTPError as RetryableError", () => {
        const m = new DummyManager();
        const err = new HTTPError("rate limited", 429);
        const e = m.n(err, "t");
        expect(e).toBeInstanceOf(RetryableError);
    });

    it("classifies 404 MatrixError as NotFoundError", () => {
        const m = new DummyManager();
        const err = new MatrixError({ errcode: "M_NOT_FOUND", error: "nope" }, 404);
        const e = m.n(err, "t");
        expect(e).toBeInstanceOf(NotFoundError);
    });

    it("classifies 401 MatrixError as AuthError", () => {
        const m = new DummyManager();
        const err = new MatrixError({ errcode: "M_UNKNOWN_TOKEN", error: "bad token" }, 401);
        const e = m.n(err, "t");
        expect(e).toBeInstanceOf(AuthError);
    });

    it("falls back to ApiError for other statuses", () => {
        const m = new DummyManager();
        const err = new MatrixError({ errcode: "M_FORBIDDEN", error: "forbidden" }, 403);
        const e = m.n(err, "t");
        expect(e).toBeInstanceOf(ApiError);
    });
});
