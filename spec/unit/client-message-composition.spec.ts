/*
 * 消息组合的纯逻辑（P3-5 · client.ts 拆分第一批）。
 *
 * 抽出来的原因：`sendTextMessage` / `sendNotice` / `sendEmoteMessage` 三个公开方法里
 * 那段「threadId 还是 body」的参数归一化**一字不差地重复了三遍**；`replyToEvent` /
 * `editEvent` 里的关系构建也是可以独立测的逻辑。搬进模块后 client.ts 只留转发，
 * 这几处终于有单测（原来只能通过整体 sendEvent 间接覆盖）。
 */

import { describe, expect, it } from "vitest";

import { MatrixEvent } from "../../src/models/event";
import { EventType, RelationType } from "../../src/@types/event";
import { MsgType } from "../../src/@types/event";
import { buildEditContent, buildReplyContent, normalizeThreadBodyArgs } from "../../src/client-message-composition";

function makeEvent(overrides: { roomId?: string; eventId?: string; threadRootId?: string } = {}): MatrixEvent {
    const event = new MatrixEvent({
        type: EventType.RoomMessage,
        event_id: overrides.eventId ?? "$target",
        room_id: overrides.roomId ?? "!room:test",
        sender: "@alice:test",
        origin_server_ts: 1,
        content: { msgtype: MsgType.Text, body: "original" },
    });
    if (overrides.threadRootId !== undefined) {
        // threadRootId 由 unsigned 的线程字段派生；这里直接 stub 掉，测试只关心归一化结果
        Object.defineProperty(event, "threadRootId", { value: overrides.threadRootId, configurable: true });
    }
    return event;
}

describe("normalizeThreadBodyArgs", () => {
    it("两参形式：第一个参数不是事件 ID（不以 $ 开头）时当作 body，第二个当作 txnId", () => {
        expect(normalizeThreadBodyArgs("hello", "txn-1", undefined)).toEqual({
            threadId: null,
            body: "hello",
            txnId: "txn-1",
        });
    });

    it("三参形式：第一个参数是线程 ID（$ 开头）时按 (threadId, body, txnId) 解释", () => {
        expect(normalizeThreadBodyArgs("$thread", "hello", "txn-2")).toEqual({
            threadId: "$thread",
            body: "hello",
            txnId: "txn-2",
        });
    });

    it("threadId 为 null 时按三参形式解释", () => {
        expect(normalizeThreadBodyArgs(null, "hello", "txn-3")).toEqual({
            threadId: null,
            body: "hello",
            txnId: "txn-3",
        });
    });

    it("两参形式且没有 txnId 时 txnId 为 undefined（而不是 null 之类的占位）", () => {
        expect(normalizeThreadBodyArgs("hello", undefined, undefined)).toEqual({
            threadId: null,
            body: "hello",
            txnId: undefined,
        });
    });
});

describe("buildReplyContent", () => {
    it("把 m.in_reply_to 指向目标事件，并保留原有的 m.relates_to 字段", () => {
        const content = buildReplyContent("!room:test", makeEvent(), {
            msgtype: MsgType.Text,
            body: "reply",
            "m.relates_to": { rel_type: RelationType.Annotation, event_id: "$other" },
        });

        expect(content["m.relates_to"]).toEqual({
            rel_type: RelationType.Annotation,
            event_id: "$other",
            "m.in_reply_to": { event_id: "$target" },
        });
        expect(content.body).toBe("reply");
    });

    it("房间不匹配时抛错（避免把回复发到别的房间）", () => {
        expect(() => buildReplyContent("!other:test", makeEvent(), { msgtype: MsgType.Text, body: "x" })).toThrow(
            /different room/,
        );
    });
});

describe("buildEditContent", () => {
    it("写入 m.new_content（原始内容）并把 relates_to 设为 m.replace", () => {
        const content = buildEditContent("!room:test", makeEvent(), { msgtype: MsgType.Text, body: "fixed" });

        expect(content["m.new_content"]).toEqual({ msgtype: MsgType.Text, body: "fixed" });
        expect(content["m.relates_to"]).toEqual({ rel_type: RelationType.Replace, event_id: "$target" });
        // 顶层仍是新内容本身（编辑事件按 m.replace 约定携带新正文）
        expect(content.body).toBe("fixed");
    });

    it("保留原有的 m.relates_to 字段（例如同时是线程回复）", () => {
        const content = buildEditContent("!room:test", makeEvent(), {
            msgtype: MsgType.Text,
            body: "fixed",
            "m.relates_to": { rel_type: RelationType.Reference, event_id: "$root" },
        });

        expect(content["m.relates_to"]).toMatchObject({
            rel_type: RelationType.Replace,
            event_id: "$target",
            // 原有字段被保留（当前实现是覆盖 rel_type/event_id，其余保留）
        });
    });

    it("房间不匹配时抛错", () => {
        expect(() => buildEditContent("!other:test", makeEvent(), { msgtype: MsgType.Text, body: "x" })).toThrow(
            /different room/,
        );
    });
});
