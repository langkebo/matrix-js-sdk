/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect } from "vitest";

import { StubStore } from "../../../src/store/stub.ts";

describe("StubStore", () => {
    describe("constructor", () => {
        it("should create a StubStore instance", () => {
            const store = new StubStore();
            expect(store).toBeInstanceOf(StubStore);
        });
    });

    describe("accountData", () => {
        it("should have an empty accountData map", () => {
            const store = new StubStore();
            expect(store.accountData).toBeInstanceOf(Map);
            expect(store.accountData.size).toBe(0);
        });
    });

    describe("isNewlyCreated", () => {
        it("should return true", async () => {
            const store = new StubStore();
            const result = await store.isNewlyCreated();
            expect(result).toBe(true);
        });
    });

    describe("sync token", () => {
        it("should return null when no token is set", () => {
            const store = new StubStore();
            expect(store.getSyncToken()).toBeNull();
        });

        it("should store and retrieve sync token", () => {
            const store = new StubStore();
            store.setSyncToken("token123");
            expect(store.getSyncToken()).toBe("token123");
        });

        it("should overwrite sync token", () => {
            const store = new StubStore();
            store.setSyncToken("token1");
            store.setSyncToken("token2");
            expect(store.getSyncToken()).toBe("token2");
        });
    });

    describe("room operations", () => {
        it("should return null for getRoom", () => {
            const store = new StubStore();
            expect(store.getRoom("!room:server")).toBeNull();
        });

        it("should return empty array for getRooms", () => {
            const store = new StubStore();
            expect(store.getRooms()).toEqual([]);
        });

        it("should not throw on storeRoom", () => {
            const store = new StubStore();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect(() => store.storeRoom({} as any)).not.toThrow();
        });

        it("should not throw on removeRoom", () => {
            const store = new StubStore();
            expect(() => store.removeRoom("!room:server")).not.toThrow();
        });

        it("should return empty array for getRoomSummaries", () => {
            const store = new StubStore();
            expect(store.getRoomSummaries()).toEqual([]);
        });
    });

    describe("user operations", () => {
        it("should return null for getUser", () => {
            const store = new StubStore();
            expect(store.getUser("@user:server")).toBeNull();
        });

        it("should return empty array for getUsers", () => {
            const store = new StubStore();
            expect(store.getUsers()).toEqual([]);
        });

        it("should not throw on storeUser", () => {
            const store = new StubStore();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect(() => store.storeUser({} as any)).not.toThrow();
        });

        it("should not throw on setUserCreator", () => {
            const store = new StubStore();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect(() => store.setUserCreator(() => ({}) as any)).not.toThrow();
        });
    });

    describe("scrollback", () => {
        it("should return empty array", () => {
            const store = new StubStore();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect(store.scrollback({} as any, 10)).toEqual([]);
        });
    });

    describe("storeEvents", () => {
        it("should not throw", () => {
            const store = new StubStore();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect(() => store.storeEvents({} as any, [], null, false)).not.toThrow();
        });
    });

    describe("filter operations", () => {
        it("should return null for getFilter", () => {
            const store = new StubStore();
            expect(store.getFilter("@user:server", "filter_id")).toBeNull();
        });

        it("should return null for getFilterIdByName", () => {
            const store = new StubStore();
            expect(store.getFilterIdByName("filter_name")).toBeNull();
        });

        it("should not throw on storeFilter", () => {
            const store = new StubStore();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect(() => store.storeFilter({} as any)).not.toThrow();
        });

        it("should not throw on setFilterIdByName", () => {
            const store = new StubStore();
            expect(() => store.setFilterIdByName("name", "id")).not.toThrow();
        });
    });

    describe("account data operations", () => {
        it("should return undefined for getAccountData", () => {
            const store = new StubStore();
            expect(store.getAccountData("m.custom")).toBeUndefined();
        });

        it("should not throw on storeAccountDataEvents", () => {
            const store = new StubStore();
            expect(() => store.storeAccountDataEvents([])).not.toThrow();
        });
    });

    describe("sync data operations", () => {
        it("should resolve setSyncData", async () => {
            const store = new StubStore();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await expect(store.setSyncData({} as any)).resolves.toBeUndefined();
        });

        it("should return false for wantsSave", () => {
            const store = new StubStore();
            expect(store.wantsSave()).toBe(false);
        });

        it("should resolve save", async () => {
            const store = new StubStore();
            await expect(store.save()).resolves.toBeUndefined();
        });

        it("should resolve startup", async () => {
            const store = new StubStore();
            await expect(store.startup()).resolves.toBeUndefined();
        });

        it("should return null for getSavedSync", async () => {
            const store = new StubStore();
            await expect(store.getSavedSync()).resolves.toBeNull();
        });

        it("should return null for getSavedSyncToken", async () => {
            const store = new StubStore();
            await expect(store.getSavedSyncToken()).resolves.toBeNull();
        });
    });

    describe("deleteAllData", () => {
        it("should resolve without error", async () => {
            const store = new StubStore();
            await expect(store.deleteAllData()).resolves.toBeUndefined();
        });
    });

    describe("out of band members", () => {
        it("should return null for getOutOfBandMembers", async () => {
            const store = new StubStore();
            await expect(store.getOutOfBandMembers()).resolves.toBeNull();
        });

        it("should resolve setOutOfBandMembers", async () => {
            const store = new StubStore();
            await expect(store.setOutOfBandMembers("!room:server", [])).resolves.toBeUndefined();
        });

        it("should resolve clearOutOfBandMembers", async () => {
            const store = new StubStore();
            await expect(store.clearOutOfBandMembers()).resolves.toBeUndefined();
        });
    });

    describe("client options", () => {
        it("should return undefined for getClientOptions", async () => {
            const store = new StubStore();
            await expect(store.getClientOptions()).resolves.toBeUndefined();
        });

        it("should resolve storeClientOptions", async () => {
            const store = new StubStore();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await expect(store.storeClientOptions({} as any)).resolves.toBeUndefined();
        });
    });

    describe("pending events", () => {
        it("should return empty array for getPendingEvents", async () => {
            const store = new StubStore();
            await expect(store.getPendingEvents("!room:server")).resolves.toEqual([]);
        });

        it("should resolve setPendingEvents", async () => {
            const store = new StubStore();
            await expect(store.setPendingEvents("!room:server", [])).resolves.toBeUndefined();
        });
    });

    describe("to-device batches", () => {
        it("should resolve saveToDeviceBatches", async () => {
            const store = new StubStore();
            await expect(store.saveToDeviceBatches([])).resolves.toBeUndefined();
        });

        it("should return null for getOldestToDeviceBatch", async () => {
            const store = new StubStore();
            await expect(store.getOldestToDeviceBatch()).resolves.toBeNull();
        });

        it("should resolve removeToDeviceBatch", async () => {
            const store = new StubStore();
            await expect(store.removeToDeviceBatch(1)).resolves.toBeUndefined();
        });
    });

    describe("destroy", () => {
        it("should resolve without error", async () => {
            const store = new StubStore();
            await expect(store.destroy()).resolves.toBeUndefined();
        });
    });
});
