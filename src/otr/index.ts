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
 * OTR Manager - OTR加密管理
 *
 * 提供OTR(Off-The-Record)加密相关功能
 */

import { MatrixClient } from "../client";
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";

export interface IOtrSession {
    sessionId: string;
    userId: string;
    roomId?: string;
    startedAt: number;
    isActive: boolean;
}

export interface IOtrMessage {
    type: string;
    content: Record<string, unknown>;
}

export interface IOtrBeginResponse {
    session: IOtrSession;
}

export interface OtrManagerEvents {
    otr_session_started: { userId: string; sessionId: string };
    otr_session_ended: { userId: string };
    otr_message_sent: { userId: string };
}

export class OtrManager extends BaseManager<keyof OtrManagerEvents, OtrManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public async beginOTR(userId: string, roomId?: string): Promise<IOtrBeginResponse> {
        return this.withRetry(
            () =>
                (
                    this.client as unknown as {
                        beginOTR: (userId: string, roomId?: string) => Promise<IOtrBeginResponse>;
                    }
                ).beginOTR(userId, roomId),
            "beginOTR",
        );
    }

    public async endOTR(userId: string): Promise<void> {
        return this.withRetry(
            () =>
                (
                    this.client as unknown as {
                        endOTR: (userId: string) => Promise<void>;
                    }
                ).endOTR(userId),
            "endOTR",
        );
    }

    public async sendOTRMessage(userId: string, message: IOtrMessage): Promise<void> {
        return this.withRetry(
            () =>
                (
                    this.client as unknown as {
                        sendOTRMessage: (userId: string, message: IOtrMessage) => Promise<void>;
                    }
                ).sendOTRMessage(userId, message),
            "sendOTRMessage",
        );
    }

    public isOTREnabled(): boolean {
        return (
            this.client as unknown as {
                isOTREnabled: () => boolean;
            }
        ).isOTREnabled();
    }

    public setOTREnabled(enabled: boolean): void {
        (
            this.client as unknown as {
                setOTREnabled: (enabled: boolean) => void;
            }
        ).setOTREnabled(enabled);
    }

    public getOTRSession(userId: string): IOtrSession | null {
        return (
            this.client as unknown as {
                getOTRSession: (userId: string) => IOtrSession | null;
            }
        ).getOTRSession(userId);
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getOtrManager(): OtrManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getOtrManager = function (): OtrManager {
        return getOrCreateManager(this, "otr", () => new OtrManager(this));
    };
}

export default extendMatrixClient;
