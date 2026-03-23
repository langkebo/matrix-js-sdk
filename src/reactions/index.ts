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
 * Reactions Manager - 表情回应管理
 * 
 * 提供表情回应相关功能 (增厚版)
 * 对应后端: reactions
 */

import { MatrixClient } from "../client";
import { type MatrixEvent } from "../models/event";

export interface ReactionCount {
    key: string;
    count: number;
    users: string[];
}

export interface ReactionSummary {
    eventId: string;
    reactions: ReactionCount[];
    totalReactions: number;
}

/**
 * 表情回应管理器 (增厚版)
 * 对应后端服务: reactions
 */
export class ReactionsManager {
    constructor(private client: MatrixClient) {}

    /**
     * React to message
     */
    public async reactToMessage(roomId: string, eventId: string, key: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).reactToMessage(roomId, eventId, key);
    }

    /**
     * Redact reaction
     */
    public async redactReaction(roomId: string, eventId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).redactReaction(roomId, eventId);
    }

    /**
     * Get reaction users
     */
    public getReactionUsers(roomId: string, eventId: string): string[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getReactionUsers(roomId, eventId);
    }

    /**
     * Has reaction
     */
    public hasReaction(roomId: string, eventId: string, userId: string, key: string): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).hasReaction(roomId, eventId, userId, key);
    }

    /**
     * Get all reactions for a message
     * 获取消息的所有reaction
     */
    public getReactionsForEvent(roomId: string, eventId: string): MatrixEvent[] {
        const room = this.client.getRoom(roomId);
        if (!room) return [];
        
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const relations = (this.client as any).relations?.getChildEventsForEvent(roomId, eventId, "m.annotation");
        return relations || [];
    }

    /**
     * Get reaction summary for a message
     * 获取消息的reaction汇总
     */
    public getReactionSummary(roomId: string, eventId: string): ReactionSummary {
        const reactions = this.getReactionsForEvent(roomId, eventId);
        const reactionMap = new Map<string, ReactionCount>();
        
        for (const reaction of reactions) {
            const key = reaction.getRelation()?.key;
            const sender = reaction.getSender();
            
            if (!key || !sender) continue;
            
            if (!reactionMap.has(key)) {
                reactionMap.set(key, { key, count: 0, users: [] });
            }
            
            const entry = reactionMap.get(key)!;
            entry.count++;
            if (!entry.users.includes(sender)) {
                entry.users.push(sender);
            }
        }
        
        return {
            eventId,
            reactions: Array.from(reactionMap.values()),
            totalReactions: reactions.length
        };
    }

    /**
     * Get reaction count for a specific key
     * 获取特定reaction的数量
     */
    public getReactionCount(roomId: string, eventId: string, key: string): number {
        const summary = this.getReactionSummary(roomId, eventId);
        const reaction = summary.reactions.find(r => r.key === key);
        return reaction?.count ?? 0;
    }

    /**
     * Toggle reaction
     * 切换reaction（如果存在则移除，不存在则添加）
     */
    public async toggleReaction(roomId: string, eventId: string, key: string): Promise<any> {
        const currentUserId = this.client.getUserId();
        if (!currentUserId) return;
        
        const hasReacted = this.hasReaction(roomId, eventId, currentUserId, key);
        
        if (hasReacted) {
            // 移除已有的reaction
            const reactions = this.getReactionsForEvent(roomId, eventId);
            const myReaction = reactions.find(r => 
                r.getSender() === currentUserId && 
                r.getRelation()?.key === key
            );
            
            if (myReaction) {
                const reactionId = myReaction.getId();
                if (reactionId) {
                    return this.redactReaction(roomId, reactionId);
                }
            }
        }
        
        // 添加新的reaction
        return this.reactToMessage(roomId, eventId, key);
    }

    /**
     * Get reactions by user
     * 获取用户发出的所有reaction
     */
    public getReactionsByUser(roomId: string, userId: string, eventId: string): MatrixEvent[] {
        const reactions = this.getReactionsForEvent(roomId, eventId);
        return reactions.filter(r => r.getSender() === userId);
    }

    /**
     * Get most reacted messages in room
     * 获取房间内reaction最多的消息
     */
    public getMostReactedMessages(roomId: string, limit: number = 10): ReactionSummary[] {
        const room = this.client.getRoom(roomId);
        if (!room) return [];
        
        const summaries: ReactionSummary[] = [];
        const timeline = room.timeline;
        
        for (const event of timeline) {
            if (event.getType() === "m.room.message") {
                const eventId = event.getId();
                if (eventId) {
                    const summary = this.getReactionSummary(roomId, eventId);
                    if (summary.totalReactions > 0) {
                        summaries.push(summary);
                    }
                }
            }
        }
        
        return summaries
            .sort((a, b) => b.totalReactions - a.totalReactions)
            .slice(0, limit);
    }

    /**
     * Remove all reactions from a message
     * 移除消息的所有reaction
     */
    public async removeAllReactions(roomId: string, eventId: string): Promise<any[]> {
        const reactions = this.getReactionsForEvent(roomId, eventId);
        const promises: Promise<any>[] = [];
        
        for (const r of reactions) {
            const reactionId = r.getId();
            if (reactionId) {
                promises.push(this.redactReaction(roomId, reactionId));
            }
        }
        
        return Promise.all(promises);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getReactionsManager(): ReactionsManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getReactionsManager = function (): ReactionsManager {
        return new ReactionsManager(this);
    };
}

export default extendMatrixClient;
