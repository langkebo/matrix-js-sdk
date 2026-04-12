/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect, vi } from "vitest";

import {
    getIdentityHashDetailsRequest,
    identityHashedLookupRequest,
    lookupThreePidRequest,
    bulkLookupThreePidsRequest,
    type IdServerRequestFn,
    type IdentityHashDetails,
} from "../../src/client-identity-lookup.ts";
import { Method, IdentityPrefix } from "../../src/http-api/index.ts";

describe("client-identity-lookup", () => {
    const mockIdServerRequest = vi.fn();

    beforeEach(() => {
        mockIdServerRequest.mockReset();
    });

    describe("getIdentityHashDetailsRequest", () => {
        it("should request hash details with correct parameters", async () => {
            const mockResponse: IdentityHashDetails = {
                algorithms: ["sha256"],
                lookup_pepper: "test-pepper",
            };
            mockIdServerRequest.mockResolvedValue(mockResponse);

            const result = await getIdentityHashDetailsRequest(
                mockIdServerRequest as IdServerRequestFn,
                "access-token",
            );

            expect(mockIdServerRequest).toHaveBeenCalledWith(
                Method.Get,
                "/hash_details",
                undefined,
                IdentityPrefix.V2,
                "access-token",
            );
            expect(result).toEqual(mockResponse);
        });
    });

    describe("identityHashedLookupRequest", () => {
        it("should throw error when hash details response is invalid", async () => {
            mockIdServerRequest.mockResolvedValueOnce(null);

            await expect(
                identityHashedLookupRequest(
                    [["user@example.com", "email"]],
                    "token",
                    mockIdServerRequest as IdServerRequestFn,
                ),
            ).rejects.toThrow("Unsupported identity server: bad response");
        });

        it("should throw error when lookup_pepper is missing", async () => {
            mockIdServerRequest.mockResolvedValueOnce({ algorithms: ["sha256"] });

            await expect(
                identityHashedLookupRequest(
                    [["user@example.com", "email"]],
                    "token",
                    mockIdServerRequest as IdServerRequestFn,
                ),
            ).rejects.toThrow("Unsupported identity server: bad response");
        });

        it("should throw error when algorithms is missing", async () => {
            mockIdServerRequest.mockResolvedValueOnce({ lookup_pepper: "pepper" });

            await expect(
                identityHashedLookupRequest(
                    [["user@example.com", "email"]],
                    "token",
                    mockIdServerRequest as IdServerRequestFn,
                ),
            ).rejects.toThrow("Unsupported identity server: bad response");
        });

        it("should throw error when no supported algorithm", async () => {
            mockIdServerRequest.mockResolvedValueOnce({
                algorithms: ["unknown"],
                lookup_pepper: "pepper",
            });

            await expect(
                identityHashedLookupRequest(
                    [["user@example.com", "email"]],
                    "token",
                    mockIdServerRequest as IdServerRequestFn,
                ),
            ).rejects.toThrow("Unsupported identity server: unknown hash algorithm");
        });

        it("should use sha256 algorithm when available", async () => {
            mockIdServerRequest
                .mockResolvedValueOnce({
                    algorithms: ["sha256"],
                    lookup_pepper: "test-pepper",
                })
                .mockResolvedValueOnce({
                    mappings: {},
                });

            const result = await identityHashedLookupRequest(
                [["user@example.com", "email"]],
                "token",
                mockIdServerRequest as IdServerRequestFn,
            );

            expect(result).toEqual([]);
            expect(mockIdServerRequest).toHaveBeenCalledTimes(2);
        });

        it("should use none algorithm when sha256 not available", async () => {
            mockIdServerRequest
                .mockResolvedValueOnce({
                    algorithms: ["none"],
                    lookup_pepper: "test-pepper",
                })
                .mockResolvedValueOnce({
                    mappings: {},
                });

            const result = await identityHashedLookupRequest(
                [["user@example.com", "email"]],
                "token",
                mockIdServerRequest as IdServerRequestFn,
            );

            expect(result).toEqual([]);
        });

        it("should return found addresses from mappings", async () => {
            mockIdServerRequest
                .mockResolvedValueOnce({
                    algorithms: ["none"],
                    lookup_pepper: "test-pepper",
                })
                .mockResolvedValueOnce({
                    mappings: {
                        "user@example.com email": "@user:server",
                    },
                });

            const result = await identityHashedLookupRequest(
                [["user@example.com", "email"]],
                "token",
                mockIdServerRequest as IdServerRequestFn,
            );

            expect(result).toEqual([{ address: "user@example.com", mxid: "@user:server" }]);
        });

        it("should throw error when server returns unexpected results", async () => {
            mockIdServerRequest
                .mockResolvedValueOnce({
                    algorithms: ["none"],
                    lookup_pepper: "test-pepper",
                })
                .mockResolvedValueOnce({
                    mappings: {
                        "unknown@example.com email": "@user:server",
                    },
                });

            await expect(
                identityHashedLookupRequest(
                    [["user@example.com", "email"]],
                    "token",
                    mockIdServerRequest as IdServerRequestFn,
                ),
            ).rejects.toThrow("Identity server returned more results than expected");
        });

        it("should return empty array when no mappings", async () => {
            mockIdServerRequest
                .mockResolvedValueOnce({
                    algorithms: ["sha256"],
                    lookup_pepper: "test-pepper",
                })
                .mockResolvedValueOnce(null);

            const result = await identityHashedLookupRequest(
                [["user@example.com", "email"]],
                "token",
                mockIdServerRequest as IdServerRequestFn,
            );

            expect(result).toEqual([]);
        });
    });

    describe("lookupThreePidRequest", () => {
        it("should return empty object when address not found", async () => {
            mockIdServerRequest
                .mockResolvedValueOnce({
                    algorithms: ["none"],
                    lookup_pepper: "pepper",
                })
                .mockResolvedValueOnce({ mappings: {} });

            const result = await lookupThreePidRequest(
                "email",
                "user@example.com",
                "token",
                mockIdServerRequest as IdServerRequestFn,
            );

            expect(result).toEqual({});
        });

        it("should return threepid info when found", async () => {
            mockIdServerRequest
                .mockResolvedValueOnce({
                    algorithms: ["none"],
                    lookup_pepper: "pepper",
                })
                .mockResolvedValueOnce({
                    mappings: {
                        "user@example.com email": "@user:server",
                    },
                });

            const result = await lookupThreePidRequest(
                "email",
                "user@example.com",
                "token",
                mockIdServerRequest as IdServerRequestFn,
            );

            expect(result).toEqual({
                address: "user@example.com",
                medium: "email",
                mxid: "@user:server",
            });
        });
    });

    describe("bulkLookupThreePidsRequest", () => {
        it("should return empty threepids when no matches", async () => {
            mockIdServerRequest
                .mockResolvedValueOnce({
                    algorithms: ["none"],
                    lookup_pepper: "pepper",
                })
                .mockResolvedValueOnce({ mappings: {} });

            const result = await bulkLookupThreePidsRequest(
                [["email", "user@example.com"]],
                "token",
                mockIdServerRequest as IdServerRequestFn,
            );

            expect(result).toEqual({ threepids: [] });
        });

        it("should return matched threepids", async () => {
            mockIdServerRequest
                .mockResolvedValueOnce({
                    algorithms: ["none"],
                    lookup_pepper: "pepper",
                })
                .mockResolvedValueOnce({
                    mappings: {
                        "user@example.com email": "@user:server",
                    },
                });

            const result = await bulkLookupThreePidsRequest(
                [["email", "user@example.com"]],
                "token",
                mockIdServerRequest as IdServerRequestFn,
            );

            expect(result).toEqual({
                threepids: [["email", "user@example.com", "@user:server"]],
            });
        });

        it("should throw error when server returns unexpected results", async () => {
            mockIdServerRequest
                .mockResolvedValueOnce({
                    algorithms: ["none"],
                    lookup_pepper: "pepper",
                })
                .mockResolvedValueOnce({
                    mappings: {
                        "unknown@example.com email": "@user:server",
                    },
                });

            await expect(
                bulkLookupThreePidsRequest(
                    [["email", "user@example.com"]],
                    "token",
                    mockIdServerRequest as IdServerRequestFn,
                ),
            ).rejects.toThrow("Identity server returned more results than expected");
        });
    });
});
