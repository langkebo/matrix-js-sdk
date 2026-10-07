import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import { RoomEventsManager } from "../../src/room-events";
import { MatrixEvent } from "../../src/models/event";
import { Method, ClientPrefix } from "../../src/http-api";

/*
 * 注意本 spec 的 mockClient **故意不提供** `getRoomEvents` / `getStateEventsForRoom` /
 * `getTimelineEvents` / `getEphemeralEvents` / `hasTimelineEvent` / `findEventById`。
 *
 * 这 6 个方法在本 fork 的 MatrixClient 上运行时并不存在（类型表却声明了），原先
 * `RoomEventsManager` 逐个转发给它们 ⇒ 调用即 TypeError。旧 spec 把这 6 个方法
 * `vi.fn()` 到 mockClient 上，于是这个事实被测试掩盖、长期全绿 —— 一旦有人把实现
 * 改回去，本文件立刻以 TypeError 失败，而不是"通过"。
 */
describe("RoomEventsManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    const roomId = "!room:hs";

    const evt = (id: string, type = "m.room.message"): MatrixEvent =>
        new MatrixEvent({ event_id: id, type, sender: "@a:hs", content: {} });

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn().mockResolvedValue({ event_id: "$ok" }),
            },
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("timeline / state 查询委托 Room 与 EphemeralManager", async () => {
        const timelineEvents = [evt("$a"), evt("$b"), evt("$c")];
        const nameEvent = evt("$name", "m.room.name");

        mockClient.getRoom = (id: string) =>
            id === roomId
                ? {
                      getLiveTimeline: () => ({ getEvents: () => timelineEvents }),
                      currentState: { events: new Map([["m.room.name", new Map([["", nameEvent]])]]) },
                      findEventById: (eventId: string) => timelineEvents.find((e) => e.getId() === eventId),
                  }
                : null;
        mockClient.getEphemeralManager = () => ({
            getEphemeralEvents: () => [{ type: "m.typing", sender: "@a:hs", content: {} }],
        });

        const manager = new RoomEventsManager(mockClient);

        expect(await manager.getRoomEvents(roomId)).toEqual(timelineEvents);
        // limit 取**最近** N 条
        expect(await manager.getRoomEvents(roomId, 2)).toEqual(timelineEvents.slice(-2));
        expect(await manager.getStateEventsForRoom(roomId)).toEqual([nameEvent]);
        expect(manager.getTimelineEvents(roomId)).toEqual(timelineEvents);
        expect(manager.getEphemeralEvents(roomId)).toEqual([{ type: "m.typing", sender: "@a:hs", content: {} }]);
        expect(manager.hasTimelineEvent(roomId, "$b")).toBe(true);
        expect(manager.hasTimelineEvent(roomId, "$zzz")).toBe(false);
        expect(manager.findEventById(roomId, "$b")).toBe(timelineEvents[1]);
        // Room.findEventById 返回 undefined，本方法契约是 null —— 必须归一
        expect(manager.findEventById(roomId, "$zzz")).toBeNull();
    });

    it("未知房间返回空结果而非抛错（getRoom 返回 null）", async () => {
        mockClient.getRoom = () => null;
        const manager = new RoomEventsManager(mockClient);

        expect(await manager.getRoomEvents("!nope:hs")).toEqual([]);
        expect(await manager.getStateEventsForRoom("!nope:hs")).toEqual([]);
        expect(manager.getTimelineEvents("!nope:hs")).toEqual([]);
        expect(manager.hasTimelineEvent("!nope:hs", "$x")).toBe(false);
        expect(manager.findEventById("!nope:hs", "$x")).toBeNull();
    });

    it("getEvent / getMessages 仍走 http.authedRequest（真实现未被动过）", async () => {
        const manager = new RoomEventsManager(mockClient);

        await manager.getEvent(roomId, "$e");
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Get,
            expect.stringContaining("/rooms/!room%3Ahs/event/%24e"),
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 },
        );

        await manager.getMessages(roomId, "b", 30, "t1");
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Get,
            expect.stringContaining("/rooms/!room%3Ahs/messages"),
            { dir: "b", limit: "30", from: "t1" },
            undefined,
            { prefix: ClientPrefix.V3 },
        );

        await manager.getMessages(roomId, "f", 10);
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Get,
            expect.stringContaining("/rooms/!room%3Ahs/messages"),
            { dir: "f", limit: "10" },
            undefined,
            { prefix: ClientPrefix.V3 },
        );
    });

    it("sends reaction event", async () => {
        vi.spyOn(Date, "now").mockReturnValue(123);
        const manager = new RoomEventsManager(mockClient);

        await manager.sendReaction(roomId, "$evt", "👍");
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Put,
            expect.stringContaining("/rooms/!room%3Ahs/send/m.reaction/m123"),
            undefined,
            {
                "m.relates_to": {
                    rel_type: "m.annotation",
                    event_id: "$evt",
                    key: "👍",
                },
            },
            { prefix: ClientPrefix.V3 },
        );
    });
});
