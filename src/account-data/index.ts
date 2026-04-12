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
import {
    buildRoomAccountDataPath,
    buildUserAccountDataListPath,
    buildUserAccountDataPath,
} from "../client-account-data-requests";
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";

export enum AccountDataEvent {
    AccountDataUpdated = "AccountDataUpdated",
    AccountDataError = "AccountDataError",
}

interface AccountDataManagerEventMap {
    [AccountDataEvent.AccountDataUpdated]: (eventType: string, event: MatrixEvent) => void;
    [AccountDataEvent.AccountDataError]: (error: Error) => void;
}

export class AccountDataManager extends BaseManager<AccountDataEvent, AccountDataManagerEventMap> {
    constructor(client: MatrixClient) {
        super(client);
    }

    /**
     * Set account data
     */
    public async setAccountData<K extends string>(eventType: K, content: Record<string, unknown>): Promise<void> {
        try {
            await this.client.setAccountData(eventType, content);
            const event = new MatrixEvent({ type: eventType, content });
            this.emit(AccountDataEvent.AccountDataUpdated, eventType, event);
        } catch (e) {
            const error = this.normalizeError(e, "setAccountData");
            this.emit(AccountDataEvent.AccountDataError, error);
            throw error;
        }
    }

    public setAccountDataRaw<K extends string>(eventType: K, content: Record<string, unknown>): void {
        this.client.setAccountDataRaw(eventType, content);
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
        const path = buildUserAccountDataPath(this.client.credentials.userId!, eventType);

        try {
            const response = await this.client.http.authedRequest<Record<string, unknown>>(Method.Get, path);
            const event = new MatrixEvent({
                type: eventType,
                content: response,
            });
            this.client.store?.storeAccountDataEvents?.([event]);
            this.emit(AccountDataEvent.AccountDataUpdated, eventType, event);
            return event;
        } catch (e) {
            const error = this.normalizeError(e, "getAccountDataFromServer");
            this.emit(AccountDataEvent.AccountDataError, error);
            throw error;
        }
    }

    /**
     * List all account data for the current user
     */
    public async listAccountData(): Promise<{ account_data: Record<string, unknown> }> {
        const path = buildUserAccountDataListPath(this.client.credentials.userId!);

        try {
            return await this.client.http.authedRequest<{ account_data: Record<string, unknown> }>(Method.Get, path);
        } catch (e) {
            throw this.normalizeError(e, "listAccountData");
        }
    }

    /**
     * Get room account data from server
     */
    public async getRoomAccountDataFromServer<K extends string>(
        roomId: string,
        eventType: K,
    ): Promise<MatrixEvent | undefined> {
        const path = buildRoomAccountDataPath(this.client.credentials.userId!, roomId, eventType);

        try {
            const response = await this.client.http.authedRequest<Record<string, unknown>>(Method.Get, path);
            return new MatrixEvent({
                type: eventType,
                content: response,
            });
        } catch (e) {
            throw this.normalizeError(e, "getRoomAccountDataFromServer");
        }
    }

    /**
     * Delete account data
     */
    public async deleteAccountData(eventType: string): Promise<void> {
        const path = buildUserAccountDataPath(this.client.credentials.userId!, eventType);

        try {
            await this.client.http.authedRequest(Method.Delete, path);
            const event = new MatrixEvent({ type: eventType, content: {} });
            this.client.store?.storeAccountDataEvents?.([event]);
            this.emit(AccountDataEvent.AccountDataUpdated, eventType, event);
        } catch (e) {
            const error = this.normalizeError(e, "deleteAccountData");
            this.emit(AccountDataEvent.AccountDataError, error);
            throw error;
        }
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
        return getOrCreateManager(this, "accountData", () => new AccountDataManager(this));
    };
}

export default extendMatrixClient;
