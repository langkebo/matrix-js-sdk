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
 * Reporting Manager - 举报管理
 *
 * 提供内容举报功能
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/index";
import { ClientPrefix } from "../http-api/prefix";
import * as utils from "../utils";
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";
import type { EmptyObject } from "../@types/common";

export interface ReportResult {
    report_id: string;
    status: string;
}

export interface ReportingManagerEvents {
    room_reported: { roomId: string; reason: string };
    event_reported: { roomId: string; eventId: string; reason: string };
    user_reported: { userId: string; reason: string };
}

export class ReportingManager extends BaseManager<keyof ReportingManagerEvents, ReportingManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public async reportRoom(roomId: string, reason: string): Promise<EmptyObject> {
        return this.withRetry(async () => {
            const path = utils.encodeUri("/rooms/$roomId/report", { $roomId: roomId });
            return await this.client.http.authedRequest<EmptyObject>(Method.Post, path, undefined, { reason });
        }, "reportRoom");
    }

    public async reportEvent(roomId: string, eventId: string, score: number, reason: string): Promise<EmptyObject> {
        return this.withRetry(async () => {
            const path = utils.encodeUri("/rooms/$roomId/report/$eventId", { $roomId: roomId, $eventId: eventId });
            return await this.client.http.authedRequest<EmptyObject>(Method.Post, path, undefined, { score, reason });
        }, "reportEvent");
    }

    public async reportUser(userId: string, reason: string): Promise<void> {
        return this.withRetry(async () => {
            const path = utils.encodeUri("/users/$userId/report", { $userId: userId });
            await this.client.http.authedRequest(Method.Post, path, undefined, { reason });
        }, "reportUser");
    }

    /**
     * Score a report
     * @param roomId - The room ID
     * @param eventId - The event ID
     * @param score - The score (-100 to 0)
     */
    public async scoreReport(roomId: string, eventId: string, score: number): Promise<void> {
        const path = utils.encodeUri("/rooms/$roomId/report/$eventId/score", {
            $roomId: roomId,
            $eventId: eventId,
        });
        await this.client.http.authedRequest(Method.Put, path, undefined, { score }, { prefix: ClientPrefix.V3 });
    }

    /**
     * Get scanner info for a report
     * @param roomId - The room ID
     * @param eventId - The event ID
     */
    public async getScannerInfo(roomId: string, eventId: string): Promise<Record<string, unknown>> {
        const path = utils.encodeUri("/rooms/$roomId/report/$eventId/scanner_info", {
            $roomId: roomId,
            $eventId: eventId,
        });
        return this.client.http.authedRequest(Method.Get, path, undefined, undefined, { prefix: ClientPrefix.V1 });
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getReportingManager(): ReportingManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getReportingManager = function (): ReportingManager {
        return getOrCreateManager(this, "reporting", () => new ReportingManager(this));
    };
}

export default extendMatrixClient;
