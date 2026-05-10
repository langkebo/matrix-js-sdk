import { describe, expect, it, vi } from "vitest";

import { SpaceEvent, SpaceManager } from "../../src/space/index";
import { ClientPrefix, MatrixError, Method } from "../../src/http-api";
import { NotFoundError } from "../../src/errors";

function makeManager(authedRequest = vi.fn(), extraClient: Record<string, unknown> = {}): SpaceManager {
    return new SpaceManager({
        http: { authedRequest },
        getRoom: vi.fn(),
        ...extraClient,
    } as any);
}

describe("SpaceManager", () => {
    it("uses the v3 spaces endpoint for getSpace", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ room_id: "!space:test", name: "Root" });
        const manager = makeManager(authedRequest);

        const result = await manager.getSpace("!space:test");

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Get,
            `/spaces/${encodeURIComponent("!space:test")}`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 },
        );
        expect(result.space_id).toBe("!space:test");
        expect(result.room_id).toBe("!space:test");
    });

    it("uses the v3 spaces endpoint for createSpace", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ space_id: "!space:test", room_id: "!space:test" });
        const manager = makeManager(authedRequest);

        await manager.createSpace({ room_id: "!space:test", name: "Docs", topic: "Root", visibility: "public" });

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/spaces",
            undefined,
            { room_id: "!space:test", name: "Docs", topic: "Root", visibility: "public" },
            { prefix: ClientPrefix.V3 },
        );
    });

    it("loads user spaces from the contract endpoint and normalizes results", async () => {
        const authedRequest = vi.fn().mockResolvedValue({
            spaces: [{ room_id: "!space:test", name: "Docs" }],
        });
        const manager = makeManager(authedRequest);

        const spaces = await manager.getUserSpaces();

        expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/spaces/user", undefined, undefined, {
            prefix: ClientPrefix.V3,
        });
        expect(spaces).toEqual([
            expect.objectContaining({
                space_id: "!space:test",
                room_id: "!space:test",
                name: "Docs",
            }),
        ]);
    });

    it("searches spaces via the contract endpoint", async () => {
        const authedRequest = vi.fn().mockResolvedValue({
            chunk: [{ room_id: "!space:test", name: "Search Hit" }],
        });
        const manager = makeManager(authedRequest);

        const spaces = await manager.searchSpaces("Search", 25);

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/spaces/search",
            { search_term: "Search", limit: 25 },
            undefined,
            { prefix: ClientPrefix.V3 },
        );
        expect(spaces[0].space_id).toBe("!space:test");
    });

    it("adds children through the contract endpoint", async () => {
        const authedRequest = vi.fn().mockResolvedValue({});
        const manager = makeManager(authedRequest);

        await manager.addChild("!space:test", {
            room_id: "!child:test",
            via_servers: ["test"],
            suggested: true,
        });

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Post,
            `/spaces/${encodeURIComponent("!space:test")}/children`,
            undefined,
            {
                room_id: "!child:test",
                via_servers: ["test"],
                suggested: true,
            },
            { prefix: ClientPrefix.V3 },
        );
    });

    it("loads space rooms via the contract endpoint", async () => {
        const authedRequest = vi.fn().mockResolvedValue({
            rooms: [{ room_id: "!room:test", name: "General" }],
        });
        const manager = makeManager(authedRequest);

        const rooms = await manager.getSpaceRooms("!space:test", { limit: 20 });

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Get,
            `/spaces/${encodeURIComponent("!space:test")}/rooms`,
            { limit: 20 },
            undefined,
            { prefix: ClientPrefix.V3 },
        );
        expect(rooms[0].room_id).toBe("!room:test");
    });

    it("loads space summary via the contract endpoint", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ room_id: "!space:test", name: "Root" });
        const manager = makeManager(authedRequest);

        await manager.getSpaceSummary("!space:test");

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Get,
            `/spaces/${encodeURIComponent("!space:test")}/summary`,
            {},
            undefined,
            { prefix: ClientPrefix.V3 },
        );
    });

    it("loads space tree path via the contract endpoint", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ path: [] });
        const manager = makeManager(authedRequest);

        await manager.getSpaceTreePath("!space:test", { from: "abc" });

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Get,
            `/spaces/${encodeURIComponent("!space:test")}/tree_path`,
            { from: "abc" },
            undefined,
            { prefix: ClientPrefix.V3 },
        );
    });

    it("loads parent spaces for a room via the contract endpoint", async () => {
        const authedRequest = vi.fn().mockResolvedValue({
            chunk: [{ room_id: "!space:test", name: "Parent" }],
        });
        const manager = makeManager(authedRequest);

        const parents = await manager.getRoomParentSpaces("!room:test");

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Get,
            `/spaces/room/${encodeURIComponent("!room:test")}/parents`,
            {},
            undefined,
            { prefix: ClientPrefix.V3 },
        );
        expect(parents[0].space_id).toBe("!space:test");
    });

    it("normalizes 404 responses to NotFoundError", async () => {
        const authedRequest = vi
            .fn()
            .mockRejectedValue(new MatrixError({ errcode: "M_NOT_FOUND", error: "missing" }, 404));
        const manager = makeManager(authedRequest);

        await expect(manager.getSpace("!missing:test")).rejects.toBeInstanceOf(NotFoundError);
    });

    it("emits SpaceError on non-retryable failures", async () => {
        const authedRequest = vi
            .fn()
            .mockRejectedValue(new MatrixError({ errcode: "M_NOT_FOUND", error: "missing" }, 404));
        const manager = makeManager(authedRequest);
        const onError = vi.fn();
        manager.on(SpaceEvent.SpaceError, onError);

        await expect(manager.getSpace("!missing:test")).rejects.toBeInstanceOf(NotFoundError);
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    });
});
