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
 * 提供消息关系、引用等功能 (增厚版)
 * 对应后端: relations
 */

import { MatrixClient } from "../client";
import { type MatrixEvent } from "../models/event";

export type RelationType = "m.reference" | "m.annotation" | "m.replace" | "m.thread";
export type RelationEventType = "m.room.message" | "m.room.encrypted" | string;

export interface IRelationsResponse {
    chunk: Array<Record<string, unknown>>;
    next_batch?: string;
    prev_batch?: string;
    total?: number;
}

export interface RelationResult {
    events: MatrixEvent[];
    nextBatch?: string;
    prevBatch?: string;
    total?: number;
}

export interface ISendRelationContent {
    msgtype?: string;
    body?: string;
    "m.relates_to": {
        rel_type: RelationType;
        event_id: string;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

export class RelationsManager {
    constructor(private client: MatrixClient) {}

    public async relations(roomId: string, eventId: string, relationType?: string, eventType?: string): Promise<IRelationsResponse> {
        return (this.client as unknown as {
            relations: (roomId: string, eventId: string, relationType?: string, eventType?: string) => Promise<IRelationsResponse>;
        }).relations(roomId, eventId, relationType, eventType);
    }

    public async fetchRelations(roomId: string, eventId: string, relationType?: string, eventType?: string): Promise<RelationResult> {
        return (this.client as unknown as {
            fetchRelations: (roomId: string, eventId: string, relationType?: string, eventType?: string) => Promise<RelationResult>;
        }).fetchRelations(roomId, eventId, relationType, eventType);
    }

    public async getPendingRelations(roomId: string): Promise<MatrixEvent[]> {
        return (this.client as unknown as {
            getPendingRelations: (roomId: string) => Promise<MatrixEvent[]>;
        }).getPendingRelations(roomId);
    }

    private async sendRelation(roomId: string, eventId: string, relationType: RelationType, content: ISendRelationContent): Promise<{ event_id: string }> {
        return (this.client as unknown as {
            sendRelation: (roomId: string, eventId: string, relationType: RelationType, content: ISendRelationContent) => Promise<{ event_id: string }>;
        }).sendRelation(roomId, eventId, relationType, content);
    }

    public async getAnnotations(roomId: string, eventId: string): Promise<RelationResult> {
        try {
            const result = await this.fetchRelations(roomId, eventId, "m.annotation", "m.room.message");
            return {
                events: result.events || [],
                nextBatch: result.nextBatch,
                total: result.total
            };
        } catch {
            return { events: [] };
        }
    }

    public async sendReference(roomId: string, eventId: string, content: ISendRelationContent): Promise<{ event_id: string }> {
        return this.sendRelation(roomId, eventId, "m.reference", content);
    }

    public async sendThreadMessage(roomId: string, eventId: string, content: ISendRelationContent): Promise<{ event_id: string }> {
        return this.sendRelation(roomId, eventId, "m.thread", content);
    }

    public async hasReference(roomId: string, eventId: string): Promise<boolean> {
        const references = await this.getReferences(roomId, eventId);
        return references.events.length > 0;
    }

    private async getReferences(roomId: string, eventId: string): Promise<RelationResult> {
        return this.fetchRelations(roomId, eventId, "m.reference");
    }

    public async hasThread(roomId: string, eventId: string): Promise<boolean> {
        const thread = await this.getThread(roomId, eventId);
        return thread.events.length > 0;
    }

    private async getThread(roomId: string, eventId: string): Promise<RelationResult> {
        return this.fetchRelations(roomId, eventId, "m.thread");
    }

    public async getRelationCount(roomId: string, eventId: string, relationType: string): Promise<number> {
        try {
            const result = await this.fetchRelations(roomId, eventId, relationType);
            return result.total || 0;
        } catch {
            return 0;
        }
    }

    public async getLatestRelation(roomId: string, eventId: string, relationType: string): Promise<MatrixEvent | null> {
        try {
            const result = await this.fetchRelations(roomId, eventId, relationType);
            return result.events?.[0] || null;
        } catch {
            return null;
        }
    }

    public async paginateRelations(
        roomId: string, 
        eventId: string, 
        relationType: string, 
        batch: string
    ): Promise<RelationResult> {
        return (this.client as unknown as {
            relations: (roomId: string, eventId: string, relationType: string, eventType?: undefined, opts?: { from: string }) => Promise<RelationResult>;
        }).relations(roomId, eventId, relationType, undefined, { from: batch });
    }

    public async getRelationTypes(roomId: string, eventId: string): Promise<string[]> {
        const types: string[] = [];
        
        const referenceCount = await this.getRelationCount(roomId, eventId, "m.reference");
        if (referenceCount > 0) types.push("m.reference");
        
        const annotationCount = await this.getRelationCount(roomId, eventId, "m.annotation");
        if (annotationCount > 0) types.push("m.annotation");
        
        const replaceCount = await this.getRelationCount(roomId, eventId, "m.replace");
        if (replaceCount > 0) types.push("m.replace");
        
        const threadCount = await this.getRelationCount(roomId, eventId, "m.thread");
        if (threadCount > 0) types.push("m.thread");
        
        return types;
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
        return new RelationsManager(this);
    };
}

export default extendMatrixClient;
