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
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import type { SendToDeviceContentMap } from "../client-api-types";
import type { EmptyObject } from "../@types/common";
import type { ToDeviceBatch as ModelToDeviceBatch, ToDevicePayload } from "../models/ToDeviceMessage";
import type { IContent } from "../models/event";

export interface ToDeviceMessage {
    [userId: string]: {
        [deviceId: string]: IContent;
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

/**
 * Optional widget-aware overrides exposed by {@link RoomWidgetClient}.
 *
 * The base {@link MatrixClient} does not define these methods, so their
 * presence is used as a runtime signal that to-device traffic must be routed
 * through the widget API instead of the HTTP `/sendToDevice` endpoint.
 */
interface WidgetAwareToDeviceClient {
    sendToDevice?(eventType: string, contentMap: SendToDeviceContentMap): Promise<EmptyObject>;
    queueToDevice?(batch: ModelToDeviceBatch): Promise<void>;
    encryptAndSendToDevice?(
        eventType: string,
        devices: { userId: string; deviceId: string }[],
        payload: ToDevicePayload,
    ): Promise<void>;
}

export class ToDeviceManager extends BaseManager {
    private txnId = 0;

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * 发送设备间消息
     * PUT /_matrix/client/v3/sendToDevice/{event_type}/{txnId}
     */
    async sendToDevice(eventType: string, messages: ToDeviceMessage, txnId?: string): Promise<ToDeviceResult> {
        const transactionId = txnId ?? this.makeTxnId();

        const response = await this.withRetry(async () => {
            return await this.request<ToDeviceResult>({
                method: Method.Put,
                path: `/sendToDevice/${encodeURIComponent(eventType)}/${encodeURIComponent(transactionId)}`,
                body: { messages },
                prefix: ClientPrefix.V3,
            });
        }, "sendToDevice");

        return { success: !!response, failures: response?.failures };
    }

    /**
     * Send an event to a specific list of devices using SendToDeviceContentMap.
     * This is the client.ts-compatible API that accepts Map<string, Map<string, ...>> format.
     * PUT /_matrix/client/v3/sendToDevice/{event_type}/{txnId}
     */
    async sendToDeviceFromContentMap(
        eventType: string,
        contentMap: SendToDeviceContentMap,
        txnId?: string,
    ): Promise<EmptyObject> {
        // When running inside a widget (RoomWidgetClient), delegate to the
        // widget-aware override so to-device traffic flows through the widget
        // API instead of the HTTP endpoint.
        const widgetClient = this.client as unknown as WidgetAwareToDeviceClient;
        if (typeof widgetClient.sendToDevice === "function") {
            return widgetClient.sendToDevice(eventType, contentMap);
        }

        const transactionId = txnId ?? this.makeTxnId();
        const path = `/sendToDevice/${encodeURIComponent(eventType)}/${encodeURIComponent(transactionId)}`;

        // Convert Map<string, Map<string, Record<string, any>>> to plain object
        const messages: Record<string, Record<string, IContent>> = {};
        for (const [userId, deviceMessages] of contentMap) {
            const perUserMessages: Record<string, IContent> = {};
            for (const [deviceId, content] of deviceMessages) {
                perUserMessages[deviceId] = content;
            }
            messages[userId] = perUserMessages;
        }

        return await this.request<EmptyObject>({
            method: Method.Put,
            path: path,
            body: { messages },
            prefix: ClientPrefix.V3,
        });
    }

    /**
     * Queue a ToDeviceBatch for batch sending via the client's ToDeviceMessageQueue.
     */
    async queueToDeviceBatch(batch: ModelToDeviceBatch): Promise<void> {
        // When running inside a widget (RoomWidgetClient), delegate to the
        // widget-aware override so the batch is sent through the widget API.
        const widgetClient = this.client as unknown as WidgetAwareToDeviceClient;
        if (typeof widgetClient.queueToDevice === "function") {
            return widgetClient.queueToDevice(batch);
        }

        return this.internalClient.toDeviceMessageQueue.queueBatch(batch);
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
     * Encrypt the payload for all devices in the list and queue it.
     * The type of the sent to-device message will be `m.room.encrypted`.
     * @param eventType - The type of event to send
     * @param devices - The list of devices to send the event to.
     * @param payload - The payload to send. This will be encrypted.
     * @returns Promise which resolves once queued.
     */
    async encryptAndSendToDevice(
        eventType: string,
        devices: { userId: string; deviceId: string }[],
        payload: ToDevicePayload,
    ): Promise<void> {
        // When running inside a widget (RoomWidgetClient), delegate to the
        // widget-aware override which routes encrypted to-device traffic
        // through the widget API. The widget host performs the encryption.
        const widgetClient = this.client as unknown as WidgetAwareToDeviceClient;
        if (typeof widgetClient.encryptAndSendToDevice === "function") {
            return widgetClient.encryptAndSendToDevice(eventType, devices, payload);
        }

        const client = this.internalClient;
        if (!client.cryptoBackend) {
            throw new Error("Cannot encrypt to device event, your client does not support encryption.");
        }
        const batch = await client.cryptoBackend.encryptToDeviceMessages(eventType, devices, payload);
        await this.queueToDeviceBatch(batch);
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

export function extendMatrixClient(): void {
    MatrixClient.prototype.getToDeviceManager = function (): ToDeviceManager {
        registerManagerClass("toDevice", ToDeviceManager);
        return getOrCreateManager(this, "toDevice", () => new ToDeviceManager(this));
    };
}
