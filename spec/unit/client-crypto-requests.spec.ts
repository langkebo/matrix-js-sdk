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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Mock } from "vitest";

import { Method, MatrixError } from "../../src/http-api";
import * as cryptoRequests from "../../src/client-crypto-requests";
import type { QueryDict } from "../../src/utils";

/**
 * 与 src/client-crypto-requests 中 AuthedRequestFn 匹配的 mock 签名。
 * 必须是泛型函数，否则 vi.fn() 的 Mock 类型无法赋值给泛型 AuthedRequestFn。
 */
type MockAuthedRequest = <T>(
    method: Method,
    path: string,
    queryParams?: QueryDict,
    body?: unknown,
    requestOpts?: unknown,
) => Promise<T>;

describe("client-crypto-requests", () => {
    let mockAuthedRequest: Mock<MockAuthedRequest> & MockAuthedRequest;
    let mockResult: Record<string, unknown>;

    beforeEach(() => {
        mockResult = { success: true, data: "test" };
        mockAuthedRequest = vi.fn().mockResolvedValue(mockResult) as unknown as Mock<MockAuthedRequest> &
            MockAuthedRequest;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe("performSearchRequest", () => {
        it("should perform search request without nextBatch", async () => {
            const body = { search_categories: { room_events: {} } };
            const result = await cryptoRequests.performSearchRequest(body, undefined, undefined, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Post, "/search", {}, body, {
                abortSignal: undefined,
            });
            expect(result).toEqual(mockResult);
        });

        it("should include next_batch when provided", async () => {
            const body = { search_categories: { room_events: {} } };
            const nextBatch = "next_token_123";
            const abortSignal = { aborted: false } as AbortSignal;

            await cryptoRequests.performSearchRequest(body, nextBatch, abortSignal, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Post, "/search", { next_batch: nextBatch }, body, {
                abortSignal,
            });
        });
    });

    describe("uploadKeysHttpRequest", () => {
        it("should upload keys with content", async () => {
            const content = { device_keys: {}, one_time_keys: {} };
            const result = await cryptoRequests.uploadKeysHttpRequest(content, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Post, "/keys/upload", undefined, content);
            expect(result).toEqual(mockResult);
        });
    });

    describe("uploadKeySignaturesHttpRequest", () => {
        it("should upload key signatures", async () => {
            const content = { signatures: {} };
            const result = await cryptoRequests.uploadKeySignaturesHttpRequest(content, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Post, "/keys/signatures/upload", undefined, content);
            expect(result).toEqual(mockResult);
        });
    });

    describe("queryKeysForUsersRequest", () => {
        it("should query keys for users without token", async () => {
            const userIds = ["@alice:example.com", "@bob:example.com"];

            await cryptoRequests.queryKeysForUsersRequest(userIds, undefined, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/keys/query",
                undefined,
                expect.objectContaining({
                    device_keys: {
                        "@alice:example.com": [],
                        "@bob:example.com": [],
                    },
                }),
            );
        });

        it("should include token when provided", async () => {
            const userIds = ["@alice:example.com"];
            const token = "since_token";

            await cryptoRequests.queryKeysForUsersRequest(userIds, token, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/keys/query",
                undefined,
                expect.objectContaining({
                    device_keys: { "@alice:example.com": [] },
                    token: token,
                }),
            );
        });
    });

    describe("claimOneTimeKeysHttpRequest", () => {
        it("should claim one time keys with default algorithm", async () => {
            const devices: [string, string][] = [
                ["@alice:example.com", "DEVICE1"],
                ["@bob:example.com", "DEVICE2"],
            ];

            await cryptoRequests.claimOneTimeKeysHttpRequest(devices, undefined, undefined, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/keys/claim",
                undefined,
                expect.objectContaining({
                    one_time_keys: {
                        "@alice:example.com": { DEVICE1: "signed_curve25519" },
                        "@bob:example.com": { DEVICE2: "signed_curve25519" },
                    },
                }),
            );
        });

        it("should use custom key algorithm", async () => {
            const devices: [string, string][] = [["@alice:example.com", "DEVICE1"]];
            const algorithm = "custom_algo";

            await cryptoRequests.claimOneTimeKeysHttpRequest(devices, algorithm, undefined, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/keys/claim",
                undefined,
                expect.objectContaining({
                    one_time_keys: {
                        "@alice:example.com": { DEVICE1: "custom_algo" },
                    },
                }),
            );
        });

        it("should include timeout when provided", async () => {
            const devices: [string, string][] = [["@alice:example.com", "DEVICE1"]];
            const timeout = 5000;

            await cryptoRequests.claimOneTimeKeysHttpRequest(devices, undefined, timeout, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/keys/claim",
                undefined,
                expect.objectContaining({
                    one_time_keys: { "@alice:example.com": { DEVICE1: "signed_curve25519" } },
                    timeout: timeout,
                }),
            );
        });
    });

    describe("getKeyChangesRequest", () => {
        it("should get key changes with from and to tokens", async () => {
            const oldToken = "old_sync_token";
            const newToken = "new_sync_token";

            await cryptoRequests.getKeyChangesRequest(oldToken, newToken, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/keys/changes", {
                from: oldToken,
                to: newToken,
            });
        });
    });

    describe("uploadDeviceSigningKeysHttpRequest", () => {
        it("should upload device signing keys without auth", async () => {
            const keys = { pub_key: "public_key_data" };

            await cryptoRequests.uploadDeviceSigningKeysHttpRequest(undefined, keys, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/keys/device_signing/upload",
                undefined,
                { pub_key: "public_key_data" },
                { prefix: expect.any(String) },
            );
        });

        it("should include auth when provided", async () => {
            const auth = { type: "m.login.password", identifier: {} };
            const keys = { pub_key: "public_key_data" };

            await cryptoRequests.uploadDeviceSigningKeysHttpRequest(auth, keys, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/keys/device_signing/upload",
                undefined,
                expect.objectContaining({
                    pub_key: "public_key_data",
                    auth: auth,
                }),
                { prefix: expect.any(String) },
            );
        });
    });

    describe("requestRoomKeyHttpRequest", () => {
        it("should request room key", async () => {
            const request = { room_id: "!room:example.com" };

            await cryptoRequests.requestRoomKeyHttpRequest(request, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Post, "/room_keys/request", undefined, request, {
                prefix: expect.any(String),
            });
        });
    });

    describe("getRoomKeyRequestsHttpRequest", () => {
        it("should get room key requests with query", async () => {
            const query = { state: "unresolved" };

            await cryptoRequests.getRoomKeyRequestsHttpRequest(query, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/room_keys/request", query, undefined, {
                prefix: expect.any(String),
            });
        });
    });

    describe("deleteRoomKeyRequestHttpRequest", () => {
        it("should delete room key request", async () => {
            const requestId = "request_123";

            await cryptoRequests.deleteRoomKeyRequestHttpRequest(requestId, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Delete,
                "/room_keys/request/request_123",
                undefined,
                undefined,
                { prefix: expect.any(String) },
            );
        });
    });

    describe("Edge Cases", () => {
        it("should handle empty device list in claimOneTimeKeysHttpRequest", async () => {
            const devices: [string, string][] = [];

            await cryptoRequests.claimOneTimeKeysHttpRequest(devices, undefined, undefined, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Post, "/keys/claim", undefined, {
                one_time_keys: {},
            });
        });

        it("should handle empty userIds list in queryKeysForUsersRequest", async () => {
            await cryptoRequests.queryKeysForUsersRequest([], undefined, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/keys/query",
                undefined,
                expect.objectContaining({
                    device_keys: {},
                }),
            );
        });
    });

    describe("deleteRoomKeyRequestHttpRequest path encoding", () => {
        it("should percent-encode spaces and slashes in requestId", async () => {
            const requestId = "a b/c";

            await cryptoRequests.deleteRoomKeyRequestHttpRequest(requestId, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Delete,
                "/room_keys/request/a%20b%2Fc",
                undefined,
                undefined,
                { prefix: expect.any(String) },
            );
        });

        it("should not double-encode a requestId without reserved characters", async () => {
            const requestId = "abc-123_XYZ";

            await cryptoRequests.deleteRoomKeyRequestHttpRequest(requestId, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Delete,
                "/room_keys/request/abc-123_XYZ",
                undefined,
                undefined,
                { prefix: expect.any(String) },
            );
        });
    });

    describe("Error propagation (HTTP status -> SDK error)", () => {
        it("should propagate 400 M_BAD_JSON instead of swallowing it", async () => {
            const err = new MatrixError({ errcode: "M_BAD_JSON", error: "Invalid JSON body" }, 400);
            mockAuthedRequest.mockRejectedValue(err);

            await expect(cryptoRequests.uploadKeysHttpRequest({ invalid: true }, mockAuthedRequest)).rejects.toThrow(
                err,
            );
        });

        it("should propagate 401 M_UNKNOWN_TOKEN on key upload", async () => {
            const err = new MatrixError({ errcode: "M_UNKNOWN_TOKEN", error: "bad token" }, 401);
            mockAuthedRequest.mockRejectedValue(err);

            await expect(
                cryptoRequests.uploadKeySignaturesHttpRequest({ signatures: {} }, mockAuthedRequest),
            ).rejects.toThrow(err);
        });

        it("should propagate 403 M_FORBIDDEN on key query", async () => {
            const err = new MatrixError({ errcode: "M_FORBIDDEN", error: "forbidden" }, 403);
            mockAuthedRequest.mockRejectedValue(err);

            await expect(
                cryptoRequests.queryKeysForUsersRequest(["@alice:example.com"], undefined, mockAuthedRequest),
            ).rejects.toThrow(err);
        });

        it("should surface 429 rate-limit as a retryable MatrixError", async () => {
            const err = new MatrixError({ errcode: "M_LIMIT_EXCEEDED", error: "slow down" }, 429);
            mockAuthedRequest.mockRejectedValue(err);

            await expect(
                cryptoRequests.claimOneTimeKeysHttpRequest(
                    [["@alice:example.com", "DEVICE1"]],
                    undefined,
                    undefined,
                    mockAuthedRequest,
                ),
            ).rejects.toThrow(err);
            expect(err.isRateLimitError()).toBe(true);
        });

        it("should propagate 404 as M_UNRECOGNIZED-capable error on signing key upload", async () => {
            const err = new MatrixError({ errcode: "M_UNRECOGNIZED", error: "unknown endpoint" }, 404);
            mockAuthedRequest.mockRejectedValue(err);

            await expect(
                cryptoRequests.uploadDeviceSigningKeysHttpRequest(undefined, {}, mockAuthedRequest),
            ).rejects.toThrow(err);
            expect(err.isUnrecognizedError()).toBe(true);
        });

        it("should propagate 500 server error on room key request", async () => {
            const err = new MatrixError({ errcode: "M_UNKNOWN", error: "internal error" }, 500);
            mockAuthedRequest.mockRejectedValue(err);

            await expect(
                cryptoRequests.requestRoomKeyHttpRequest({ room_id: "!r:example.com" }, mockAuthedRequest),
            ).rejects.toThrow(err);
        });

        it("should propagate 502 upstream failure on key changes fetch", async () => {
            const err = new MatrixError({ error: "bad gateway" }, 502);
            mockAuthedRequest.mockRejectedValue(err);

            await expect(cryptoRequests.getKeyChangesRequest("a", "b", mockAuthedRequest)).rejects.toThrow(err);
        });

        it("should not resolve when the transport rejects", async () => {
            mockAuthedRequest.mockRejectedValue(new Error("network down"));

            await expect(cryptoRequests.getRoomKeyRequestsHttpRequest({}, mockAuthedRequest)).rejects.toThrow(
                "network down",
            );
        });
    });
});
