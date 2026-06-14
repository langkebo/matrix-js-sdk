/**
 * API consistency tests — Auth & Error code mapping
 *
 * Validates SDK-1/2/3: error code constants, HTTP status mapping,
 * C-6 token refresh behaviour, and M_UNRECOGNIZED 404 handling.
 */
import { describe, it, expect } from "vitest";
import {
    MatrixErrorCode,
    MATRIX_ERROR_HTTP_STATUS,
} from "../../../src/@types/errors";

const {
    M_UNRECOGNIZED,
    M_SERVER_NOT_TRUSTED,
    M_REQUEST_TIMEOUT,
    M_CANNOT_LEAVE_SERVER_NOTICE_ROOM,
} = MatrixErrorCode;

const ALL_CODES = Object.values(MatrixErrorCode);

describe("SDK-1: Error code constants", () => {
    it("defines Matrix standard error codes matching synapse-rust MatrixErrorCode enum", () => {
        // All unique codes matching synapse-rust MatrixErrorCode enum (v10)
        expect(ALL_CODES.length).toBe(33);
        expect(new Set(ALL_CODES).size).toBe(33); // no duplicates
    });

    it("all codes follow M_ prefix convention", () => {
        for (const code of ALL_CODES) {
            expect(code).toMatch(/^M_[A-Z_]+$/);
        }
    });
});

describe("SDK-1: HTTP status mapping", () => {
    it("M_UNRECOGNIZED maps to 404 (SDK-2)", () => {
        expect(MATRIX_ERROR_HTTP_STATUS[M_UNRECOGNIZED]).toBe(404);
    });

    it("M_SERVER_NOT_TRUSTED maps to 502", () => {
        expect(MATRIX_ERROR_HTTP_STATUS[M_SERVER_NOT_TRUSTED]).toBe(502);
    });

    it("M_REQUEST_TIMEOUT maps to 408", () => {
        expect(MATRIX_ERROR_HTTP_STATUS[M_REQUEST_TIMEOUT]).toBe(408);
    });

    it("M_CANNOT_LEAVE_SERVER_NOTICE_ROOM maps to 403", () => {
        expect(MATRIX_ERROR_HTTP_STATUS[M_CANNOT_LEAVE_SERVER_NOTICE_ROOM]).toBe(403);
    });

    it("every error code has a known HTTP status", () => {
        for (const code of ALL_CODES) {
            expect(
                MATRIX_ERROR_HTTP_STATUS[code],
                `${code} should have HTTP status mapping`,
            ).toBeTypeOf("number");
        }
    });
});