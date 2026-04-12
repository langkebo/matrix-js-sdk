/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
    HttpManager,
    extendMatrixClient,
    type IRequestOptions,
    type IPendingRequest,
} from "../../../src/http/index.ts";
import { MatrixClient } from "../../../src/client.ts";
import { MatrixError } from "../../../src/http-api/index.ts";

describe("HttpManager", () => {
    let mockClient: Partial<MatrixClient>;
    let mockHttpApi: Record<string, unknown>;

    beforeEach(() => {
        mockHttpApi = {
            authedRequest: vi.fn(),
        };

        mockClient = {
            http: mockHttpApi as unknown as MatrixClient["http"],
            credentials: {
                accessToken: "test-token",
            },
        } as unknown as Partial<MatrixClient>;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("constructor", () => {
        it("should create HttpManager with client reference", () => {
            const manager = new HttpManager(mockClient as MatrixClient);
            expect(manager).toBeInstanceOf(HttpManager);
        });
    });

    describe("getHttp", () => {
        it("should return the client's http instance", () => {
            const manager = new HttpManager(mockClient as MatrixClient);
            const http = manager.getHttp();
            expect(http).toBe(mockHttpApi);
        });
    });

    describe("setHttp", () => {
        it("should set the client's http instance", () => {
            const manager = new HttpManager(mockClient as MatrixClient);
            const newHttpApi = { authedRequest: vi.fn() };
            manager.setHttp(newHttpApi as unknown as MatrixClient["http"]);
            expect(mockClient.http).toBe(newHttpApi);
        });
    });

    describe("createRequest", () => {
        it("should call client's createRequest with options", async () => {
            const mockCreateRequest = vi.fn().mockResolvedValue({ data: "test" });
            (mockClient as unknown as Record<string, unknown>).createRequest = mockCreateRequest;

            const manager = new HttpManager(mockClient as MatrixClient);
            const options: IRequestOptions = {
                method: "GET",
                url: "/test",
            };

            const result = await manager.createRequest(options);

            expect(mockCreateRequest).toHaveBeenCalledWith(options);
            expect(result).toEqual({ data: "test" });
        });

        it("should retry on retryable error (500 status)", async () => {
            const serverError = new MatrixError({ errcode: "M_UNKNOWN", error: "Internal server error" }, 500);
            const mockCreateRequest = vi.fn().mockRejectedValueOnce(serverError).mockResolvedValue({ data: "success" });
            (mockClient as unknown as Record<string, unknown>).createRequest = mockCreateRequest;

            const manager = new HttpManager(mockClient as MatrixClient);
            const options: IRequestOptions = {
                method: "GET",
                url: "/test",
            };

            const result = await manager.createRequest(options);

            expect(mockCreateRequest).toHaveBeenCalledTimes(2);
            expect(result).toEqual({ data: "success" });
        });
    });

    describe("pickAnyDestinationCertificate", () => {
        it("should call client's pickAnyDestinationCertificate", () => {
            const mockPickCert = vi.fn().mockReturnValue({ cert: "data" });
            (mockClient as unknown as Record<string, unknown>).pickAnyDestinationCertificate = mockPickCert;

            const manager = new HttpManager(mockClient as MatrixClient);
            const result = manager.pickAnyDestinationCertificate("!room:server", "$event_id");

            expect(mockPickCert).toHaveBeenCalledWith("!room:server", "$event_id");
            expect(result).toEqual({ cert: "data" });
        });
    });

    describe("getPendingRequests", () => {
        it("should return pending requests from client", () => {
            const pendingRequests: IPendingRequest[] = [
                { id: "1", url: "/test1", method: "GET", timestamp: Date.now() },
                { id: "2", url: "/test2", method: "POST", timestamp: Date.now() },
            ];
            const mockGetPending = vi.fn().mockReturnValue(pendingRequests);
            (mockClient as unknown as Record<string, unknown>).getPendingRequests = mockGetPending;

            const manager = new HttpManager(mockClient as MatrixClient);
            const result = manager.getPendingRequests();

            expect(mockGetPending).toHaveBeenCalled();
            expect(result).toEqual(pendingRequests);
        });

        it("should return empty array when no pending requests", () => {
            const mockGetPending = vi.fn().mockReturnValue([]);
            (mockClient as unknown as Record<string, unknown>).getPendingRequests = mockGetPending;

            const manager = new HttpManager(mockClient as MatrixClient);
            const result = manager.getPendingRequests();

            expect(result).toEqual([]);
        });
    });

    describe("cancelPendingRequests", () => {
        it("should call client's cancelPendingRequests with reason", () => {
            const mockCancel = vi.fn();
            (mockClient as unknown as Record<string, unknown>).cancelPendingRequests = mockCancel;

            const manager = new HttpManager(mockClient as MatrixClient);
            manager.cancelPendingRequests("User cancelled");

            expect(mockCancel).toHaveBeenCalledWith("User cancelled");
        });
    });
});

describe("extendMatrixClient", () => {
    it("should add getHttpManager method to MatrixClient prototype", () => {
        extendMatrixClient();
        expect(MatrixClient.prototype.getHttpManager).toBeDefined();
    });

    it("should return HttpManager instance when called", () => {
        extendMatrixClient();
        const client = Object.create(MatrixClient.prototype);
        client.http = {};

        const manager = client.getHttpManager();
        expect(manager).toBeInstanceOf(HttpManager);
    });
});
