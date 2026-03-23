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
 * Relations Manager - 关系管理
 * 
 * 提供消息关系、引用等功能 (增厚版)
 * 对应后端: relations
 */

import { MatrixClient } from "../client";
import { type MatrixEvent } from "../models/event";

export type RelationType = "m.reference" | "m.annotation" | "m.replace" | "m.thread";
export type RelationEventType = "m.room.message" | "m.room.encrypted" | string;

export interface RelationResult {
    events: MatrixEvent[];
    nextBatch?: string;
    prevBatch?: string;
    total?: number;
}

/**
 * 关系管理器 (增厚版)
 * 对应后端服务: relations
 */
export class RelationsManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get relations
     */
    public async relations(roomId: string, eventId: string, relationType?: string, eventType?: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).relations(roomId, eventId, relationType, eventType);
    }

    /**
     * Fetch relations
     */
    public async fetchRelations(roomId: string, eventId: string, relationType?: string, eventType?: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).fetchRelations(roomId, eventId, relationType, eventType);
    }

    /**
     * Get pending relations
     */
    public async getPendingRelations(roomId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getPendingRelations(roomId);
    }

    /**
     * Send relation
     */
    public async sendRelation(roomId: string, eventId: string, relationType: string, content: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).sendRelation(roomId, eventId, relationType, content);
    }

    /**
     * Get references (引用)
     * 获取引用了指定消息的所有消息
     */
    public async getReferences(roomId: string, eventId: string): Promise<RelationResult> {
        try {
            const result = await this.fetchRelations(roomId, eventId, "m.reference", "m.room.message");
            return {
                events: result.events || [],
                nextBatch: result.next_batch,
                total: result.total
            };
        } catch {
            return { events: [] };
        }
    }

    /**
     * Get thread (线程)
     * 获取线程中的所有消息
     */
    public async getThread(roomId: string, eventId: string): Promise<RelationResult> {
        try {
            const result = await this.fetchRelations(roomId, eventId, "m.thread", "m.room.message");
            return {
                events: result.events || [],
                nextBatch: result.next_batch,
                total: result.total
            };
        } catch {
            return { events: [] };
        }
    }

    /**
     * Get edits (编辑)
     * 获取消息的所有编辑版本
     */
    public async getEdits(roomId: string, eventId: string): Promise<RelationResult> {
        try {
            const result = await this.fetchRelations(roomId, eventId, "m.replace", "m.room.message");
            return {
                events: result.events || [],
                nextBatch: result.next_batch,
                total: result.total
            };
        } catch {
            return { events: [] };
        }
    }

    /**
     * Get annotations (回应/Reaction)
     * 获取消息的所有回应(annotation)
     */
    public async getAnnotations(roomId: string, eventId: string): Promise<RelationResult> {
        try {
            const result = await this.fetchRelations(roomId, eventId, "m.annotation", "m.room.message");
            return {
                events: result.events || [],
                nextBatch: result.next_batch,
                total: result.total
            };
        } catch {
            return { events: [] };
        }
    }

    /**
     * Send reference (发送引用)
     * 引用另一条消息
     */
    public async sendReference(roomId: string, eventId: string, content: any): Promise<any> {
        return this.sendRelation(roomId, eventId, "m.reference", content);
    }

    /**
     * Send thread message (发送线程消息)
     * 发送线程消息
     */
    public async sendThreadMessage(roomId: string, eventId: string, content: any): Promise<any> {
        return this.sendRelation(roomId, eventId, "m.thread", content);
    }

    /**
     * Has reference
     * 检查消息是否有引用
     */
    public async hasReference(roomId: string, eventId: string): Promise<boolean> {
        const references = await this.getReferences(roomId, eventId);
        return references.events.length > 0;
    }

    /**
     * Has thread
     * 检查消息是否有线程
     */
    public async hasThread(roomId: string, eventId: string): Promise<boolean> {
        const thread = await this.getThread(roomId, eventId);
        return thread.events.length > 0;
    }

    /**
     * Get relation count
     * 获取关系的数量
     */
    public async getRelationCount(roomId: string, eventId: string, relationType: string): Promise<number> {
        try {
            const result = await this.fetchRelations(roomId, eventId, relationType);
            return result.total || 0;
        } catch {
            return 0;
        }
    }

    /**
     * Get latest relation
     * 获取最新的关系消息
     */
    public async getLatestRelation(roomId: string, eventId: string, relationType: string): Promise<MatrixEvent | null> {
        try {
            const result = await this.fetchRelations(roomId, eventId, relationType);
            return result.events?.[0] || null;
        } catch {
            return null;
        }
    }

    /**
     * Paginate relations
     * 分页获取关系
     */
    public async paginateRelations(
        roomId: string, 
        eventId: string, 
        relationType: string, 
        batch: string
    ): Promise<RelationResult> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).relations(roomId, eventId, relationType, undefined, { from: batch });
    }

    /**
     * Get all relation types
     * 获取消息的所有关系类型
     */
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
