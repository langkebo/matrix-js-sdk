import { describe, expect, it, vi } from "vitest";

import { clearClientStores } from "../../src/client-store-cleanup";

describe("client-store-cleanup", () => {
    it("throws when client is running", async () => {
        const client = { clientRunning: true };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await expect(clearClientStores(client as any)).rejects.toThrow("Cannot clear stores while client is running");
    });

    it("deletes data from the main store", async () => {
        const client = {
            clientRunning: false,
            store: { deleteAllData: vi.fn().mockResolvedValue(undefined) },
            legacyCryptoStore: undefined,
            logger: { info: vi.fn(), warn: vi.fn() },
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await clearClientStores(client as any);

        expect(client.store.deleteAllData).toHaveBeenCalled();
    });

    it("deletes data from legacy crypto store when present", async () => {
        const client = {
            clientRunning: false,
            store: { deleteAllData: vi.fn().mockResolvedValue(undefined) },
            legacyCryptoStore: { deleteAllData: vi.fn().mockResolvedValue(undefined) },
            logger: { info: vi.fn(), warn: vi.fn() },
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await clearClientStores(client as any);

        expect(client.store.deleteAllData).toHaveBeenCalled();
        expect(client.legacyCryptoStore.deleteAllData).toHaveBeenCalled();
    });
});
