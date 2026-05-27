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
 *
 * 契约文档: docs/api-contract/account-data.md
 *
 * 数据约束:
 * - data_type 最大长度: 128 字符
 * - Account Data 内容最大大小: 64KB (65536 字节)
 * - 用户只能访问自己的数据
 */

import { MatrixClient, ClientEvent } from "../client";
import { MatrixEvent } from "../models/event";
import { Method, retryNetworkOperation } from "../http-api/index";
import { type EmptyObject } from "../@types/common";
import { EventType, type AccountDataEvents, type WritableAccountDataEvents } from "../@types/event";
import {
    buildRoomAccountDataPath,
    buildUserAccountDataListPath,
    buildUserAccountDataPath,
    setUserAccountDataRequest,
    getUserAccountDataRequest,
    deleteUserAccountDataRequest,
    selectDeleteAccountDataRequestOptions,
} from "../client-account-data-requests";
import {
    getAccountDataFromStoreWhenReady,
    isAccountDataNotFoundError,
    shouldFallbackDeleteAccountDataToEmptyContent,
} from "../client-account-data-core";
import { Feature } from "../feature";
import { deepCompare } from "../utils";
import { logger } from "../logger";
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";
import { ValidationError } from "../errors";

export enum AccountDataEvent {
    AccountDataUpdated = "AccountDataUpdated",
    AccountDataError = "AccountDataError",
}

interface AccountDataManagerEventMap {
    [AccountDataEvent.AccountDataUpdated]: (eventType: string, event: MatrixEvent) => void;
    [AccountDataEvent.AccountDataError]: (error: Error) => void;
}

// 常量定义
const MAX_DATA_TYPE_LENGTH = 128;
const MAX_CONTENT_SIZE = 65536; // 64KB

export class AccountDataManager extends BaseManager<AccountDataEvent, AccountDataManagerEventMap> {
    constructor(client: MatrixClient) {
        super(client);
    }

    /**
     * 验证 data_type 长度
     */
    private validateDataType(eventType: string): void {
        if (eventType.length > MAX_DATA_TYPE_LENGTH) {
            throw new ValidationError(`data_type too long (max ${MAX_DATA_TYPE_LENGTH} characters)`);
        }
    }

    /**
     * 验证内容大小
     */
    private validateContentSize(content: Record<string, unknown>): void {
        const contentStr = JSON.stringify(content);
        if (contentStr.length > MAX_CONTENT_SIZE) {
            throw new ValidationError(`Account data too large (max ${MAX_CONTENT_SIZE} bytes)`);
        }
    }

    /**
     * Set account data with remote echo waiting.
     *
     * @param eventType - The event type
     * @param content - The contents object for the event
     * @returns Promise which resolves: an empty object
     */
    public async setAccountData<K extends keyof WritableAccountDataEvents>(
        eventType: K,
        content: AccountDataEvents[K] | Record<string, never>,
    ): Promise<EmptyObject> {
        this.validateDataType(eventType as string);
        this.validateContentSize(content as Record<string, unknown>);

        // If the sync loop is not running, fall back to setAccountDataRaw.
        if (!this.client.clientRunning) {
            logger.warn(
                "Calling `setAccountData` before the client is started: `getAccountData` may return inconsistent results.",
            );
            return await retryNetworkOperation(5, () => this.setAccountDataRaw(eventType, content));
        }

        // If the account data is already correct, then we cannot expect an update over sync, and the operation
        // is, in any case, a no-op.
        const existingData = this.client.store.getAccountData(eventType as string);
        if (existingData && deepCompare(existingData.event.content, content)) return {};

        // Create a promise which will resolve when the update is received
        const updatedResolvers = Promise.withResolvers<void>();
        function accountDataListener(event: MatrixEvent): void {
            if (event.getType() === eventType) updatedResolvers.resolve();
        }
        this.client.addListener(ClientEvent.AccountData, accountDataListener);

        try {
            const result = await retryNetworkOperation(5, () => this.setAccountDataRaw(eventType, content));
            await updatedResolvers.promise;
            return result;
        } finally {
            this.client.removeListener(ClientEvent.AccountData, accountDataListener);
        }
    }

    /**
     * Set account data event for the current user, without waiting for the remote echo.
     *
     * @param eventType - The event type
     * @param content - the contents object for the event
     */
    public setAccountDataRaw<K extends keyof WritableAccountDataEvents>(
        eventType: K,
        content: AccountDataEvents[K] | Record<string, never>,
    ): Promise<EmptyObject> {
        return setUserAccountDataRequest(
            this.client.credentials.userId,
            eventType as string,
            content as Record<string, unknown>,
            this.client.http.authedRequest.bind(this.client.http),
        );
    }

    /**
     * Get account data event of given type for the current user.
     * @param eventType - The event type
     * @returns The contents of the given account data event
     */
    public getAccountData<K extends keyof AccountDataEvents>(eventType: K): MatrixEvent | undefined {
        return this.client.store.getAccountData(eventType as string);
    }

    /**
     * Get account data event of given type for the current user. This variant
     * gets account data directly from the homeserver if the local store is not
     * ready, which can be useful very early in startup before the initial sync.
     * @param eventType - The event type
     * @returns Promise which resolves: The contents of the given account data event.
     * @returns Rejects: with an error response.
     */
    public async getAccountDataFromServer<K extends keyof AccountDataEvents>(
        eventType: K,
    ): Promise<AccountDataEvents[K] | null> {
        const localContent = getAccountDataFromStoreWhenReady<AccountDataEvents[K]>(
            this.client.isInitialSyncComplete(),
            this.client.store.getAccountData(eventType as string),
        );
        if (localContent !== undefined) {
            return localContent;
        }
        try {
            return await getUserAccountDataRequest<AccountDataEvents[K]>(
                this.client.credentials.userId,
                eventType as string,
                this.client.http.authedRequest.bind(this.client.http),
            );
        } catch (e) {
            if (isAccountDataNotFoundError(e)) {
                return null;
            }
            throw e;
        }
    }

    /**
     * List all account data for the current user
     *
     * @returns 包含所有 account data 的对象，格式为 { account_data: { type: content, ... } }
     *
     * 响应示例:
     * {
     *   "account_data": {
     *     "m.direct": { "@alice:example.com": ["!room1:example.com"] },
     *     "m.push_rules": { "global": { ... } }
     *   }
     * }
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
     *
     * @param roomId - 房间 ID
     * @param eventType - 数据类型
     * @returns MatrixEvent 或 undefined（当数据不存在时）
     * @throws Error 当请求失败时（404 表示数据不存在）
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
     * Set room account data
     *
     * @param roomId - 房间 ID
     * @param eventType - 数据类型
     * @param content - 数据内容
     */
    public async setRoomAccountData<K extends string>(
        roomId: string,
        eventType: K,
        content: Record<string, unknown>,
    ): Promise<void> {
        this.validateDataType(eventType);
        this.validateContentSize(content);
        const path = buildRoomAccountDataPath(this.client.credentials.userId!, roomId, eventType);

        try {
            await this.client.http.authedRequest(Method.Put, path, undefined, content);
        } catch (e) {
            throw this.normalizeError(e, "setRoomAccountData");
        }
    }

    /**
     * Delete room account data
     *
     * @param roomId - 房间 ID
     * @param eventType - 数据类型
     * @throws Error 当数据不存在时（404）
     */
    public async deleteRoomAccountData(roomId: string, eventType: string): Promise<void> {
        const path = buildRoomAccountDataPath(this.client.credentials.userId!, roomId, eventType);

        try {
            await this.client.http.authedRequest(Method.Delete, path);
        } catch (e) {
            throw this.normalizeError(e, "deleteRoomAccountData");
        }
    }

    /**
     * Delete account data.
     * @param eventType - The event type to delete
     */
    public async deleteAccountData(eventType: keyof WritableAccountDataEvents): Promise<void> {
        const msc3391DeleteAccountDataServerSupport = this.client.canSupport.get(Feature.AccountDataDeletion);
        // if deletion is not supported overwrite with empty content
        if (shouldFallbackDeleteAccountDataToEmptyContent(msc3391DeleteAccountDataServerSupport)) {
            await this.setAccountData(eventType, {});
            return;
        }
        return await deleteUserAccountDataRequest(
            this.client.getSafeUserId(),
            eventType as string,
            this.client.http.authedRequest.bind(this.client.http),
            selectDeleteAccountDataRequestOptions(msc3391DeleteAccountDataServerSupport),
        );
    }

    /**
     * Gets the users that are ignored by this client
     * @returns The array of users that are ignored (empty if none)
     */
    public getIgnoredUsers(): string[] {
        const event = this.getAccountData(EventType.IgnoredUserList);
        const ignoredUsers = event?.getContent()["ignored_users"];
        if (!ignoredUsers || typeof ignoredUsers !== "object") return [];
        return Object.keys(ignoredUsers);
    }

    /**
     * Sets the users that the current user should ignore.
     * @param userIds - the user IDs to ignore
     * @returns Promise which resolves: an empty object
     * @returns Rejects: with an error response.
     */
    public setIgnoredUsers(userIds: string[]): Promise<EmptyObject> {
        const content = { ignored_users: {} as Record<string, EmptyObject> };
        userIds.forEach((u) => {
            content.ignored_users[u] = {};
        });
        return this.setAccountData(EventType.IgnoredUserList, content);
    }

    /**
     * Gets whether or not a specific user is being ignored by this client.
     * @param userId - the user ID to check
     * @returns true if the user is ignored, false otherwise
     */
    public isUserIgnored(userId: string): boolean {
        return this.getIgnoredUsers().includes(userId);
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
