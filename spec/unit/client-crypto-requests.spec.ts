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

import { Method, type Body, type IRequestOpts } from "../../src/http-api";
import * as cryptoRequests from "../../src/client-crypto-requests";
import type { QueryDict } from "../../src/utils";

type AuthedRequestFn = <T>(
    method: Method,
    path: string,
    queryParams?: Record<string, unknown>,
    body?: Body,
    requestOpts?: IRequestOpts,
) => Promise<T>;

describe("client-crypto-requests", () => {
    let mockAuthedRequest: ReturnType<typeof vi.fn>;
    let mockResult: Record<string, unknown>;

    beforeEach(() => {
        mockResult = { success: true, data: "test" };
        mockAuthedRequest = vi.fn().mockResolvedValue(mockResult);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe("performSearchRequest", () => {
        it("should perform search request without nextBatch", async () => {
            const body = { search_categories: { room_events: {} } };
            const result = await cryptoRequests.performSearchRequest(
                body,
                undefined,
                undefined,
                mockAuthedRequest,
            );

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/search",
                {},
                body,
                { abortSignal: undefined },
            );
            expect(result).toEqual(mockResult);
        });

        it("should include next_batch when provided", async () => {
            const body = { search_categories: { room_events: {} } };
            const nextBatch = "next_token_123";
            const abortSignal = { aborted: false } as AbortSignal;

            await cryptoRequests.performSearchRequest(body, nextBatch, abortSignal, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/search",
                { next_batch: nextBatch },
                body,
                { abortSignal },
            );
        });
    });

    describe("uploadKeysHttpRequest", () => {
        it("should upload keys with content", async () => {
            const content = { device_keys: {}, one_time_keys: {} };
            const result = await cryptoRequests.uploadKeysHttpRequest(content, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/keys/upload",
                undefined,
                content,
            );
            expect(result).toEqual(mockResult);
        });
    });

    describe("uploadKeySignaturesHttpRequest", () => {
        it("should upload key signatures", async () => {
            const content = { signatures: {} };
            const result = await cryptoRequests.uploadKeySignaturesHttpRequest(content, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/keys/signatures/upload",
                undefined,
                content,
            );
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
            const devices = [["@alice:example.com", "DEVICE1"], ["@bob:example.com", "DEVICE2"]];

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
            const devices = [["@alice:example.com", "DEVICE1"]];
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
            const devices = [["@alice:example.com", "DEVICE1"]];
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

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/keys/changes",
                { from: oldToken, to: newToken },
            );
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

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/room_keys/request",
                undefined,
                request,
                { prefix: expect.any(String) },
            );
        });
    });

    describe("getRoomKeyRequestsHttpRequest", () => {
        it("should get room key requests with query", async () => {
            const query = { state: "unresolved" };

            await cryptoRequests.getRoomKeyRequestsHttpRequest(query, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/room_keys/request",
                query,
                undefined,
                { prefix: expect.any(String) },
            );
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

    describe("Device Signing Verification Requests", () => {
        const prefixes = ["prefix_v1", "prefix_v2"];
        
        describe.each([
            ["startDeviceSigningVerificationRequest", Method.Post],
            ["acceptDeviceSigningVerificationRequest", Method.Put],
            ["sendDeviceSigningVerificationKeyAgreementRequest", Method.Post],
            ["confirmDeviceSigningVerificationMacRequest", Method.Post],
            ["completeDeviceSigningVerificationRequest", Method.Post],
            ["cancelDeviceSigningVerificationRequest", Method.Post],
        ])("%s", (fnName, expectedMethod) => {
            it(`should call ${fnName} with request and prefix`, async () => {
                const request = { user_id: "@user:example.com" };
                const func = cryptoRequests[fnName] as any;

                await func(request, prefixes[0], mockAuthedRequest);

                expect(mockAuthedRequest).toHaveBeenCalledWith(
                    expectedMethod,
                    expect.stringContaining("device_signing"),
                    undefined,
                    request,
                    { prefix: prefixes[0] },
                );
            });
        });

        describe("getVerificationRequestsHttpRequest", () => {
            it("should get verification requests", async () => {
                await cryptoRequests.getVerificationRequestsHttpRequest(prefixes[0], mockAuthedRequest);

                expect(mockAuthedRequest).toHaveBeenCalledWith(
                    Method.Get,
                    "/keys/device_signing/requests",
                    undefined,
                    undefined,
                    { prefix: prefixes[0] },
                );
            });
        });

        describe("showQrCodeHttpRequest", () => {
            it("should show QR code", async () => {
                await cryptoRequests.showQrCodeHttpRequest(prefixes[0], mockAuthedRequest);

                expect(mockAuthedRequest).toHaveBeenCalledWith(
                    Method.Get,
                    "/keys/qr_code/show",
                    undefined,
                    undefined,
                    { prefix: prefixes[0] },
                );
            });
        });

        describe("scanQrCodeHttpRequest", () => {
            it("should scan QR code", async () => {
                const request = { user_id: "@user:example.com" };

                await cryptoRequests.scanQrCodeHttpRequest(request, prefixes[0], mockAuthedRequest);

                expect(mockAuthedRequest).toHaveBeenCalledWith(
                    Method.Post,
                    "/keys/qr_code/scan",
                    undefined,
                    request,
                    { prefix: prefixes[0] },
                );
            });
        });
    });

    describe("Edge Cases", () => {
        it("should handle empty device list in claimOneTimeKeysHttpRequest", async () => {
            const devices: [string, string][] = [];

            await cryptoRequests.claimOneTimeKeysHttpRequest(devices, undefined, undefined, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/keys/claim",
                undefined,
                { one_time_keys: {} },
            );
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
});
