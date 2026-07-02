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
import { BaseManager } from "../managers/base-manager";
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
    constructor(client: MatrixClient) {
        super(client);
    }

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

    public getAggregation(roomId: string, eventId: string, relationType: string): IAggregation | null {
        const aggregations = this.getAggregations(roomId, eventId);
        return aggregations.find((a) => a.relationType === relationType) || null;
    }

    public hasAggregation(roomId: string, eventId: string, relationType: string): boolean {
        return this.getAggregation(roomId, eventId, relationType) !== null;
    }

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

export default extendMatrixClient;
