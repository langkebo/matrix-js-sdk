import { describe, it, expect, beforeEach, vi } from "vitest";

import { RoomCreationManager } from "../../src/room-creation";
import { EventType } from "../../src/@types/event";

/*
 * mockClient **故意不提供** `createDirectRoom` / `findOrCreateDirectRoom` /
 * `getCreateRoomOptions` / `setCreateRoomOptions` —— 它们在本 fork 的 MatrixClient
 * 上运行时并不存在（类型表却声明了）。本文件只挂真实能力（`createRoom` /
 * `getAccountData` / `getRoom`），实现若回退到转发，立刻 TypeError。
 *
 * 本模块此前**没有任何 spec**。
 */
describe("RoomCreationManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let manager: RoomCreationManager;

    beforeEach(() => {
        mockClient = {
            createRoom: vi.fn().mockResolvedValue({ room_id: "!new:hs" }),
            getAccountData: vi.fn().mockReturnValue(undefined),
            getRoom: vi.fn().mockReturnValue(null),
        };
        manager = new RoomCreationManager(mockClient);
    });

    it("createRoom 委托 client.createRoom，并叠加选项模板", async () => {
        manager.setCreateRoomOptions({ preset: "public_chat" });

        await expect(manager.createRoom({ name: "N" })).resolves.toEqual({ room_id: "!new:hs" });
        expect(mockClient.createRoom).toHaveBeenCalledWith({ preset: "public_chat", name: "N" });
    });

    it("createDirectRoom 补 invite + is_direct + 默认 preset", async () => {
        await manager.createDirectRoom("@bob:hs");

        expect(mockClient.createRoom).toHaveBeenCalledWith(
            expect.objectContaining({
                invite: ["@bob:hs"],
                is_direct: true,
                preset: "trusted_private_chat",
            }),
        );
    });

    it("createDirectRoom 保留调用方的 preset，并把 userId 追加进已有 invite", async () => {
        await manager.createDirectRoom("@bob:hs", { invite: ["@carol:hs"], preset: "public_chat" });

        expect(mockClient.createRoom).toHaveBeenCalledWith(
            expect.objectContaining({ invite: ["@carol:hs", "@bob:hs"], preset: "public_chat" }),
        );
    });

    it("findOrCreateDirectRoom 命中 m.direct 的既有房间时不再建房", async () => {
        // 必须用 mockReturnValue —— 直接 `mockClient.getAccountData = () => …` 会把 spy 换掉，
        // 后面的 toHaveBeenCalledWith 会以 "[Function] is not a spy" 失败。
        mockClient.getAccountData.mockReturnValue({ getContent: () => ({ "@bob:hs": ["!existing:hs"] }) });
        mockClient.getRoom.mockImplementation((id: string) => (id === "!existing:hs" ? { roomId: id } : null));

        await expect(manager.findOrCreateDirectRoom("@bob:hs")).resolves.toEqual({ room_id: "!existing:hs" });
        expect(mockClient.getAccountData).toHaveBeenCalledWith(EventType.Direct);
        expect(mockClient.createRoom).not.toHaveBeenCalled();
    });

    it("findOrCreateDirectRoom 在 m.direct 指向的房间已不在时新建", async () => {
        mockClient.getAccountData.mockReturnValue({ getContent: () => ({ "@bob:hs": ["!gone:hs"] }) });
        mockClient.getRoom.mockReturnValue(null);

        await expect(manager.findOrCreateDirectRoom("@bob:hs")).resolves.toEqual({ room_id: "!new:hs" });
        expect(mockClient.createRoom).toHaveBeenCalled();
    });

    it("选项模板是模块内状态，且读写都走副本", () => {
        manager.setCreateRoomOptions({ name: "template" });
        expect(manager.getCreateRoomOptions()).toEqual({ name: "template" });

        manager.getCreateRoomOptions().name = "mutated";
        expect(manager.getCreateRoomOptions()).toEqual({ name: "template" });
    });
});
