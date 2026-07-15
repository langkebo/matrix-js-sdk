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

        const queryParams: QueryDict = {
            from: params.from,
            dir: params.dir,
        };
        if (params.to) queryParams.to = params.to;
        if (params.limit) queryParams.limit = params.limit.toString();
        if (params.filter) queryParams.filter = JSON.stringify(params.filter);

        const response = await this.withRetry(async () => {
            return await this.request<IGetMessagesResponse>({
                method: Method.Get,
                path: utils.encodeUri("/rooms/$roomId/messages", { $roomId: roomId }),
                queryParams: queryParams,
                prefix: ClientPrefix.V3,
            });
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

    public async createThreadListMessagesRequest(
        roomId: string,
        fromToken: string | null,
        limit = 30,
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
            });
        });

        this.emit(EventManagerEvent.EventSent, roomId, response.event_id);
        return response;
    }

    // ==================== State ====================

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
