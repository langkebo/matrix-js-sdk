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
 * To-Device Manager - 设备消息管理
 *
 * 提供设备间消息发送功能
 * 对应后端: synapse-rust/src/web/routes/e2ee_routes.rs
 *
 * 后端端点:
 * - PUT /sendToDevice/{event_type}/{transaction_id}
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";

export interface ToDeviceMessage {
    [userId: string]: {
        [deviceId: string]: Record<string, unknown>;
    };
}

export interface ToDeviceBatch {
    eventType: string;
    batch: ToDeviceMessage;
}

export interface ToDeviceResult {
    success: boolean;
    failures?: Record<string, Record<string, { error: string }>>;
}

export class ToDeviceManager extends BaseManager {
    private txnId = 0;

    constructor(client: MatrixClient) {
        super(client);
    }

    /**
     * 发送设备间消息
     * PUT /_matrix/client/v3/sendToDevice/{event_type}/{txnId}
     */
    async sendToDevice(eventType: string, messages: ToDeviceMessage, txnId?: string): Promise<ToDeviceResult> {
        const transactionId = txnId ?? this.makeTxnId();

        return await this.withRetry(async () => {
            return await this.client.http.authedRequest<ToDeviceResult>(
                Method.Put,
                `/sendToDevice/${encodeURIComponent(eventType)}/${encodeURIComponent(transactionId)}`,
                undefined,
                { messages },
                { prefix: ClientPrefix.V3 },
            );
        }, "sendToDevice");
    }

    /**
     * 批量发送设备间消息
     */
    async sendBatchToDevice(batch: ToDeviceBatch[]): Promise<ToDeviceResult[]> {
        const results: ToDeviceResult[] = [];

        for (const item of batch) {
            try {
                const result = await this.sendToDevice(item.eventType, item.batch);
                results.push(result);
            } catch (error) {
                results.push({
                    success: false,
                    failures: {
                        _batch: {
                            _error: { error: error instanceof Error ? error.message : String(error) },
                        },
                    },
                });
            }
        }

        return results;
    }

    /**
     * 发送加密的设备间消息
     */
    async sendEncryptedToDevice(
        eventType: string,
        encryptedMessages: ToDeviceMessage,
        txnId?: string,
    ): Promise<ToDeviceResult> {
        return this.sendToDevice(eventType, encryptedMessages, txnId);
    }

    private makeTxnId(): string {
        return `mjs${Date.now()}${this.txnId++}`;
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getToDeviceManager(): ToDeviceManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getToDeviceManager = function (): ToDeviceManager {
        return getOrCreateManager(this, "toDevice", () => new ToDeviceManager(this));
    };
}

export default extendMatrixClient;
