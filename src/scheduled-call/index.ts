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
 * Scheduled Call Manager - 预约通话管理
 *
 * 提供预约通话相关功能
 */

import { MatrixClient } from "../client";
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";

export interface IScheduledCall {
    callId: string;
    roomId: string;
    type: "voice" | "video";
    scheduledAt: number;
    createdBy: string;
    status: "scheduled" | "started" | "ended" | "cancelled";
}

export interface IScheduleCallResponse {
    call_id: string;
}

export interface ScheduledCallManagerEvents {
    call_scheduled: { callId: string; roomId: string };
    call_cancelled: { callId: string };
    call_started: { callId: string };
}

export class ScheduledCallManager extends BaseManager<keyof ScheduledCallManagerEvents, ScheduledCallManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public async scheduleCall(roomId: string, type: string, timestamp: number): Promise<IScheduleCallResponse> {
        return this.withRetry(
            () =>
                (
                    this.client as unknown as {
                        scheduleCall: (
                            roomId: string,
                            type: string,
                            timestamp: number,
                        ) => Promise<IScheduleCallResponse>;
                    }
                ).scheduleCall(roomId, type, timestamp),
            "scheduleCall",
        );
    }

    public async cancelScheduledCall(callId: string): Promise<void> {
        return this.withRetry(
            () =>
                (
                    this.client as unknown as {
                        cancelScheduledCall: (callId: string) => Promise<void>;
                    }
                ).cancelScheduledCall(callId),
            "cancelScheduledCall",
        );
    }

    public getScheduledCalls(): IScheduledCall[] {
        return (
            this.client as unknown as {
                getScheduledCalls: () => IScheduledCall[];
            }
        ).getScheduledCalls();
    }

    public getScheduledCall(callId: string): IScheduledCall | null {
        return (
            this.client as unknown as {
                getScheduledCall: (callId: string) => IScheduledCall | null;
            }
        ).getScheduledCall(callId);
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getScheduledCallManager(): ScheduledCallManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getScheduledCallManager = function (): ScheduledCallManager {
        return getOrCreateManager(this, "scheduledCall", () => new ScheduledCallManager(this));
    };
}

export default extendMatrixClient;
