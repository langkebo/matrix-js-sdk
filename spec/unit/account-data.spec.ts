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

import { AccountDataManager } from "../../src/account-data/index";
import { MatrixEvent } from "../../src/models/event";
import { Method } from "../../src/http-api";
import { Feature, ServerSupport } from "../../src/feature";

describe("AccountDataManager", () => {
    let mockClient: any;
    let accountDataManager: AccountDataManager;
    let mockAuthedRequest: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockAuthedRequest = vi.fn();

        const mockAccountDataMap = new Map();

        mockClient = {
            credentials: {
                userId: "@alice:example.com",
            },
            getSafeUserId: vi.fn().mockReturnValue("@alice:example.com"),
            http: {
                authedRequest: mockAuthedRequest,
            },
            store: {
                getAccountData: vi.fn((type: string) => mockAccountDataMap.get(type)),
                accountData: mockAccountDataMap,
                storeAccountDataEvents: vi.fn((events: MatrixEvent[]) => {
                    events.forEach((event) => {
                        mockAccountDataMap.set(event.getType(), event);
                    });
                }),
            },
            clientRunning: true,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            isInitialSyncComplete: vi.fn().mockReturnValue(true),
            canSupport: new Map<Feature, ServerSupport>(),
        };
        accountDataManager = new AccountDataManager(mockClient);
    });

    describe("setAccountData", () => {
        it("should set account data via setAccountDataRaw when client is not running", async () => {
            mockClient.clientRunning = false;
            mockAuthedRequest.mockResolvedValue({});

            await accountDataManager.setAccountData("m.direct" as any, { "@bob:example.com": ["!room:example.com"] } as any);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/user/%40alice%3Aexample.com/account_data/m.direct",
                undefined,
                { "@bob:example.com": ["!room:example.com"] },
            );
        });

        it("should handle custom event types", async () => {
            mockClient.clientRunning = false;
            mockAuthedRequest.mockResolvedValue({});

            await accountDataManager.setAccountData("com.example.custom" as any, { data: "value" } as any);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/user/%40alice%3Aexample.com/account_data/com.example.custom",
                undefined,
                { data: "value" },
            );
        });
    });

    describe("setAccountDataRaw", () => {
        it("should set account data raw via http", async () => {
            mockAuthedRequest.mockResolvedValue({});

            await accountDataManager.setAccountDataRaw("m.push_rules" as any, { global: {} } as any);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/user/%40alice%3Aexample.com/account_data/m.push_rules",
                undefined,
                { global: {} },
            );
        });
    });

    describe("getAccountData", () => {
        it("should get account data from store", () => {
            const event = new MatrixEvent({
                type: "m.direct",
                content: { "@bob:example.com": ["!room:example.com"] },
            });
            mockClient.store.accountData.set("m.direct", event);

            const result = accountDataManager.getAccountData("m.direct" as any);

            expect(result).toBe(event);
            expect(mockClient.store.getAccountData).toHaveBeenCalledWith("m.direct");
        });

        it("should return undefined for non-existent data", () => {
            const result = accountDataManager.getAccountData("m.nonexistent" as any);

            expect(result).toBeUndefined();
        });
    });

    describe("getAccountDataFromServer", () => {
        it("should return local content when initial sync is complete and data exists", async () => {
            const content = { "@bob:example.com": ["!room:example.com"] };
            const event = new MatrixEvent({ type: "m.direct", content });
            mockClient.store.getAccountData = vi.fn().mockReturnValue(event);
            mockClient.isInitialSyncComplete = vi.fn().mockReturnValue(true);

            const result = await accountDataManager.getAccountDataFromServer("m.direct" as any);

            expect(result).toEqual(content);
        });

        it("should return null when data not found on server", async () => {
            mockClient.store.getAccountData = vi.fn().mockReturnValue(undefined);
            mockClient.isInitialSyncComplete = vi.fn().mockReturnValue(false);
            const error = { data: { errcode: "M_NOT_FOUND" } };
            mockAuthedRequest.mockRejectedValue(error);

            const result = await accountDataManager.getAccountDataFromServer("m.nonexistent" as any);

            expect(result).toBeNull();
        });
    });

    describe("listAccountData", () => {
        it("should list all account data", async () => {
            const response = {
                account_data: {
                    "m.direct": { "@bob:example.com": ["!room:example.com"] },
                    "m.push_rules": { global: {} },
                },
            };
            mockAuthedRequest.mockResolvedValue(response);

            const result = await accountDataManager.listAccountData();

            expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/user/%40alice%3Aexample.com/account_data/");
            expect(result).toEqual(response);
        });

        it("should handle empty account data", async () => {
            const response = {
                account_data: {},
            };
            mockAuthedRequest.mockResolvedValue(response);

            const result = await accountDataManager.listAccountData();

            expect(result.account_data).toEqual({});
        });
    });

    describe("getRoomAccountDataFromServer", () => {
        it("should get room account data from server", async () => {
            const content = { tags: { "m.favourite": {} } };
            mockAuthedRequest.mockResolvedValue(content);

            const result = await accountDataManager.getRoomAccountDataFromServer("!room:example.com", "m.tag");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/user/%40alice%3Aexample.com/rooms/!room%3Aexample.com/account_data/m.tag",
            );
            expect(result).toBeInstanceOf(MatrixEvent);
            expect(result?.getType()).toBe("m.tag");
            expect(result?.getContent()).toEqual(content);
        });

        it("should handle custom room account data types", async () => {
            const content = { custom: "data" };
            mockAuthedRequest.mockResolvedValue(content);

            const result = await accountDataManager.getRoomAccountDataFromServer(
                "!room:example.com",
                "com.example.custom",
            );

            expect(result?.getType()).toBe("com.example.custom");
        });
    });

    describe("deleteAccountData", () => {
        it("should delete account data when supported", async () => {
            mockClient.canSupport.set(Feature.AccountDataDeletion, ServerSupport.Stable);
            mockAuthedRequest.mockResolvedValue(undefined);

            await accountDataManager.deleteAccountData("m.direct" as any);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Delete,
                "/user/%40alice%3Aexample.com/account_data/m.direct",
                undefined,
                undefined,
                undefined,
            );
        });

        it("should fallback to setAccountData with empty content when deletion is unsupported", async () => {
            mockClient.canSupport.set(Feature.AccountDataDeletion, ServerSupport.Unsupported);
            mockClient.clientRunning = false;
            mockAuthedRequest.mockResolvedValue({});

            await accountDataManager.deleteAccountData("m.direct" as any);

            // Should call PUT with empty content as fallback
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/user/%40alice%3Aexample.com/account_data/m.direct",
                undefined,
                {},
            );
        });
    });

    describe("setRoomAccountData", () => {
        it("should set room account data", async () => {
            mockAuthedRequest.mockResolvedValue({});

            await accountDataManager.setRoomAccountData("!room:example.com", "m.fully_read", {
                event_id: "$event:example.com",
            });

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/user/%40alice%3Aexample.com/rooms/!room%3Aexample.com/account_data/m.fully_read",
                undefined,
                { event_id: "$event:example.com" },
            );
        });
    });

    describe("deleteRoomAccountData", () => {
        it("should delete room account data", async () => {
            mockAuthedRequest.mockResolvedValue({});

            await accountDataManager.deleteRoomAccountData("!room:example.com", "m.fully_read");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Delete,
                "/user/%40alice%3Aexample.com/rooms/!room%3Aexample.com/account_data/m.fully_read",
            );
        });
    });

    describe("getIgnoredUsers", () => {
        it("should return empty array when no ignored users", () => {
            mockClient.store.getAccountData = vi.fn().mockReturnValue(undefined);

            const result = accountDataManager.getIgnoredUsers();

            expect(result).toEqual([]);
        });

        it("should return ignored user IDs", () => {
            const event = new MatrixEvent({
                type: "m.ignored_user_list",
                content: { ignored_users: { "@bob:example.com": {}, "@charlie:example.com": {} } },
            });
            mockClient.store.getAccountData = vi.fn().mockReturnValue(event);

            const result = accountDataManager.getIgnoredUsers();

            expect(result).toEqual(["@bob:example.com", "@charlie:example.com"]);
        });
    });

    describe("setIgnoredUsers", () => {
        it("should set ignored users via setAccountData", async () => {
            mockClient.clientRunning = false;
            mockAuthedRequest.mockResolvedValue({});

            await accountDataManager.setIgnoredUsers(["@bob:example.com"]);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/user/%40alice%3Aexample.com/account_data/m.ignored_user_list",
                undefined,
                { ignored_users: { "@bob:example.com": {} } },
            );
        });
    });

    describe("isUserIgnored", () => {
        it("should return true for ignored user", () => {
            const event = new MatrixEvent({
                type: "m.ignored_user_list",
                content: { ignored_users: { "@bob:example.com": {} } },
            });
            mockClient.store.getAccountData = vi.fn().mockReturnValue(event);

            expect(accountDataManager.isUserIgnored("@bob:example.com")).toBe(true);
        });

        it("should return false for non-ignored user", () => {
            const event = new MatrixEvent({
                type: "m.ignored_user_list",
                content: { ignored_users: { "@bob:example.com": {} } },
            });
            mockClient.store.getAccountData = vi.fn().mockReturnValue(event);

            expect(accountDataManager.isUserIgnored("@charlie:example.com")).toBe(false);
        });
    });

    describe("Data Validation", () => {
        it("should reject data_type longer than 128 characters", async () => {
            const longType = "a".repeat(129);

            await expect(accountDataManager.setAccountData(longType as any, { data: "value" } as any)).rejects.toThrow(
                "data_type too long (max 128 characters)",
            );
        });

        it("should reject content larger than 64KB", async () => {
            const largeContent = { data: "x".repeat(65537) };

            await expect(accountDataManager.setAccountData("m.test" as any, largeContent as any)).rejects.toThrow(
                "Account data too large (max 65536 bytes)",
            );
        });
    });

    describe("Error Handling", () => {
        it("should throw error on server failure for getAccountDataFromServer", async () => {
            mockClient.store.getAccountData = vi.fn().mockReturnValue(undefined);
            mockClient.isInitialSyncComplete = vi.fn().mockReturnValue(false);
            const error = new Error("Server error");
            mockAuthedRequest.mockRejectedValue(error);

            await expect(accountDataManager.getAccountDataFromServer("m.direct" as any)).rejects.toThrow("Server error");
        });

        it("should throw error on delete failure", async () => {
            mockClient.canSupport.set(Feature.AccountDataDeletion, ServerSupport.Stable);
            const error = new Error("Delete failed");
            mockAuthedRequest.mockRejectedValue(error);

            await expect(accountDataManager.deleteAccountData("m.direct" as any)).rejects.toThrow("Delete failed");
        });
    });
});
