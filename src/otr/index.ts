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

export class OtrManager {
    constructor(private client: MatrixClient) {}

    public async beginOTR(userId: string, roomId?: string): Promise<IOtrBeginResponse> {
        return (this.client as unknown as {
            beginOTR: (userId: string, roomId?: string) => Promise<IOtrBeginResponse>;
        }).beginOTR(userId, roomId);
    }

    public async endOTR(userId: string): Promise<void> {
        return (this.client as unknown as {
            endOTR: (userId: string) => Promise<void>;
        }).endOTR(userId);
    }

    public async sendOTRMessage(userId: string, message: IOtrMessage): Promise<void> {
        return (this.client as unknown as {
            sendOTRMessage: (userId: string, message: IOtrMessage) => Promise<void>;
        }).sendOTRMessage(userId, message);
    }

    public isOTREnabled(): boolean {
        return (this.client as unknown as {
            isOTREnabled: () => boolean;
        }).isOTREnabled();
    }

    public setOTREnabled(enabled: boolean): void {
        (this.client as unknown as {
            setOTREnabled: (enabled: boolean) => void;
        }).setOTREnabled(enabled);
    }

    public getOTRSession(userId: string): IOtrSession | null {
        return (this.client as unknown as {
            getOTRSession: (userId: string) => IOtrSession | null;
        }).getOTRSession(userId);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getOtrManager(): OtrManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getOtrManager = function (): OtrManager {
        return new OtrManager(this);
    };
}

export default extendMatrixClient;
