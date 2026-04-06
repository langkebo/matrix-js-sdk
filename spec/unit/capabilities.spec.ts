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

import { describe, expect, it, vi, beforeEach } from "vitest";
import { CapabilitiesManager } from "../../src/capabilities/index";

describe("CapabilitiesManager", () => {
    let mockClient: any;
    let capabilitiesManager: CapabilitiesManager;
    let mockGetCachedCapabilities: ReturnType<typeof vi.fn>;
    let mockFetchCapabilities: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockGetCachedCapabilities = vi.fn();
        mockFetchCapabilities = vi.fn();

        mockClient = {
            serverCapabilitiesService: {
                getCachedCapabilities: mockGetCachedCapabilities,
                fetchCapabilities: mockFetchCapabilities,
            },
        };
        capabilitiesManager = new CapabilitiesManager(mockClient);
    });

    describe("getCapabilities", () => {
        it("should return cached capabilities if available", async () => {
            const capabilities = {
                "m.change_password": { enabled: true },
                "m.room_versions": {
                    default: "9",
                    available: { "9": "stable", "10": "stable" },
                },
            };
            mockGetCachedCapabilities.mockReturnValue(capabilities);

            const result = await capabilitiesManager.getCapabilities();

            expect(result).toEqual(capabilities);
            expect(mockGetCachedCapabilities).toHaveBeenCalled();
        });

        it("should fetch capabilities if not cached", async () => {
            const capabilities = {
                "m.change_password": { enabled: false },
            };
            mockGetCachedCapabilities.mockReturnValue(undefined);
            mockFetchCapabilities.mockResolvedValue(capabilities);

            const result = await capabilitiesManager.getCapabilities();

            expect(result).toEqual(capabilities);
            expect(mockFetchCapabilities).toHaveBeenCalled();
        });

        it("should handle missing serverCapabilitiesService", async () => {
            delete mockClient.serverCapabilitiesService;
            capabilitiesManager = new CapabilitiesManager(mockClient);

            const result = await capabilitiesManager.getCapabilities();

            expect(result).toBeUndefined();
        });
    });

    describe("getCachedCapabilities", () => {
        it("should return cached capabilities", () => {
            const capabilities = {
                "m.change_password": { enabled: true },
            };
            mockGetCachedCapabilities.mockReturnValue(capabilities);

            const result = capabilitiesManager.getCachedCapabilities();

            expect(result).toEqual(capabilities);
            expect(mockGetCachedCapabilities).toHaveBeenCalled();
        });

        it("should return undefined if no cache", () => {
            mockGetCachedCapabilities.mockReturnValue(undefined);

            const result = capabilitiesManager.getCachedCapabilities();

            expect(result).toBeUndefined();
        });

        it("should handle missing serverCapabilitiesService", () => {
            delete mockClient.serverCapabilitiesService;
            capabilitiesManager = new CapabilitiesManager(mockClient);

            const result = capabilitiesManager.getCachedCapabilities();

            expect(result).toBeUndefined();
        });
    });

    describe("fetchCapabilities", () => {
        it("should fetch capabilities from server", async () => {
            const capabilities = {
                "m.change_password": { enabled: true },
                "m.room_versions": {
                    default: "9",
                    available: { "9": "stable" },
                },
            };
            mockFetchCapabilities.mockResolvedValue(capabilities);

            const result = await capabilitiesManager.fetchCapabilities();

            expect(result).toEqual(capabilities);
            expect(mockFetchCapabilities).toHaveBeenCalled();
        });

        it("should handle fetch errors", async () => {
            const error = new Error("Network error");
            mockFetchCapabilities.mockRejectedValue(error);

            await expect(capabilitiesManager.fetchCapabilities()).rejects.toThrow("Network error");
        });

        it("should handle missing serverCapabilitiesService", async () => {
            delete mockClient.serverCapabilitiesService;
            capabilitiesManager = new CapabilitiesManager(mockClient);

            const result = await capabilitiesManager.fetchCapabilities();

            expect(result).toBeUndefined();
        });
    });
});
