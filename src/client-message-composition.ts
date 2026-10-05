/*
 * 消息组合的纯逻辑（P3-5 从 client.ts 拆出的第一批）。
 *
 * 这里只放**不依赖 MatrixClient 实例**的部分：参数归一化与关系内容构建。它们原先内联在
 * `client.ts` 的同名公开方法里，导致：
 *   - `sendTextMessage` / `sendNotice` / `sendEmoteMessage` 的归一化代码**重复三遍**；
 *   - `replyToEvent` / `editEvent` 的关系构建只能靠整体发送路径间接覆盖，没有单测。
 * client.ts 现在只保留公开签名 + 转发，行为不变（既有 client 测试即回归网）。
 */

import type { MatrixEvent } from "./models/event.ts";
import type { RoomMessageEventContent } from "./@types/events.ts";
import { RelationType } from "./@types/event.ts";

export interface ThreadBodyArgs {
    threadId: string | null;
    body: string;
    txnId: string | undefined;
}

/**
 * 归一化 `sendTextMessage` / `sendNotice` / `sendEmoteMessage` 的两种调用形式。
 *
 * 这两组公开方法历史上支持两种签名：
 *   - `(roomId, body, txnId?)`
 *   - `(roomId, threadId, body, txnId?)`
 * 判别依据是第一个参数是否为线程 ID（Matrix 的房间/事件 ID 都以 `$` 开头；`null` 显式表示
 * 「非线程」）。原实现把这段判断在三个方法里各抄了一份，这里收敛成一处。
 */
export function normalizeThreadBodyArgs(
    threadIdOrBody: string | null,
    bodyOrTxnId?: string,
    txnId?: string,
): ThreadBodyArgs {
    if (threadIdOrBody !== null && !threadIdOrBody.startsWith("$")) {
        return { threadId: null, body: threadIdOrBody, txnId: bodyOrTxnId };
    }
    return { threadId: threadIdOrBody, body: bodyOrTxnId!, txnId };
}

function assertSameRoom(roomId: string, event: MatrixEvent, action: string): void {
    if (event.getRoomId() !== roomId) {
        throw new Error(`Cannot ${action} an event in a different room`);
    }
}

/**
 * 构建回复内容：在 `m.relates_to.m.in_reply_to` 里指向目标事件，保留调用方已有的
 * `m.relates_to` 字段（例如同时是线程回复时的 `rel_type`/`event_id`）。
 *
 * 房间不匹配时抛错 —— 这个检查必须在**发出去之前**做，否则会把回复发到别的房间。
 */
export function buildReplyContent(
    roomId: string,
    event: MatrixEvent,
    content: RoomMessageEventContent,
): RoomMessageEventContent {
    assertSameRoom(roomId, event, "reply to");

    return {
        ...content,
        "m.relates_to": {
            ...(content["m.relates_to"] ?? {}),
            "m.in_reply_to": {
                event_id: event.getId()!,
            },
        },
    } as RoomMessageEventContent;
}

/**
 * 构建编辑内容：新内容放在 `m.new_content`，`m.relates_to` 标记为 `m.replace` 并指向被编辑事件。
 *
 * 注意 `m.new_content` 存的是**原始 content**（不含 `m.relates_to`），与 Matrix 的
 * `m.replace` 约定一致；顶层同样携带新正文，便于旧客户端降级展示。
 */
export function buildEditContent(
    roomId: string,
    event: MatrixEvent,
    content: RoomMessageEventContent,
): RoomMessageEventContent {
    assertSameRoom(roomId, event, "edit");

    return {
        ...content,
        "m.new_content": {
            ...content,
        },
        "m.relates_to": {
            ...(content["m.relates_to"] ?? {}),
            rel_type: RelationType.Replace,
            event_id: event.getId()!,
        },
    } as RoomMessageEventContent;
}
