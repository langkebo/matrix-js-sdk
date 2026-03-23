import { logger } from "../logger"
/*
Copyright 2024 The Matrix.org Foundation C.I.C.
*/

/**
 * Push Manager - 推送管理
 * 
 * 提供推送通知和推送规则管理功能
 */

export interface PushRule {
    rule_id: string
    default: boolean
    enabled: boolean
    pattern?: string
    conditions?: Array<{
        kind: string
        [key: string]: any
    }>
    actions: string[]
}

export interface PushManagerRuleSet {
    override?: PushRule[]
    content?: PushRule[]
    room?: PushRule[]
    sender?: PushRule[]
    underride?: PushRule[]
}

export interface PushRuleActions {
    actions: string[]
    tweaks?: {
        highlight?: boolean
        sound?: string
        vibration?: boolean
    }
}

export interface PushNotification {
    room_id: string
    room_name?: string
    room_icon?: string
    sender_name?: string
    sender_avatar?: string
    event_id: string
    txn_id?: string
    priority?: string
    content: Record<string, any>
    counts: {
        unread: number
        missed_calls?: number
    }
    devices: Array<{
        app_id: string
        pushkey: string
        data: Record<string, any>
    }>
}

export interface PushGatewayConfig {
    url: string
    format: 'event_id_only' | 'event_id_only_push' | 'p2p'
}

export class PushManager {
    private client: any;
    private pushers: any[] = [];

    constructor(client: any) {
        this.client = client;
    }

    /**
     * 获取推送规则
     */
    async getPushRules(): Promise<PushManagerRuleSet> {
        try {
            return await this.client.getPushRules();
        } catch (e) {
            logger.warn('PushManager.getPushRules failed:', e);
            return {};
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
            logger.warn('PushManager.getRulesByKind failed:', e);
            return [];
        }
    }

    /**
     * 添加推送规则
     */
    async addPushRule(
        kind: string,
        ruleId: string,
        pattern?: string,
        actions?: string[]
    ): Promise<void> {
        try {
            await this.client.addPushRule(kind, ruleId, {
                pattern,
                actions: actions || ['notify']
            });
        } catch (e) {
            logger.warn('PushManager.addPushRule failed:', e);
        }
    }

    /**
     * 删除推送规则
     */
    async deletePushRule(kind: string, ruleId: string): Promise<void> {
        try {
            await this.client.deletePushRule(kind, ruleId);
        } catch (e) {
            logger.warn('PushManager.deletePushRule failed:', e);
        }
    }

    /**
     * 启用/禁用推送规则
     */
    async setPushRuleEnabled(kind: string, ruleId: string, enabled: boolean): Promise<void> {
        try {
            await this.client.setPushRuleEnabled(kind, ruleId, enabled);
        } catch (e) {
            logger.warn('PushManager.setPushRuleEnabled failed:', e);
        }
    }

    /**
     * 更新推送规则动作
     */
    async updatePushRuleActions(kind: string, ruleId: string, actions: string[]): Promise<void> {
        try {
            await this.client.updatePushRuleActions(kind, ruleId, actions);
        } catch (e) {
            logger.warn('PushManager.updatePushRuleActions failed:', e);
        }
    }

    /**
     * 忽略用户发送者
     */
    async ignoreUser(userId: string): Promise<void> {
        await this.addPushRule('sender', userId, undefined, ['dont_notify']);
    }

    /**
     * 取消忽略用户
     */
    async unignoreUser(userId: string): Promise<void> {
        await this.deletePushRule('sender', userId);
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
        await this.addPushRule('content', keyword, keyword, ['notify', 'highlight']);
    }

    /**
     * 移除关键词高亮
     */
    async removeKeywordHighlight(keyword: string): Promise<void> {
        await this.deletePushRule('content', keyword);
    }

    /**
     * 静音房间
     */
    async muteRoom(roomId: string): Promise<void> {
        await this.addPushRule('room', roomId, undefined, ['dont_notify']);
    }

    /**
     * 取消房间静音
     */
    async unmuteRoom(roomId: string): Promise<void> {
        await this.deletePushRule('room', roomId);
    }

    /**
     * 获取所有 pusher
     */
    async getPushers(): Promise<any[]> {
        try {
            const result = await this.client.getPushers();
            this.pushers = result.pushers || [];
            return this.pushers;
        } catch (e) {
            logger.warn('PushManager.getPushers failed:', e);
            return [];
        }
    }

    /**
     * 添加 pusher
     */
    async addPusher(config: {
        app_id: string
        pushkey: string
        kind: string
        app_display_name?: string
        device_display_name?: string
        lang?: string
        data?: Record<string, any>
    }): Promise<void> {
        try {
            await this.client.setPusher(config);
        } catch (e) {
            logger.warn('PushManager.addPusher failed:', e);
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
                kind: null
            });
        } catch (e) {
            logger.warn('PushManager.removePusher failed:', e);
        }
    }

    /**
     * 获取服务器推送通知能力
     */
    async getCapabilities(): Promise<{
        push: boolean
        formats: string[]
    }> {
        try {
            const caps = await this.client.getCapabilities();
            return {
                push: caps.push?.enabled || false,
                formats: caps.push?.formats || []
            };
        } catch (e) {
            logger.warn('PushManager.getCapabilities failed:', e);
            return { push: false, formats: [] };
        }
    }

    /**
     * 提交推送打扰通知
     */
    async submitNotification(notification: PushNotification): Promise<{ rejected?: string[] }> {
        try {
            return await this.client.submitNotification(notification);
        } catch (e) {
            logger.warn('PushManager.submitNotification failed:', e);
            return {};
        }
    }

    start(): void {}
    stop(): void {}
}
