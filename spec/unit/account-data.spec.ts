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

describe("AccountDataManager", () => {
    let mockClient: any;
    let accountDataManager: AccountDataManager;
    let mockAuthedRequest: ReturnType<typeof vi.fn>;
    let mockSetAccountData: ReturnType<typeof vi.fn>;
    let mockSetAccountDataRaw: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockAuthedRequest = vi.fn();
        mockSetAccountData = vi.fn();
        mockSetAccountDataRaw = vi.fn();

        const mockAccountDataMap = new Map();

        mockClient = {
            credentials: {
                userId: "@alice:example.com",
            },
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
            setAccountData: mockSetAccountData,
            setAccountDataRaw: mockSetAccountDataRaw,
        };
        accountDataManager = new AccountDataManager(mockClient);
    });

    describe("setAccountData", () => {
        it("should set account data", async () => {
            mockSetAccountData.mockResolvedValue({});

            await accountDataManager.setAccountData("m.direct", { "@bob:example.com": ["!room:example.com"] });

            expect(mockSetAccountData).toHaveBeenCalledWith("m.direct", { "@bob:example.com": ["!room:example.com"] });
        });

        it("should handle custom event types", async () => {
            mockSetAccountData.mockResolvedValue({});

            await accountDataManager.setAccountData("com.example.custom", { data: "value" });

            expect(mockSetAccountData).toHaveBeenCalledWith("com.example.custom", { data: "value" });
        });
    });

    describe("setAccountDataRaw", () => {
        it("should set account data raw", () => {
            accountDataManager.setAccountDataRaw("m.push_rules", { global: {} });

            expect(mockSetAccountDataRaw).toHaveBeenCalledWith("m.push_rules", { global: {} });
        });
    });

    describe("getAccountData", () => {
        it("should get account data from store", () => {
            const event = new MatrixEvent({
                type: "m.direct",
                content: { "@bob:example.com": ["!room:example.com"] },
            });
            mockClient.store.accountData.set("m.direct", event);

            const result = accountDataManager.getAccountData("m.direct");

            expect(result).toBe(event);
            expect(mockClient.store.getAccountData).toHaveBeenCalledWith("m.direct");
        });

        it("should return undefined for non-existent data", () => {
            const result = accountDataManager.getAccountData("m.nonexistent");

            expect(result).toBeUndefined();
        });
    });

    describe("getAccountDataFromServer", () => {
        it("should get account data from server", async () => {
            const content = { "@bob:example.com": ["!room:example.com"] };
            mockAuthedRequest.mockResolvedValue(content);

            const result = await accountDataManager.getAccountDataFromServer("m.direct");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/user/%40alice%3Aexample.com/account_data/m.direct",
            );
            expect(result).toBeInstanceOf(MatrixEvent);
            expect(result?.getType()).toBe("m.direct");
            expect(result?.getContent()).toEqual(content);
        });

        it("should cache fetched data in store", async () => {
            const content = { data: "value" };
            mockAuthedRequest.mockResolvedValue(content);

            await accountDataManager.getAccountDataFromServer("com.example.custom");

            expect(mockClient.store.accountData.has("com.example.custom")).toBe(true);
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
        it("should delete account data", async () => {
            mockAuthedRequest.mockResolvedValue({});

            await accountDataManager.deleteAccountData("m.direct");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Delete,
                "/user/%40alice%3Aexample.com/account_data/m.direct",
            );
        });

        it("should clear data from store after deletion", async () => {
            mockAuthedRequest.mockResolvedValue({});

            await accountDataManager.deleteAccountData("m.direct");

            const storedEvent = mockClient.store.accountData.get("m.direct");
            expect(storedEvent).toBeInstanceOf(MatrixEvent);
            expect(storedEvent.getContent()).toEqual({});
        });

        it("should handle deletion of non-existent data", async () => {
            mockAuthedRequest.mockResolvedValue({});

            await accountDataManager.deleteAccountData("m.nonexistent");

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Delete,
                "/user/%40alice%3Aexample.com/account_data/m.nonexistent",
            );
        });
    });

    describe("Error Handling", () => {
        it("should throw error on server failure", async () => {
            const error = new Error("Server error");
            mockAuthedRequest.mockRejectedValue(error);

            await expect(accountDataManager.getAccountDataFromServer("m.direct")).rejects.toThrow("Server error");
        });

        it("should throw error on delete failure", async () => {
            const error = new Error("Delete failed");
            mockAuthedRequest.mockRejectedValue(error);

            await expect(accountDataManager.deleteAccountData("m.direct")).rejects.toThrow("Delete failed");
        });
    });
});
