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
 * Aggregations Manager - 聚合管理
 * 
 * 提供消息聚合相关功能
 */

import { MatrixClient } from "../client";

export class AggregationsManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get aggregations
     */
    public getAggregations(roomId: string, eventId: string): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getAggregations(roomId, eventId);
    }

    /**
     * Get aggregation
     */
    public getAggregation(roomId: string, eventId: string, relationType: string): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getAggregation(roomId, eventId, relationType);
    }

    /**
     * Has aggregation
     */
    public hasAggregation(roomId: string, eventId: string, relationType: string): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).hasAggregation(roomId, eventId, relationType);
    }

    /**
     * Add aggregation
     */
    public addAggregation(roomId: string, eventId: string, aggregation: any): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).addAggregation(roomId, eventId, aggregation);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getAggregationsManager(): AggregationsManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getAggregationsManager = function (): AggregationsManager {
        return new AggregationsManager(this);
    };
}

export default extendMatrixClient;
