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

    /**
     * 对指定消息发送表情回应。
     *
     * @param roomId - 房间 ID
     * @param eventId - 目标事件 ID
     * @param key - 表情（如 "👍"）
     * @returns 新回应事件 ID；无法确定时返回 undefined
     *
     * @example
     * ```typescript
     * const eventId = await client.getReactionsManager().reactToMessage("!room:example.org", "$event", "👍");
     * ```
     */
    public async reactToMessage(roomId: string, eventId: string, key: string): Promise<string | undefined> {
        return this.withRetry(() => this.client.reactToMessage(roomId, eventId, key), "reactToMessage");
    }

    /**
     * 撤回一条表情回应。
     *
     * @param roomId - 房间 ID
     * @param eventId - 要撤回的回应事件 ID
     * @returns 撤回后的 { event_id }
     *
     * @example
     * ```typescript
     * await client.getReactionsManager().redactReaction("!room:example.org", "$reaction");
     * ```
     */
    public async redactReaction(roomId: string, eventId: string): Promise<{ event_id: string }> {
        return this.withRetry(() => this.client.redactReaction(roomId, eventId), "redactReaction");
    }

    /**
     * Returns the list of users who reacted to the given event.
     *
     * Reads directly from the room's relations cache to avoid delegating back
     * to `client.getReactionUsers`, which would create an infinite recursion
     * (client.getReactionUsers -> manager.getReactionUsers -> client...).
     *
     * @example
     * ```typescript
     * const users = await client.getReactionsManager().getReactionUsers("!room:example.org", "$event");
     * ```
     */
    public async getReactionUsers(roomId: string, eventId: string): Promise<string[]> {
        return this.withRetry(async () => {
            const reactions = this.getReactionsForEvent(roomId, eventId);
            const users: string[] = [];
            for (const reaction of reactions) {
                const sender = reaction.getSender();
                if (sender && !users.includes(sender)) {
                    users.push(sender);
                }
            }
            return users;
        }, "getReactionUsers");
    }

    /**
     * Checks whether a user has reacted to an event with the given key.
     *
     * Reads directly from the room's relations cache to avoid delegating back
     * to `client.hasReaction`, which would create an infinite recursion.
     *
     * @example
     * ```typescript
     * const reacted = await client.getReactionsManager().hasReaction("!room:example.org", "$event", "@alice:example.org", "👍");
     * ```
     */
    public async hasReaction(roomId: string, eventId: string, userId: string, key: string): Promise<boolean> {
        return this.withRetry(async () => {
            const reactions = this.getReactionsForEvent(roomId, eventId);
            return reactions.some((reaction) => reaction.getSender() === userId && reaction.getRelation()?.key === key);
        }, "hasReaction");
    }

    /**
     * 获取指定事件下所有表情回应事件。
     *
     * @param roomId - 房间 ID
     * @param eventId - 目标事件 ID
     * @returns 回应事件数组；房间不存在时返回空数组
     *
     * @example
     * ```typescript
     * const reactions = client.getReactionsManager().getReactionsForEvent("!room:example.org", "$event");
     * ```
     */
    public getReactionsForEvent(roomId: string, eventId: string): MatrixEvent[] {
        const room = this.client.getRoom(roomId);
        if (!room) return [];

        const relations = room.relations.getChildEventsForEvent(eventId, RelationType.Annotation, EventType.Reaction);
        return relations?.getRelations() ?? [];
    }

    /**
     * 汇总指定事件的表情回应。
     *
     * @param roomId - 房间 ID
     * @param eventId - 目标事件 ID
     * @returns 按表情 key 聚合的回应摘要
     *
     * @example
     * ```typescript
     * const summary = client.getReactionsManager().getReactionSummary("!room:example.org", "$event");
     * ```
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
            totalReactions: reactions.length,
        };
    }

    /**
     * 获取指定事件某个表情的回应数量。
     *
     * @param roomId - 房间 ID
     * @param eventId - 目标事件 ID
     * @param key - 表情 key
     * @returns 该表情的回应数量
     *
     * @example
     * ```typescript
     * const count = client.getReactionsManager().getReactionCount("!room:example.org", "$event", "👍");
     * ```
     */
    public getReactionCount(roomId: string, eventId: string, key: string): number {
        const summary = this.getReactionSummary(roomId, eventId);
        const reaction = summary.reactions.find((r) => r.key === key);
        return reaction?.count ?? 0;
    }

    /**
     * 切换当前用户对某消息的表情回应：已回应则撤回，未回应则新增。
     *
     * @param roomId - 房间 ID
     * @param eventId - 目标事件 ID
     * @param key - 表情 key
     * @returns 新增返回回应事件 ID，撤回返回 { event_id }；未登录返回 undefined
     *
     * @example
     * ```typescript
     * await client.getReactionsManager().toggleReaction("!room:example.org", "$event", "👍");
     * ```
     */
    public async toggleReaction(
        roomId: string,
        eventId: string,
        key: string,
    ): Promise<string | { event_id: string } | undefined> {
        const currentUserId = this.client.getUserId();
        if (!currentUserId) return undefined;

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

    /**
     * 获取指定用户在某个事件上的所有表情回应。
     *
     * @param roomId - 房间 ID
     * @param userId - 用户 ID
     * @param eventId - 目标事件 ID
     * @returns 该用户发出的回应事件数组
     *
     * @example
     * ```typescript
     * const mine = client.getReactionsManager().getReactionsByUser("!room:example.org", "@alice:example.org", "$event");
     * ```
     */
    public getReactionsByUser(roomId: string, userId: string, eventId: string): MatrixEvent[] {
        const reactions = this.getReactionsForEvent(roomId, eventId);
        return reactions.filter((r) => r.getSender() === userId);
    }

    /**
     * 获取房间内回应最多的消息。
     *
     * @param roomId - 房间 ID
     * @param limit - 返回条数上限，默认 10
     * @returns 按回应总数降序排列的摘要数组
     *
     * @example
     * ```typescript
     * const top = client.getReactionsManager().getMostReactedMessages("!room:example.org", 5);
     * ```
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

        return summaries.sort((a, b) => b.totalReactions - a.totalReactions).slice(0, limit);
    }

    /**
     * 移除某个事件上的所有表情回应。
     *
     * @param roomId - 房间 ID
     * @param eventId - 目标事件 ID
     * @returns 每条被撤回回应的 { event_id } 数组
     *
     * @example
     * ```typescript
     * await client.getReactionsManager().removeAllReactions("!room:example.org", "$event");
     * ```
     */
    public async removeAllReactions(roomId: string, eventId: string): Promise<Array<{ event_id: string }>> {
        const reactions = this.getReactionsForEvent(roomId, eventId);
        const promises: Promise<{ event_id: string }>[] = [];

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
