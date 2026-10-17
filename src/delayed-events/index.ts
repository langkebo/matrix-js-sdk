/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/**
 * Delayed Events Manager - MSC4140 延迟事件管理
 *
 * 提供已调度延迟事件的管理操作：取消、重启（心跳）、强制发送。
 *
 * SDK-BL-004/005: 此前延迟事件管理能力直接挂在 `MatrixClient` 上
 * (`src/client.ts` 的 `_unstable_*` 方法)，且 cancel/restart/send 系列优先
 * 尝试 action-in-PATH (`/delayed_events/{id}/{action}`)，当时后端不支持该路径，
 * 触发 `M_UNRECOGNIZED` 后才 fallback 到 action-in-BODY —— 每次管理操作多
 * 一次失败请求。本 Manager 统一使用 action-in-BODY 单次请求
 * (`POST /delayed_events/{delay_id}` body `{ action }`)，删除 fallback。
 * （2026-10-14 起后端补齐了 action-in-PATH 三个子路径；两形态如今均受支持，
 * 本 Manager 维持单请求的 body 形态不变。）
 *
 * 后端实现: synapse-rust/src/web/routes/delayed_events.rs
 *   POST /_matrix/client/unstable/org.matrix.msc4140/delayed_events/{delay_id}
 *   { "action": "send" | "cancel" | "restart" }
 *
 * `MatrixClient` 上的 `_unstable_cancelScheduledDelayedEvent` 等方法保留为
 * 向后兼容的委托方法，内部转发到本 Manager。
 */

import type { EmptyObject } from "../@types/common";
import type { IRequestOpts } from "../http-api/interface";
import { Method } from "../http-api/method";
import { UnsupportedDelayedEventsEndpointError, ValidationError } from "../errors";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { MatrixClient } from "../client";
import { getOrCreateManager, registerManagerClass } from "../client-infra/manager-registry";
import { UpdateDelayedEventAction } from "../@types/requests";
import {
    buildDelayedEventsPath,
    buildDedicatedDelayedEventPath,
    buildUnstableFeaturePrefix,
} from "../client-delayed-events";

/** MSC4140 unstable feature name. Local copy to avoid a runtime circular import of `client.ts`. */
const UNSTABLE_MSC4140_DELAYED_EVENTS = "org.matrix.msc4140";

const DELAYED_EVENTS_PREFIX = buildUnstableFeaturePrefix(UNSTABLE_MSC4140_DELAYED_EVENTS);

type DelayedEventClientEndpoint =
    | "cancelScheduledDelayedEvent"
    | "restartScheduledDelayedEvent"
    | "sendScheduledDelayedEvent"
    | "getScheduledDelayedEvent"
    | "listScheduledDelayedEvents"
    | "scheduleDelayedEvent";

/**
 * `GET /delayed_events/{delay_id}` 的响应（MSC4140）。
 *
 * 与后端 handler 逐字段对齐：`delay_id` / `room_id` / `type` / 可选 `state_key` /
 * `delay_ms` / `delayed_since_ts`（调度时刻）/ `content`。`state_key` 缺席表示不是状态事件。
 */
export interface DelayedEventInfo {
    delay_id: number;
    room_id: string;
    type: string;
    state_key?: string;
    delay_ms: number;
    delayed_since_ts: number;
    content: Record<string, unknown>;
}

/**
 * 专用调度端点（`PUT /rooms/{roomId}/delayed_event/{eventType}/{txnId}`）的请求体。
 *
 * 与后端 `parse_schedule_request` 逐字段对齐（synapse-rust
 * synapse-web/src/routes/delayed_events.rs）：`delay_ms` 必须为正整数且不超过
 * 24 小时；`content` 是事件本体（不像 `/send` 那样整个 body 即内容）；
 * `state_key` 缺席或显式 `null` 都表示消息事件。
 *
 * 注意：MSC4354 的 sticky 字段在该端点被后端拒绝（501）——本服务器把 sticky
 * 事件建模为按用户置钉（`POST /rooms/{roomId}/sticky_events`），无法在一次
 * 调用里"调度并置钉"。
 */
export interface ScheduleDelayedEventRequest {
    delay_ms: number;
    content: Record<string, unknown>;
    state_key?: string | null;
}

/** 专用调度端点的响应：服务端生成的 `delay_id`（i64，JSON number）。 */
export interface ScheduleDelayedEventResponse {
    delay_id: number;
}

export class DelayedEventsManager extends BaseManager {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /** 抛出 `UnsupportedDelayedEventsEndpointError` 当服务端未声明 MSC4140 支持。 */
    private async assertSupported(apiName: DelayedEventClientEndpoint): Promise<void> {
        const supported = await this.client.doesServerSupportUnstableFeature(UNSTABLE_MSC4140_DELAYED_EVENTS);
        if (!supported) {
            throw new UnsupportedDelayedEventsEndpointError("Server does not support the delayed events API", apiName);
        }
    }

    /**
     * 取消已调度的延迟事件。
     *
     * @param delayId     服务端在调度延迟事件时返回的 delay_id
     * @param requestOpts 可选请求选项（localTimeoutMs / abortSignal / headers）
     *
     * @example
     * ```typescript
     * await client.getDelayedEventsManager().cancelScheduledDelayedEvent(42);
     * ```
     */
    public async cancelScheduledDelayedEvent(
        delayId: string | number,
        requestOpts?: IRequestOpts,
    ): Promise<EmptyObject> {
        return await this.updateScheduledDelayedEvent(delayId, UpdateDelayedEventAction.Cancel, requestOpts);
    }

    /**
     * 重启（心跳）已调度的延迟事件。
     *
     * @param delayId     服务端在调度延迟事件时返回的 delay_id
     * @param requestOpts 可选请求选项（localTimeoutMs / abortSignal / headers）
     *
     * @example
     * ```typescript
     * await client.getDelayedEventsManager().restartScheduledDelayedEvent(42);
     * ```
     */
    public async restartScheduledDelayedEvent(
        delayId: string | number,
        requestOpts?: IRequestOpts,
    ): Promise<EmptyObject> {
        return await this.updateScheduledDelayedEvent(delayId, UpdateDelayedEventAction.Restart, requestOpts);
    }

    /**
     * 立即发送已调度的延迟事件（不再等待计划投递）。
     *
     * @param delayId     服务端在调度延迟事件时返回的 delay_id
     * @param requestOpts 可选请求选项（localTimeoutMs / abortSignal / headers）
     *
     * @example
     * ```typescript
     * await client.getDelayedEventsManager().sendScheduledDelayedEvent(42);
     * ```
     */
    public async sendScheduledDelayedEvent(delayId: string | number, requestOpts?: IRequestOpts): Promise<EmptyObject> {
        return await this.updateScheduledDelayedEvent(delayId, UpdateDelayedEventAction.Send, requestOpts);
    }

    /**
     * 统一的管理操作实现：action-in-BODY 单次请求。
     *
     * SDK-BL-005: 后端仅支持 `POST /delayed_events/{delay_id}` body `{ action }`，
     * 不支持 action-in-PATH，因此无需 fallback。
     *
     * FT-084/FT-101: 后端 delay_id 为 i64 (JSON number)，参数类型须接受 number。
     * number 类型校验为正整数（数据库 id 从 1 开始），string 类型走 requireNonEmptyString。
     */
    /** FT-084/FT-101：后端 `delay_id` 是 i64，number 必须为正整数；string 走非空校验。 */
    private normalizeDelayId(delayId: string | number): string {
        if (typeof delayId === "number") {
            if (!Number.isInteger(delayId) || delayId <= 0) {
                throw new ValidationError("delayId must be a positive integer or non-empty string");
            }
        } else {
            this.requireNonEmptyString(delayId, "delayId");
        }
        return String(delayId);
    }

    /**
     * 查询单个**待发**的延迟事件（MSC4140）。
     *
     * `GET /_matrix/client/unstable/org.matrix.msc4140/delayed_events/{delay_id}`。
     * 只有调度它的用户能读到，且仅在该事件仍 pending 时可见：缺失 / 他人 / 已结算
     * 一律 `M_NOT_FOUND`（后端刻意不泄漏他人延迟事件的存在性，SDK 不额外包装）。
     *
     * @param delayId 服务端在调度时返回的 `delay_id`（i64）
     * @param requestOpts 可选请求选项（localTimeoutMs / abortSignal / headers）
     * @returns 延迟事件的完整描述（含 `delayed_since_ts` 与 `content`）
     * @throws UnsupportedDelayedEventsEndpointError 服务端未声明 MSC4140 支持时
     * @example
     * ```typescript
     * const delayed = await client.getDelayedEventsManager().getScheduledDelayedEvent(42);
     * console.log(delayed.room_id, delayed.type, delayed.delay_ms);
     * ```
     */
    public async getScheduledDelayedEvent(
        delayId: string | number,
        requestOpts?: IRequestOpts,
    ): Promise<DelayedEventInfo> {
        const delayIdStr = this.normalizeDelayId(delayId);
        await this.assertSupported("getScheduledDelayedEvent");

        return await this.request<DelayedEventInfo>({
            method: Method.Get,
            path: buildDelayedEventsPath(delayIdStr),
            prefix: DELAYED_EVENTS_PREFIX,
            localTimeoutMs: requestOpts?.localTimeoutMs,
            headers: requestOpts?.headers,
            abortSignal: requestOpts?.abortSignal,
            label: "getScheduledDelayedEvent",
        });
    }

    private async updateScheduledDelayedEvent(
        delayId: string | number,
        action: UpdateDelayedEventAction,
        requestOpts?: IRequestOpts,
    ): Promise<EmptyObject> {
        const delayIdStr = this.normalizeDelayId(delayId);
        const apiName = `${action}ScheduledDelayedEvent` as DelayedEventClientEndpoint;
        await this.assertSupported(apiName);

        return await this.request<EmptyObject>({
            method: Method.Post,
            path: buildDelayedEventsPath(delayIdStr),
            prefix: DELAYED_EVENTS_PREFIX,
            body: { action },
            localTimeoutMs: requestOpts?.localTimeoutMs,
            headers: requestOpts?.headers,
            abortSignal: requestOpts?.abortSignal,
            // 管理操作不可重试（非幂等：cancel/restart/send 改变服务端状态）
            retry: { idempotent: false, retryNonIdempotent: false, maxRetries: 0 },
            label: `${action}ScheduledDelayedEvent`,
        });
    }

    /**
     * 列出当前用户的全部**待发**延迟事件（MSC4140）。
     *
     * `GET /_matrix/client/unstable/org.matrix.msc4140/delayed_events`（后端
     * 2026-10-14 新增）。后端按调用者过滤，仅返回本人仍 pending 的事件。
     *
     * @param requestOpts 可选请求选项（localTimeoutMs / abortSignal / headers）
     * @returns 延迟事件描述数组；后端省略包裹键时返回空数组
     * @throws UnsupportedDelayedEventsEndpointError 服务端未声明 MSC4140 支持时
     * @example
     * ```typescript
     * const pending = await client.getDelayedEventsManager().listScheduledDelayedEvents();
     * for (const ev of pending) console.log(ev.delay_id, ev.room_id, ev.delay_ms);
     * ```
     */
    public async listScheduledDelayedEvents(requestOpts?: IRequestOpts): Promise<DelayedEventInfo[]> {
        await this.assertSupported("listScheduledDelayedEvents");

        const raw = await this.request<{ delayed_events?: DelayedEventInfo[] }>({
            method: Method.Get,
            path: "/delayed_events",
            prefix: DELAYED_EVENTS_PREFIX,
            localTimeoutMs: requestOpts?.localTimeoutMs,
            headers: requestOpts?.headers,
            abortSignal: requestOpts?.abortSignal,
            label: "listScheduledDelayedEvents",
        });
        return raw.delayed_events ?? [];
    }

    /**
     * 通过**专用调度端点**调度延迟事件（MSC4140，上游 19354 推荐形态）。
     *
     * `PUT /_matrix/client/unstable/org.matrix.msc4140/rooms/{roomId}/delayed_event/{eventType}/{txnId}`，
     * 后端 2026-10-14 新增。与 [`MatrixClient.sendDelayedEvent`]（`/send` 上的
     * delay query，已标记弃用）相对：这里 body 为
     * `{ delay_ms, content, state_key? }`，事件内容不再与调度提示混在一个对象里。
     *
     * @param roomId    目标房间 ID
     * @param eventType 事件类型（如 `m.room.message`）
     * @param txnId     客户端事务 ID（幂等去重键，与 `/send` 的 txnId 同一命名空间语义）
     * @param body      `{ delay_ms, content, state_key? }`
     * @param requestOpts 可选请求选项（localTimeoutMs / abortSignal / headers）
     * @returns 含服务端生成的 `delay_id`（i64 number），用于后续管理操作
     * @throws UnsupportedDelayedEventsEndpointError 服务端未声明 MSC4140 支持时
     * @throws ValidationError 参数非法（空路径段、`delay_ms` 非正整数、`content` 非对象）时
     * @example
     * ```typescript
     * const { delay_id } = await client.getDelayedEventsManager().scheduleDelayedEvent(
     *     "!room:example.com", "m.room.message", "txn-1",
     *     { delay_ms: 5000, content: { body: "later" } },
     * );
     * await client.getDelayedEventsManager().cancelScheduledDelayedEvent(delay_id);
     * ```
     */
    public async scheduleDelayedEvent(
        roomId: string,
        eventType: string,
        txnId: string,
        body: ScheduleDelayedEventRequest,
        requestOpts?: IRequestOpts,
    ): Promise<ScheduleDelayedEventResponse> {
        this.requireNonEmptyString(roomId, "roomId");
        this.requireNonEmptyString(eventType, "eventType");
        this.requireNonEmptyString(txnId, "txnId");
        if (!Number.isInteger(body.delay_ms) || body.delay_ms <= 0) {
            throw new ValidationError("delay_ms must be a positive integer (milliseconds)");
        }
        if (typeof body.content !== "object" || body.content === null || Array.isArray(body.content)) {
            throw new ValidationError("content must be a JSON object");
        }
        await this.assertSupported("scheduleDelayedEvent");

        // state_key 未提供时不下发该键（后端把缺席与显式 null 同样视为消息事件）
        const payload: ScheduleDelayedEventRequest =
            body.state_key === undefined ? { delay_ms: body.delay_ms, content: body.content } : body;

        return await this.request<ScheduleDelayedEventResponse>({
            method: Method.Put,
            path: buildDedicatedDelayedEventPath(roomId, eventType, txnId),
            prefix: DELAYED_EVENTS_PREFIX,
            body: payload,
            localTimeoutMs: requestOpts?.localTimeoutMs,
            headers: requestOpts?.headers,
            abortSignal: requestOpts?.abortSignal,
            // 带 txnId 的调度可安全重试（服务端按 txn 去重）
            label: "scheduleDelayedEvent",
        });
    }
}

/**
 * 将 `getDelayedEventsManager()` 挂载到 `MatrixClient.prototype`。
 * 由 `manager-extensions` 在初始化时调用。
 */
export function extendMatrixClient(): void {
    MatrixClient.prototype.getDelayedEventsManager = function (): DelayedEventsManager {
        registerManagerClass("delayedEvents", DelayedEventsManager);
        return getOrCreateManager(this, "delayedEvents", () => new DelayedEventsManager(this));
    };
}
