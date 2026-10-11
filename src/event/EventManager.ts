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

import type { MatrixClient } from "../client";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { type IRoomEventFilter } from "../filter";
import { InvalidParamError } from "../common/errors";
import { validateRoomId } from "../common/validators";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import * as utils from "../utils";
import { QueryDict } from "../http-api/utils";
import { LRUCache } from "../utils/lru-cache";
import { prepareSendCompleteEventLifecycle } from "../client-send-lifecycle";
import { encryptAndSendEventWorkflow } from "../client-encrypt-send";
import {
    type IContextResponse,
    ISendEventResponse,
    SendDelayedEventRequestOpts,
    SendDelayedEventResponse,
} from "../@types/requests";
import { type IMessagesResponse, type IThreadedMessagesResponse } from "../client-internal-types";
import { EventStatus, type IEvent, type IContent, type IUnsigned, MatrixEvent } from "../models/event";
import { Room } from "../models/room";
import { Direction } from "../models/event-timeline";
import { type MatrixScheduler } from "../scheduler";
import { FeatureSupport, Thread, ThreadFilterType, threadFilterTypeToFilter } from "../models/thread";
import {
    buildEventContextParams,
    buildEventContextPath,
    buildMessagesRequestParams,
    buildMessagesRequestPath,
    buildThreadListRequestParams,
    buildThreadListRequestPath,
    DEFAULT_MESSAGES_LIMIT,
} from "../client-timeline-requests";
import { normalizeEventContextResponse, type NormalizedContextResponse } from "../client-timeline-core";

export enum EventManagerEvent {
    EventSent = "EventSent",
    EventRedacted = "EventRedacted",
    StateChanged = "StateChanged",
    Error = "Error",
}

export interface IRoomEvent {
    content: IContent;
    type: string;
    event_id: string;
    sender: string;
    origin_server_ts: number;
    room_id?: string;
    unsigned?: IUnsigned;
}

export interface IStateEvent extends IRoomEvent {
    state_key: string;
}

export interface IGetMessagesResponse {
    chunk: IRoomEvent[];
    start: string;
    end?: string;
    state?: IStateEvent[];
}

export interface IEventContextResponse {
    event: IRoomEvent;
    events_before: IRoomEvent[];
    events_after: IRoomEvent[];
    start: string;
    end: string;
    state: IStateEvent[];
}

interface SendEventWorkflowContext {
    threadId: string | null;
    userId: string;
    makeTxnId: () => string;
    getRoom: (roomId: string) => Room | null;
    reEmitter: {
        reEmit(target: MatrixEvent, events: string[]): void;
    };
    scheduler?: MatrixScheduler<ISendEventResponse>;
    eventsBeingEncrypted: Set<string>;
    encryptEventIfNeeded: (event: MatrixEvent, room?: Room) => Promise<void>;
    sendEventHttpRequest: (
        event: MatrixEvent,
        queryOrDelayOpts?: SendDelayedEventRequestOpts | QueryDict,
        queryDict?: QueryDict,
    ) => Promise<ISendEventResponse | SendDelayedEventResponse>;
    updatePendingEventStatus: (room: Room | null, event: MatrixEvent, newStatus: EventStatus) => void;
    logger: {
        debug(message: string): void;
        error(...args: unknown[]): void;
    };
}

interface EventManagerEventMap {
    [EventManagerEvent.EventSent]: (roomId: string, eventId: string) => void;
    [EventManagerEvent.EventRedacted]: (roomId: string, eventId: string) => void;
    [EventManagerEvent.StateChanged]: (roomId: string, eventType: string, stateKey: string) => void;
    [EventManagerEvent.Error]: (error: Error) => void;
}

export function setEventManagerRetryOptions(
    client: MatrixClient,
    options: import("../managers/base-manager").RetryOptions,
): void {
    client.getEventManager().setRetryOptions(options);
}

export class EventManager extends BaseManager<EventManagerEvent, EventManagerEventMap> {
    private stateCache: LRUCache<IStateEvent[]>;

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
        this.stateCache = new LRUCache<IStateEvent[]>(50, 5 * 60 * 1000);
    }

    private validateEventId(eventId: string): void {
        if (!eventId || typeof eventId !== "string") {
            throw new InvalidParamError("eventId is required and must be a string");
        }
        const trimmed = eventId.trim();
        if (trimmed.length === 0) {
            throw new InvalidParamError("eventId cannot be empty");
        }
    }

    // ==================== Messages ====================

    /**
     * 拉取房间的消息时间线片段（`/messages`）。
     *
     * @param roomId - 房间 ID
     * @param params - 拉取参数：起始 token、方向、结束 token、数量上限与时间线过滤器
     * @returns 消息片段响应
     *
     * @example
     * ```typescript
     * const response = await client.getEventManager().getMessages("!room:example.org", {
     *     from: "t1-0",
     *     dir: "b",
     *     limit: 20,
     * });
     * ```
     */
    public async getMessages(
        roomId: string,
        params: {
            from: string;
            dir: "f" | "b";
            to?: string;
            limit?: number;
            filter?: IRoomEventFilter;
        },
    ): Promise<IGetMessagesResponse> {
        validateRoomId(roomId);

        // Reuse the shared /messages builders instead of hand-rolling the query here,
        // so this endpoint has a single construction path (see also createMessagesRequest).
        //
        // `Direction.Forward`/`Backward` have the same wire values as "f"/"b", so the
        // conversion below is a pure internal normalisation: the public signature keeps
        // accepting the string literals, so no caller is affected.
        const queryParams: QueryDict = buildMessagesRequestParams({
            fromToken: params.from,
            limit: params.limit,
            dir: params.dir === "f" ? Direction.Forward : Direction.Backward,
            lazyLoadMembers: false,
            timelineFilter: params.filter,
        });
        // `to` is not part of the shared builder: only this method exposes it.
        if (params.to) queryParams.to = params.to;

        const response = await this.withRetry(async () => {
            return await this.request<IGetMessagesResponse>({
                method: Method.Get,
                path: buildMessagesRequestPath(roomId),
                queryParams: queryParams,
                prefix: ClientPrefix.V3,
            });
        });

        return response;
    }

    /**
     * 构造并发送 `/messages` 请求（返回未 await 的 Promise）。
     *
     * @param roomId - 房间 ID
     * @param fromToken - 起始分页 token；null 表示从头开始
     * @param limit - 返回数量上限
     * @param dir - 翻页方向
     * @param timelineFilter - 时间线过滤器，可选
     * @param lazyLoadMembers - 是否惰性加载成员
     * @returns `/messages` 响应
     *
     * @example
     * ```typescript
     * const response = await client
     *     .getEventManager()
     *     .createMessagesRequest("!room:example.org", null, 20, Direction.Backward);
     * ```
     */
    public createMessagesRequest(
        roomId: string,
        fromToken: string | null,
        limit = DEFAULT_MESSAGES_LIMIT,
        dir: Direction,
        timelineFilter?: IRoomEventFilter,
        lazyLoadMembers = false,
    ): Promise<IMessagesResponse> {
        validateRoomId(roomId);
        const path = buildMessagesRequestPath(roomId);
        const params = buildMessagesRequestParams({
            fromToken,
            limit,
            dir,
            lazyLoadMembers,
            timelineFilter,
        });
        return this.request<IMessagesResponse>({
            method: Method.Get,
            path: path,
            queryParams: params,
        });
    }

    /**
     * 拉取房间的线程列表消息片段。
     *
     * @param roomId - 房间 ID
     * @param fromToken - 起始分页 token；null 表示从头开始
     * @param limit - 返回数量上限
     * @param dir - 翻页方向
     * @param threadListType - 线程过滤类型
     * @param timelineFilter - 时间线过滤器，可选
     * @param lazyLoadMembers - 是否惰性加载成员
     * @returns 线程列表消息响应
     *
     * @example
     * ```typescript
     * const response = await client
     *     .getEventManager()
     *     .createThreadListMessagesRequest("!room:example.org", null);
     * ```
     */
    public async createThreadListMessagesRequest(
        roomId: string,
        fromToken: string | null,
        limit = DEFAULT_MESSAGES_LIMIT,
        dir = Direction.Backward,
        threadListType: ThreadFilterType | null = ThreadFilterType.All,
        timelineFilter?: IRoomEventFilter,
        lazyLoadMembers = false,
    ): Promise<IMessagesResponse> {
        validateRoomId(roomId);
        const path = buildThreadListRequestPath(roomId);
        const params = buildThreadListRequestParams({
            fromToken,
            limit,
            dir,
            include: threadFilterTypeToFilter(threadListType),
            lazyLoadMembers,
            timelineFilter,
        });
        const res = await this.request<IThreadedMessagesResponse>({
            method: Method.Get,
            path: path,
            queryParams: params,
            prefix:
                Thread.hasServerSideListSupport === FeatureSupport.Stable
                    ? ClientPrefix.V1
                    : "/_matrix/client/unstable/org.matrix.msc3856",
        });
        return {
            ...res,
            chunk: res.chunk?.reverse(),
            start: res.prev_batch,
            end: res.next_batch,
        };
    }

    /**
     * 向房间发送事件。
     *
     * @param roomId - 房间 ID
     * @param eventType - 事件类型
     * @param content - 事件内容
     * @param txnId - 事务 ID，可选；用于幂等与重试
     * @param workflowContext - 发送工作流上下文，可选
     * @returns 发送回执
     * @throws {InvalidParamError} 当 eventType 为空时抛出
     *
     * @example
     * ```typescript
     * const response = await client.getEventManager().sendEvent("!room:example.org", "m.room.message", {
     *     msgtype: "m.text",
     *     body: "hello",
     * });
     * ```
     */
    public async sendEvent(
        roomId: string,
        eventType: string,
        content: IContent,
        txnId?: string,
        workflowContext?: SendEventWorkflowContext,
    ): Promise<ISendEventResponse> {
        validateRoomId(roomId);
        if (!eventType) {
            throw new InvalidParamError("eventType is required");
        }

        if (workflowContext) {
            const { room, localEvent } = prepareSendCompleteEventLifecycle({
                roomId,
                threadId: workflowContext.threadId,
                eventObject: {
                    type: eventType,
                    content,
                } as Partial<IEvent>,
                txnId,
                userId: workflowContext.userId,
                makeTxnId: workflowContext.makeTxnId,
                getRoom: workflowContext.getRoom,
                logger: workflowContext.logger,
                reEmitter: workflowContext.reEmitter,
            });
            const response = await encryptAndSendEventWorkflow({
                room,
                event: localEvent,
                scheduler: workflowContext.scheduler,
                eventsBeingEncrypted: workflowContext.eventsBeingEncrypted,
                encryptEventIfNeeded: workflowContext.encryptEventIfNeeded,
                sendEventHttpRequest: workflowContext.sendEventHttpRequest,
                updatePendingEventStatus: workflowContext.updatePendingEventStatus,
                logger: workflowContext.logger,
            });
            if ("event_id" in response && response.event_id) {
                this.emit(EventManagerEvent.EventSent, roomId, response.event_id);
            }
            return response as ISendEventResponse;
        }

        // 事务 ID 在闭包**之外**定下：withRetry 会重跑整个闭包，闭包内的 Date.now()
        // 每次重试都会产生新键，服务端就无法按 txnId 去重（P3-1）。
        const txn = txnId || `m${Date.now()}`;
        const response = await this.withRetry(async () => {
            return await this.request<ISendEventResponse>({
                method: Method.Put,
                path: utils.encodeUri("/rooms/$roomId/send/$eventType/$txnId", {
                    $roomId: roomId,
                    $eventType: eventType,
                    $txnId: txn,
                }),
                body: content,
                prefix: ClientPrefix.V3,
                // 声明幂等键 → 这类天然幂等的写允许对 5xx 重试（同一 txnId，服务端按事务去重）
                idempotencyKey: txn,
            });
        });

        this.emit(EventManagerEvent.EventSent, roomId, response.event_id);
        return response;
    }

    // ==================== State ====================

    /**
     * 获取房间的完整状态事件列表（带本地缓存）。
     *
     * @param roomId - 房间 ID
     * @param forceRefresh - 是否强制刷新缓存
     * @returns 房间状态事件列表
     *
     * @example
     * ```typescript
     * const state = await client.getEventManager().getState("!room:example.org");
     * ```
     */
    public async getState(roomId: string, forceRefresh = false): Promise<IStateEvent[]> {
        validateRoomId(roomId);

        const cacheKey = `state:${roomId}`;
        if (!forceRefresh) {
            const cached = this.stateCache.get(cacheKey);
            if (cached) {
                return cached;
            }
        }

        const response = await this.withRetry(async () => {
            return await this.request<IStateEvent[]>({
                method: Method.Get,
                path: utils.encodeUri("/rooms/$roomId/state", { $roomId: roomId }),
                prefix: ClientPrefix.V3,
            });
        });

        this.stateCache.set(cacheKey, response);
        return response;
    }

    /**
     * 获取房间的某条状态事件内容。
     *
     * @param roomId - 房间 ID
     * @param eventType - 状态事件类型
     * @param stateKey - 状态键，默认空字符串
     * @returns 状态事件内容
     * @throws {InvalidParamError} 当 eventType 为空时抛出
     *
     * @example
     * ```typescript
     * const content = await client.getEventManager().getStateEvent("!room:example.org", "m.room.name");
     * ```
     */
    public async getStateEvent(roomId: string, eventType: string, stateKey = ""): Promise<IContent> {
        validateRoomId(roomId);
        if (!eventType) {
            throw new InvalidParamError("eventType is required");
        }

        const path =
            stateKey !== undefined
                ? utils.encodeUri("/rooms/$roomId/state/$eventType/$stateKey", {
                      $roomId: roomId,
                      $eventType: eventType,
                      $stateKey: stateKey,
                  })
                : utils.encodeUri("/rooms/$roomId/state/$eventType", {
                      $roomId: roomId,
                      $eventType: eventType,
                  });

        const response = await this.withRetry(async () => {
            return await this.request<IContent>({
                method: Method.Get,
                path: path,
                prefix: ClientPrefix.V3,
            });
        });

        return response;
    }

    /**
     * 发送房间状态事件。
     *
     * @param roomId - 房间 ID
     * @param eventType - 状态事件类型
     * @param content - 状态事件内容
     * @param stateKey - 状态键，默认空字符串
     * @returns 发送回执
     * @throws {InvalidParamError} 当 eventType 为空时抛出
     *
     * @example
     * ```typescript
     * const response = await client.getEventManager().sendStateEvent("!room:example.org", "m.room.topic", {
     *     topic: "hello",
     * });
     * ```
     */
    public async sendStateEvent(
        roomId: string,
        eventType: string,
        content: IContent,
        stateKey = "",
    ): Promise<ISendEventResponse> {
        validateRoomId(roomId);
        if (!eventType) {
            throw new InvalidParamError("eventType is required");
        }

        const path =
            stateKey !== undefined
                ? utils.encodeUri("/rooms/$roomId/state/$eventType/$stateKey", {
                      $roomId: roomId,
                      $eventType: eventType,
                      $stateKey: stateKey,
                  })
                : utils.encodeUri("/rooms/$roomId/state/$eventType", {
                      $roomId: roomId,
                      $eventType: eventType,
                  });

        const response = await this.withRetry(async () => {
            return await this.request<ISendEventResponse>({
                method: Method.Put,
                path: path,
                body: content,
                prefix: ClientPrefix.V3,
            });
        });

        this.stateCache.delete(`state:${roomId}`);
        this.emit(EventManagerEvent.StateChanged, roomId, eventType, stateKey);
        return response;
    }

    // ==================== Events ====================

    /**
     * 获取房间内的单条事件。
     *
     * @param roomId - 房间 ID
     * @param eventId - 事件 ID
     * @returns 房间事件
     *
     * @example
     * ```typescript
     * const event = await client.getEventManager().getEvent("!room:example.org", "$event");
     * ```
     */
    public async getEvent(roomId: string, eventId: string): Promise<IRoomEvent> {
        validateRoomId(roomId);
        this.validateEventId(eventId);

        const response = await this.withRetry(async () => {
            return await this.request<IRoomEvent>({
                method: Method.Get,
                path: utils.encodeUri("/rooms/$roomId/event/$eventId", {
                    $roomId: roomId,
                    $eventId: eventId,
                }),
                prefix: ClientPrefix.V3,
            });
        });

        return response;
    }

    /**
     * 获取某条事件的上下文（前后相邻事件）。
     *
     * @param roomId - 房间 ID
     * @param eventId - 事件 ID
     * @param params - 可选参数：数量上限、过滤器、是否惰性加载成员
     * @returns 归一化后的事件上下文响应
     *
     * @example
     * ```typescript
     * const context = await client.getEventManager().getEventContext("!room:example.org", "$event", { limit: 10 });
     * ```
     */
    public async getEventContext(
        roomId: string,
        eventId: string,
        params?: { limit?: number; filter?: IRoomEventFilter; lazyLoadMembers?: boolean },
    ): Promise<NormalizedContextResponse> {
        validateRoomId(roomId);
        this.validateEventId(eventId);

        const queryParams: Record<string, string | string[]> = params?.lazyLoadMembers
            ? buildEventContextParams(params.lazyLoadMembers)
            : {};
        if (params?.limit !== undefined) queryParams.limit = params.limit.toString();
        if (params?.filter) {
            queryParams.filter = typeof params.filter === "string" ? params.filter : JSON.stringify(params.filter);
        }

        const response = await this.withRetry(async () => {
            return await this.request<IContextResponse>({
                method: Method.Get,
                path: buildEventContextPath(roomId, eventId),
                queryParams: Object.keys(queryParams).length > 0 ? queryParams : undefined,
                prefix: ClientPrefix.V3,
            });
        });

        return normalizeEventContextResponse(response);
    }

    /**
     * 废止（redact）房间内的一条事件。
     *
     * @param roomId - 房间 ID
     * @param eventId - 事件 ID
     * @param reasonOrContent - 废止原因字符串或内容对象，可选
     * @param txnId - 事务 ID，可选
     * @returns 发送回执
     *
     * @example
     * ```typescript
     * const response = await client.getEventManager().redactEvent("!room:example.org", "$event", "spam");
     * ```
     */
    public async redactEvent(
        roomId: string,
        eventId: string,
        reasonOrContent?: string | IContent,
        txnId?: string,
    ): Promise<ISendEventResponse> {
        validateRoomId(roomId);
        this.validateEventId(eventId);

        const txn = txnId || `m${Date.now()}`;
        const content =
            typeof reasonOrContent === "string"
                ? reasonOrContent
                    ? { reason: reasonOrContent }
                    : {}
                : (reasonOrContent ?? {});
        const response = await this.withRetry(async () => {
            return await this.request<ISendEventResponse>({
                method: Method.Put,
                path: utils.encodeUri("/rooms/$roomId/redact/$eventId/$txnId", {
                    $roomId: roomId,
                    $eventId: eventId,
                    $txnId: txn,
                }),
                body: content,
                prefix: ClientPrefix.V3,
            });
        });

        this.emit(EventManagerEvent.EventRedacted, roomId, eventId);
        return response;
    }

    /**
     * Resend an event.
     * @param event - The event to resend
     * @param room - The room the event belongs to
     * @param deps - Dependencies from the client
     *
     * @example
     * ```typescript
     * await client.getEventManager().resendEvent(event, room, deps);
     * ```
     */
    public async resendEvent(
        event: MatrixEvent,
        room: Room,
        deps: {
            toDeviceMessageQueueSendQueue: () => void;
            updatePendingEventStatus: (room: Room | null, event: MatrixEvent, status: EventStatus) => void;
            encryptAndSendEvent: (room: Room | null, event: MatrixEvent) => Promise<ISendEventResponse>;
        },
    ): Promise<ISendEventResponse> {
        deps.toDeviceMessageQueueSendQueue();
        deps.updatePendingEventStatus(room, event, EventStatus.SENDING);
        return deps.encryptAndSendEvent(room, event);
    }

    /**
     * Cancel a queued or unsent event.
     * @param event - The event to cancel
     * @param deps - Dependencies from the client
     * @throws Error if the event is not in QUEUED, NOT_SENT or ENCRYPTING state
     * @example
     * ```typescript
     * client.getEventManager().cancelPendingEvent(event, deps);
     * ```
     */
    public cancelPendingEvent(
        event: MatrixEvent,
        deps: {
            eventsBeingEncrypted: Set<string>;
            scheduler?: { removeEventFromQueue(event: MatrixEvent): void };
            getRoom: (roomId: string) => Room | null;
            updatePendingEventStatus: (room: Room | null, event: MatrixEvent, status: EventStatus) => void;
        },
    ): void {
        if (![EventStatus.QUEUED, EventStatus.NOT_SENT, EventStatus.ENCRYPTING].includes(event.status!)) {
            throw new Error("cannot cancel an event with status " + event.status);
        }

        if (event.status === EventStatus.ENCRYPTING) {
            deps.eventsBeingEncrypted.delete(event.getId()!);
        } else if (deps.scheduler && event.status === EventStatus.QUEUED) {
            deps.scheduler.removeEventFromQueue(event);
        }

        const roomId = event.getRoomId();
        const room = roomId ? deps.getRoom(roomId) : null;
        deps.updatePendingEventStatus(room, event, EventStatus.CANCELLED);
    }

    /**
     * Decrypt an event if needed.
     * @param event - The event to decrypt
     * @param deps - Dependencies from the client
     *
     * @example
     * ```typescript
     * await client.getEventManager().decryptEventIfNeeded(event, deps);
     * ```
     */
    public async decryptEventIfNeeded(
        event: MatrixEvent,
        deps: {
            enableEncryptedStateEvents: boolean;
            getCrypto: () => unknown;
            cryptoBackend: unknown;
        },
        options?: import("../models/event").IDecryptOptions,
    ): Promise<void> {
        if (event.isState() && !deps.enableEncryptedStateEvents) {
            return;
        }

        if (event.shouldAttemptDecryption() && deps.getCrypto()) {
            event.attemptDecryption(
                deps.cryptoBackend as unknown as import("../common-crypto/CryptoBackend").CryptoBackend,
                options,
            );
        }

        if (event.isBeingDecrypted()) {
            return event.getDecryptionPromise()!;
        } else {
            return;
        }
    }

    /**
     * Send a state event with encryption support.
     * @param roomId - The room ID
     * @param eventType - The event type
     * @param content - The event content
     * @param stateKey - The state key
     * @param deps - Dependencies from the client
     *
     * @example
     * ```typescript
     * const response = await client
     *     .getEventManager()
     *     .sendStateEventWithEncryption("!room:example.org", "m.room.topic", { topic: "Hi" });
     * ```
     */
    public async sendStateEventWithEncryption(
        roomId: string,
        eventType: string,
        content: IContent,
        stateKey = "",
        deps?: {
            getRoom: (roomId: string) => Room | null;
            encryptStateEventIfNeeded: (event: MatrixEvent, room?: Room) => Promise<void>;
            dispatchStateEventRequest: (params: {
                roomId: string;
                eventType: string;
                content: unknown;
                stateKey: string;
                http: unknown;
                requestOpts: unknown;
            }) => Promise<ISendEventResponse>;
            http: unknown;
            requestOpts: unknown;
        },
    ): Promise<ISendEventResponse> {
        if (deps) {
            const room = deps.getRoom(roomId);
            const event = new MatrixEvent({
                room_id: roomId,
                type: eventType,
                state_key: stateKey,
                content,
            });

            await deps.encryptStateEventIfNeeded(event, room ?? undefined);

            return deps.dispatchStateEventRequest({
                roomId,
                eventType: event.getWireType(),
                content: event.getWireContent(),
                stateKey: event.getWireStateKey() ?? stateKey,
                http: deps.http,
                requestOpts: deps.requestOpts,
            });
        }

        return this.sendStateEvent(roomId, eventType, content, stateKey);
    }
}
