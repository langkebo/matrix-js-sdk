/*
 * 调度器发送回调（P3-5 从 client.ts 构造函数里拆出）。
 *
 * `MatrixScheduler` 的 process function 原来是内联在 `MatrixClient` 构造函数里的闭包，
 * 依赖 `this`：既没法单测，也让构造函数更难读。这里改成显式依赖注入的工厂函数。
 *
 * 顺序很关键（原注释保留）：必须在**下次调度运行之前**用返回的 `event_id` 更新 pending 事件，
 * 否则监听事件 ID 变化的同步监听器会先跑、拿不到 id。
 */

import type { MatrixEvent } from "./models/event.ts";
import { EventStatus } from "./models/event.ts";
import type { ISendEventResponse } from "./@types/requests.ts";
import type { Room } from "./models/room.ts";

export interface SchedulerProcessDeps {
    /** 取事件所在房间（可能已被丢弃 → null）。 */
    getRoom: (roomId: string | undefined) => Room | null;
    /** 更新 pending 事件状态（有 room 时走 room，否则直接改事件）。 */
    updatePendingEventStatus: (room: Room | null, event: MatrixEvent, status: EventStatus) => void;
    /** 真正发出 HTTP 请求。 */
    sendEventHttpRequest: (event: MatrixEvent) => Promise<ISendEventResponse>;
}

/** 构造 `MatrixScheduler.setProcessFunction()` 需要的回调。 */
export function createSchedulerProcessFunction({
    getRoom,
    updatePendingEventStatus,
    sendEventHttpRequest,
}: SchedulerProcessDeps): (event: MatrixEvent) => Promise<ISendEventResponse> {
    return async function processScheduledEvent(event: MatrixEvent): Promise<ISendEventResponse> {
        const room = getRoom(event.getRoomId());
        if (event.status !== EventStatus.SENDING) {
            updatePendingEventStatus(room, event, EventStatus.SENDING);
        }
        const res = await sendEventHttpRequest(event);
        if (room) {
            // ensure we update pending event before the next scheduler run so that any listeners to event id
            // updates on the synchronous event emitter get a chance to run first.
            room.updatePendingEvent(event, EventStatus.SENT, res.event_id);
        }
        return res;
    };
}
