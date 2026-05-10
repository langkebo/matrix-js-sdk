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
            throw new Error(`data_type too long (max ${MAX_DATA_TYPE_LENGTH} characters)`);
        }
    }

    /**
     * 验证内容大小
     */
    private validateContentSize(content: Record<string, unknown>): void {
        const contentStr = JSON.stringify(content);
        if (contentStr.length > MAX_CONTENT_SIZE) {
            throw new Error(`Account data too large (max ${MAX_CONTENT_SIZE} bytes)`);
        }
    }

    /**
     * Set account data
     *
     * @param eventType - 数据类型，最大长度 128 字符
     * @param content - 数据内容，序列化后最大 64KB
     * @throws Error 当 eventType 过长或 content 过大时
     */
    public async setAccountData<K extends string>(eventType: K, content: Record<string, unknown>): Promise<void> {
        this.validateDataType(eventType);
        this.validateContentSize(content);

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
     *
     * @param eventType - 数据类型
     * @returns MatrixEvent 或 undefined（当数据不存在时）
     * @throws Error 当请求失败时（404 表示数据不存在，除了 m.push_rules）
     *
     * 特殊处理:
     * - m.push_rules 不存在时返回默认推送规则骨架
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
