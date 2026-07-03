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
import { EventType, RelationType } from "../@types/event";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

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

export interface ReactionsManagerEvents {
    reaction_added: { roomId: string; eventId: string; key: string; userId: string };
    reaction_removed: { roomId: string; eventId: string; key: string; userId: string };
}

export class ReactionsManager extends BaseManager<keyof ReactionsManagerEvents, ReactionsManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public async reactToMessage(roomId: string, eventId: string, key: string): Promise<void> {
        return this.withRetry(() => this.client.reactToMessage(roomId, eventId, key), "reactToMessage");
    }

    public async redactReaction(roomId: string, eventId: string): Promise<void> {
        return this.withRetry(() => this.client.redactReaction(roomId, eventId), "redactReaction");
    }

    public async getReactionUsers(roomId: string, eventId: string): Promise<string[]> {
        return this.withRetry(async () => {
            const members = await this.client.getReactionUsers(roomId, eventId);
            return members.map((member) => member.userId);
        }, "getReactionUsers");
    }

    public async hasReaction(roomId: string, eventId: string, userId: string, key: string): Promise<boolean> {
        return this.withRetry(() => this.client.hasReaction(roomId, eventId, userId, key), "hasReaction");
    }

    public getReactionsForEvent(roomId: string, eventId: string): MatrixEvent[] {
        const room = this.client.getRoom(roomId);
        if (!room) return [];

        const relations = room.relations.getChildEventsForEvent(eventId, RelationType.Annotation, EventType.Reaction);
        return relations?.getRelations() ?? [];
    }

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
            totalReactions: reactions.length,
        };
    }

    public getReactionCount(roomId: string, eventId: string, key: string): number {
        const summary = this.getReactionSummary(roomId, eventId);
        const reaction = summary.reactions.find((r) => r.key === key);
        return reaction?.count ?? 0;
    }

    public async toggleReaction(roomId: string, eventId: string, key: string): Promise<void> {
        const currentUserId = this.client.getUserId();
        if (!currentUserId) return;

        const hasReacted = await this.hasReaction(roomId, eventId, currentUserId, key);

        if (hasReacted) {
            const reactions = this.getReactionsForEvent(roomId, eventId);
            const myReaction = reactions.find((r) => r.getSender() === currentUserId && r.getRelation()?.key === key);

            if (myReaction) {
                const reactionId = myReaction.getId();
                if (reactionId) {
                    return this.redactReaction(roomId, reactionId);
                }
            }
        }

        return this.reactToMessage(roomId, eventId, key);
    }

    public getReactionsByUser(roomId: string, userId: string, eventId: string): MatrixEvent[] {
        const reactions = this.getReactionsForEvent(roomId, eventId);
        return reactions.filter((r) => r.getSender() === userId);
    }

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

        return summaries.sort((a, b) => b.totalReactions - a.totalReactions).slice(0, limit);
    }

    public async removeAllReactions(roomId: string, eventId: string): Promise<void[]> {
        const reactions = this.getReactionsForEvent(roomId, eventId);
        const promises: Promise<void>[] = [];

        for (const r of reactions) {
            const reactionId = r.getId();
            if (reactionId) {
                promises.push(this.redactReaction(roomId, reactionId));
            }
        }

        return Promise.all(promises);
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getReactionsManager = function (): ReactionsManager {
        registerManagerClass("reactions", ReactionsManager);
        return getOrCreateManager(this, "reactions", () => new ReactionsManager(this));
    };
}

export default extendMatrixClient;
