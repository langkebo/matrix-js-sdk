/*
 * client.ts 拆分 · 第二批（P3-5）：调度器发送回调与 key-backup 路径构建。
 *
 * 这两块是 P3-5 量化后 client.ts 里**仅剩的非发送路径真实逻辑**（其余 343 个方法都是转发）：
 *   - 调度器回调有微妙顺序要求（必须在下次调度前更新 pending 事件，事件 ID 监听器才赶得上）；
 *   - key-backup 路径有 3 种形态 + 可选 version 查询参数。
 * 两者此前都没有直接单测。
 */

import { describe, expect, it, vi } from "vitest";

import { createSchedulerProcessFunction } from "../../src/client-scheduler-process";
import { makeKeyBackupPath } from "../../src/key-backup-paths";
import { EventStatus, MatrixEvent } from "../../src/models/event";

function makeEvent(status: EventStatus | null): MatrixEvent {
    const event = new MatrixEvent({
        type: "m.room.message",
        event_id: "$event",
        room_id: "!room:test",
        sender: "@alice:test",
        origin_server_ts: 1,
        content: { msgtype: "m.text", body: "hi" },
    });
    if (status !== null) event.setStatus(status);
    return event;
}

describe("createSchedulerProcessFunction", () => {
    it("把事件标为 SENDING 后发送，并在下次调度前用返回的 event_id 更新 pending 事件", async () => {
        const room = { updatePendingEvent: vi.fn() };
        const updatePendingEventStatus = vi.fn();
        const sendEventHttpRequest = vi.fn().mockResolvedValue({ event_id: "$sent" });
        const event = makeEvent(EventStatus.QUEUED);

        const process = createSchedulerProcessFunction({
            getRoom: () => room as never,
            updatePendingEventStatus,
            sendEventHttpRequest,
        });
        const result = await process(event);

        expect(result).toEqual({ event_id: "$sent" });
        expect(updatePendingEventStatus).toHaveBeenCalledWith(room, event, EventStatus.SENDING);
        expect(sendEventHttpRequest).toHaveBeenCalledWith(event);
        expect(room.updatePendingEvent).toHaveBeenCalledWith(event, EventStatus.SENT, "$sent");
    });

    it("已经是 SENDING 的事件不重复设置状态（避免多余的 pending 更新）", async () => {
        const updatePendingEventStatus = vi.fn();
        const event = makeEvent(EventStatus.SENDING);

        const process = createSchedulerProcessFunction({
            getRoom: () => null,
            updatePendingEventStatus,
            sendEventHttpRequest: vi.fn().mockResolvedValue({ event_id: "$sent" }),
        });
        await process(event);

        expect(updatePendingEventStatus).not.toHaveBeenCalled();
    });

    it("没有 room 时不更新 pending 事件，但仍返回发送结果", async () => {
        const updatePendingEventStatus = vi.fn();
        const process = createSchedulerProcessFunction({
            getRoom: () => null,
            updatePendingEventStatus,
            sendEventHttpRequest: vi.fn().mockResolvedValue({ event_id: "$sent" }),
        });

        await expect(process(makeEvent(EventStatus.NOT_SENT))).resolves.toEqual({ event_id: "$sent" });
    });
});

describe("makeKeyBackupPath", () => {
    it("无 roomId/sessionId 时为 /room_keys/keys", () => {
        expect(makeKeyBackupPath()).toEqual({ path: "/room_keys/keys", queryData: undefined });
    });

    it("只有 roomId 时按房间取键", () => {
        expect(makeKeyBackupPath("!room:test")).toEqual({
            path: "/room_keys/keys/!room%3Atest",
            queryData: undefined,
        });
    });

    it("roomId + sessionId 时按会话取键", () => {
        expect(makeKeyBackupPath("!room:test", "sess1")).toEqual({
            path: "/room_keys/keys/!room%3Atest/sess1",
            queryData: undefined,
        });
    });

    it("给定 version 时带上 version 查询参数", () => {
        expect(makeKeyBackupPath("!room:test", "sess1", "7")).toEqual({
            path: "/room_keys/keys/!room%3Atest/sess1",
            queryData: { version: "7" },
        });
    });
});
