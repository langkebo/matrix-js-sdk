/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect, vi } from "vitest";

import {
    getThirdpartyLocationRequest,
    getThirdpartyUserRequest,
    getThirdpartyProtocolsRequest,
    type AuthedRequestFn,
} from "../../src/client-third-party.ts";
import { Method } from "../../src/http-api/method.ts";

describe("client-thirdparty", () => {
    describe("getThirdpartyLocationRequest", () => {
        it("should make request with protocol and search fields", async () => {
            const mockResponse = [{ alias: "#room:server", fields: {} }];
            const mockAuthedRequest = vi.fn().mockResolvedValue(mockResponse);

            const result = await getThirdpartyLocationRequest(
                "irc",
                { searchFields: ["test"] },
                mockAuthedRequest as AuthedRequestFn,
            );

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/thirdparty/location/irc", {
                searchFields: ["test"],
            });
            expect(result).toEqual(mockResponse);
        });

        it("should handle empty search fields", async () => {
            const mockResponse: unknown[] = [];
            const mockAuthedRequest = vi.fn().mockResolvedValue(mockResponse);

            const result = await getThirdpartyLocationRequest("matrix", {}, mockAuthedRequest as AuthedRequestFn);

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/thirdparty/location/matrix", {});
            expect(result).toEqual([]);
        });
    });

    describe("getThirdpartyUserRequest", () => {
        it("should make request with protocol and params", async () => {
            const mockResponse = [{ userid: "@user:server", fields: {} }];
            const mockAuthedRequest = vi.fn().mockResolvedValue(mockResponse);

            const result = await getThirdpartyUserRequest(
                "irc",
                { field: "value" },
                mockAuthedRequest as AuthedRequestFn,
            );

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/thirdparty/user/irc", { field: "value" });
            expect(result).toEqual(mockResponse);
        });

        it("should handle undefined params", async () => {
            const mockResponse: unknown[] = [];
            const mockAuthedRequest = vi.fn().mockResolvedValue(mockResponse);

            const result = await getThirdpartyUserRequest("matrix", undefined, mockAuthedRequest as AuthedRequestFn);

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/thirdparty/user/matrix", undefined);
            expect(result).toEqual([]);
        });
    });

    describe("getThirdpartyProtocolsRequest", () => {
        it("should return protocols object", async () => {
            const mockResponse = {
                irc: { user_fields: ["nick"], location_fields: ["channel"] },
                matrix: { user_fields: [], location_fields: [] },
            };
            const mockAuthedRequest = vi.fn().mockResolvedValue(mockResponse);

            const result = await getThirdpartyProtocolsRequest(mockAuthedRequest as AuthedRequestFn);

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/thirdparty/protocols", undefined);
            expect(result).toEqual(mockResponse);
        });

        it("should throw error when response is not an object", async () => {
            const mockAuthedRequest = vi.fn().mockResolvedValue(null);

            await expect(getThirdpartyProtocolsRequest(mockAuthedRequest as AuthedRequestFn)).rejects.toThrow(
                "/thirdparty/protocols did not return an object",
            );
        });

        it("should throw error when response is a string", async () => {
            const mockAuthedRequest = vi.fn().mockResolvedValue("invalid");

            await expect(getThirdpartyProtocolsRequest(mockAuthedRequest as AuthedRequestFn)).rejects.toThrow(
                "/thirdparty/protocols did not return an object",
            );
        });

        it("should handle empty object response", async () => {
            const mockResponse = {};
            const mockAuthedRequest = vi.fn().mockResolvedValue(mockResponse);

            const result = await getThirdpartyProtocolsRequest(mockAuthedRequest as AuthedRequestFn);

            expect(result).toEqual({});
        });
    });
});
