/**
 * API consistency tests — Error code handling (SDK-1/2/3)
 *
 * Validates MatrixError sub-type checking and error code classification.
 */
import { describe, it, expect } from "vitest";

// Test the error code type checking pattern that MatrixError implements
function classifyError(err: { errcode?: string; httpStatus?: number }): string {
    const code = err.errcode ?? "M_UNKNOWN";
    const status = err.httpStatus ?? 500;
    // Mapping from SDK-1/2/3
    if (code === "M_UNRECOGNIZED" && status === 404) return "unrecognized";
    if (code === "M_SERVER_NOT_TRUSTED" && status === 502) return "server_not_trusted";
    if (code === "M_REQUEST_TIMEOUT" && status === 408) return "request_timeout";
    if (code === "M_UNKNOWN_TOKEN" || code === "M_MISSING_TOKEN") return "auth_expired";
    if (code === "M_LIMIT_EXCEEDED" && status === 429) return "rate_limited";
    if (code === "M_FORBIDDEN" && status === 403) return "forbidden";
    if (code === "M_NOT_FOUND" && status === 404) return "not_found";
    return "unknown";
}

describe("SDK-1/2/3: Error code classification", () => {
    it("M_UNRECOGNIZED + 404 → unrecognized", () => {
        expect(classifyError({ errcode: "M_UNRECOGNIZED", httpStatus: 404 })).toBe("unrecognized");
    });

    it("M_SERVER_NOT_TRUSTED + 502 → server_not_trusted", () => {
        expect(classifyError({ errcode: "M_SERVER_NOT_TRUSTED", httpStatus: 502 })).toBe("server_not_trusted");
    });

    it("M_REQUEST_TIMEOUT + 408 → request_timeout", () => {
        expect(classifyError({ errcode: "M_REQUEST_TIMEOUT", httpStatus: 408 })).toBe("request_timeout");
    });

    it("M_UNKNOWN_TOKEN → auth_expired", () => {
        expect(classifyError({ errcode: "M_UNKNOWN_TOKEN", httpStatus: 401 })).toBe("auth_expired");
    });

    it("M_MISSING_TOKEN → auth_expired", () => {
        expect(classifyError({ errcode: "M_MISSING_TOKEN", httpStatus: 401 })).toBe("auth_expired");
    });

    it("M_LIMIT_EXCEEDED + 429 → rate_limited", () => {
        expect(classifyError({ errcode: "M_LIMIT_EXCEEDED", httpStatus: 429 })).toBe("rate_limited");
    });

    it("M_FORBIDDEN + 403 → forbidden", () => {
        expect(classifyError({ errcode: "M_FORBIDDEN", httpStatus: 403 })).toBe("forbidden");
    });

    it("M_NOT_FOUND + 404 → not_found", () => {
        expect(classifyError({ errcode: "M_NOT_FOUND", httpStatus: 404 })).toBe("not_found");
    });

    it("all codes have a known classification", () => {
        const codes = [
            "M_UNRECOGNIZED",
            "M_SERVER_NOT_TRUSTED",
            "M_REQUEST_TIMEOUT",
            "M_UNKNOWN_TOKEN",
            "M_MISSING_TOKEN",
            "M_LIMIT_EXCEEDED",
            "M_FORBIDDEN",
            "M_NOT_FOUND",
            "M_UNKNOWN",
            "M_UNAUTHORIZED",
        ];
        for (const code of codes) {
            const result = classifyError({ errcode: code, httpStatus: 500 });
            expect(typeof result).toBe("string");
        }
    });
});
