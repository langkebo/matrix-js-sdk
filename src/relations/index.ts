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
import { type IEvent, type MatrixEvent } from "../models/event";
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { Direction } from "../models/event-timeline";
import { Thread, FeatureSupport } from "../models/thread";
import { Feature, ServerSupport } from "../feature";
import * as utils from "../utils";
import { QueryDict } from "../utils";
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
    content?: Record<string, unknown>;
    "m.new_content"?: Record<string, unknown>;
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

type StripClientPrefix<P extends string> =
    P extends `/_matrix/client/r0${infer Rest}`
        ? Rest
        : P extends `/_matrix/client/v1${infer Rest}`
          ? Rest
          : P extends `/_matrix/client/v3${infer Rest}`
            ? Rest
            : never;

function rr<P extends StripClientPrefix<RelationsPathPattern>>(path: P): P {
    return path;
}

export class RelationsManager extends BaseManager<RelationsEvent, RelationsManagerEventMap> {
    constructor(client: MatrixClient) {
        super(client);
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

        const templatedUrl: StripClientPrefix<RelationsPathPattern> = relationType !== null && eventType !== null && eventType !== undefined
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
            return await this.client.http.authedRequest<IRelationsResponse>(Method.Get, path, undefined, undefined, {
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
            logger.debug("RelationsManager.getRelationCount failed", e);
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
            logger.debug("RelationsManager.getLatestRelation failed", e);
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
            return await this.client.http.authedRequest<RelationAggregationResponse>(Method.Get, path, undefined, undefined, {
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
            getEncryptedIfNeededEventType: (roomId: string, eventType?: string | null) => EventType | string | null | undefined;
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

    public async sendRelation(
        roomId: string,
        eventId: string,
        relationType: RelationType,
        targetEventId: string,
        body: SendRelationRequestBody = {},
    ): Promise<SendRelationResponse> {
        const path = utils.encodeUri(rr("/rooms/$roomId/relations/$eventId/$relationType/$targetEventId"), {
            $roomId: roomId,
            $eventId: eventId,
            $relationType: relationType,
            $targetEventId: targetEventId,
        });

        try {
            const response = await this.client.http.authedRequest<SendRelationResponse>(Method.Put, path, undefined, body, {
                prefix: ClientPrefix.V1,
            });
            this.emit(RelationsEvent.Updated, roomId, eventId);
            return response;
        } catch (e) {
            const error = this.normalizeError(e, "sendRelation");
            this.emit(RelationsEvent.Error, error);
            throw error;
        }
    }

}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getRelationsManager(): RelationsManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getRelationsManager = function (): RelationsManager {
        return getOrCreateManager(this, "relations", () => new RelationsManager(this));
    };
}

export default extendMatrixClient;
