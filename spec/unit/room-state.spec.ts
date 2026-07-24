import { describe, it, expect, beforeEach, vi } from "vitest";

import { RoomStateManager } from "../../src/room-state";
import { Method, ClientPrefix } from "../../src/http-api";

describe("RoomStateManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let manager: RoomStateManager;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn().mockResolvedValue([{ type: "m.room.name" }]),
            },
        };
        manager = new RoomStateManager(mockClient);
    });

    it("gets room/all/type state with fallback", async () => {
        await expect(manager.roomState("!r:hs")).resolves.toEqual([{ type: "m.room.name" }]);
        await expect(manager.getStateEvents("!r:hs")).resolves.toEqual([{ type: "m.room.name" }]);
        await expect(manager.getStateEvents("!r:hs", "m.room.topic", "")).resolves.toEqual([{ type: "m.room.name" }]);
        await expect(manager.getAllStateEvents("!r:hs")).resolves.toEqual([{ type: "m.room.name" }]);
        await expect(manager.getStateEventsByType("!r:hs", "m.room.topic")).resolves.toEqual([{ type: "m.room.name" }]);

        mockClient.http.authedRequest.mockRejectedValueOnce(new Error("x"));
        await expect(manager.getAllStateEvents("!r:hs")).resolves.toEqual([]);
        mockClient.http.authedRequest.mockRejectedValueOnce(new Error("x"));
        await expect(manager.getStateEventsByType("!r:hs", "m.room.topic")).resolves.toEqual([]);
    });

    it("sends state and encryption events", async () => {
        mockClient.http.authedRequest
            .mockResolvedValueOnce({ event_id: "$1" })
            .mockResolvedValueOnce({ algorithm: "m.megolm.v1.aes-sha2" });
        await expect(manager.sendStateEvent("!r:hs", "m.room.topic", { topic: "t" }, "")).resolves.toEqual({
            event_id: "$1",
        });
        await expect(manager.getRoomEncryption("!r:hs")).resolves.toEqual({ algorithm: "m.megolm.v1.aes-sha2" });
        mockClient.http.authedRequest.mockResolvedValueOnce({ event_id: "$2" });
        await expect(manager.setRoomEncryption("!r:hs", { algorithm: "m.megolm.v1.aes-sha2" })).resolves.toEqual({
            event_id: "$2",
        });
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Put,
            "/rooms/!r%3Ahs/state/m.room.encryption/",
            undefined,
            { algorithm: "m.megolm.v1.aes-sha2" },
            { prefix: ClientPrefix.V3 },
        );
    });

    // MSC4497: optional `type` query parameter filters state events by event
    // type server-side, avoiding a full state fetch + client-side filter.
    it("roomState passes type query param when eventType filter is given", async () => {
        mockClient.http.authedRequest.mockResolvedValueOnce([{ type: "m.room.member" }]);

        await manager.roomState("!r:hs", "m.room.member");

        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/rooms/!r%3Ahs/state",
            { type: "m.room.member" },
            undefined,
            { prefix: ClientPrefix.V3 },
        );
    });

    it("roomState omits type query param when no eventType filter is given", async () => {
        mockClient.http.authedRequest.mockResolvedValueOnce([{ type: "m.room.name" }]);

        await manager.roomState("!r:hs");

        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/rooms/!r%3Ahs/state",
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 },
        );
    });
});
