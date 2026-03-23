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
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/index";
import * as utils from "../utils";

export class ToDeviceManager {
    constructor(private client: MatrixClient) {}

    /**
     * Send to-device message
     */
    public sendToDevice(eventType: string, contentMap: any, txnId?: string): Promise<any> {
        const path = utils.encodeUri("/sendToDevice/$eventType/$txnId", {
            $eventType: eventType,
            $txnId: txnId ? txnId : (this.client as any).makeTxnId(),
        });

        const body = {
            messages: utils.recursiveMapToObject(contentMap),
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Put, path, undefined, body);
    }

    /**
     * Queue to-device messages
     */
    public queueToDevice(batch: any): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).toDeviceMessageQueue.queueBatch(batch);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getToDeviceManager(): ToDeviceManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getToDeviceManager = function (): ToDeviceManager {
        return new ToDeviceManager(this);
    };
}

export default extendMatrixClient;
