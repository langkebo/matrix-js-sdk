import { describe, expect, it, vi } from "vitest";

import { createGroupCallForRoom } from "../../src/client-voip-group-call";

describe("client-voip-group-call", () => {
    it("throws when room already has a group call", async () => {
        const client = {
            getGroupCallForRoom: vi.fn().mockReturnValue({}),
            getRoom: vi.fn(),
        };

        await expect(
            createGroupCallForRoom(client as any, "!room:example.org", "video" as any, false, "ring" as any),
        ).rejects.toThrow("already has an existing group call");
    });

    it("throws when room does not exist", async () => {
        const client = {
            getGroupCallForRoom: vi.fn().mockReturnValue(null),
            getRoom: vi.fn().mockReturnValue(undefined),
        };

        await expect(
            createGroupCallForRoom(client as any, "!room:example.org", "video" as any, false, "ring" as any),
        ).rejects.toThrow("Cannot find room");
    });
});
