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
 * Account Data Manager - 账户数据管理
 * 
 * 提供账户数据获取、设置、删除等功能
 */

import { MatrixClient } from "../client";
import { MatrixEvent } from "../models/event";
import { Method } from "../http-api/index";
import * as utils from "../utils";

export class AccountDataManager {
    constructor(private client: MatrixClient) {}

    /**
     * Set account data
     */
    public async setAccountData<K extends string>(
        eventType: K,
        content: any,
    ): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).setAccountData(eventType, content);
    }

    /**
     * Set account data raw
     */
    public setAccountDataRaw<K extends string>(
        eventType: K,
        content: any,
    ): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).setAccountDataRaw(eventType, content);
    }

    /**
     * Get account data
     */
    public getAccountData<K extends string>(eventType: K): MatrixEvent | undefined {
        return this.client.store.getAccountData(eventType);
    }

    /**
     * Get account data from server
     */
    public async getAccountDataFromServer<K extends string>(eventType: K): Promise<MatrixEvent | undefined> {
        const path = utils.encodeUri("/user/$userId/account_data/$type", {
            $userId: this.client.credentials.userId!,
            $type: eventType,
        });
        
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const response = await (this.client as any).http.authedRequest(Method.Get, path);
        const event = new MatrixEvent({
            type: eventType,
            content: response,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client.store as any).accountData.set(eventType, event);
        return event;
    }

    /**
     * Delete account data
     */
    public async deleteAccountData(eventType: string): Promise<void> {
        const path = utils.encodeUri("/user/$userId/account_data/$type", {
            $userId: this.client.credentials.userId!,
            $type: eventType,
        });
        
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (this.client as any).http.authedRequest(Method.Delete, path);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client.store as any).accountData.set(eventType, new MatrixEvent({ type: eventType, content: {} }));
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getAccountDataManager(): AccountDataManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getAccountDataManager = function (): AccountDataManager {
        return new AccountDataManager(this);
    };
}

export default extendMatrixClient;
