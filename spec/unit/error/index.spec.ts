/*
Copyright 2024 The Matrix.org Foundation C.I.C.

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

import { describe, it, expect, vi } from "vitest";
import {
    SDKError,
    ErrorCodes,
    createError,
    isSDKError,
    withErrorHandling,
    mapHttpError,
} from "../../../src/error/index";

describe("SDKError", () => {
    it("should create an error with all properties", () => {
        const error = new SDKError("Test message", "TEST_CODE", 400, { detail: "test" });

        expect(error.message).toBe("Test message");
        expect(error.code).toBe("TEST_CODE");
        expect(error.statusCode).toBe(400);
        expect(error.details).toEqual({ detail: "test" });
        expect(error.name).toBe("SDKError");
    });

    it("should work with Error properties", () => {
        const error = new SDKError("Test", "CODE");
        expect(error instanceof Error).toBe(true);
        expect(error instanceof SDKError).toBe(true);
    });
});

describe("ErrorCodes", () => {
    it("should have all expected error codes", () => {
        expect(ErrorCodes.NETWORK_ERROR).toBe("NETWORK_ERROR");
        expect(ErrorCodes.UNAUTHORIZED).toBe("UNAUTHORIZED");
        expect(ErrorCodes.FORBIDDEN).toBe("FORBIDDEN");
        expect(ErrorCodes.NOT_FOUND).toBe("NOT_FOUND");
        expect(ErrorCodes.BAD_REQUEST).toBe("BAD_REQUEST");
        expect(ErrorCodes.SERVER_ERROR).toBe("SERVER_ERROR");
        expect(ErrorCodes.TIMEOUT).toBe("TIMEOUT");
        expect(ErrorCodes.VALIDATION_ERROR).toBe("VALIDATION_ERROR");
        expect(ErrorCodes.RATE_LIMITED).toBe("RATE_LIMITED");
        expect(ErrorCodes.CONFLICT).toBe("CONFLICT");
        expect(ErrorCodes.SERVICE_UNAVAILABLE).toBe("SERVICE_UNAVAILABLE");
    });
});

describe("createError", () => {
    it("should create an SDKError with given parameters", () => {
        const error = createError(ErrorCodes.BAD_REQUEST, "Invalid input", 400);

        expect(error).toBeInstanceOf(SDKError);
        expect(error.code).toBe("BAD_REQUEST");
        expect(error.message).toBe("Invalid input");
        expect(error.statusCode).toBe(400);
    });

    it("should create error without statusCode", () => {
        const error = createError(ErrorCodes.NETWORK_ERROR, "Network failed");

        expect(error.statusCode).toBeUndefined();
    });
});

describe("isSDKError", () => {
    it("should return true for SDKError instances", () => {
        const error = new SDKError("test", "CODE");
        expect(isSDKError(error)).toBe(true);
    });

    it("should return false for regular Error instances", () => {
        const error = new Error("test");
        expect(isSDKError(error)).toBe(false);
    });

    it("should return false for non-error values", () => {
        expect(isSDKError(null)).toBe(false);
        expect(isSDKError(undefined)).toBe(false);
        expect(isSDKError("string")).toBe(false);
        expect(isSDKError(123)).toBe(false);
    });
});

describe("withErrorHandling", () => {
    it("should return result when function succeeds", async () => {
        const fn = vi.fn().mockResolvedValue("success");
        const result = await withErrorHandling(fn);

        expect(result).toBe("success");
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should throw when function fails and no fallback provided", async () => {
        const error = new Error("failure");
        const fn = vi.fn().mockRejectedValue(error);

        await expect(withErrorHandling(fn)).rejects.toThrow("failure");
    });

    it("should return fallback when function fails", async () => {
        const fn = vi.fn().mockRejectedValue(new Error("failure"));
        const fallback = "fallback";

        const result = await withErrorHandling(fn, fallback);

        expect(result).toBe("fallback");
    });

    it("should call onError callback when error occurs", async () => {
        const error = new Error("failure");
        const fn = vi.fn().mockRejectedValue(error);
        const onError = vi.fn();

        try {
            await withErrorHandling(fn, undefined, onError);
        } catch (e) {
            // Expected to throw
        }

        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith(
            expect.objectContaining({
                code: ErrorCodes.SERVER_ERROR,
                message: "failure",
            }),
        );
    });

    it("should handle SDKError in onError callback", async () => {
        const sdkError = new SDKError("custom", "CUSTOM_CODE", 400);
        const fn = vi.fn().mockRejectedValue(sdkError);
        const onError = vi.fn();

        try {
            await withErrorHandling(fn, undefined, onError);
        } catch (e) {
            // Expected to throw
        }

        expect(onError).toHaveBeenCalledWith(sdkError);
    });
});

describe("mapHttpError", () => {
    it("should map 400 to BAD_REQUEST", () => {
        const error = mapHttpError(400, "Bad request");
        expect(error.code).toBe(ErrorCodes.BAD_REQUEST);
        expect(error.statusCode).toBe(400);
    });

    it("should map 401 to UNAUTHORIZED", () => {
        const error = mapHttpError(401);
        expect(error.code).toBe(ErrorCodes.UNAUTHORIZED);
        expect(error.statusCode).toBe(401);
    });

    it("should map 403 to FORBIDDEN", () => {
        const error = mapHttpError(403);
        expect(error.code).toBe(ErrorCodes.FORBIDDEN);
        expect(error.statusCode).toBe(403);
    });

    it("should map 404 to NOT_FOUND", () => {
        const error = mapHttpError(404);
        expect(error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(error.statusCode).toBe(404);
    });

    it("should map 429 to RATE_LIMITED", () => {
        const error = mapHttpError(429);
        expect(error.code).toBe(ErrorCodes.RATE_LIMITED);
        expect(error.statusCode).toBe(429);
    });

    it("should map 500 to SERVER_ERROR", () => {
        const error = mapHttpError(500);
        expect(error.code).toBe(ErrorCodes.SERVER_ERROR);
        expect(error.statusCode).toBe(500);
    });

    it("should map 503 to SERVICE_UNAVAILABLE", () => {
        const error = mapHttpError(503);
        expect(error.code).toBe(ErrorCodes.SERVICE_UNAVAILABLE);
        expect(error.statusCode).toBe(503);
    });

    it("should map unknown status to SERVER_ERROR", () => {
        const error = mapHttpError(418);
        expect(error.code).toBe(ErrorCodes.SERVER_ERROR);
        expect(error.statusCode).toBe(418);
        expect(error.message).toContain("418");
    });
});
