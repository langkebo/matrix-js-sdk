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
 * Push Manager - 推送管理
 * 
 * 提供推送通知和推送规则管理功能
 */

import { logger } from "../logger";
import { MatrixError } from "../http-api/errors";
import { MatrixClient } from "../client";
import { PushRuleKind } from "../@types/PushRules";

export interface PushRule {
    rule_id: string;
    default: boolean;
    enabled: boolean;
    pattern?: string;
    conditions?: Array<{
        kind: string;
        [key: string]: unknown;
    }>;
    actions: string[];
}

export interface PushManagerRuleSet {
    override?: PushRule[];
    content?: PushRule[];
    room?: PushRule[];
    sender?: PushRule[];
    underride?: PushRule[];
}

export interface PushRuleActions {
    actions: string[];
    tweaks?: {
        highlight?: boolean;
        sound?: string;
        vibration?: boolean;
    };
}

export interface PushNotification {
    room_id: string;
    room_name?: string;
    room_icon?: string;
    sender_name?: string;
    sender_avatar?: string;
    event_id: string;
    txn_id?: string;
    priority?: string;
    content: Record<string, unknown>;
    counts: {
        unread: number;
        missed_calls?: number;
    };
    devices: Array<{
        app_id: string;
        pushkey: string;
        data: Record<string, unknown>;
    }>;
}

export interface PushGatewayConfig {
    url: string;
    format: 'event_id_only' | 'event_id_only_push' | 'p2p';
}

export interface PushCapabilities {
    supports: {
        push: boolean;
        formats: string[];
        urgency?: string[];
    };
}

/**
 * Push 错误类
 */
export class PushError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly statusCode: number
    ) {
        super(message);
        this.name = "PushError";
    }
}

/**
 * Push Manager - 推送管理
 */
export class PushManager {
    private client: MatrixClient;
    private pushers: Array<Record<string, unknown>> = [];
    private capabilities: PushCapabilities | null = null;

    constructor(client: MatrixClient) {
        this.client = client;
    }

    /**
     * 获取推送规则
     */
    async getPushRules(): Promise<PushManagerRuleSet> {
        try {
            const rules = await this.client.getPushRules() as any;
            return rules as PushManagerRuleSet;
        } catch (e) {
            this.handleError("getPushRules", e);
            throw this.normalizeError(e, "getPushRules");
        }
    }

    /**
     * 获取特定类型的推送规则
     */
    async getRulesByKind(kind: 'override' | 'content' | 'room' | 'sender' | 'underride'): Promise<PushRule[]> {
        try {
            const rules = await this.getPushRules();
            return rules[kind] || [];
        } catch (e) {
            this.handleError("getRulesByKind", e);
            throw this.normalizeError(e, "getRulesByKind");
        }
    }

    /**
     * 添加推送规则
     */
    async addPushRule(
        scope: string,
        kind: PushRuleKind,
        ruleId: string,
        pattern?: string,
        actions?: string[]
    ): Promise<void> {
        try {
            await this.client.addPushRule(scope, kind, ruleId as any, {
                pattern,
                actions: actions || ['notify']
            } as any);
        } catch (e: unknown) {
            this.handleError("addPushRule", e);
            const err = e as Error;
            const matrixErr = e as MatrixError;
            throw new PushError(
                `Failed to add push rule: ${err?.message ?? 'Unknown error'}`,
                matrixErr?.errcode ?? "UNKNOWN",
                matrixErr?.httpStatus ?? 0
            );
        }
    }

    /**
     * 删除推送规则
     */
    async deletePushRule(scope: string, kind: PushRuleKind, ruleId: string): Promise<void> {
        try {
            await this.client.deletePushRule(scope, kind, ruleId as any);
        } catch (e: unknown) {
            this.handleError("deletePushRule", e);
            const err = e as Error;
            const matrixErr = e as MatrixError;
            throw new PushError(
                `Failed to delete push rule: ${err?.message ?? 'Unknown error'}`,
                matrixErr?.errcode ?? "UNKNOWN",
                matrixErr?.httpStatus ?? 0
            );
        }
    }

    /**
     * 启用/禁用推送规则
     */
    async setPushRuleEnabled(scope: string, kind: PushRuleKind, ruleId: string, enabled: boolean): Promise<void> {
        try {
            await this.client.setPushRuleEnabled(scope, kind, ruleId, enabled);
        } catch (e: unknown) {
            this.handleError("setPushRuleEnabled", e);
            const err = e as Error;
            const matrixErr = e as MatrixError;
            throw new PushError(
                `Failed to set push rule enabled: ${err?.message ?? 'Unknown error'}`,
                matrixErr?.errcode ?? "UNKNOWN",
                matrixErr?.httpStatus ?? 0
            );
        }
    }

    /**
     * 更新推送规则动作
     */
    async updatePushRuleActions(scope: string, kind: PushRuleKind, ruleId: string, actions: string[]): Promise<void> {
        try {
            await this.client.setPushRuleActions(scope, kind, ruleId, actions as any);
        } catch (e: unknown) {
            this.handleError("updatePushRuleActions", e);
            const err = e as Error;
            const matrixErr = e as MatrixError;
            throw new PushError(
                `Failed to update push rule actions: ${err?.message ?? 'Unknown error'}`,
                matrixErr?.errcode ?? "UNKNOWN",
                matrixErr?.httpStatus ?? 0
            );
        }
    }

    /**
     * 忽略用户发送者
     */
    async ignoreUser(userId: string): Promise<void> {
        await this.addPushRule("sender", PushRuleKind.SenderSpecific, userId, undefined, ['dont_notify']);
    }

    /**
     * 取消忽略用户
     */
    async unignoreUser(userId: string): Promise<void> {
        await this.deletePushRule("sender", PushRuleKind.SenderSpecific, userId);
    }

    /**
     * 检查用户是否被忽略
     */
    async isUserIgnored(userId: string): Promise<boolean> {
        const rules = await this.getRulesByKind('sender');
        return rules.some(r => r.rule_id === userId && r.enabled);
    }

    /**
     * 添加关键词高亮规则
     */
    async addKeywordHighlight(keyword: string): Promise<void> {
        await this.addPushRule("global", PushRuleKind.ContentSpecific, keyword, keyword, ['notify', 'highlight']);
    }

    /**
     * 移除关键词高亮
     */
    async removeKeywordHighlight(keyword: string): Promise<void> {
        await this.deletePushRule("global", PushRuleKind.ContentSpecific, keyword);
    }

    /**
     * 静音房间
     */
    async muteRoom(roomId: string): Promise<void> {
        await this.addPushRule("room", PushRuleKind.RoomSpecific, roomId, undefined, ['dont_notify']);
    }

    /**
     * 取消房间静音
     */
    async unmuteRoom(roomId: string): Promise<void> {
        await this.deletePushRule("room", PushRuleKind.RoomSpecific, roomId);
    }

    /**
     * 检查房间是否被静音
     */
    async isRoomMuted(roomId: string): Promise<boolean> {
        const rules = await this.getRulesByKind('room');
        return rules.some(r => r.rule_id === roomId && r.enabled && r.actions.includes('dont_notify'));
    }

    /**
     * 获取所有 pusher
     */
    async getPushers(): Promise<Array<Record<string, unknown>>> {
        try {
            const result = await this.client.getPushers() as any;
            this.pushers = result?.pushers || [];
            return this.pushers;
        } catch (e) {
            this.handleError("getPushers", e);
            throw this.normalizeError(e, "getPushers");
        }
    }

    /**
     * 添加 pusher
     */
    async addPusher(config: {
        app_id: string;
        pushkey: string;
        kind: string;
        app_display_name?: string;
        device_display_name?: string;
        lang?: string;
        data?: Record<string, unknown>;
    }): Promise<void> {
        try {
            await this.client.setPusher({
                app_id: config.app_id,
                pushkey: config.pushkey,
                kind: config.kind,
                app_display_name: config.app_display_name ?? '',
                device_display_name: config.device_display_name ?? '',
                lang: config.lang ?? '',
                data: config.data || {}
            } as any);
            await this.getPushers();
        } catch (e: unknown) {
            this.handleError("addPusher", e);
            const err = e as Error;
            const matrixErr = e as MatrixError;
            throw new PushError(
                `Failed to add pusher: ${err?.message ?? 'Unknown error'}`,
                matrixErr?.errcode ?? "UNKNOWN",
                matrixErr?.httpStatus ?? 0
            );
        }
    }

    /**
     * 移除 pusher
     */
    async removePusher(appId: string, pushkey: string): Promise<void> {
        try {
            await this.client.setPusher({
                app_id: appId,
                pushkey,
                kind: '' as unknown as string,
                app_display_name: '',
                device_display_name: '',
                lang: ''
            } as any);
            await this.getPushers();
        } catch (e: unknown) {
            this.handleError("removePusher", e);
            const err = e as Error;
            const matrixErr = e as MatrixError;
            throw new PushError(
                `Failed to remove pusher: ${err?.message ?? 'Unknown error'}`,
                matrixErr?.errcode ?? "UNKNOWN",
                matrixErr?.httpStatus ?? 0
            );
        }
    }

    /**
     * 获取缓存的 pusher 列表
     */
    getCachedPushers(): Array<Record<string, unknown>> {
        return this.pushers;
    }

    /**
     * 获取服务器推送通知能力
     */
    async getCapabilities(): Promise<PushCapabilities> {
        if (this.capabilities) {
            return this.capabilities;
        }

        try {
            const caps = await this.client.getCapabilities() as any;
            this.capabilities = {
                supports: {
                    push: caps?.push?.enabled ?? false,
                    formats: caps?.push?.formats ?? []
                }
            };
            return this.capabilities;
        } catch (e) {
            this.handleError("getCapabilities", e);
            throw this.normalizeError(e, "getCapabilities");
        }
    }

    /**
     * 清除缓存
     */
    clearCache(): void {
        this.pushers = [];
        this.capabilities = null;
    }

    start(): void {
        this.getPushers().catch(e => {
            logger.warn('PushManager.start failed to get pushers:', e);
        });
    }

    stop(): void {
        this.clearCache();
    }

    private handleError(method: string, error: unknown): void {
        if (error instanceof MatrixError) {
            logger.warn(`PushManager.${method} failed: [${error.errcode}] ${error.message}`);
        } else {
            logger.warn(`PushManager.${method} failed:`, error);
        }
    }

    private normalizeError(error: unknown, method: string): PushError {
        const err = error as Error;
        const matrixErr = error instanceof MatrixError ? error : null;
        return new PushError(
            `PushManager.${method} failed: ${err?.message ?? 'Unknown error'}`,
            matrixErr?.errcode ?? "UNKNOWN",
            matrixErr?.httpStatus ?? 500
        );
    }
}

// Type declaration for MatrixClient extension
declare module "../client.ts" {
    interface MatrixClient {
        getPushManager(): PushManager;
    }
}

/**
 * 扩展 MatrixClient 原型
 */
export function extendMatrixClient(): void {
    MatrixClient.prototype.getPushManager = function (): PushManager {
        return new PushManager(this);
    };
}

export default extendMatrixClient;