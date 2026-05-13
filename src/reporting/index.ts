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
import * as utils from "../utils";
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";

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

    public async reportRoom(roomId: string, reason: string, score?: number): Promise<void> {
        return this.withRetry(async () => {
            const path = utils.encodeUri("/rooms/$roomId/report", { $roomId: roomId });
            await this.client.http.authedRequest(Method.Post, path, undefined, { reason, score });
        }, "reportRoom");
    }

    public async reportEvent(roomId: string, eventId: string, reason: string, score?: number): Promise<void> {
        return this.withRetry(async () => {
            const path = utils.encodeUri("/rooms/$roomId/report/$eventId", { $roomId: roomId, $eventId: eventId });
            await this.client.http.authedRequest(Method.Post, path, undefined, { reason, score });
        }, "reportEvent");
    }

    public async reportUser(userId: string, reason: string): Promise<void> {
        return this.withRetry(async () => {
            const path = utils.encodeUri("/users/$userId/report", { $userId: userId });
            await this.client.http.authedRequest(Method.Post, path, undefined, { reason });
        }, "reportUser");
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
