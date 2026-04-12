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

import type { MatrixClient } from "../client.ts";
import { Method } from "../http-api/method.ts";
import { ClientPrefix } from "../http-api/prefix.ts";
import { type IRoomEventFilter } from "../filter.ts";
import { InvalidParamError } from "../common/errors.ts";
import { BaseManager } from "../managers/base-manager.ts";
import * as utils from "../utils.ts";
import { QueryDict } from "../utils.ts";
import { LRUCache } from "../utils/lru-cache.ts";
import { prepareSendCompleteEventLifecycle } from "../client-send-lifecycle.ts";
import { encryptAndSendEventWorkflow } from "../client-encrypt-send.ts";
import {
    type IContextResponse,
    ISendEventResponse,
    SendDelayedEventRequestOpts,
    SendDelayedEventResponse,
} from "../@types/requests.ts";
import { type IMessagesResponse, type IThreadedMessagesResponse } from "../client-internal-types.ts";
import { EventStatus, type IEvent, type MatrixEvent } from "../models/event.ts";
import { Room } from "../models/room.ts";
import { Direction } from "../models/event-timeline.ts";
import { type MatrixScheduler } from "../scheduler.ts";
import { FeatureSupport, Thread, ThreadFilterType, threadFilterTypeToFilter } from "../models/thread.ts";
import {
    buildEventContextParams,
    buildEventContextPath,
    buildMessagesRequestParams,
    buildMessagesRequestPath,
    buildThreadListRequestParams,
    buildThreadListRequestPath,
} from "../client-timeline-requests.ts";
import { normalizeEventContextResponse, type NormalizedContextResponse } from "../client-timeline-core.ts";

export enum EventManagerEvent {
    EventSent = "EventSent",
    EventRedacted = "EventRedacted",
    StateChanged = "StateChanged",
    Error = "Error",
}

export interface IRoomEvent {
    content: Record<string, unknown>;
    type: string;
    event_id: string;
    sender: string;
    origin_server_ts: number;
    room_id?: string;
    unsigned?: Record<string, unknown>;
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

export class EventManager extends BaseManager<EventManagerEvent, EventManagerEventMap> {
    private stateCache: LRUCache<IStateEvent[]>;

    constructor(client: MatrixClient, retryOptions?: import("../managers/base-manager").RetryOptions) {
        super(client, retryOptions);
        this.stateCache = new LRUCache<IStateEvent[]>(50, 5 * 60 * 1000);
    }

    private validateRoomId(roomId: string): void {
        if (!roomId || typeof roomId !== "string") {
            throw new InvalidParamError("roomId is required and must be a string");
        }
        const trimmed = roomId.trim();
        if (trimmed.length === 0) {
            throw new InvalidParamError("roomId cannot be empty");
        }
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

    public async getMessages(
        roomId: string,
        params: {
            from: string;
            dir: "f" | "b";
            to?: string;
            limit?: number;
            filter?: Record<string, unknown>;
        },
    ): Promise<IGetMessagesResponse> {
        this.validateRoomId(roomId);

        const queryParams: QueryDict = {
            from: params.from,
            dir: params.dir,
        };
        if (params.to) queryParams.to = params.to;
        if (params.limit) queryParams.limit = params.limit.toString();
        if (params.filter) queryParams.filter = JSON.stringify(params.filter);

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<IGetMessagesResponse>(
                Method.Get,
                utils.encodeUri("/rooms/$roomId/messages", { $roomId: roomId }),
                queryParams,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });

        return response;
    }

    public createMessagesRequest(
        roomId: string,
        fromToken: string | null,
        limit = 30,
        dir: Direction,
        timelineFilter?: IRoomEventFilter,
        lazyLoadMembers = false,
    ): Promise<IMessagesResponse> {
        this.validateRoomId(roomId);
        const path = buildMessagesRequestPath(roomId);
        const params = buildMessagesRequestParams({
            fromToken,
            limit,
            dir,
            lazyLoadMembers,
            timelineFilter,
        });
        return this.client.http.authedRequest<IMessagesResponse>(Method.Get, path, params);
    }

    public async createThreadListMessagesRequest(
        roomId: string,
        fromToken: string | null,
        limit = 30,
        dir = Direction.Backward,
        threadListType: ThreadFilterType | null = ThreadFilterType.All,
        timelineFilter?: IRoomEventFilter,
        lazyLoadMembers = false,
    ): Promise<IMessagesResponse> {
        this.validateRoomId(roomId);
        const path = buildThreadListRequestPath(roomId);
        const params = buildThreadListRequestParams({
            fromToken,
            limit,
            dir,
            include: threadFilterTypeToFilter(threadListType),
            lazyLoadMembers,
            timelineFilter,
        });
        const opts = {
            prefix:
                Thread.hasServerSideListSupport === FeatureSupport.Stable
                    ? ClientPrefix.V1
                    : "/_matrix/client/unstable/org.matrix.msc3856",
        };

        const res = await this.client.http.authedRequest<IThreadedMessagesResponse>(
            Method.Get,
            path,
            params,
            undefined,
            opts,
        );
        return {
            ...res,
            chunk: res.chunk?.reverse(),
            start: res.prev_batch,
            end: res.next_batch,
        };
    }

    public async sendEvent(
        roomId: string,
        eventType: string,
        content: Record<string, unknown>,
        txnId?: string,
        workflowContext?: SendEventWorkflowContext,
    ): Promise<ISendEventResponse> {
        this.validateRoomId(roomId);
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

        const txn = txnId || `m${Date.now()}`;
        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<ISendEventResponse>(
                Method.Put,
                utils.encodeUri("/rooms/$roomId/send/$eventType/$txnId", {
                    $roomId: roomId,
                    $eventType: eventType,
                    $txnId: txn,
                }),
                undefined,
                content,
                { prefix: ClientPrefix.V3 },
            );
        });

        this.emit(EventManagerEvent.EventSent, roomId, response.event_id);
        return response;
    }

    // ==================== State ====================

    public async getState(roomId: string, forceRefresh = false): Promise<IStateEvent[]> {
        this.validateRoomId(roomId);

        const cacheKey = `state:${roomId}`;
        if (!forceRefresh) {
            const cached = this.stateCache.get(cacheKey);
            if (cached) {
                return cached;
            }
        }

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<IStateEvent[]>(
                Method.Get,
                utils.encodeUri("/rooms/$roomId/state", { $roomId: roomId }),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });

        this.stateCache.set(cacheKey, response);
        return response;
    }

    public async getStateEvent(roomId: string, eventType: string, stateKey = ""): Promise<Record<string, unknown>> {
        this.validateRoomId(roomId);
        if (!eventType) {
            throw new InvalidParamError("eventType is required");
        }

        const path = stateKey
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
            return await this.client.http.authedRequest<Record<string, unknown>>(
                Method.Get,
                path,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });

        return response;
    }

    public async sendStateEvent(
        roomId: string,
        eventType: string,
        content: Record<string, unknown>,
        stateKey = "",
    ): Promise<ISendEventResponse> {
        this.validateRoomId(roomId);
        if (!eventType) {
            throw new InvalidParamError("eventType is required");
        }

        const path = stateKey
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
            return await this.client.http.authedRequest<ISendEventResponse>(Method.Put, path, undefined, content, {
                prefix: ClientPrefix.V3,
            });
        });

        this.stateCache.delete(`state:${roomId}`);
        this.emit(EventManagerEvent.StateChanged, roomId, eventType, stateKey);
        return response;
    }

    // ==================== Events ====================

    public async getEvent(roomId: string, eventId: string): Promise<IRoomEvent> {
        this.validateRoomId(roomId);
        this.validateEventId(eventId);

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<IRoomEvent>(
                Method.Get,
                utils.encodeUri("/rooms/$roomId/event/$eventId", {
                    $roomId: roomId,
                    $eventId: eventId,
                }),
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });

        return response;
    }

    public async getEventContext(
        roomId: string,
        eventId: string,
        params?: { limit?: number; filter?: Record<string, unknown>; lazyLoadMembers?: boolean },
    ): Promise<NormalizedContextResponse> {
        this.validateRoomId(roomId);
        this.validateEventId(eventId);

        const queryParams: Record<string, string | string[]> = params?.lazyLoadMembers
            ? buildEventContextParams(params.lazyLoadMembers)
            : {};
        if (params?.limit !== undefined) queryParams.limit = params.limit.toString();
        if (params?.filter) queryParams.filter = JSON.stringify(params.filter);

        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<IContextResponse>(
                Method.Get,
                buildEventContextPath(roomId, eventId),
                Object.keys(queryParams).length > 0 ? queryParams : undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });

        return normalizeEventContextResponse(response);
    }

    public async redactEvent(
        roomId: string,
        eventId: string,
        reasonOrContent?: string | Record<string, unknown>,
        txnId?: string,
    ): Promise<ISendEventResponse> {
        this.validateRoomId(roomId);
        this.validateEventId(eventId);

        const txn = txnId || `m${Date.now()}`;
        const content =
            typeof reasonOrContent === "string"
                ? reasonOrContent
                    ? { reason: reasonOrContent }
                    : {}
                : (reasonOrContent ?? {});
        const response = await this.withRetry(async () => {
            return await this.client.http.authedRequest<ISendEventResponse>(
                Method.Put,
                utils.encodeUri("/rooms/$roomId/redact/$eventId/$txnId", {
                    $roomId: roomId,
                    $eventId: eventId,
                    $txnId: txn,
                }),
                undefined,
                content,
                { prefix: ClientPrefix.V3 },
            );
        });

        this.emit(EventManagerEvent.EventRedacted, roomId, eventId);
        return response;
    }
}
