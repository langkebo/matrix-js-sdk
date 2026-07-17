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
 * Key Forwarding Manager - 密钥转发管理
 *
 * 提供密钥转发相关功能
 */

import { MatrixClient } from "../client";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export interface IForwardedKey {
    roomId: string;
    eventId: string;
    sessionId: string;
    algorithm: string;
    forwardedTo: string;
    timestamp: number;
}

export interface IKeyForwardingResponse {
    success: boolean;
    requestId: string;
}

export interface KeyForwardingManagerEvents {
    key_forwarded: { roomId: string; userId: string };
    key_forward_failed: { roomId: string; error: Error };
}

export class KeyForwardingManager extends BaseManager<keyof KeyForwardingManagerEvents, KeyForwardingManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public async requestKeyForwarding(
        roomId: string,
        eventId: string,
        userId: string,
    ): Promise<IKeyForwardingResponse> {
        return this.withRetry(() => this.client.requestKeyForwarding(roomId, eventId, userId), "requestKeyForwarding");
    }

    public async forwardKey(
        roomId: string,
        eventId: string,
        userId: string,
        key: Record<string, unknown>, // Dynamic: key forwarding data varies by algorithm
    ): Promise<IKeyForwardingResponse> {
        return this.withRetry(() => this.client.forwardKey(roomId, eventId, userId, key), "forwardKey");
    }

    public hasForwardedKey(roomId: string, eventId: string): boolean {
        return this.client.hasForwardedKey(roomId, eventId);
    }

    public getForwardedKeys(roomId: string): IForwardedKey[] {
        return this.client.getForwardedKeys(roomId);
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getKeyForwardingManager = function (): KeyForwardingManager {
        registerManagerClass("keyForwarding", KeyForwardingManager);
        return getOrCreateManager(this, "keyForwarding", () => new KeyForwardingManager(this));
    };
}
