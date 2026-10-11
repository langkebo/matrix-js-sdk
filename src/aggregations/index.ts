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

import { MatrixClient } from "../client";
import { MatrixEvent } from "../models/event";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export interface IAggregation {
    relationType: string;
    events: MatrixEvent[];
    count: number;
}

export interface AggregationsManagerEvents {
    aggregation_updated: { roomId: string; eventId: string; relationType: string };
}

export class AggregationsManager extends BaseManager<keyof AggregationsManagerEvents, AggregationsManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * 获取指定事件的所有聚合结果（按 relation 类型分组）。
     *
     * @param roomId - 房间 ID
     * @param eventId - 事件 ID
     * @returns 聚合结果列表；房间或事件不存在时返回空数组
     *
     * @example
     * ```typescript
     * const aggregations = client.getAggregationsManager().getAggregations("!room:example.org", "$event");
     * ```
     */
    public getAggregations(roomId: string, eventId: string): IAggregation[] {
        const room = this.client.getRoom(roomId);
        if (!room) return [];

        const relations = room.getRelationsForEvent(eventId);
        if (!relations.size) return [];

        return Array.from(relations.entries()).map(([relationType, events]) => ({
            relationType,
            events,
            count: events.length,
        }));
    }

    /**
     * 获取指定事件在给定 relation 类型下的聚合结果。
     *
     * @param roomId - 房间 ID
     * @param eventId - 事件 ID
     * @param relationType - relation 类型（例如 `m.annotation`）
     * @returns 对应的聚合结果；不存在时返回 null
     *
     * @example
     * ```typescript
     * const aggregation = client.getAggregationsManager().getAggregation("!room:example.org", "$event", "m.annotation");
     * ```
     */
    public getAggregation(roomId: string, eventId: string, relationType: string): IAggregation | null {
        const aggregations = this.getAggregations(roomId, eventId);
        return aggregations.find((a) => a.relationType === relationType) || null;
    }

    /**
     * 判断指定事件是否存在给定 relation 类型的聚合结果。
     *
     * @param roomId - 房间 ID
     * @param eventId - 事件 ID
     * @param relationType - relation 类型
     * @returns 存在时返回 true，否则返回 false
     *
     * @example
     * ```typescript
     * const exists = client.getAggregationsManager().hasAggregation("!room:example.org", "$event", "m.annotation");
     * ```
     */
    public hasAggregation(roomId: string, eventId: string, relationType: string): boolean {
        return this.getAggregation(roomId, eventId, relationType) !== null;
    }

    /**
     * 记录一条聚合结果（当前为占位实现，房间不存在时直接返回）。
     *
     * @param roomId - 房间 ID
     * @param _eventId - 事件 ID
     * @param _aggregation - 聚合结果
     *
     * @example
     * ```typescript
     * client.getAggregationsManager().addAggregation("!room:example.org", "$event", {
     *     relationType: "m.annotation",
     *     events: [],
     *     count: 0,
     * });
     * ```
     */
    public addAggregation(roomId: string, _eventId: string, _aggregation: IAggregation): void {
        const room = this.client.getRoom(roomId);
        if (!room) return;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getAggregationsManager = function (): AggregationsManager {
        registerManagerClass("aggregations", AggregationsManager);
        return getOrCreateManager(this, "aggregations", () => new AggregationsManager(this));
    };
}
