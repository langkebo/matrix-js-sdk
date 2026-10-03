/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You May obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/**
 * Relations Manager - 关系管理
 *
 * 提供消息关系、引用等功能
 */

import { MatrixClient } from "../client";
import { type IEvent, type IContent, type MatrixEvent } from "../models/event";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import { Method } from "../http-api/method";
import { ClientPrefix, VendorPrefix } from "../http-api/prefix";
import { Direction } from "../models/event-timeline";
import { Thread, FeatureSupport } from "../models/thread";
import { Feature, ServerSupport } from "../feature";
import * as utils from "../utils";
import { QueryDict } from "../http-api/utils";
import { IRelationsRequestOpts, IRelationsResponse } from "../@types/requests";
import { logger } from "../logger";
import type { RelationsPathPattern } from "./__generated__/route-table";
import { processRelationEvents } from "../client-relations-core";
import { EventType, RelationType as RelationTypeBase } from "../@types/event";

export type RelationType = RelationTypeBase | string;
export type RelationEventType = "m.room.message" | "m.room.encrypted" | string;

export interface RelationResult {
    events: MatrixEvent[];
    nextBatch?: string;
    prevBatch?: string;
    total?: number;
}

export interface RelationAggregationChunk {
    type: string;
    key: string;
    count: number;
}

export interface RelationAggregationResponse {
    chunk: RelationAggregationChunk[];
    next_batch?: string;
    prev_batch?: string;
}

export interface SendRelationRequestBody {
    content?: IContent;
    "m.new_content"?: IContent;
    key?: string;
    type?: string;
}

export interface SendRelationResponse {
    event_id: string;
    room_id?: string;
    relates_to?: {
        event_id: string;
        rel_type: RelationType;
    };
}

export enum RelationsEvent {
    Updated = "RelationsUpdated",
    Error = "RelationsError",
}

interface RelationsManagerEventMap {
    [RelationsEvent.Updated]: (roomId: string, eventId: string) => void;
    [RelationsEvent.Error]: (error: Error) => void;
}

function replaceParam(oldKey: string, newKey: string, params: QueryDict): QueryDict {
    if (params[oldKey] !== undefined) {
        const newParams = { ...params };
        newParams[newKey] = newParams[oldKey];
        delete newParams[oldKey];
        return newParams;
    }
    return params;
}

type StripClientPrefix<P extends string> = P extends `/_matrix/client/r0${infer Rest}`
    ? Rest
    : P extends `/_matrix/client/v1${infer Rest}`
      ? Rest
      : P extends `/_matrix/client/v3${infer Rest}`
        ? Rest
        : never;

function rr<P extends StripClientPrefix<RelationsPathPattern>>(path: P): P {
    return path;
}

/**
 * 关系写入端点在 `/_matrix/vendor/v1` 下（ISSUE-13：关系写入不是 spec 端点）。
 * 与 `rr` 同理：`RelationsPathPattern` 的 `{param}` 已被 codegen 降级成 `${string}`，
 * 所以这层约束校验的是**形状**（前缀 + 段数 + 静态段），不是参数名。
 */
type StripVendorPrefix<P extends string> = P extends `/_matrix/vendor/v1${infer Rest}` ? Rest : never;

function rv<P extends StripVendorPrefix<RelationsPathPattern>>(path: P): P {
    return path;
}

export class RelationsManager extends BaseManager<RelationsEvent, RelationsManagerEventMap> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * Get the relations for a given event.
     *
     * @param roomId - the room in which the event is
     * @param eventId - the id of the event for which to fetch relations
     * @param relationType - the type of relation to fetch
     * @param eventType - the type of event to fetch
     * @param opts - the options for the request
     * @returns the response, with chunk, prev_batch and, next_batch.
     * @throws SdkError - if the homeserver rejects the request (for example a
     * malformed room/event id or a transient rate limit).
     * @example
     * ```typescript
     * const relations = client.getRelationsManager();
     *
     * const response = await relations.fetchRelations(
     *     "!room:example.org",
     *     "$event:example.org",
     *     "m.annotation",
     *     "m.room.message",
     *     { dir: Direction.Backward, limit: 50 },
     * );
     *
     * for (const event of response.chunk) {
     *     console.log(event.event_id, event.content);
     * }
     * console.log(response.next_batch);
     * ```
     */
    public async fetchRelations(
        roomId: string,
        eventId: string,
        relationType: RelationType | string | null,
        eventType?: string | null,
        opts: IRelationsRequestOpts = { dir: Direction.Backward },
    ): Promise<IRelationsResponse> {
        let params = opts as QueryDict;
        if (Thread.hasServerSideFwdPaginationSupport === FeatureSupport.Experimental) {
            params = replaceParam("dir", "org.matrix.msc3715.dir", params);
        }
        if (this.client.canSupport.get(Feature.RelationsRecursion) === ServerSupport.Unstable) {
            params = replaceParam("recurse", "org.matrix.msc3981.recurse", params);
        }
        const queryString = utils.encodeParams(params);

        const templatedUrl: StripClientPrefix<RelationsPathPattern> =
            relationType !== null && eventType !== null && eventType !== undefined
                ? rr("/rooms/$roomId/relations/$eventId/$relationType/$eventType")
                : relationType !== null
                  ? rr("/rooms/$roomId/relations/$eventId/$relationType")
                  : rr("/rooms/$roomId/relations/$eventId");

        if (relationType === null && eventType !== null && eventType !== undefined) {
            logger.warn(`eventType: ${eventType} ignored when fetching relations as relationType is null`);
            eventType = null;
        }

        const pathTemplate = utils.encodeUri(templatedUrl, {
            $roomId: roomId,
            $eventId: eventId,
            $relationType: relationType!,
            $eventType: eventType!,
        });

        const path = queryString ? `${pathTemplate}?${queryString}` : pathTemplate;

        try {
            return await this.request<IRelationsResponse>({
                method: Method.Get,
                path: path,
                prefix: ClientPrefix.V1,
            });
        } catch (e) {
            throw this.normalizeError(e, "fetchRelations");
        }
    }

    public async getAnnotations(roomId: string, eventId: string): Promise<RelationResult> {
        try {
            const response = await this.fetchRelations(roomId, eventId, "m.annotation", "m.room.message");
            const mapper = this.client.getEventMapper();
            return {
                events: (response.chunk || []).map(mapper),
                nextBatch: response.next_batch,
                total: response.total,
            };
            // @swallow-error { owner: "refactor-bot", expires: "2026-12-31" }
        } catch (e) {
            logger.debug("RelationsManager.fetchRelations failed", e);
            return { events: [] };
        }
    }

    public async hasReference(roomId: string, eventId: string): Promise<boolean> {
        const references = await this.getReferences(roomId, eventId);
        return (references.events?.length ?? 0) > 0;
    }

    private async getReferences(roomId: string, eventId: string): Promise<RelationResult> {
        const response = await this.fetchRelations(roomId, eventId, "m.reference");
        const mapper = this.client.getEventMapper();
        return {
            events: (response.chunk || []).map(mapper),
            nextBatch: response.next_batch,
            total: response.total,
        };
    }

    public async hasThread(roomId: string, eventId: string): Promise<boolean> {
        const thread = await this.getThread(roomId, eventId);
        return (thread.events?.length ?? 0) > 0;
    }

    private async getThread(roomId: string, eventId: string): Promise<RelationResult> {
        const response = await this.fetchRelations(roomId, eventId, "m.thread");
        const mapper = this.client.getEventMapper();
        return {
            events: (response.chunk || []).map(mapper),
            nextBatch: response.next_batch,
            total: response.total,
        };
    }

    public async getRelationCount(roomId: string, eventId: string, relationType: string): Promise<number> {
        try {
            const result = await this.fetchRelations(roomId, eventId, relationType);
            return result.total || 0;
            // @swallow-error { owner: "refactor-bot", expires: "2026-12-31" }
        } catch (e) {
            logger.warn("RelationsManager.getRelationCount failed", e);
            return 0;
        }
    }

    public async getLatestRelation(roomId: string, eventId: string, relationType: string): Promise<MatrixEvent | null> {
        try {
            const result = await this.fetchRelations(roomId, eventId, relationType);
            if (result.chunk && result.chunk.length > 0) {
                return this.client.getEventMapper()(result.chunk[0]);
            }
            return null;
            // @swallow-error { owner: "refactor-bot", expires: "2026-12-31" }
        } catch (e) {
            logger.warn("RelationsManager.getLatestRelation failed", e);
            return null;
        }
    }

    public async getRelationTypes(roomId: string, eventId: string): Promise<string[]> {
        const types: string[] = [];

        // This is a bit expensive, but follows the previous implementation logic
        const relationTypes = ["m.reference", "m.annotation", "m.replace", "m.thread"];
        for (const type of relationTypes) {
            const count = await this.getRelationCount(roomId, eventId, type);
            if (count > 0) {
                types.push(type);
            }
        }

        return types;
    }

    /**
     * Get the server-side aggregation of all the relations of a given type for an
     * event, as counts grouped by relation key.
     *
     * Hits `GET /rooms/$roomId/aggregations/$eventId/$relType`, which is the cheap
     * alternative to paging through `fetchRelations` when only the counts are
     * needed (for example to render reaction or edit counters).
     *
     * @param roomId - the room in which the event is
     * @param eventId - the id of the event whose relations to aggregate
     * @param relationType - the type of relation to aggregate, e.g. "m.annotation"
     * @returns the aggregation response, with a `chunk` of `{ type, key, count }`
     * entries plus optional `next_batch` / `prev_batch` pagination tokens.
     * @throws SdkError - if the homeserver rejects the request (for example an
     * unknown room, event or relation type).
     * @example
     * ```typescript
     * const relations = client.getRelationsManager();
     *
     * const aggregations = await relations.getAggregations(
     *     "!room:example.org",
     *     "$event:example.org",
     *     "m.annotation",
     * );
     *
     * for (const { key, count } of aggregations.chunk) {
     *     console.log(`${key} was used ${count} time(s)`);
     * }
     * ```
     */
    public async getAggregations(
        roomId: string,
        eventId: string,
        relationType: RelationType,
    ): Promise<RelationAggregationResponse> {
        const path = utils.encodeUri(rr("/rooms/$roomId/aggregations/$eventId/$relType"), {
            $roomId: roomId,
            $eventId: eventId,
            $relType: relationType,
        });

        try {
            return await this.request<RelationAggregationResponse>({
                method: Method.Get,
                path: path,
                prefix: ClientPrefix.V1,
            });
        } catch (e) {
            throw this.normalizeError(e, "getAggregations");
        }
    }

    public async relations(
        roomId: string,
        eventId: string,
        relationType: RelationType | string | null,
        eventType?: EventType | string | null,
        opts: IRelationsRequestOpts = { dir: Direction.Backward },
        deps?: {
            getEncryptedIfNeededEventType: (
                roomId: string,
                eventType?: string | null,
            ) => EventType | string | null | undefined;
            fetchRoomEvent: (roomId: string, eventId: string) => Promise<Partial<IEvent>>;
            fetchRelations: (
                roomId: string,
                eventId: string,
                relationType: RelationType | string | null,
                eventType?: string | null,
                opts?: IRelationsRequestOpts,
            ) => Promise<IRelationsResponse>;
            getEventMapper: () => (e: Partial<IEvent>) => MatrixEvent;
            decryptEventIfNeeded: (event: MatrixEvent) => Promise<void>;
        },
    ): Promise<{
        originalEvent?: MatrixEvent | null;
        events: MatrixEvent[];
        nextBatch?: string | null;
        prevBatch?: string | null;
    }> {
        if (!deps) {
            // Fallback without encryption support
            const result = await this.fetchRelations(roomId, eventId, relationType, eventType as string | null, opts);
            const mapper = this.client.getEventMapper();
            return {
                originalEvent: null,
                events: result.chunk.map(mapper),
                nextBatch: result.next_batch ?? null,
                prevBatch: result.prev_batch ?? null,
            };
        }

        const fetchedEventType = eventType ? deps.getEncryptedIfNeededEventType(roomId, eventType) : null;
        const [eventResult, result] = await Promise.all([
            deps.fetchRoomEvent(roomId, eventId),
            deps.fetchRelations(roomId, eventId, relationType, fetchedEventType, opts),
        ]);
        const mapper = deps.getEventMapper();

        const originalEvent = eventResult ? mapper(eventResult) : undefined;
        let events = result.chunk.map(mapper);
        events = await processRelationEvents({
            events,
            originalEvent,
            fetchedEventType,
            requestedEventType: eventType,
            relationType,
            decryptEventIfNeeded: (event) => deps.decryptEventIfNeeded(event),
        });
        return {
            originalEvent: originalEvent ?? null,
            events,
            nextBatch: result.next_batch ?? null,
            prevBatch: result.prev_batch ?? null,
        };
    }

    /**
     * 发送一条关系事件（`m.annotation` / `m.reference` / `m.thread` / `m.replace`）。
     *
     * 打到 `PUT /_matrix/vendor/v1/rooms/{room_id}/relations/{event_id}/{rel_type}/{txn_id}`：
     * 关系写入不是 spec 端点（spec 客户端发带 `m.relates_to` 的普通事件），按 ISSUE-13 走
     * vendor 前缀。末段是 `txn_id` 且**真的**是幂等键 —— 服务端用 `room_event_txn_dedup`
     * 记录 `(user, room, txn)`，重放返回同一个 `event_id`，不会产生第二条关系事件。
     *
     * ⚠️ 与旧签名的区别（旧调用点只有单测，无生产调用）：旧的第 4 个参数被当作"目标子事件
     * id"写进末段，但后端一直把该段当 txn_id 用 —— 那个 id 从未生效，而且"关系指向子事件"
     * 在后端没有对应语义（关系恒指向路径里的 `parentEventId`，靶点由 body 的 `content` /
     * `key` 表达）。现在末段是显式 txn id，body 直接是关系内容。
     *
     * 成功时对 `parentEventId` 发 {@link RelationsEvent.Updated}；失败时发
     * {@link RelationsEvent.Error} 并原样抛出。
     *
     * @param roomId - 两个事件所在房间
     * @param parentEventId - 关系指向的事件（路径里的 `event_id`）
     * @param relationType - 关系类型，例如 `"m.annotation"`
     * @param body - 关系内容：`m.annotation` 用 `{ key }`，`reference`/`thread`/`replace` 用 `{ content }`
     * @param opts - 可选 `txnId`（不传则由 `client.makeTxnId()` 生成；传固定值即可实现重试幂等）
     * @returns 服务端回执：新 `event_id` 与 `relates_to` 描述符
     * @throws SdkError - 服务端拒绝时抛出；同一错误也会经 {@link RelationsEvent.Error} 发出
     * @example
     * ```typescript
     * const relations = client.getRelationsManager();
     *
     * const response = await relations.sendRelation(
     *     "!room:example.org",
     *     "$parent:example.org",
     *     "m.annotation",
     *     { key: "👍" },
     * );
     *
     * console.log(response.event_id);
     * ```
     */
    public async sendRelation(
        roomId: string,
        parentEventId: string,
        relationType: RelationType,
        body: SendRelationRequestBody = {},
        opts: { txnId?: string } = {},
    ): Promise<SendRelationResponse> {
        const txnId = opts.txnId ?? this.client.makeTxnId();
        const path = utils.encodeUri(rv("/rooms/$roomId/relations/$eventId/$relType/$txnId"), {
            $roomId: roomId,
            $eventId: parentEventId,
            $relType: relationType,
            $txnId: txnId,
        });

        try {
            const response = await this.request<SendRelationResponse>({
                method: Method.Put,
                path: path,
                body: body,
                prefix: VendorPrefix,
            });
            this.emit(RelationsEvent.Updated, roomId, parentEventId);
            return response;
        } catch (e) {
            const error = this.normalizeError(e, "sendRelation");
            this.emit(RelationsEvent.Error, error);
            throw error;
        }
    }
}

// Declare prototype extension

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRelationsManager = function (): RelationsManager {
        registerManagerClass("relations", RelationsManager);
        return getOrCreateManager(this, "relations", () => new RelationsManager(this));
    };
}
